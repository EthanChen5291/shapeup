#!/usr/bin/env node
// Makes the README try-on GIF: one head turning once around while its hair changes.
//
// It drives the dev-only page /lab/turntable (src/app/lab/turntable) frame by frame, so the
// result does not depend on how fast this machine draws: every frame is posed, left to settle,
// read off the canvas, and the frames are assembled with ffmpeg.
//
// Needs: `npm run dev` on :3000, a buzz-cut try-on base at public/lab/turntable_base.splat
// (+ .meta.json), the prebakes in public/prebake, and ffmpeg on the PATH.
//
//   node scripts/turntable-gif.mjs --out docs/media/tryon-turntable.gif            # the README line-up
//   node scripts/turntable-gif.mjs --looks f-birkin_copper,f-lob_mocha --out x.gif  # your own
//   node scripts/turntable-gif.mjs --sheet out-dir [--looks ...] [--angles 0,40]   # stills, to pick looks
//
// Options: --frames 96  --fps 16  --width 400  --size 720 (render edge)  --page "fov=35&y=-0.2" (framing,
// see turntable.ts)  --alpha 4 (hair opacity gain; 1 = as the studio draws it)
// --url http://localhost:3000  --keep (keep the PNG frames next to the GIF)

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const origin = opt('url', 'http://localhost:3000');
const size = Number(opt('size', '720'));
const frames = Number(opt('frames', '96'));
const fps = Number(opt('fps', '16'));
const width = Number(opt('width', '400'));
const sheetDir = opt('sheet', null);
const out = resolve(opt('out', 'tryon.gif'));
// Hair opacity gain. The studio draws catalog hair at 1, where thin straight cuts let the buzz-cut
// scalp and ears show through from behind; 4 makes them solid without changing the face-on look.
const pageQuery = [`alpha=${opt('alpha', '4')}`, opt('page', '')].filter(Boolean).join('&');

// The README line-up: every listed women's cut once, four per colour, a quarter second each.
// Order matters: the first six and last six are on screen while the face is (0-90 and 270-360
// degrees), so they are the cuts that frame it best; the middle twelve are seen from behind.
const README_LOOKS = [
  'f-birkin_copper', 'f-curlyshag_espresso', 'f-faceframing_honeyblonde', 'f-hollywoodwaves_cherrycola',
  'f-layeredbob_mocha', 'f-longcurls_caramelbalayage',
  'f-shag_copper', 'f-braids_honeyblonde', 'f-sleekstraight_espresso', 'f-mermaidwaves_cherrycola',
  'f-afro_mocha', 'f-lob_caramelbalayage', 'f-highponytail_copper', 'f-hushcut_honeyblonde',
  'f-mullet_espresso', 'f-locs_cherrycola', 'f-wolfcut_mocha', 'f-beachwaves_caramelbalayage',
  'f-bluntbangs_espresso', 'f-butterfly_copper', 'f-asymbob_cherrycola', 'f-longlayersbangs_honeyblonde',
  'f-ccurl_mocha', 'f-mediumcurtains_caramelbalayage',
];

/** Mirror of turntableFrame() in src/app/lab/turntable/turntable.ts (tested there). */
const frameAt = (i, n, looks) => ({ angle: (2 * Math.PI * i) / n, look: Math.min(looks - 1, Math.floor((i * looks) / n)) });

const browser = await chromium.launch({ headless: !flag('headed'), args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: size + 64, height: size + 96 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.goto(`${origin}/lab/turntable?size=${size}${pageQuery ? `&${pageQuery}` : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__turntable || /^failed/.test(document.querySelector('[data-testid="turntable-status"]')?.textContent ?? ''), null, { timeout: 120_000 });
  const status = await page.textContent('[data-testid="turntable-status"]');
  if (status?.startsWith('failed')) throw new Error(status);
  console.log('renderer:', await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  }));

  const catalog = await page.evaluate(() => window.__turntable.looks());
  const asked = (opt('looks', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const looks = asked.length || sheetDir ? asked : README_LOOKS;
  const unknown = looks.filter((id) => !catalog.some((l) => l.id === id));
  if (unknown.length) throw new Error(`unknown looks: ${unknown.join(', ')}`);

  const png = () => page.evaluate(() => window.__turntable.png());
  // Wait for a rendered, mounted canvas before anything is shown: that frame is "nothing but background".
  await page.waitForFunction(() => window.__turntable.png().length > 100);
  await page.waitForTimeout(300);
  const blank = await png();

  /** Pose the head, then wait until the picture has stopped changing (splat loaded and re-sorted). */
  const shoot = async (id, angle) => {
    await page.evaluate(([v, a]) => window.__turntable.show(v, a), [id, angle]);
    let last = '';
    let same = 0;
    for (let tries = 0; tries < 200; tries++) {
      await page.waitForTimeout(90);
      const cur = await png();
      if (cur !== blank && cur === last) { if (++same >= 2) return Buffer.from(cur.split(',')[1], 'base64'); }
      else same = 0;
      last = cur;
    }
    throw new Error(`frame never settled: ${id} @ ${angle}`);
  };

  if (sheetDir) {
    // Stills of each look (default: every listed women's cut, first colour) for choosing a line-up.
    const dir = resolve(sheetDir);
    mkdirSync(dir, { recursive: true });
    const ids = looks.length ? looks : catalog.filter((l) => l.id.startsWith('f-')).map((l) => l.id);
    const angles = opt('angles', '0').split(',').map((d) => (Number(d) * Math.PI) / 180);
    for (const id of ids) {
      for (const [k, a] of angles.entries()) {
        writeFileSync(join(dir, `${id}_${k}.png`), await shoot(id, a));
      }
      console.log('still', id);
    }
  } else {
    const dir = flag('keep') ? `${out}.frames` : mkdtempSync(join(tmpdir(), 'turntable-'));
    mkdirSync(dir, { recursive: true });
    mkdirSync(dirname(out), { recursive: true });
    for (let i = 0; i < frames; i++) {
      const f = frameAt(i, frames, looks.length);
      writeFileSync(join(dir, `f${String(i).padStart(4, '0')}.png`), await shoot(looks[f.look], f.angle));
      if (i % 10 === 0) console.log(`frame ${i}/${frames}  ${looks[f.look]}`);
    }
    // One palette for the whole loop; lanczos downscale from the larger render does the antialiasing.
    const vf = `fps=${fps},scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=${opt('colors', '256')}:stats_mode=full[p];[b][p]paletteuse=dither=${opt('dither', 'sierra2_4a')}`;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(dir, 'f%04d.png'), '-vf', vf, '-loop', '0', out], { stdio: 'inherit' });
    if (!flag('keep')) rmSync(dir, { recursive: true, force: true });
    console.log('wrote', out);
  }
} finally {
  await browser.close();
}
