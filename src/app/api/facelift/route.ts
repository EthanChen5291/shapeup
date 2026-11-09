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
import { ConvexError } from 'convex/values';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { getSignedDownloadUrl, uploadToS3 } from '@/lib/s3';
import { RATE_LIMITS, getClientIp, hashIdentifier } from '@/lib/rateLimit';
import { enforceDurableRateLimits } from '@/lib/durableRateLimit';
import { requireSignedIn } from '@/lib/serverAuth';
import { parseImageDataUrl, sanitizeOutputName } from '@/lib/imageDataUrl';
import { logEvent } from '@/lib/log';
import { traced } from '@/lib/trace';
import { getFaceliftHeaders, isFaceliftConfigured, resolveFaceliftUpstreams } from '@/lib/facelift';
import { FREE_MODE } from '@/lib/freeMode';
import fs from 'fs/promises';
import path from 'path';

const SH_C0 = 0.28209479177387814;
const MAX_FACELIFT_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_PLY_BYTES = 80 * 1024 * 1024;
const MAX_VIDEO_BYTES = 120 * 1024 * 1024;
// Total time all upstream attempts may take. Must leave headroom under
// maxDuration for auth/Convex work before and S3 signing after — otherwise a
// stalled upstream (e.g. the primary worker queued waiting for GPU capacity)
// gets the function killed by the platform, and the client sees a raw 504
// page instead of our error.
const UPSTREAM_BUDGET_MS = 240_000;
// A cancel is best effort and must never hold up the build it belongs to.
const CANCEL_TIMEOUT_MS = 5_000;
const BUILDER_BUSY = 'Our 3D builder is busy right now. Please try again in a few minutes.';
const IDENTITY_DRIFT_ERROR = "That edit changed your face too much, so we didn't build it. Try describing just the hair.";
const BUILD_CANCELLED_ERROR = 'This build was replaced by a newer one.';

/** The `code` of a worker's structured refusal `{ detail: { code } }` (422 identity_drift, 409 cancelled), else null. */
function workerCode(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { detail?: { code?: unknown } };
    return typeof parsed.detail?.code === 'string' ? parsed.detail.code : null;
  } catch {
    return null;
  }
}

// Tell a worker to drop a job. The worker skips it if it is still waiting for the
// GPU; a job already running finishes (inference cannot be interrupted). Best
// effort: never throws and never changes the build's outcome. A 404 means the
// backend predates the endpoint (or is the secondary worker), which is fine.
async function cancelFaceliftJob(url: string, jobId: string, why: string): Promise<void> {
  try {
    const res = await fetch(`${url}/cancel/${encodeURIComponent(jobId)}`, {
      method: 'POST',
      headers: getFaceliftHeaders(),
      signal: AbortSignal.timeout(CANCEL_TIMEOUT_MS),
    });
    if (res.status === 404) {
      console.log(`[facelift] cancel ${jobId} (${why}): backend has no cancel endpoint`);
      return;
    }
    const body = res.ok ? await res.json().catch(() => null) as { queued?: unknown } | null : null;
    console.log(`[facelift] cancel ${jobId} (${why}): HTTP ${res.status} queued=${body?.queued === true}`);
  } catch (err) {
    console.warn(`[facelift] cancel ${jobId} (${why}) failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const PLY_SIZES: Record<string, number> = {
  float: 4, float32: 4, double: 8, float64: 8,
  char: 1, uchar: 1, int8: 1, uint8: 1,
  short: 2, ushort: 2, int16: 2, uint16: 2,
  int: 4, uint: 4, int32: 4, uint32: 4,
};

function plyToSplat(plyBuf: Buffer): Buffer {
  const END = Buffer.from('end_header\n');
  const headerEnd = plyBuf.indexOf(END);
  if (headerEnd === -1) throw new Error('Invalid PLY: no end_header');
  const dataOffset = headerEnd + END.length;
  const header = plyBuf.subarray(0, headerEnd).toString('ascii');

  const vcountMatch = header.match(/element vertex (\d+)/);
  if (!vcountMatch) throw new Error('No vertex count in PLY');
  const vcount = parseInt(vcountMatch[1]);

  const propLines = [...header.matchAll(/^property (\S+) (\S+)$/gm)];
  const propOffset: Record<string, number> = {};
  let stride = 0;
  for (const [, type, name] of propLines) {
    propOffset[name] = stride;
    stride += PLY_SIZES[type] ?? 4;
  }

  const f = (i: number, name: string) =>
    plyBuf.readFloatLE(dataOffset + i * stride + propOffset[name]);

  const x   = new Float32Array(vcount);
  const y   = new Float32Array(vcount);
  const z   = new Float32Array(vcount);
  const r   = new Float32Array(vcount);
  const g   = new Float32Array(vcount);
  const b   = new Float32Array(vcount);
  const a   = new Float32Array(vcount);
  const sx  = new Float32Array(vcount);
  const sy  = new Float32Array(vcount);
  const sz  = new Float32Array(vcount);
  const q   = [
    new Float32Array(vcount),
    new Float32Array(vcount),
    new Float32Array(vcount),
    new Float32Array(vcount),
  ];

  for (let i = 0; i < vcount; i++) {
    x[i]  = f(i, 'x');
    y[i]  = f(i, 'y');
    z[i]  = f(i, 'z');
    r[i]  = Math.min(1, Math.max(0, 0.5 + SH_C0 * f(i, 'f_dc_0')));
    g[i]  = Math.min(1, Math.max(0, 0.5 + SH_C0 * f(i, 'f_dc_1')));
    b[i]  = Math.min(1, Math.max(0, 0.5 + SH_C0 * f(i, 'f_dc_2')));
    a[i]  = 1.0 / (1.0 + Math.exp(-f(i, 'opacity')));
    sx[i] = Math.exp(f(i, 'scale_0'));
    sy[i] = Math.exp(f(i, 'scale_1'));
    sz[i] = Math.exp(f(i, 'scale_2'));
    const q0 = f(i, 'rot_0'), q1 = f(i, 'rot_1'), q2 = f(i, 'rot_2'), q3 = f(i, 'rot_3');
    const qlen = Math.max(1e-8, Math.sqrt(q0*q0 + q1*q1 + q2*q2 + q3*q3));
    q[0][i] = q0 / qlen;
    q[1][i] = q1 / qlen;
    q[2][i] = q2 / qlen;
    q[3][i] = q3 / qlen;
  }

  const order = Array.from({ length: vcount }, (_, i) => i).sort((a2, b2) => a[b2] - a[a2]);

  const out = Buffer.allocUnsafe(vcount * 32);
  for (let i = 0; i < vcount; i++) {
    const j = order[i];
    const off = i * 32;
    out.writeFloatLE(x[j],  off);
    out.writeFloatLE(y[j],  off + 4);
    out.writeFloatLE(z[j],  off + 8);
    out.writeFloatLE(sx[j], off + 12);
    out.writeFloatLE(sy[j], off + 16);
    out.writeFloatLE(sz[j], off + 20);
    out.writeUInt8(Math.round(r[j] * 255), off + 24);
    out.writeUInt8(Math.round(g[j] * 255), off + 25);
    out.writeUInt8(Math.round(b[j] * 255), off + 26);
    out.writeUInt8(Math.round(a[j] * 255), off + 27);
    out.writeUInt8(Math.min(255, Math.max(0, Math.round(q[0][j] * 128 + 128))), off + 28);
    out.writeUInt8(Math.min(255, Math.max(0, Math.round(q[1][j] * 128 + 128))), off + 29);
    out.writeUInt8(Math.min(255, Math.max(0, Math.round(q[2][j] * 128 + 128))), off + 30);
    out.writeUInt8(Math.min(255, Math.max(0, Math.round(q[3][j] * 128 + 128))), off + 31);
  }

  console.log(`[facelift] converted ${vcount} gaussians → ${out.length} bytes splat`);
  return out;
}

function decodeBoundedBase64(value: unknown, maxBytes: number): Buffer | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (value.length > Math.ceil(maxBytes * 4 / 3) + 128) return null;
  const buffer = Buffer.from(value, 'base64');
  if (buffer.length === 0 || buffer.length > maxBytes) return null;
  return buffer;
}

// Upstream-supplied S3 keys are used verbatim to mint signed download URLs, so
// constrain them to the facelifts/ prefix and a safe charset — a compromised or
// buggy upstream must not be able to make us sign arbitrary bucket objects.
const S3_KEY_RE = /^facelifts\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
function isValidS3Key(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 256 && S3_KEY_RE.test(value);
}

// A successful upstream returns one of two shapes:
//  - 's3'     → the primary worker already converted PLY → splat and uploaded
//               both to S3; we get the keys back and skip all local processing.
//  - 'base64' → the secondary worker returns base64 PLY; the route converts +
//               uploads itself.
type UpstreamResult =
  | { ok: true; kind: 's3'; jobId: string; plyKey: string | null; splatKey: string; metaKey: string | null; elapsedS: number | null }
  | { ok: true; kind: 'base64'; plyBuffer: Buffer; videoBuffer: Buffer | null; elapsedS: number | null }
  // terminal: the worker refused this input on purpose; don't retry it elsewhere.
  // timedOut: we stopped waiting on this worker, so it may still be holding the job.
  | { ok: false; reason: string; terminal?: { status: number; error: string }; timedOut?: boolean };

// One synchronous attempt against a single upstream's /process_image. Any
// failure — network error, non-200, malformed JSON, or a missing/oversized
// payload (e.g. the secondary worker's async `{job_id}` response) — is
// returned as a soft failure so the caller can fall back to the next upstream
// instead of erroring.
async function callFaceliftUpstream(url: string, form: FormData, timeoutMs: number): Promise<UpstreamResult> {
  let upstream: Response;
  try {
    upstream = await fetch(`${url}/process_image`, {
      method: 'POST',
      headers: getFaceliftHeaders(),
      body: form,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { ok: false, reason: `network error: ${err instanceof Error ? err.message : String(err)}`, timedOut };
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    const code = workerCode(text);
    // The identity check rejected the edit. Falling back would build the same
    // image on a worker without the check, so stop here with a user-safe message.
    if (upstream.status === 422 && code === 'identity_drift') {
      return { ok: false, reason: 'identity_drift', terminal: { status: 422, error: IDENTITY_DRIFT_ERROR } };
    }
    // The worker dropped the job because we asked it to (a newer build superseded
    // it); building it on the next worker would spend the GPU time just saved.
    if (upstream.status === 409 && code === 'cancelled') {
      return { ok: false, reason: 'cancelled', terminal: { status: 409, error: BUILD_CANCELLED_ERROR } };
    }
    return { ok: false, reason: `HTTP ${upstream.status}: ${text}` };
  }

  let data: {
    job_id?: unknown;
    ply_s3_key?: unknown;
    splat_s3_key?: unknown;
    ply_b64?: unknown;
    video_b64?: unknown;
    elapsed_s?: unknown;
  };
  try {
    data = await upstream.json();
  } catch {
    return { ok: false, reason: 'malformed JSON' };
  }

  const elapsedS = typeof data.elapsed_s === 'number' && data.elapsed_s > 0 ? data.elapsed_s : null;

  // Primary worker (S3-from-container): already converted + uploaded, returns
  // S3 keys. Prefer this whenever the upstream signals it (either key
  // present), and reject keys outside the facelifts/ prefix before we ever
  // sign them. The .ply is optional (the primary worker omits it / returns
  // null when need_ply was false), so only the splat key is mandatory; a
  // present ply key must still be valid.
  if (data.splat_s3_key !== undefined || data.ply_s3_key !== undefined) {
    if (!isValidS3Key(data.splat_s3_key)) {
      return { ok: false, reason: 'missing or invalid splat_s3_key' };
    }
    let plyKey: string | null = null;
    if (data.ply_s3_key !== undefined && data.ply_s3_key !== null) {
      if (!isValidS3Key(data.ply_s3_key)) {
        return { ok: false, reason: 'invalid ply_s3_key' };
      }
      plyKey = data.ply_s3_key;
    }
    // Optional sidecar (viewer transform + provenance) the worker writes next to the splat.
    let metaKey: string | null = null;
    const metaRaw = (data as { meta_s3_key?: unknown }).meta_s3_key;
    if (typeof metaRaw === 'string' && metaRaw) {
      if (!isValidS3Key(metaRaw)) {
        return { ok: false, reason: 'invalid meta_s3_key' };
      }
      metaKey = metaRaw;
    }
    const jobId = typeof data.job_id === 'string' && data.job_id ? data.job_id : crypto.randomUUID();
    return { ok: true, kind: 's3', jobId, plyKey, splatKey: data.splat_s3_key, metaKey, elapsedS };
  }

  // Secondary worker (base64): the route decodes, converts, and uploads.
  const plyBuffer = decodeBoundedBase64(data.ply_b64, MAX_PLY_BYTES);
  if (!plyBuffer) return { ok: false, reason: 'missing or invalid ply_s3_key / ply_b64' };

  let videoBuffer: Buffer | null = null;
  if (data.video_b64) {
    videoBuffer = decodeBoundedBase64(data.video_b64, MAX_VIDEO_BYTES);
    if (!videoBuffer) return { ok: false, reason: 'invalid video_b64' };
  }

  return { ok: true, kind: 'base64', plyBuffer, videoBuffer, elapsedS };
}

// WorkResult is the outcome of the core upstream-loop + S3-upload work,
// shared between the sync response path and the async after() callback.
type WorkResult =
  | { ok: true; jobId: string; splatKey: string; plyKey: string | null; videoKey: string | null; metaKey: string | null; elapsedS: number | null }
  | { ok: false; status: number; error: string };

// runFaceliftWork encapsulates the upstream loop, PLY→splat conversion, and
// S3 uploads. It does NOT call any Convex mutations — callers do that with a
// freshly-minted token after this returns (long builds can outlive a 60 s JWT).
async function runFaceliftWork({
  jobId: requestedJobId,
  buffer,
  mimeType,
  needPly,
  outputName,
  userHash,
  referenceS3Key = null,
}: {
  /** The build's one id: credit hold, project build, S3 folder and facelift row all use it. */
  jobId: string;
  buffer: Buffer;
  mimeType: string;
  needPly: boolean;
  outputName: string;
  userHash: string;
  /** Edits only: the original selfie the worker's identity check compares against. */
  referenceS3Key?: string | null;
}): Promise<WorkResult> {
  const uploadExt = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const imageBytes = new Uint8Array(buffer.length);
  imageBytes.set(buffer);
  const imageBlob = new Blob([imageBytes], { type: mimeType });
  const buildForm = () => {
    const form = new FormData();
    form.append('image', imageBlob, `face.${uploadExt}`);
    // The primary worker skips the heavy .ply S3 upload unless this is set.
    form.append('need_ply', needPly ? 'true' : 'false');
    // The worker files its outputs under facelifts/<job_id>/ and treats a repeat
    // of the same id as the same job (returns the finished result, no second GPU run).
    form.append('job_id', requestedJobId);
    if (referenceS3Key) form.append('reference_s3_key', referenceS3Key);
    return form;
  };

  const upstreams = await resolveFaceliftUpstreams();
  const deadline = Date.now() + UPSTREAM_BUDGET_MS;
  let result: Extract<UpstreamResult, { ok: true }> | null = null;
  const failures: string[] = [];
  for (const { name, url } of upstreams) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      failures.push(`${name}: skipped (time budget spent)`);
      continue;
    }
    console.log(`[facelift] trying ${name} → ${url} — ${buffer.length} bytes`);
    const attemptStart = Date.now();
    const attempt = await callFaceliftUpstream(url, buildForm(), remainingMs);
    logEvent('upstream.attempt', {
      jobId: requestedJobId, upstream: name, ok: attempt.ok, ms: Date.now() - attemptStart,
      reason: attempt.ok ? undefined : attempt.reason, timedOut: attempt.ok ? undefined : attempt.timedOut,
    }, { level: attempt.ok ? 'info' : 'warn' });
    if (attempt.ok) {
      console.log(`[facelift] ${name} succeeded (${attempt.kind})`);
      result = attempt;
      break;
    }
    console.warn(`[facelift] ${name} failed (${attempt.reason})`, { user: userHash });
    if (attempt.timedOut) {
      // We stopped waiting but the worker did not: ask it to drop the job if it
      // is still queued, so GPU time nobody will see is not spent (and billed).
      // Awaited (bounded by CANCEL_TIMEOUT_MS) so the request is not lost when
      // the function freezes right after failBuild; it cannot fail the build.
      await cancelFaceliftJob(url, requestedJobId, 'upstream budget spent');
    }
    if (attempt.terminal) return { ok: false, ...attempt.terminal };
    failures.push(`${name}: ${attempt.reason}`);
  }

  if (!result) {
    const detail = failures.join('; ') || 'no upstream configured';
    console.error(`[facelift] all FaceLift upstreams failed — ${detail}`);
    return { ok: false, status: 503, error: BUILDER_BUSY };
  }

  // Resolve the final S3 keys.
  let jobId: string;
  let plyKey: string | null = null;
  let splatKey: string;
  let videoKey: string | null = null;
  let metaKey: string | null = null;
  const elapsedS = result.elapsedS;

  if (result.kind === 's3') {
    ({ jobId, plyKey, splatKey, metaKey } = result);
    // A worker deployed before job_id was accepted mints its own; keep working,
    // but log it so the drift is visible.
    if (jobId !== requestedJobId) {
      console.warn('[facelift] worker ignored job_id', { requested: requestedJobId, got: jobId });
    }
  } else {
    let splatBuffer: Buffer;
    try {
      splatBuffer = plyToSplat(result.plyBuffer);
    } catch (err) {
      console.warn('[facelift] upstream returned malformed PLY', {
        user: userHash,
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, status: 502, error: BUILDER_BUSY };
    }

    jobId    = requestedJobId;
    splatKey = `facelifts/${jobId}/output.splat`;
    plyKey   = needPly ? `facelifts/${jobId}/output.ply` : null;
    videoKey = result.videoBuffer ? `facelifts/${jobId}/turntable.mp4` : null;

    await Promise.all([
      uploadToS3(splatKey, splatBuffer, 'application/octet-stream'),
      ...(plyKey ? [uploadToS3(plyKey, result.plyBuffer, 'application/octet-stream')] : []),
      ...(result.videoBuffer ? [uploadToS3(videoKey!, result.videoBuffer, 'video/mp4')] : []),
    ]);
    console.log(`[facelift] uploaded to S3 — ply=${plyKey ? `${result.plyBuffer.length}B` : 'skipped'} splat=${splatBuffer.length}B`);

    try {
      const publicDir = path.join(process.cwd(), 'public');
      const safeOutputName = sanitizeOutputName(outputName, 'edit-output');
      await Promise.all([
        fs.writeFile(path.join(publicDir, `${safeOutputName}.splat`), splatBuffer),
        ...(needPly ? [fs.writeFile(path.join(publicDir, `${safeOutputName}.ply`), result.plyBuffer)] : []),
      ]);
    } catch (err) {
      console.warn('[facelift] could not write local public/ files (non-fatal):', err);
    }
  }

  return { ok: true, jobId, splatKey, plyKey, videoKey, metaKey, elapsedS };
}

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
    try {
      await convex.mutation(api.freeGen.consumeGeneration, {
        jobId,
        ipHash: hashIdentifier(ip),
        fingerprintHash: typeof fingerprint === 'string' && fingerprint.length > 0
          ? hashIdentifier(fingerprint)
          : undefined,
      });
      holdPlaced = true;
    } catch (err) {
      // A ConvexError is an *intentional*, user-facing rejection from the
      // mutation (the message + structured data survive the wire even in prod).
      // consumeGeneration tags each with a `code`; `needsCredits` tells the
      // client whether to show the pricing modal (genuine credit exhaustion) or
      // surface the gate's actual message (e.g. "verify your email"). We keep a
      // 402 for the whole free-generation entitlement family.
      if (err instanceof ConvexError) {
        const data = (err.data && typeof err.data === 'object')
          ? err.data as { code?: string; message?: string }
          : { message: typeof err.data === 'string' ? err.data : err.message };
        const message = data.message ?? err.message;
        const CREDIT_CODES = new Set(['out_of_credits', 'free_gen_used', 'network_limited']);
        // Prefer the structured code; fall back to message matching so a route
        // deployed ahead of the updated mutation still classifies correctly.
        const needsCredits = data.code
          ? CREDIT_CODES.has(data.code)
          : /out of credits|free generation/i.test(message);
        return NextResponse.json({ error: message, code: data.code, needsCredits }, { status: 402 });
      }
      // Anything else is a masked Convex "Server Error" (an unexpected internal
      // failure, redacted to "[Request ID: …] Server Error" in prod). That is
      // NOT a client error — surface it as 502 and log the request id so it can
      // be traced in the Convex dashboard, instead of a misleading 400.
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[facelift] POST: consumeGeneration failed unexpectedly:', msg, {
        user: hashIdentifier(authResult.session.userId),
      });
      return NextResponse.json({ error: BUILDER_BUSY }, { status: 502 });
    }
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
      try {
        // Fire-and-forget: the superseded build may still be queued on a worker,
        // and we don't know which backend took it, so every configured one is
        // asked (a 404 just means that backend cannot cancel).
        if (capturedSupersededJobId) {
          const upstreams = await resolveFaceliftUpstreams();
          for (const { url } of upstreams) void cancelFaceliftJob(url, capturedSupersededJobId, 'superseded');
        }

        // Edits: the worker's identity check compares against the project's
        // original selfie. Read it server-side from the caller's own project
        // (projects.get checks ownership), never from the request, so nobody can
        // score their image against another user's photo. Only for users who
        // accepted a notice that discloses the check. Best-effort: without a
        // reference the worker skips the check.
        let referenceS3Key: string | null = null;
        if (mode === 'edit') {
          try {
            const consented = await capturedConvex.query(api.users.hasIdentityCheckConsent, {});
            const project = consented ? await capturedConvex.query(api.projects.get, {
              projectId: capturedProjectId as Id<'projects'>,
            }) : null;
            const key = project?.lastImageS3Key;
            if (typeof key === 'string' && key.startsWith('pictures/')) referenceS3Key = key;
          } catch (err) {
            console.warn('[facelift] async: selfie lookup for identity check failed (skipping check)', {
              jobId: capturedJobId,
              reason: err instanceof Error ? err.message : String(err),
            });
          }
        }

        const work = await runFaceliftWork({
          jobId: capturedJobId,
          buffer: capturedBuffer,
          mimeType: capturedMimeType,
          needPly: capturedNeedPly,
          outputName: capturedOutputName,
          userHash: capturedUserHash,
          referenceS3Key,
        });

        // Refresh the Convex JWT before any mutations — the upstream build
        // takes minutes and the initial 60 s token will have expired.
        try {
          const freshToken = await capturedSession.getToken({ template: 'convex' });
          if (freshToken) capturedConvex.setAuth(freshToken);
        } catch {
          console.error('[facelift] async: could not refresh Convex token (continuing with stale)', {
            jobId: capturedJobId,
          });
        }

        if (!work.ok) {
          logEvent('build.failed', { jobId: capturedJobId, mode, ms: Date.now() - acceptedAt, reason: work.error }, { level: 'warn' });
          await capturedConvex.mutation(lifecycle.fail, {
            projectId: capturedProjectId as Id<'projects'>,
            jobId: capturedJobId,
            // Always user-safe: BUILDER_BUSY, or the identity check's message.
            error: work.error,
          });
          return;
        }

        // GPU metering — non-fatal.
        if (work.elapsedS !== null) {
          capturedConvex.mutation(api.gpuUsage.record, { seconds: work.elapsedS }).catch((e) =>
            console.error('[facelift] async: gpuUsage.record failed (non-fatal):', e)
          );
        }

        // Record facelift — non-fatal.
        capturedConvex.mutation(api.facelifts.recordResult, {
          jobId: work.jobId,
          splatS3Key: work.splatKey,
          ...(work.plyKey ? { plyS3Key: work.plyKey } : {}),
          ...(work.metaKey ? { metaS3Key: work.metaKey } : {}),
        }).catch((e) =>
          console.error('[facelift] async: facelifts.recordResult failed (non-fatal):', e)
        );

        await capturedConvex.mutation(lifecycle.complete, {
          projectId: capturedProjectId as Id<'projects'>,
          jobId: capturedJobId,
          splatS3Key: work.splatKey,
          ...(work.metaKey ? { metaS3Key: work.metaKey } : {}),
          ...(editPrompt ? { prompt: editPrompt } : {}),
        });

        logEvent('build.done', { jobId: capturedJobId, mode, ms: Date.now() - acceptedAt, gpuS: work.elapsedS ?? undefined });
      } catch (err) {
        logEvent('build.crashed', { jobId: capturedJobId, mode, ms: Date.now() - acceptedAt }, { level: 'error', error: err });
        try {
          const freshToken = await capturedSession.getToken({ template: 'convex' }).catch(() => null);
          if (freshToken) capturedConvex.setAuth(freshToken);
          await capturedConvex.mutation(lifecycle.fail, {
            projectId: capturedProjectId as Id<'projects'>,
            jobId: capturedJobId,
            error: BUILDER_BUSY,
          });
        } catch (failErr) {
          logEvent('build.fail_unrecorded', { jobId: capturedJobId, mode }, { level: 'error', error: failErr });
        }
      }
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
