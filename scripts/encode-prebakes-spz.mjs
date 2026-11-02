#!/usr/bin/env node
// Write a compressed .spz next to every public/prebake/<gender>/*.splat, then
// check each one decodes back to the same number of Gaussians.
//   npm run prebake:spz        # then: npm run prebake:upload
// Uses the app's own codec (src/lib/spz.ts) through Node's TypeScript stripping.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { decodeSpz, encodeSpz } from '../src/lib/spz.ts';

const ROOT = 'public/prebake';
let before = 0, after = 0, count = 0;
for (const g of ['men', 'women']) {
  const dir = path.join(ROOT, g);
  if (!existsSync(dir)) continue;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.splat')).sort()) {
    const splat = readFileSync(path.join(dir, file));
    const spz = await encodeSpz(new Uint8Array(splat.buffer, splat.byteOffset, splat.byteLength));
    const back = await decodeSpz(spz);
    if (back.length !== splat.length) throw new Error(`${file}: round trip changed the size (${splat.length} → ${back.length})`);
    const out = path.join(dir, file.replace(/\.splat$/, '.spz'));
    writeFileSync(out, spz);
    before += splat.length; after += spz.length; count++;
    console.log(`${out.padEnd(64)} ${(splat.length / 1e6).toFixed(1)} MB → ${(spz.length / 1e6).toFixed(1)} MB`);
  }
}
console.log(`\n${count} files: ${(before / 1e6).toFixed(0)} MB → ${(after / 1e6).toFixed(0)} MB (${(before / after).toFixed(1)}× smaller)`);
