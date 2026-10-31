import { NextRequest, NextResponse } from 'next/server';
import { getSignedDownloadUrl } from '@/lib/s3';
import { PREBAKE_CACHE_MAX_AGE_S, prebakeKeyFromSegments } from '@/lib/prebakeKeys';

// /prebake/<gender>/<file>.splat is rewritten here when no public/ copy exists
// (i.e. in deploys). Prebakes are free, non-personal try-on assets, so no auth;
// the key is constrained to the prebake/ prefix and a strict file pattern.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const key = prebakeKeyFromSegments(path);
  if (!key) return NextResponse.json({ error: 'not a prebake path' }, { status: 400 });

  let url: string;
  try {
    url = await getSignedDownloadUrl(key);
  } catch {
    return NextResponse.json({ error: 'Failed to generate signed URL' }, { status: 500 });
  }
  const res = NextResponse.redirect(url, 307);
  // Reuse the same signed URL for a day (well inside its 7-day lifetime) so the
  // browser's HTTP cache serves repeat try-ons of the same style.
  res.headers.set('Cache-Control', `private, max-age=${PREBAKE_CACHE_MAX_AGE_S}`);
  return res;
}
