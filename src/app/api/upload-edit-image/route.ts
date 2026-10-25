import { NextRequest, NextResponse } from 'next/server';
import { uploadToS3 } from '@/lib/s3';
import { sniffImageMime } from '@/lib/imageDataUrl';
import { requireSignedIn } from '@/lib/serverAuth';
import { randomUUID } from 'crypto';

const MAX_BYTES = 10 * 1024 * 1024;
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as const;

export async function POST(req: NextRequest) {
  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;

  const buffer = Buffer.from(await req.arrayBuffer());
  if (buffer.length > MAX_BYTES) {
    return NextResponse.json({ error: 'Image is too large' }, { status: 413 });
  }
  const mimeType = sniffImageMime(buffer);
  if (!mimeType) {
    return NextResponse.json({ error: 'Body must be a PNG, JPEG, or WebP image' }, { status: 400 });
  }

  const key = `edit-images/${randomUUID()}.${EXT[mimeType]}`;
  await uploadToS3(key, buffer, mimeType);
  return NextResponse.json({ key });
}
