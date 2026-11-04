// GET /api/splat?key=<s3-key> | ?url=<encoded-url> → 307 redirect to the file.
//
// Hands the browser a short trip to where a head's files (the .splat and its
// meta.json) actually live. For ?key= it checks the caller owns the file, signs
// an S3 download URL and redirects to it; ?url= redirects to an allowed remote
// URL. (This used to be /api/proxy-ply, back when it streamed the bytes through;
// that path still works as an alias.)
//
// We redirect rather than stream the bytes through this function for two reasons:
//   1. Vercel serverless responses are capped at ~4.5 MB; splats are routinely
//      larger, so streaming the body fails in production.
//   2. drei's SplatLoader requires a Content-Length header — Vercel drops the
//      explicit one when it re-chunks streamed bodies. S3 always sends a correct
//      Content-Length, so fetching the source directly satisfies the loader.
//
// fetch() (which the loaders use) follows the redirect transparently, so the
// browser downloads straight from S3. This requires the bucket to allow CORS GET
// from the app origin — see scripts/apply-s3-cors.mjs. In local dev the bytes
// are streamed instead, to sidestep S3 CORS for localhost.

import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import { getConvexToken, requireSignedIn } from '@/lib/serverAuth';
import { isSafeRemoteUrl } from '@/lib/urlSafety';
import { getSignedDownloadUrl } from '@/lib/s3';
import { KEY_REDIRECT_MAX_AGE_S } from '@/lib/splatRedirectCache';

const KEY_ALLOWED_PREFIXES = ['facelifts/'];

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  const key = req.nextUrl.searchParams.get('key');

  if (!url && !key) {
    return NextResponse.json({ error: 'url or key param required' }, { status: 400 });
  }

  let targetUrl: string;

  if (key) {
    if (!KEY_ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      return NextResponse.json({ error: 'key prefix not allowed' }, { status: 400 });
    }
    // A facelift output is a 3D model of someone's face: only its owner may
    // fetch it, so a leaked or guessed key isn't enough (same rule as /api/img).
    const authResult = await requireSignedIn();
    if (authResult.response) return authResult.response;
    const ownershipCheck = async (): Promise<NextResponse | null> => {
      const minted = await getConvexToken(authResult.session);
      if (minted.response) return minted.response;
      const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
      convex.setAuth(minted.token);
      const owns = await convex.query(api.users.ownsSplatKey, { key });
      return owns ? null : NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    };
    const [denied, signed] = await Promise.all([
      ownershipCheck(),
      getSignedDownloadUrl(key).catch(() => null),
    ]);
    if (denied) return denied;
    if (!signed) return NextResponse.json({ error: 'Failed to generate signed URL' }, { status: 500 });
    targetUrl = signed;
  } else {
    if (!isSafeRemoteUrl(url!)) {
      return NextResponse.json({ error: 'url is not allowed' }, { status: 400 });
    }
    targetUrl = url!;
  }

  // In local dev, stream the bytes through to avoid S3 CORS issues.
  // In production (Vercel) redirect instead to avoid the 4.5 MB response size cap.
  if (process.env.NODE_ENV === 'development') {
    const upstream = await fetch(targetUrl);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: `Upstream fetch failed (${upstream.status})` }, { status: 502 });
    }
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'application/octet-stream',
        'Content-Length': upstream.headers.get('Content-Length') ?? '',
        'Cache-Control': 'no-store',
      },
    });
  }

  console.log(`[splat] redirecting to ${targetUrl.slice(0, 80)}…`);
  const res = NextResponse.redirect(targetUrl, 307);
  if (key) {
    // Facelift outputs are immutable per job, but every call here mints a fresh
    // signed URL, so without this the browser re-downloads the whole splat on
    // every project open. Cache the redirect (and thus the same signed URL) for
    // just under the URL's lifetime so repeat opens hit the HTTP cache.
    res.headers.set('Cache-Control', `private, max-age=${KEY_REDIRECT_MAX_AGE_S}, immutable`);
  }
  return res;
}
