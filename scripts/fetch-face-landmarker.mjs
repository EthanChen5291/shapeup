#!/usr/bin/env node
// Vendor the face-landmarker assets chair mode needs into public/mediapipe/.
//
//   node scripts/fetch-face-landmarker.mjs
//
// Two halves, from two places:
//
//   wasm/   copied out of node_modules/@mediapipe/tasks-vision, so the runtime
//           and the package version can never drift apart.
//   .task   downloaded once from Google's model storage (~3.8MB) — it isn't
//           shipped inside the npm package.
//
// Both are vendored rather than loaded from a CDN so the chair page fetches
// nothing from a third-party origin: it runs in a shop on shop wifi, and a
// blocked CDN would silently cost the barber their reference sheet. Same reason
// public/fonts and public/hair-previews are checked in.
//
// Idempotent — existing files are left alone unless --force is passed.

import { existsSync, mkdirSync, copyFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_WASM = join(ROOT, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const OUT_DIR = join(ROOT, 'public', 'mediapipe');
const OUT_WASM = join(OUT_DIR, 'wasm');
const MODEL_OUT = join(OUT_DIR, 'face_landmarker.task');

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

// FilesetResolver picks between these at runtime based on SIMD support, so all
// six have to be present — shipping only the SIMD build breaks older tablets.
const WASM_FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
];

const force = process.argv.includes('--force');

function copyWasm() {
  if (!existsSync(SRC_WASM)) {
    console.error(
      `✗ ${SRC_WASM} not found — run \`npm install\` first (@mediapipe/tasks-vision).`,
    );
    process.exit(1);
  }
  mkdirSync(OUT_WASM, { recursive: true });
  for (const file of WASM_FILES) {
    const from = join(SRC_WASM, file);
    const to = join(OUT_WASM, file);
    if (!existsSync(from)) {
      console.error(`✗ missing ${file} in the installed package`);
      process.exit(1);
    }
    if (existsSync(to) && !force) {
      console.log(`· ${file} already vendored`);
      continue;
    }
    copyFileSync(from, to);
    console.log(`✓ ${file} (${(statSync(to).size / 1024).toFixed(0)}KB)`);
  }
}

async function fetchModel() {
  if (existsSync(MODEL_OUT) && !force) {
    console.log('· face_landmarker.task already vendored');
    return;
  }
  console.log('… downloading face_landmarker.task');
  const res = await fetch(MODEL_URL);
  if (!res.ok) {
    console.error(`✗ model download failed: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(MODEL_OUT, bytes);
  console.log(`✓ face_landmarker.task (${(bytes.length / 1024 / 1024).toFixed(1)}MB)`);
}

copyWasm();
await fetchModel();
console.log('\nDone. public/mediapipe/ is ready for chair mode.');
