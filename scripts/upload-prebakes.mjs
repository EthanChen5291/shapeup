#!/usr/bin/env node
// Upload public/prebake/<gender>/*.splat to the app bucket at prebake/<gender>/<file>.splat.
// Idempotent: skips files whose S3 ETag already equals the local MD5.
//   npm run prebake:upload            # upload new/changed files
//   npm run prebake:upload -- --dry   # show what would change
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

for (const f of ['.env.local', '.env']) if (existsSync(f)) process.loadEnvFile(f);
const { AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_S3_BUCKET_NAME: BUCKET } = process.env;
if (!AWS_REGION || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY || !BUCKET) {
  console.error('Missing AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_S3_BUCKET_NAME');
  process.exit(1);
}
const dry = process.argv.includes('--dry');
const s3 = new S3Client({ region: AWS_REGION, credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY } });
const ROOT = 'public/prebake';
const GENDERS = ['men', 'women'];

const rows = [];
let uploaded = 0, skipped = 0, bytes = 0;
for (const g of GENDERS) {
  const dir = path.join(ROOT, g);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.splat')).sort()) {
    const local = path.join(dir, file);
    const key = `prebake/${g}/${file}`;
    const body = readFileSync(local);
    const md5 = createHash('md5').update(body).digest('hex');
    let remote = null;
    try { remote = (await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))).ETag?.replaceAll('"', ''); } catch { /* not there yet */ }
    if (remote === md5) { skipped++; rows.push(['same', key, statSync(local).size]); continue; }
    if (!dry) {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: key, Body: body, ContentType: 'application/octet-stream',
        // Can be regenerated under the same name: a day, not immutable.
        CacheControl: 'public, max-age=86400',
      }));
    }
    uploaded++; bytes += body.length;
    rows.push([dry ? 'would upload' : (remote ? 'updated' : 'uploaded'), key, body.length]);
  }
}
for (const [what, key, size] of rows) console.log(`${what.padEnd(12)} ${key.padEnd(62)} ${(size / 1e6).toFixed(1)} MB`);
console.log(`\n${dry ? 'would upload' : 'uploaded'} ${uploaded} (${(bytes / 1e6).toFixed(1)} MB), unchanged ${skipped}`);
