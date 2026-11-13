// ============================================================
// POST /api/gemini-hair-edit — the closed-box edit, steered.
//
// Body: { imageUrl, prompt, sessionId, currentProfile?, projectId? }
// Response: { ok, newImageUrl, editReport, editImageS3Key }
//   editReport may be null; editImageS3Key is set when a projectId was sent
//   and the image was saved to S3 + linked to the project.
//
// The image model can't be controlled at the weights, but it CAN
// be steered (prompt) and made to confess (EDIT_REPORT sidecar —
// responseModalities already includes TEXT). Changes vs v1:
//
//   1. SCALE ANCHOR — the model sees the face; telling it
//      chin-to-hairline ≈ 7 in makes "take two inches off" a
//      computable pixel distance instead of a vibe.
//   2. ZONE POLICY — the unmentioned-zone rule, verbatim:
//      untouched zones stay identical unless the named style
//      implies them (fade ⇒ sides/back/edges, mullet ⇒ back,
//      buzz ⇒ everything). Plus explicit nape guidance, since
//      the back is mostly out of frame.
//   3. EDIT_REPORT — one JSON line declaring per-zone intent.
//      The back is invisible frontally, so it must be DECLARED,
//      not measured; this line is the authoritative back record
//      and feeds the Barber Output reconciliation.
//   4. Hardening — client prompt is delimited + capped (it's
//      hostile input inside our prompt), and currentProfile is
//      slimmed to geometry only (v1 stringified the whole
//      profile, which can include faceScanData base64 — a token
//      bomb and a privacy leak into the prompt).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { isSafeImageSource } from '@/lib/urlSafety';
import { RATE_LIMITS, getClientIp, hashIdentifier } from '@/lib/rateLimit';
import { enforceDurableRateLimits } from '@/lib/durableRateLimit';
import { requireSignedIn, type ClerkSession } from '@/lib/serverAuth';
import {
  MAX_PROMPT_LENGTH, generateHairEdit, loadSourceImage, prepareHairReference, uploadEditImage,
} from '@/lib/hairEdit';

/**
 * Save the edited image to S3 and link it to the project (lastEditImageS3Key),
 * so the edit survives a closed tab without depending on a second upload from
 * the browser. Returns the key, or null if saving failed: the edit itself still
 * goes back to the client, which can save it the old way.
 */
async function saveEditImage(base64: string, projectId: string, session: NonNullable<ClerkSession>): Promise<string | null> {
  try {
    const token = await session.getToken({ template: 'convex' });
    if (!token) throw new Error('Convex token unavailable');
    const key = await uploadEditImage(Buffer.from(base64, 'base64'));
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    convex.setAuth(token);
    await convex.mutation(api.projects.save, { projectId: projectId as Id<'projects'>, lastEditImageS3Key: key });
    return key;
  } catch (err) {
    console.error('[gemini-hair-edit] could not save the edit image (client will retry):', err instanceof Error ? err.message : err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  console.log('\n[gemini-hair-edit] ===== POST START =====');
  console.log('[gemini-hair-edit] GEMINI_API_KEY set?', !!process.env.GEMINI_API_KEY);

  // NOTE: v1 had no auth or rate limiting on this route, while
  // /api/barber-order has both — and this route is the expensive one.
  // Remove these two blocks only if it must intentionally stay public.
  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;

  const ip = getClientIp(req);
  const rateLimited = await enforceDurableRateLimits([
    { ...RATE_LIMITS.geminiEditUser, key: authResult.session.userId },
    { ...RATE_LIMITS.geminiEditIp, key: ip },
    { ...RATE_LIMITS.geminiEditUserDay, key: authResult.session.userId },
    { ...RATE_LIMITS.geminiEditIpDay, key: ip },
  ], authResult.session, {
    route: '/api/gemini-hair-edit',
    user: hashIdentifier(authResult.session.userId),
    ip: hashIdentifier(ip),
  });
  if (rateLimited) return rateLimited;

  let imageUrl: string, prompt: string, sessionId: string | undefined;
  let projectId: unknown;
  let referenceImageDataUrl: unknown;
  let currentProfile: unknown = null;
  try {
    const body = await req.json();
    imageUrl = body.imageUrl;
    prompt = body.prompt;
    sessionId = body.sessionId ?? undefined;
    currentProfile = body.currentProfile ?? null;
    referenceImageDataUrl = body.referenceImageDataUrl;
    projectId = body.projectId;
    console.log('[gemini-hair-edit] body parsed OK');
    console.log('[gemini-hair-edit]   sessionId:', sessionId);
    console.log('[gemini-hair-edit]   prompt:', prompt);
    console.log('[gemini-hair-edit]   imageUrl (first 120):', imageUrl?.slice(0, 120) ?? 'MISSING');
    console.log('[gemini-hair-edit]   currentProfile present:', currentProfile !== null);
  } catch (err) {
    console.error('[gemini-hair-edit] FAILED to parse request body:', err);
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!imageUrl || !prompt) {
    console.error('[gemini-hair-edit] missing fields — imageUrl:', !!imageUrl, '| prompt:', !!prompt, '| sessionId:', sessionId ?? 'none');
    return NextResponse.json({ ok: false, error: 'imageUrl and prompt are required' }, { status: 400 });
  }
  if (typeof prompt !== 'string' || prompt.length > MAX_PROMPT_LENGTH) {
    return NextResponse.json({ ok: false, error: `prompt must be a string of at most ${MAX_PROMPT_LENGTH} characters` }, { status: 400 });
  }
  if (!isSafeImageSource(imageUrl)) {
    return NextResponse.json({ ok: false, error: 'imageUrl is not allowed' }, { status: 400 });
  }

  const reference = await prepareHairReference(referenceImageDataUrl);
  if (!reference.ok) return NextResponse.json({ ok: false, error: reference.error }, { status: reference.status });

  const source = await loadSourceImage({
    imageUrl,
    origin: new URL(req.url).origin,
    cookie: req.headers.get('cookie'),
    authorization: req.headers.get('authorization'),
  });
  if (!source.ok) {
    return NextResponse.json({ ok: false, error: source.error, ...(source.detail ? { detail: source.detail } : {}) }, { status: source.status });
  }

  const edit = await generateHairEdit({ source: source.part, reference: reference.part, prompt, currentProfile });
  if (!edit.ok) return NextResponse.json({ ok: false, error: edit.error }, { status: edit.status });

  const newImageUrl = `data:${edit.mimeType};base64,${edit.base64}`;
  const editImageS3Key = typeof projectId === 'string' && projectId
    ? await saveEditImage(edit.base64, projectId, authResult.session)
    : null;

  const totalMs = Date.now() - t0;
  console.log(`[gemini-hair-edit] ===== POST END — total ${totalMs}ms =====\n`);
  return NextResponse.json({ ok: true, newImageUrl, editReport: edit.editReport, editImageS3Key });
}
