#!/usr/bin/env node
// Makes the try-on turntable: one head turning once around while its hair changes. It is the
// README GIF and, as an .mp4 with a poster, the landing page hero.
//
// It drives the dev-only page /lab/turntable (src/app/lab/turntable) frame by frame, so the
// result does not depend on how fast this machine draws: every frame is posed, left to settle,
// read off the canvas, and the frames are assembled with ffmpeg.
//
// Needs: `npm run dev` on :3000, the prebakes in public/prebake, ffmpeg on the PATH, and a buzz-cut
// try-on base per head in public/lab/ (gitignored): turntable_base.splat (+ .meta.json) for the
// women's line-up, turntable_guy.splat for the men's. A base is a selfie given the app's buzz
// cut (lib.production_prompt(lib.buzz_prompt()) in scripts/prebake-pipeline) and built with
// FaceLift (`modal run facelift_modal.py`, then splat_io.splat_bytes); drop anything FaceLift
// kept from the photo's background (the guy's selfie left a ceiling lamp floating over his head).
//
//   node scripts/turntable-gif.mjs --transparent --width 360 --page "fov=38" \
//     --out docs/media/tryon-turntable.gif                                         # the README GIFs
//   node scripts/turntable-gif.mjs --transparent --width 360 --page "fov=38" --lineup men \
//     --out docs/media/tryon-turntable-men.gif
//   node scripts/turntable-gif.mjs --out public/landing_turntable/turntable.mp4 \   # the landing hero
//     --poster public/landing_turntable/turntable_poster.jpg --still public/landing_turntable/turntable_still.jpg \
//     --frames 144 --fps 24 --size 1024 --width 800 \
//     --page "fov=46&y=-0.26&bg=%23eddabe"
//   (and the same with --lineup men and turntable_men.mp4, turntable_men_poster.jpg, turntable_men_still.jpg)
//   node scripts/turntable-gif.mjs --looks f-birkin_copper,f-lob_mocha --out x.gif  # your own
//   node scripts/turntable-gif.mjs --sheet out-dir [--lineup men] [--looks ...] [--angles 0,40]   # stills, to pick looks
//
// Options: --frames 96  --fps 16  --width 400  --size 720 (render edge)  --page "fov=35&y=-0.2" (framing,
// see turntable.ts)  --alpha 4 (hair opacity gain; 1 = as the studio draws it)  --start -90 (degrees
// the camera starts at; 0 = face on)  --poster file.jpg (frame 0 as an image)  --still file.jpg (the face-on frame)  --crf 24 (.mp4 quality)
// --transparent (.gif only: no background, so the page it sits on shows through)
// --url http://localhost:3000  --keep (keep the PNG frames next to the output; a rerun resumes from them)
// The output format follows --out: .gif (one palette, dithered) or .mp4 (H.264, no audio).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
// -90: the loop opens on a profile and turns through the face first, so the face is on screen
// for the whole first half and the back of the head for the second.
const start = (Number(opt('start', '-90')) * Math.PI) / 180;
const out = resolve(opt('out', 'tryon.gif'));
// Hair opacity gain. The studio draws catalog hair at 1, where thin straight cuts let the buzz-cut
// scalp and ears show through from behind; 4 makes them solid without changing the face-on look.
const transparent = flag('transparent');
if (transparent && out.endsWith('.mp4')) throw new Error('--transparent needs a .gif: H.264 has no alpha');
// The page reads the first value of a repeated key, so order is precedence: --transparent over a
// --page background, and --page over the line-up's head.
const pageQueryFor = (lineupPage) => [`alpha=${opt('alpha', '4')}`, transparent ? 'bg=transparent' : '', opt('page', ''), lineupPage].filter(Boolean).join('&');

// The line-up: every listed women's cut once, four per colour, a quarter second each. Order
// matters: with --start -90 the first twelve are on screen while the face is, so they are the
// cuts that frame it best; the last twelve are seen from behind.
const WOMEN_LOOKS = [
  'f-bluntbangs_espresso', 'f-butterfly_copper', 'f-asymbob_cherrycola', 'f-longlayersbangs_honeyblonde',
  'f-ccurl_mocha', 'f-mediumcurtains_caramelbalayage',
  'f-birkin_copper', 'f-curlyshag_espresso', 'f-faceframing_honeyblonde', 'f-hollywoodwaves_cherrycola',
  'f-layeredbob_mocha', 'f-longcurls_caramelbalayage',
  'f-shag_copper', 'f-braids_honeyblonde', 'f-sleekstraight_espresso', 'f-mermaidwaves_cherrycola',
  'f-afro_mocha', 'f-lob_caramelbalayage', 'f-highponytail_copper', 'f-hushcut_honeyblonde',
  'f-mullet_espresso', 'f-locs_cherrycola', 'f-wolfcut_mocha', 'f-beachwaves_caramelbalayage',
];

// The same idea on the men's head: natural colours mostly, a few light ones for range.
const MEN_LOOKS = [
  'm-sidepart_jetblack', 'm-wavyfringe_lightbrown', 'm-messytextured_platinum', 'm-middlepart_darkbrown',
  'm-kpopperm_ashblonde', 'm-wolfcut_darkbrown',
  'm-curlymop_lightbrown', 'm-eboy_jetblack', 'm-slickedback_silver', 'm-longcurls_darkbrown',
  'm-twists_platinum', 'm-wavymiddlepart_jetblack',
  'm-mullet_platinum', 'm-shag_lightbrown', 'm-manbun_jetblack', 'm-surferwaves_ashblonde',
  'm-afro_jetblack', 'm-longstraight_darkbrown', 'm-halfupbun_lightbrown', 'm-locs_darkbrown',
  'm-broflow_ashblonde', 'm-longlayers_silver', 'm-tuckedcurtains_lightbrown', 'm-sidefringe_darkbrown',
];
/** --lineup: the looks and the head they go on (a --page base still wins). */
const LINEUPS = {
  women: { looks: WOMEN_LOOKS, page: '' },
  men: { looks: MEN_LOOKS, page: 'base=/lab/turntable_guy.splat&meta=' },
};
const lineup = LINEUPS[opt('lineup', 'women')];
if (!lineup) throw new Error(`--lineup is one of: ${Object.keys(LINEUPS).join(', ')}`);

/** Mirror of turntableFrame() in src/app/lab/turntable/turntable.ts (tested there). */
const frameAt = (i, n, looks) => ({ angle: start + (2 * Math.PI * i) / n, look: Math.min(looks - 1, Math.floor((i * looks) / n)) });

const browser = await chromium.launch({ headless: !flag('headed'), args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: size + 64, height: size + 96 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[page]', e.message));
  let blank = '';
  /** Load the stage and learn what an empty canvas looks like. Also how a capture recovers when the dev server reloads the page under it. */
  const open = async () => {
    await page.goto(`${origin}/lab/turntable?size=${size}&${pageQueryFor(lineup.page)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__turntable || /^failed/.test(document.querySelector('[data-testid="turntable-status"]')?.textContent ?? ''), null, { timeout: 180_000 });
    const status = await page.textContent('[data-testid="turntable-status"]');
    if (status?.startsWith('failed')) throw new Error(status);
    // A rendered, mounted canvas before anything is shown: that frame is "nothing but background".
    await page.waitForFunction(() => window.__turntable.png().length > 100);
    await page.waitForTimeout(300);
    blank = await page.evaluate(() => window.__turntable.png());
  };
  await open();
  console.log('renderer:', await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  }));

  const catalog = await page.evaluate(() => window.__turntable.looks());
  const asked = (opt('looks', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const looks = asked.length || sheetDir ? asked : lineup.looks;
  const unknown = looks.filter((id) => !catalog.some((l) => l.id === id));
  if (unknown.length) throw new Error(`unknown looks: ${unknown.join(', ')}`);

  const png = () => page.evaluate(() => window.__turntable.png());

  /** Pose the head, then wait until the picture has stopped changing (splat loaded and re-sorted). */
  const settle = async (id, angle) => {
    await page.evaluate(([v, a]) => window.__turntable.show(v, a), [id, angle]);
    let last = '';
    let same = 0;
    for (let tries = 0; tries < 300; tries++) {
      await page.waitForTimeout(90);
      const cur = await png();
      if (cur !== blank && cur === last) { if (++same >= 2) return Buffer.from(cur.split(',')[1], 'base64'); }
      else same = 0;
      last = cur;
    }
    throw new Error(`frame never settled: ${id} @ ${angle}`);
  };
  /** One frame, surviving a page that reloaded mid-capture (a dev server recompiling does that). */
  const shoot = async (id, angle) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await settle(id, angle);
      } catch (err) {
        if (attempt >= 4) throw err;
        console.warn(`retrying ${id} after: ${String(err.message ?? err).split('\n')[0]}`);
        await page.waitForTimeout(2000);
        await open();
      }
    }
  };

  if (sheetDir) {
    // Stills of each look (default: every listed women's cut, first colour) for choosing a line-up.
    const dir = resolve(sheetDir);
    mkdirSync(dir, { recursive: true });
    const ids = looks.length ? looks : catalog.filter((l) => l.id.startsWith(lineup === LINEUPS.men ? 'm-' : 'f-')).map((l) => l.id);
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
      const file = join(dir, `f${String(i).padStart(4, '0')}.png`);
      if (flag('keep') && existsSync(file)) continue; // resume a kept run where it stopped
      writeFileSync(file, await shoot(looks[f.look], f.angle));
      if (i % 10 === 0) console.log(`frame ${i}/${frames}  ${looks[f.look]}`);
    }
    // The lanczos downscale from the larger render does the antialiasing.
    const input = ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(dir, 'f%04d.png')];
    // With alpha, scale premultiplied: the canvas's clear pixels are black, and scaling straight
    // colour would bleed that black into every edge.
    const scale = transparent
      ? `format=rgba,premultiply=inplace=1,scale=${width}:-2:flags=lanczos,unpremultiply=inplace=1`
      : `scale=${width}:-2:flags=lanczos`;
    if (out.endsWith('.mp4')) {
      // yuv420p + faststart: plays everywhere and starts before the file has fully arrived.
      // A keyframe every half second: the landing hero seeks one loop to where the other is, and
      // with x264's default (one keyframe for the whole 6 s) that seek decodes from the start.
      const gop = String(Math.max(1, Math.round(fps / 2)));
      execFileSync('ffmpeg', [...input, '-vf', scale, '-c:v', 'libx264', '-preset', 'slow', '-crf', opt('crf', '24'), '-g', gop, '-keyint_min', gop, '-sc_threshold', '0',
        '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', out], { stdio: 'inherit' });
    } else {
      // One palette for the whole loop. GIF alpha is on/off: a pixel at least half covered is kept,
      // in its own colour, so the edge carries no halo of any background.
      const vf = transparent
        ? `${scale},split[a][b];[a]palettegen=max_colors=${opt('colors', '255')}:reserve_transparent=1:stats_mode=full[p];[b][p]paletteuse=dither=${opt('dither', 'sierra2_4a')}:alpha_threshold=${opt('threshold', '128')}`
        : `${scale},split[a][b];[a]palettegen=max_colors=${opt('colors', '256')}:stats_mode=full[p];[b][p]paletteuse=dither=${opt('dither', 'sierra2_4a')}`;
      execFileSync('ffmpeg', [...input, '-vf', vf, '-loop', '0', out], { stdio: 'inherit' });
    }
    // Stills cut from the same frames: the poster is frame 0, the still is the frame where the face is on.
    const turn = (((-start / (2 * Math.PI)) % 1) + 1) % 1;
    for (const [file, index] of [[opt('poster', null), 0], [opt('still', null), Math.round(turn * frames) % frames]]) {
      if (!file) continue;
      mkdirSync(dirname(resolve(file)), { recursive: true });
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', join(dir, `f${String(index).padStart(4, '0')}.png`), '-vf', scale, '-q:v', '3', resolve(file)], { stdio: 'inherit' });
    }
    if (!flag('keep')) rmSync(dir, { recursive: true, force: true });
    console.log('wrote', out);
  }
} finally {
  await browser.close();
}
