import { NextRequest, NextResponse } from 'next/server';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '@convex/_generated/api';
import { getSignedDownloadUrl } from '@/lib/s3';
import { requireSignedIn } from '@/lib/serverAuth';

// Only these S3 key prefixes can be served through this route.
const ALLOWED_PREFIXES = ['thumbnails/', 'pictures/', 'edit-images/'];

// Per-user assets: a signed-in caller may only fetch keys they own. Thumbnails
// are exempt — they're loaded in bulk on the dashboard and are already keyed by
// unguessable random UUIDs on the caller's own projects, so a per-key ownership
// round-trip per thumbnail isn't worth the latency.
const OWNERSHIP_REQUIRED_PREFIXES = ['pictures/', 'edit-images/'];

export async function GET(req: NextRequest) {
  // Require authentication — this route serves private user images (face scans /
  // edited faces). It must never be reachable anonymously.
  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;

  const key = req.nextUrl.searchParams.get('key');
  if (!key) return new NextResponse('Missing key', { status: 400 });

  if (!ALLOWED_PREFIXES.some((prefix) => key.startsWith(prefix))) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  // For sensitive per-user assets, confirm the caller actually owns the key so a
  // leaked/guessed key can't be fetched by another account. Runs alongside
  // signing (the two don't depend on each other); the bytes are only fetched
  // once both have succeeded.
  const ownershipCheck = async (): Promise<NextResponse | null> => {
    if (!OWNERSHIP_REQUIRED_PREFIXES.some((prefix) => key.startsWith(prefix))) return null;
    const convexToken = await authResult.session.getToken({ template: 'convex' });
    if (!convexToken) return new NextResponse('Unauthorized', { status: 401 });
    const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    convex.setAuth(convexToken);
    const owns = await convex.query(api.users.ownsImageKey, { key });
    return owns ? null : new NextResponse('Forbidden', { status: 403 });
  };

  // Proxy the bytes instead of redirecting to a presigned URL. The presigned
  // URL is generated and consumed server-side within this request, so it never
  // reaches a cache. The cached resource is the image itself, keyed by ?key=,
  // and these keys are immutable (uuid thumbnails / per-session scan paths) —
  // safe to cache long. Previously the 302 redirect was cached, so the browser
  // kept reusing a single stale signed URL and some previews would vanish.
  const [denied, signedUrl] = await Promise.all([
    ownershipCheck(),
    getSignedDownloadUrl(key).catch(() => null),
  ]);
  if (denied) return denied;
  if (!signedUrl) return new NextResponse('Not found', { status: 404 });

  const upstream = await fetch(signedUrl);
  if (!upstream.ok || !upstream.body) {
    return new NextResponse('Not found', { status: 404 });
  }

  // Stream the body through rather than buffering the whole image in the
  // function first: the first bytes reach the browser as soon as S3 sends them.
  const headers: Record<string, string> = {
    'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
    // Private: these are per-user images gated by auth/ownership, so they must
    // not be stored in shared/CDN caches keyed only by ?key=.
    'Cache-Control': 'private, max-age=86400, immutable',
  };
  const length = upstream.headers.get('content-length');
  if (length) headers['Content-Length'] = length;
  return new NextResponse(upstream.body, { headers });
}
