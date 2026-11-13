// POST { projectId, prompt, imageUrl, referenceImageDataUrl?, currentProfile?, fingerprint? }
//      → 202 { jobId, projectId }
//
// A whole hair edit as one server job. Before answering, the route checks
// everything that can be checked at once (auth, limits, consent, the photo and
// reference, the GPU budget), spends the entitlement as a hold on a fresh job
// id, and marks the project's edit build "building" at stage "editing". Then,
// in after(): wake the GPU worker, make the edited photo with the image model,
// save it and move the job to stage "building" (markEditImageReady), and build
// the head from it (finishAsyncBuild → completeEditBuild / failEditBuild).
//
// The browser only watches the project document, as for a first scan, so a
// closed tab or a refresh at any point loses nothing, and every image-model
// call is paid for (the hold is released if no head comes out of it). The
// older browser-driven path (/api/gemini-hair-edit, then /api/facelift with
// mode 'edit') still works for callers without a project.
//
// One function invocation carries both halves, so they share maxDuration: the
// image model gets IMAGE_EDIT_TIMEOUT_MS, and the workers get what is left of
// EDIT_JOB_BUDGET_MS (at most UPSTREAM_BUDGET_MS). A job that still dies is
// failed by the stale-build reaper, which releases the hold.

export const maxDuration = 300;

import { NextRequest, NextResponse, after } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { RATE_LIMITS, getClientIp, hashIdentifier } from '@/lib/rateLimit';
import { enforceDurableRateLimits } from '@/lib/durableRateLimit';
import { requireSignedIn } from '@/lib/serverAuth';
import { isSafeImageSource } from '@/lib/urlSafety';
import { parseImageDataUrl } from '@/lib/imageDataUrl';
import { logEvent } from '@/lib/log';
import { traced } from '@/lib/trace';
import { isFaceliftConfigured } from '@/lib/facelift';
import { FREE_MODE } from '@/lib/freeMode';
import { EDIT_FAILED_ERROR } from '@/lib/userFacingError';
import {
  BUILDER_BUSY, MAX_FACELIFT_IMAGE_BYTES, UPSTREAM_BUDGET_MS,
  cancelSupersededJob, finishAsyncBuild, holdGeneration, refreshConvexAuth, wakeTopWorker,
} from '@/lib/faceliftWork';
import {
  MAX_PROMPT_LENGTH, SAFETY_BLOCKED_ERROR, generateHairEdit, loadSourceImage, prepareHairReference, uploadEditImage,
} from '@/lib/hairEdit';

/** Everything after the 202, inside maxDuration with headroom for the final Convex writes. */
const EDIT_JOB_BUDGET_MS = 270_000;
/** The image model's share. Measured edits take ~8-12 s; past this one is not coming back. */
const IMAGE_EDIT_TIMEOUT_MS = 60_000;
/** Allowlisted demo/dev accounts get a raised per-user build cap (20 / 10 min), as on /api/facelift. */
const DEMO_FACELIFT_USER_LIMIT = 20;

export async function POST(req: NextRequest) {
  if (!isFaceliftConfigured()) {
    console.error('[edit-job] POST: no FaceLift upstream configured (FACELIFT_URL / OSCAR_FACELIFT_URL)');
    return NextResponse.json({ error: 'FaceLift upstream not configured' }, { status: 503 });
  }

  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;
  const session = authResult.session;
  const convexToken = await session.getToken({ template: 'convex' });
  if (!convexToken) {
    return NextResponse.json({ error: 'Convex auth token unavailable' }, { status: 401 });
  }
  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(convexToken);
  const userHash = hashIdentifier(session.userId);

  let isDemoUser = false;
  try {
    isDemoUser = await convex.query(api.users.isAllowlisted, {});
  } catch (err) {
    console.error('[edit-job] POST: allowlist check failed (treating as non-demo):', err);
  }

  // Both halves' limits: an edit job is an image edit and a 3D build.
  const ip = getClientIp(req);
  const rateLimited = await enforceDurableRateLimits([
    { ...RATE_LIMITS.geminiEditUser, key: session.userId },
    { ...RATE_LIMITS.geminiEditIp, key: ip },
    { ...RATE_LIMITS.geminiEditUserDay, key: session.userId },
    { ...RATE_LIMITS.geminiEditIpDay, key: ip },
    {
      ...RATE_LIMITS.faceliftUser,
      limit: isDemoUser ? DEMO_FACELIFT_USER_LIMIT : RATE_LIMITS.faceliftUser.limit,
      key: session.userId,
    },
    { ...RATE_LIMITS.faceliftIp, key: ip },
  ], session, { route: '/api/edit-job', user: userHash, ip: hashIdentifier(ip) });
  if (rateLimited) return rateLimited;

  if (!await convex.query(api.users.hasBiometricConsent, {})) {
    console.warn('[edit-job] POST: rejected missing biometric consent', { user: userHash });
    return NextResponse.json({ error: 'Biometric consent is required before FaceLift processing' }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { projectId, prompt, imageUrl, referenceImageDataUrl, fingerprint } = body;
  const currentProfile = body.currentProfile ?? null;
  if (typeof projectId !== 'string' || !projectId) {
    return NextResponse.json({ error: 'projectId is required' }, { status: 400 });
  }
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json({ error: `prompt must be a non-empty string of at most ${MAX_PROMPT_LENGTH} characters` }, { status: 400 });
  }
  if (typeof imageUrl !== 'string' || !isSafeImageSource(imageUrl)) {
    return NextResponse.json({ error: 'imageUrl is not allowed' }, { status: 400 });
  }

  // The inputs are read now, while the request (and its cookies, for /api/img)
  // is live; only the model call waits for after().
  const reference = await prepareHairReference(referenceImageDataUrl);
  if (!reference.ok) return NextResponse.json({ error: reference.error }, { status: reference.status });
  const source = await loadSourceImage({
    imageUrl,
    origin: new URL(req.url).origin,
    cookie: req.headers.get('cookie'),
    authorization: req.headers.get('authorization'),
  });
  if (!source.ok) return NextResponse.json({ error: source.error }, { status: source.status });

  try {
    if (await convex.query(api.gpuUsage.isOverBudget, {})) {
      console.warn('[edit-job] POST: rejected — monthly GPU budget reached', { user: userHash });
      return NextResponse.json({ error: 'Demo GPU budget reached — try again next month' }, { status: 503 });
    }
  } catch (err) {
    console.error('[edit-job] POST: GPU budget check failed (allowing request):', err);
  }

  // Charged before the image model runs: the model costs money too, and the
  // hold is released if no head comes out of this job.
  const jobId = crypto.randomUUID();
  let holdPlaced = false;
  if (!FREE_MODE && process.env.DISABLE_PAYWALL !== '1' && !isDemoUser) {
    const charge = await holdGeneration(convex, {
      jobId, ip, fingerprint: typeof fingerprint === 'string' ? fingerprint : undefined, user: userHash, route: 'edit-job',
    });
    if (charge.response) return charge.response;
    holdPlaced = true;
  }

  let supersededJobId: string | undefined;
  try {
    const started = await convex.mutation(api.projects.startEditBuild, {
      projectId: projectId as Id<'projects'>,
      jobId,
      stage: 'editing',
    });
    if (typeof started?.supersededJobId === 'string') supersededJobId = started.supersededJobId;
  } catch {
    // Charged but no job will run: give the entitlement back.
    if (holdPlaced) {
      await convex.mutation(api.creditHolds.release, { jobId }).catch((err) => {
        logEvent('hold.release_failed', { jobId, after: 'startEditBuild failure' }, { level: 'error', error: err });
      });
    }
    return NextResponse.json({ error: 'Project not found' }, { status: 404 });
  }

  const editPrompt = prompt.slice(0, MAX_PROMPT_LENGTH);
  const acceptedAt = Date.now();
  logEvent('edit_job.accepted', { jobId, projectId, supersededJobId });

  after(() => traced('edit.job', { jobId, projectId }, async () => {
    const fail = async (error: string) => {
      await refreshConvexAuth(convex, session, jobId);
      await convex.mutation(api.projects.failEditBuild, { projectId: projectId as Id<'projects'>, jobId, error });
    };
    try {
      if (supersededJobId) await cancelSupersededJob(supersededJobId);
      // Overlap the worker's cold start (~6-8 s) with the image edit (~8-12 s).
      void wakeTopWorker();

      const editStart = Date.now();
      const edit = await generateHairEdit({
        source: source.part, reference: reference.part, prompt: editPrompt, currentProfile, timeoutMs: IMAGE_EDIT_TIMEOUT_MS,
      });
      logEvent('edit_job.image', {
        jobId, ok: edit.ok, ms: Date.now() - editStart,
        reason: edit.ok ? undefined : edit.error, report: edit.ok && edit.editReport ? JSON.stringify(edit.editReport) : undefined,
      }, { level: edit.ok ? 'info' : 'warn' });
      if (!edit.ok) {
        // The safety refusal is written for users; anything else is not.
        await fail(edit.error === SAFETY_BLOCKED_ERROR ? SAFETY_BLOCKED_ERROR : EDIT_FAILED_ERROR);
        return;
      }

      const image = parseImageDataUrl(`data:${edit.mimeType};base64,${edit.base64}`, { maxBytes: MAX_FACELIFT_IMAGE_BYTES });
      if (!image.ok) {
        logEvent('edit_job.image_rejected', { jobId, reason: image.error }, { level: 'warn' });
        await fail(EDIT_FAILED_ERROR);
        return;
      }
      const editImageKey = await uploadEditImage(image.buffer);

      await refreshConvexAuth(convex, session, jobId);
      const marked = await convex.mutation(api.projects.markEditImageReady, {
        projectId: projectId as Id<'projects'>, jobId, lastEditImageS3Key: editImageKey,
      });
      if (!marked.applied) {
        // A newer edit replaced this one (and released its hold): don't build it.
        logEvent('edit_job.superseded', { jobId, at: 'image' });
        return;
      }

      await finishAsyncBuild({
        convex, session, projectId, jobId, mode: 'edit',
        buffer: image.buffer, mimeType: image.mimeType, needPly: false, outputName: 'edit-output', userHash,
        editPrompt, acceptedAt,
        budgetMs: Math.min(UPSTREAM_BUDGET_MS, EDIT_JOB_BUDGET_MS - (Date.now() - acceptedAt)),
      });
    } catch (err) {
      logEvent('edit_job.crashed', { jobId, ms: Date.now() - acceptedAt }, { level: 'error', error: err });
      try {
        await fail(BUILDER_BUSY);
      } catch (failErr) {
        logEvent('edit_job.fail_unrecorded', { jobId }, { level: 'error', error: failErr });
      }
    }
  }));

  return NextResponse.json({ jobId, projectId }, { status: 202 });
}
