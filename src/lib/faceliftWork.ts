// The reconstruction-worker half of a 3D build, shared by /api/facelift and
// /api/edit-job: call the upstreams in priority order inside one time budget,
// convert/upload when the worker returns base64, and (async builds) settle the
// project's build lifecycle with a freshly minted Convex token.

import { NextResponse } from 'next/server';
import { ConvexError } from 'convex/values';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { uploadToS3 } from '@/lib/s3';
import { sanitizeOutputName } from '@/lib/imageDataUrl';
import { logEvent } from '@/lib/log';
import { hashIdentifier } from '@/lib/rateLimit';
import { getFaceliftHeaders, resolveFaceliftUpstreams } from '@/lib/facelift';
import fs from 'fs/promises';
import path from 'path';

const SH_C0 = 0.28209479177387814;
export const MAX_FACELIFT_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_PLY_BYTES = 80 * 1024 * 1024;
const MAX_VIDEO_BYTES = 120 * 1024 * 1024;
// Total time all upstream attempts may take. Must leave headroom under
// maxDuration for auth/Convex work before and S3 signing after — otherwise a
// stalled upstream (e.g. the primary worker queued waiting for GPU capacity)
// gets the function killed by the platform, and the client sees a raw 504
// page instead of our error.
export const UPSTREAM_BUDGET_MS = 240_000;
// A cancel is best effort and must never hold up the build it belongs to.
const CANCEL_TIMEOUT_MS = 5_000;
export const BUILDER_BUSY = 'Our 3D builder is busy right now. Please try again in a few minutes.';
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
export type WorkResult =
  | { ok: true; jobId: string; splatKey: string; plyKey: string | null; videoKey: string | null; metaKey: string | null; elapsedS: number | null }
  | { ok: false; status: number; error: string };

// runFaceliftWork encapsulates the upstream loop, PLY→splat conversion, and
// S3 uploads. It does NOT call any Convex mutations — callers do that with a
// freshly-minted token after this returns (long builds can outlive a 60 s JWT).
export async function runFaceliftWork({
  jobId: requestedJobId,
  buffer,
  mimeType,
  needPly,
  outputName,
  userHash,
  referenceS3Key = null,
  budgetMs = UPSTREAM_BUDGET_MS,
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
  /** All upstream attempts share this deadline; a caller that already spent time (an edit job) passes less. */
  budgetMs?: number;
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
  const deadline = Date.now() + budgetMs;
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

/**
 * Ask every configured worker to drop a superseded build. Fire-and-forget: we
 * don't know which backend took it, and a 404 just means that backend cannot
 * cancel. Never throws.
 */
export async function cancelSupersededJob(jobId: string): Promise<void> {
  try {
    const upstreams = await resolveFaceliftUpstreams();
    for (const { url } of upstreams) void cancelFaceliftJob(url, jobId, 'superseded');
  } catch (err) {
    console.warn(`[facelift] could not resolve workers to cancel ${jobId}:`, err instanceof Error ? err.message : String(err));
  }
}

// Cold start is ~6-8s; give the wake room to finish so the container is actually up.
const WARMUP_TIMEOUT_MS = 15_000;

/**
 * Wake the worker that would serve the next build, without running inference.
 * Only the primary worker cold-starts: when the secondary worker is up it is
 * first in priority and always warm, so waking the primary (then only a
 * fallback) would be wasted GPU spend. Never throws; returns whether it woke one.
 */
export async function wakeTopWorker(): Promise<boolean> {
  try {
    const upstreams = await resolveFaceliftUpstreams();
    const top = upstreams[0];
    if (!top || top.name !== 'primary') return false;
    const res = await fetch(`${top.url}/warmup`, {
      method: 'POST',
      headers: getFaceliftHeaders(),
      signal: AbortSignal.timeout(WARMUP_TIMEOUT_MS),
    });
    return res.ok;
  } catch (err) {
    console.warn('[facelift] warmup failed (non-fatal):', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** The bit of a Clerk session an async build needs: re-minting the Convex token. */
export interface TokenSource {
  getToken(options: { template: string }): Promise<string | null>;
}

/** Long builds outlive the ~60 s Convex JWT: mint a fresh one before writing results. */
export async function refreshConvexAuth(convex: ConvexHttpClient, session: TokenSource, jobId: string): Promise<void> {
  try {
    const freshToken = await session.getToken({ template: 'convex' });
    if (freshToken) convex.setAuth(freshToken);
  } catch {
    console.error('[facelift] async: could not refresh Convex token (continuing with stale)', { jobId });
  }
}

/**
 * The background half of an async build (runs inside after()): build the head
 * from `buffer`, then settle the project's lifecycle (complete or fail, which
 * commits or releases the credit hold). mode 'build' = the project's first
 * head; 'edit' = a hair edit's head on the editBuild* fields. Never throws: any
 * crash fails the build with a user-safe message.
 */
export async function finishAsyncBuild({
  convex, session, projectId, jobId, mode, buffer, mimeType, needPly, outputName, userHash,
  editPrompt, acceptedAt, budgetMs,
}: {
  convex: ConvexHttpClient;
  session: TokenSource;
  projectId: string;
  jobId: string;
  mode: 'build' | 'edit';
  buffer: Buffer;
  mimeType: string;
  needPly: boolean;
  outputName: string;
  userHash: string;
  /** Edit mode: the request behind the cut, recorded for Recap when it completes. */
  editPrompt?: string;
  acceptedAt: number;
  budgetMs?: number;
}): Promise<void> {
  const lifecycle = mode === 'edit'
    ? { complete: api.projects.completeEditBuild, fail: api.projects.failEditBuild }
    : { complete: api.projects.completeBuild, fail: api.projects.failBuild };
  try {
    // Edits: the worker's identity check compares against the project's
    // original selfie. Read it server-side from the caller's own project
    // (projects.get checks ownership), never from the request, so nobody can
    // score their image against another user's photo. Only for users who
    // accepted a notice that discloses the check. Best-effort: without a
    // reference the worker skips the check.
    let referenceS3Key: string | null = null;
    if (mode === 'edit') {
      try {
        const consented = await convex.query(api.users.hasIdentityCheckConsent, {});
        const project = consented ? await convex.query(api.projects.get, {
          projectId: projectId as Id<'projects'>,
        }) : null;
        const key = project?.lastImageS3Key;
        if (typeof key === 'string' && key.startsWith('pictures/')) referenceS3Key = key;
      } catch (err) {
        console.warn('[facelift] async: selfie lookup for identity check failed (skipping check)', {
          jobId,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const work = await runFaceliftWork({ jobId, buffer, mimeType, needPly, outputName, userHash, referenceS3Key, budgetMs });

    // Refresh the Convex JWT before any mutations — the upstream build
    // takes minutes and the initial 60 s token will have expired.
    await refreshConvexAuth(convex, session, jobId);

    if (!work.ok) {
      logEvent('build.failed', { jobId, mode, ms: Date.now() - acceptedAt, reason: work.error }, { level: 'warn' });
      await convex.mutation(lifecycle.fail, {
        projectId: projectId as Id<'projects'>,
        jobId,
        // Always user-safe: BUILDER_BUSY, or the identity check's message.
        error: work.error,
      });
      return;
    }

    // GPU metering — non-fatal.
    if (work.elapsedS !== null) {
      convex.mutation(api.gpuUsage.record, { seconds: work.elapsedS }).catch((e) =>
        console.error('[facelift] async: gpuUsage.record failed (non-fatal):', e)
      );
    }

    // Record facelift — non-fatal.
    convex.mutation(api.facelifts.recordResult, {
      jobId: work.jobId,
      splatS3Key: work.splatKey,
      ...(work.plyKey ? { plyS3Key: work.plyKey } : {}),
      ...(work.metaKey ? { metaS3Key: work.metaKey } : {}),
    }).catch((e) =>
      console.error('[facelift] async: facelifts.recordResult failed (non-fatal):', e)
    );

    await convex.mutation(lifecycle.complete, {
      projectId: projectId as Id<'projects'>,
      jobId,
      splatS3Key: work.splatKey,
      ...(work.metaKey ? { metaS3Key: work.metaKey } : {}),
      ...(editPrompt ? { prompt: editPrompt } : {}),
    });

    logEvent('build.done', { jobId, mode, ms: Date.now() - acceptedAt, gpuS: work.elapsedS ?? undefined });
  } catch (err) {
    logEvent('build.crashed', { jobId, mode, ms: Date.now() - acceptedAt }, { level: 'error', error: err });
    try {
      const freshToken = await session.getToken({ template: 'convex' }).catch(() => null);
      if (freshToken) convex.setAuth(freshToken);
      await convex.mutation(lifecycle.fail, {
        projectId: projectId as Id<'projects'>,
        jobId,
        error: BUILDER_BUSY,
      });
    } catch (failErr) {
      logEvent('build.fail_unrecorded', { jobId, mode }, { level: 'error', error: failErr });
    }
  }
}

/**
 * Spend an entitlement for `jobId`: a paid credit if the user has one, otherwise
 * one of their monthly free generations (3/month, reset not accumulated, gated
 * by the anti-Sybil checks in freeGen.ts). The jobId is minted before the charge
 * so the spent entitlement is held against it from the start: completing the
 * build commits the hold; failing, superseding or reaping it releases it
 * (convex/creditHolds.ts). Returns the response to send when the charge is refused.
 */
export async function holdGeneration(convex: ConvexHttpClient, { jobId, ip, fingerprint, user, route }: {
  jobId: string;
  ip: string;
  fingerprint?: string;
  /** Hashed user id, for logs. */
  user: string;
  /** Log prefix. */
  route: string;
}): Promise<{ response: NextResponse | null }> {
  try {
    await convex.mutation(api.freeGen.consumeGeneration, {
      jobId,
      ipHash: hashIdentifier(ip),
      fingerprintHash: typeof fingerprint === 'string' && fingerprint.length > 0
        ? hashIdentifier(fingerprint)
        : undefined,
    });
    return { response: null };
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
      return { response: NextResponse.json({ error: message, code: data.code, needsCredits }, { status: 402 }) };
    }
    // Anything else is a masked Convex "Server Error" (an unexpected internal
    // failure, redacted to "[Request ID: …] Server Error" in prod). That is
    // NOT a client error — surface it as 502 and log the request id so it can
    // be traced in the Convex dashboard, instead of a misleading 400.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${route}] POST: consumeGeneration failed unexpectedly:`, msg, { user });
    return { response: NextResponse.json({ error: BUILDER_BUSY }, { status: 502 }) };
  }
}
