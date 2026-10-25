import { NextRequest, NextResponse } from 'next/server';
import { uploadToS3, getSignedDownloadUrl } from '@/lib/s3';
import { sniffImageMime } from '@/lib/imageDataUrl';
import { requireSignedIn } from '@/lib/serverAuth';
import { randomUUID } from 'crypto';

const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;

  const buffer = Buffer.from(await req.arrayBuffer());
  if (buffer.length > MAX_BYTES) {
    return NextResponse.json({ error: 'Thumbnail is too large' }, { status: 413 });
  }
  if (sniffImageMime(buffer) !== 'image/jpeg') {
    return NextResponse.json({ error: 'Thumbnail must be a JPEG image' }, { status: 400 });
  }

  const key = `thumbnails/${randomUUID()}.jpg`;
  await uploadToS3(key, buffer, 'image/jpeg');
  const url = await getSignedDownloadUrl(key);
  return NextResponse.json({ url, key });
}
