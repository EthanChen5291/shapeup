// POST { imageDataUrl, outputName?, needPly?, projectId?, async?, mode? }
//      → sync:  { jobId, splatUrl, plyUrl, videoUrl }
//      → async: 202 { jobId, projectId }  (build continues via after())
//
// Tries reconstruction upstreams in priority order (secondary worker first
// when up, primary worker as the reliable fallback). The primary worker
// converts PLY → splat and uploads to S3 from inside the GPU container,
// returning just the S3 keys. The secondary worker returns base64, so for
// that path this handler converts PLY → splat and uploads to S3 itself.
// The raw ~40 MB .ply is only uploaded when needPly is true (it dominates the
// upload time and the viewer never uses it — only flows that diff two Gaussian
// clouds, e.g. hair subtraction, need it); otherwise plyUrl comes back null.
//
// Async mode: when async===true && projectId is supplied the route responds
// 202 immediately after starting the build, then continues work inside
// after() from next/server (bounded by maxDuration). The project document is
// updated via api.projects.{startBuild,completeBuild,failBuild} so the client
// can subscribe and observe the result without polling this endpoint.
// mode:'edit' (a hair edit's head) uses {startEditBuild,completeEditBuild,
// failEditBuild} instead: same lifecycle on the editBuild* fields.

export const maxDuration = 300; // Vercel Hobby cap; upstream work must finish within 5 min.

import { NextRequest, NextResponse, after } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { getSignedDownloadUrl } from '@/lib/s3';
import { RATE_LIMITS, getClientIp, hashIdentifier } from '@/lib/rateLimit';
import { enforceDurableRateLimits } from '@/lib/durableRateLimit';
import { requireSignedIn } from '@/lib/serverAuth';
import { parseImageDataUrl } from '@/lib/imageDataUrl';
import { logEvent } from '@/lib/log';
import { traced } from '@/lib/trace';
import { isFaceliftConfigured } from '@/lib/facelift';
import {
  MAX_FACELIFT_IMAGE_BYTES, cancelSupersededJob, finishAsyncBuild, holdGeneration, runFaceliftWork,
} from '@/lib/faceliftWork';
import { FREE_MODE } from '@/lib/freeMode';

export async function POST(req: NextRequest) {
  if (!isFaceliftConfigured()) {
    console.error('[facelift] POST: no FaceLift upstream configured (FACELIFT_URL / OSCAR_FACELIFT_URL)');
    return NextResponse.json({ error: 'FaceLift upstream not configured' }, { status: 503 });
  }

  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;
  const convexToken = await authResult.session.getToken({ template: 'convex' });
  if (!convexToken) {
    return NextResponse.json({ error: 'Convex auth token unavailable' }, { status: 401 });
  }

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(convexToken);

  // Allowlisted demo/dev accounts get a higher per-user generation limit.
  let isDemoUser = false;
  try {
    isDemoUser = await convex.query(api.users.isAllowlisted, {});
  } catch (err) {
    console.error('[facelift] POST: allowlist check failed (treating as non-demo):', err);
  }

  // Allowlisted demo/dev accounts get a raised per-user cap (20 / 10 min).
  const DEMO_FACELIFT_USER_LIMIT = 20;

  const ip = getClientIp(req);
  const rateLimited = await enforceDurableRateLimits([
    {
      ...RATE_LIMITS.faceliftUser,
      limit: isDemoUser ? DEMO_FACELIFT_USER_LIMIT : RATE_LIMITS.faceliftUser.limit,
      key: authResult.session.userId,
    },
    { ...RATE_LIMITS.faceliftIp, key: ip },
  ], authResult.session, {
    route: '/api/facelift',
    user: hashIdentifier(authResult.session.userId),
    ip: hashIdentifier(ip),
  });
  if (rateLimited) return rateLimited;

  let hasConsent = await convex.query(api.users.hasBiometricConsent, {});
  if (!hasConsent) {
    // Retry once after a short delay — consent may have just been recorded client-side
    // and the HTTP client snapshot can lag the mutation commit by a small window.
    await new Promise(r => setTimeout(r, 1200));
    hasConsent = await convex.query(api.users.hasBiometricConsent, {});
  }
  console.log('[facelift] POST: biometric consent check result:', hasConsent, { user: hashIdentifier(authResult.session.userId) });
  if (!hasConsent) {
    console.warn('[facelift] POST: rejected missing biometric consent', {
      user: hashIdentifier(authResult.session.userId),
    });
    return NextResponse.json({ error: 'Biometric consent is required before FaceLift processing' }, { status: 403 });
  }

  let imageDataUrl: string | undefined;
  let outputName = 'edit-output';
  let fingerprint: string | undefined;
  // Default false: the viewer only needs the splat. Callers that diff the raw
  // Gaussian cloud (e.g. hair subtraction) set needPly:true to keep the .ply.
  let needPly = false;
  let asyncMode = false;
  let projectId: string | undefined;
  // 'build' = the project's first head (buildStatus, build ghost, defaultScan);
  // 'edit' = a hair edit's head (editBuildStatus). Async mode only.
  let mode: 'build' | 'edit' = 'build';
  // Edit mode: the request behind the cut, recorded for Recap when it completes.
  let editPrompt: string | undefined;
  try {
    let rawMode: unknown;
    let rawPrompt: unknown;
    ({ imageDataUrl, outputName = 'edit-output', fingerprint, needPly = false,
       async: asyncMode = false, projectId, mode: rawMode, prompt: rawPrompt } = await req.json() as {
      imageDataUrl?: string;
      outputName?: string;
      fingerprint?: string;
      needPly?: boolean;
      async?: boolean;
      projectId?: string;
      mode?: unknown;
      prompt?: unknown;
    });
    if (rawMode === 'edit') mode = 'edit';
    if (mode === 'edit' && typeof rawPrompt === 'string') editPrompt = rawPrompt.slice(0, 500);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsedImage = parseImageDataUrl(imageDataUrl, { maxBytes: MAX_FACELIFT_IMAGE_BYTES });
  if (!parsedImage.ok) {
    console.warn('[facelift] POST: rejected image payload', {
      reason: parsedImage.error,
      user: hashIdentifier(authResult.session.userId),
    });
    return NextResponse.json({ error: parsedImage.error }, { status: 400 });
  }

  // GPU budget guard: refuse before spinning up the primary worker so the
  // container scales to zero and billing stops once the monthly GPU-seconds
  // cap is hit.
  try {
    if (await convex.query(api.gpuUsage.isOverBudget, {})) {
      console.warn('[facelift] POST: rejected — monthly GPU budget reached', {
        user: hashIdentifier(authResult.session.userId),
      });
      return NextResponse.json({ error: 'Demo GPU budget reached — try again next month' }, { status: 503 });
    }
  } catch (err) {
    console.error('[facelift] POST: GPU budget check failed (allowing request):', err);
  }

  // Spend an entitlement: a paid credit if the user has one, otherwise one of
  // their monthly free generations (3/month, reset not accumulated, gated by
  // the anti-Sybil checks in freeGen.ts). Allowlisted demo/dev accounts bypass
  // billing entirely. FREE_MODE (limited-time "everything free") skips it too.
  // The jobId is minted before the charge so the spent entitlement is held
  // against it from the start: completeBuild commits the hold; failBuild, a
  // superseding startBuild, or the stale-build reaper release it
  // (convex/creditHolds.ts). The sync path settles it explicitly below.
  const jobId = crypto.randomUUID();
  let holdPlaced = false;
  if (!FREE_MODE && process.env.DISABLE_PAYWALL !== '1' && !isDemoUser) {
    const charge = await holdGeneration(convex, {
      jobId, ip, fingerprint, user: hashIdentifier(authResult.session.userId), route: 'facelift',
    });
    if (charge.response) return charge.response;
    holdPlaced = true;
  }

  // ---- Async build mode ----
  // Respond 202 immediately, continue work in after(). The client subscribes
  // to the project document to observe buildStatus transitioning to
  // 'ready' or 'failed'.
  if (asyncMode && typeof projectId === 'string') {
    const lifecycle = mode === 'edit'
      ? { start: api.projects.startEditBuild, complete: api.projects.completeEditBuild, fail: api.projects.failEditBuild }
      : { start: api.projects.startBuild, complete: api.projects.completeBuild, fail: api.projects.failBuild };
    // The build this one replaces, if that one is still running: its hold is
    // already released; we also tell the workers to drop it (below, in after()).
    let supersededJobId: string | undefined;
    try {
      const started = await convex.mutation(lifecycle.start, {
        projectId: projectId as Id<'projects'>,
        jobId,
      });
      if (typeof started?.supersededJobId === 'string') supersededJobId = started.supersededJobId;
    } catch {
      // Charged but no build will run: give the entitlement back.
      if (holdPlaced) {
        await convex.mutation(api.creditHolds.release, { jobId }).catch((err) => {
          logEvent('hold.release_failed', { jobId, after: 'startBuild failure' }, { level: 'error', error: err });
        });
      }
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    // Capture everything needed for the after() closure before responding.
    const capturedSession = authResult.session;
    const capturedConvex = convex;
    const capturedProjectId = projectId;
    const capturedJobId = jobId;
    const capturedBuffer = parsedImage.buffer;
    const capturedMimeType = parsedImage.mimeType;
    const capturedNeedPly = needPly;
    const capturedOutputName = outputName;
    const capturedUserHash = hashIdentifier(authResult.session.userId);
    const capturedSupersededJobId = supersededJobId;

    logEvent('build.accepted', { jobId: capturedJobId, projectId: capturedProjectId, mode, supersededJobId: capturedSupersededJobId });
    const acceptedAt = Date.now();

    // The build runs after the response, in its own span of this request's trace.
    after(() => traced('facelift.build', { jobId: capturedJobId, mode, projectId: capturedProjectId }, async () => {
      // The superseded build may still be queued on a worker: ask them to drop it.
      if (capturedSupersededJobId) await cancelSupersededJob(capturedSupersededJobId);
      await finishAsyncBuild({
        convex: capturedConvex,
        session: capturedSession,
        projectId: capturedProjectId,
        jobId: capturedJobId,
        mode,
        buffer: capturedBuffer,
        mimeType: capturedMimeType,
        needPly: capturedNeedPly,
        outputName: capturedOutputName,
        userHash: capturedUserHash,
        editPrompt,
        acceptedAt,
      });
    }));

    return NextResponse.json({ jobId, projectId }, { status: 202 });
  }

  // ---- Sync build mode (existing behaviour, byte-for-byte unchanged) ----
  const work = await runFaceliftWork({
    jobId,
    buffer: parsedImage.buffer,
    mimeType: parsedImage.mimeType,
    needPly,
    outputName,
    userHash: hashIdentifier(authResult.session.userId),
  });

  // Refresh the Convex JWT before post-build mutations. Long sync builds
  // (up to UPSTREAM_BUDGET_MS) outlive the initial ~60 s token, causing
  // gpuUsage.record and facelifts.recordResult to silently fail. Refreshing
  // here fixes that on the sync path too.
  const freshSyncToken = await authResult.session.getToken({ template: 'convex' }).catch(() => null);
  if (freshSyncToken) convex.setAuth(freshSyncToken);

  if (!work.ok) {
    // No head was produced: give the entitlement back.
    if (holdPlaced) {
      await convex.mutation(api.creditHolds.release, { jobId }).catch((err) => {
        logEvent('hold.release_failed', { jobId, after: 'upstream failure' }, { level: 'error', error: err });
      });
    }
    return NextResponse.json({ error: work.error }, { status: work.status });
  }

  const { jobId: syncJobId, splatKey, plyKey, videoKey, metaKey, elapsedS } = work;

  // The user got their head: the charge is final.
  if (holdPlaced) {
    await convex.mutation(api.creditHolds.commit, { jobId }).catch((err) => {
      logEvent('hold.commit_failed', { jobId }, { level: 'error', error: err });
    });
  }

  // Meter actual GPU-seconds (reported by the upstream) against the monthly budget.
  if (elapsedS !== null) {
    try {
      await convex.mutation(api.gpuUsage.record, { seconds: elapsedS });
    } catch (err) {
      console.error('[facelift] POST: failed to record GPU usage (non-fatal):', err);
    }
  }

  try {
    await convex.mutation(api.facelifts.recordResult, {
      jobId: syncJobId,
      splatS3Key: splatKey,
      ...(plyKey ? { plyS3Key: plyKey } : {}),
      ...(metaKey ? { metaS3Key: metaKey } : {}),
    });
    console.log(`[facelift] POST: recorded in Convex jobId=${syncJobId}`);
  } catch (err) {
    console.error('[facelift] POST: failed to record in Convex (non-fatal):', err);
  }

  const [plyUrl, splatUrl, videoUrl] = await Promise.all([
    plyKey ? getSignedDownloadUrl(plyKey) : Promise.resolve(null),
    getSignedDownloadUrl(splatKey),
    videoKey ? getSignedDownloadUrl(videoKey) : Promise.resolve(null),
  ]);

  console.log(`[facelift] POST: done jobId=${syncJobId}`);
  return NextResponse.json({ jobId: syncJobId, splatUrl, plyUrl, videoUrl, splatS3Key: splatKey, metaS3Key: metaKey });
}
