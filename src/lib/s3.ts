import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({
  region: process.env.AWS_REGION!,
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

const BUCKET = process.env.AWS_S3_BUCKET_NAME;
if (!BUCKET) throw new Error('AWS_S3_BUCKET_NAME env var is not set');

export async function uploadToS3(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
}

// Default expiry: 7 days — long enough for a user session
export async function getSignedDownloadUrl(key: string, expiresIn = 604_800): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
}

export async function deleteManyFromS3(keys: string[]): Promise<void> {
  const uniqueKeys = [...new Set(keys)].filter(Boolean);
  for (let i = 0; i < uniqueKeys.length; i += 1000) {
    const batch = uniqueKeys.slice(i, i + 1000);
    if (batch.length === 0) continue;
    const res = await s3.send(new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
    }));
    // DeleteObjects answers 200 even when individual keys fail; surface those so
    // callers (account deletion) stop instead of dropping rows for files still there.
    if (res?.Errors?.length) {
      const first = res.Errors[0];
      throw new Error(`S3 delete failed for ${res.Errors.length} key(s): ${first.Code ?? 'error'} ${first.Key ?? ''}`.trim());
    }
  }
}
