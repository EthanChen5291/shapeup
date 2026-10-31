import { NextRequest, NextResponse } from 'next/server';
import { uploadToS3, getSignedDownloadUrl } from '@/lib/s3';
import { sniffImageMime } from '@/lib/imageDataUrl';
import { requireSignedIn } from '@/lib/serverAuth';
import { randomUUID } from 'crypto';
import sharp from 'sharp';

const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const authResult = await requireSignedIn();
  if (authResult.response) return authResult.response;

  const buffer = Buffer.from(await req.arrayBuffer());
  if (buffer.length > MAX_BYTES) {
    return NextResponse.json({ error: 'Thumbnail is too large' }, { status: 413 });
  }
  // The client sends a PNG (transparent backdrop, so the dashboard can theme
  // it); JPEG is still accepted for older clients.
  const mime = sniffImageMime(buffer);
  if (mime !== 'image/png' && mime !== 'image/jpeg') {
    return NextResponse.json({ error: 'Thumbnail must be a PNG or JPEG image' }, { status: 400 });
  }

  // Re-encode as WebP: keeps the transparency, and at this size quality 85 is
  // indistinguishable from the PNG while being several times smaller, so the
  // dashboard grid loads faster. If the image can't be decoded, store it as sent.
  let body: Buffer = buffer;
  let type: string = mime;
  try {
    body = await sharp(buffer).webp({ quality: 85, alphaQuality: 90, effort: 4 }).toBuffer();
    type = 'image/webp';
  } catch { /* undecodable: keep the original bytes */ }

  const ext = type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg';
  const key = `thumbnails/${randomUUID()}.${ext}`;
  await uploadToS3(key, body, type);
  const url = await getSignedDownloadUrl(key);
  return NextResponse.json({ url, key });
}
