// ============================================================
// optimize-images.mjs
//
// Re-encodes the raster assets the app serves as WebP so the landing page,
// dashboard and barber surfaces ship a fraction of the bytes. Idempotent: an
// output that already exists and is newer than its source is skipped, so this
// is safe to re-run after adding or regenerating a single image.
//
// Run:  node scripts/optimize-images.mjs        (or: npm run images:optimize)
//       node scripts/optimize-images.mjs --force (re-encode everything)
//
// Sources stay on disk only while something still references them —
// public/shapeup_logo.png is the Open Graph image (scrapers need PNG/JPG) and
// must never be removed.
// ============================================================

import sharp from 'sharp';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PUBLIC = join(ROOT, 'public');
const FORCE = process.argv.includes('--force');

// Lossy, for photographs and paper textures.
const PHOTO = { quality: 85, effort: 6 };
// Lossy RGB with a losslessly-coded alpha channel: for soft/blurred artwork
// whose edge (mask) must stay exact but whose colour can take lossy coding.
const PHOTO_ALPHA = { quality: 85, effort: 6, alphaQuality: 100 };
const SOFT_ALPHA = { quality: 90, effort: 6, alphaQuality: 100 };
// Near-lossless, for small flat artwork where lossy ringing would show.
const CRISP = { quality: 95, nearLossless: true, effort: 6 };

// Decorative full-bleed backgrounds: cap the longest side at 1600px.
const BG_MAX_SIDE = 1600;
// Hairstyle preview bubbles render at 28–118px (max ~160px on retina).
const PREVIEW_MAX_SIDE = 512;

/** @type {{ src: string, out?: string, webp: object, resize?: object, maxSide?: number }[]} */
const JOBS = [
  // UI logo: 1254² RGBA shown at ~36px. Keep the PNG for Open Graph.
  { src: 'shapeup_logo.png', out: 'shapeup_logo_ui.webp', webp: CRISP, resize: { width: 256, height: 256 } },
  { src: 'shapeup_token.png', webp: CRISP, resize: { width: 96, height: 96 } },

  // Paper / texture backgrounds (opaque).
  { src: 'dark_charcoal.png', webp: PHOTO, maxSide: BG_MAX_SIDE },
  { src: 'offwhitebg.png', webp: PHOTO, maxSide: BG_MAX_SIDE },
  { src: 'barber_banner.png', webp: PHOTO, maxSide: BG_MAX_SIDE },
  { src: 'white.png', webp: PHOTO },
  { src: 'transition.png', webp: PHOTO },

  // Photographs (alpha channel present but fully opaque, or none).
  { src: 'face1_selfie.png', webp: PHOTO },
  { src: 'landing_face2/face2_selfie.png', webp: PHOTO },
  { src: 'frontfacing_male_eyes.png', webp: PHOTO },
  { src: 'frontfacing_female_eyes.png', webp: PHOTO },

  // Meaningful alpha (kept lossless) over soft artwork, and flat artwork.
  { src: '3face_blur.png', webp: PHOTO_ALPHA, maxSide: BG_MAX_SIDE }, // blurred alpha vignette
  { src: 'blob.png', webp: SOFT_ALPHA }, // paper blob, also a CSS mask-image
  { src: 'transition2.png', webp: SOFT_ALPHA }, // near-white wave strip
  { src: '1.png', webp: CRISP },
  { src: '2.png', webp: CRISP },
  { src: '3.png', webp: CRISP },

  // Hairstyle preview bubbles — 50 × ~600 KB PNGs.
  ...readdirSync(join(PUBLIC, 'hair-previews'))
    .filter((f) => f.endsWith('.png'))
    .sort()
    .map((f) => ({ src: join('hair-previews', f), webp: PHOTO, maxSide: PREVIEW_MAX_SIDE })),
];

const fmtKB = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
const pct = (before, after) => `${(((before - after) / before) * 100).toFixed(0)}%`;

async function optimize(job) {
  const src = join(PUBLIC, job.src);
  const out = join(PUBLIC, job.out ?? job.src.replace(/\.png$/i, '.webp'));
  if (!existsSync(src)) return { job, status: 'missing', before: 0, after: 0 };

  const before = statSync(src).size;
  const fresh = existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs;
  if (fresh && !FORCE) return { job, status: 'skip', before, after: statSync(out).size };

  let pipeline = sharp(src);
  if (job.resize) {
    pipeline = pipeline.resize({ ...job.resize, fit: 'inside', withoutEnlargement: true });
  } else if (job.maxSide) {
    const { width = 0, height = 0 } = await pipeline.metadata();
    if (Math.max(width, height) > job.maxSide) {
      pipeline = pipeline.resize({ width: job.maxSide, height: job.maxSide, fit: 'inside', withoutEnlargement: true });
    }
  }
  await pipeline.webp(job.webp).toFile(out);
  return { job, status: 'ok', before, after: statSync(out).size };
}

async function run() {
  const results = [];
  for (const job of JOBS) results.push(await optimize(job));

  const rows = results.filter((r) => r.status !== 'missing');
  const nameW = Math.max(...rows.map((r) => (r.job.out ?? r.job.src.replace(/\.png$/i, '.webp')).length), 6);
  console.log(`${'output'.padEnd(nameW)}  ${'before'.padStart(9)}  ${'after'.padStart(9)}  ${'saved'.padStart(5)}  note`);
  let totalBefore = 0;
  let totalAfter = 0;
  for (const r of rows) {
    const name = r.job.out ?? r.job.src.replace(/\.png$/i, '.webp');
    totalBefore += r.before;
    totalAfter += r.after;
    console.log(
      `${name.padEnd(nameW)}  ${fmtKB(r.before).padStart(9)}  ${fmtKB(r.after).padStart(9)}  ${pct(r.before, r.after).padStart(5)}  ${r.status === 'skip' ? 'up to date' : ''}`,
    );
  }
  console.log(`${'TOTAL'.padEnd(nameW)}  ${fmtKB(totalBefore).padStart(9)}  ${fmtKB(totalAfter).padStart(9)}  ${pct(totalBefore, totalAfter).padStart(5)}`);

  const missing = results.filter((r) => r.status === 'missing');
  if (missing.length) {
    // Expected once a source PNG has been removed after conversion; drop a new
    // PNG at the same path to re-encode it.
    console.log(`\n${missing.length} source(s) not on disk (skipped):`);
    for (const r of missing) console.log(`  ${relative(ROOT, join(PUBLIC, r.job.src))}`);
  }
  console.log(`\n${results.filter((r) => r.status === 'ok').length} encoded, ${results.filter((r) => r.status === 'skip').length} up to date.`);
}

run().catch((err) => {
  console.error(`✗ ${basename(fileURLToPath(import.meta.url))}: ${err?.message ?? err}`);
  process.exit(1);
});
