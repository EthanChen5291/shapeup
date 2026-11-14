#!/usr/bin/env node
// Makes the clips for step 3 of the landing page's "how it works" (public/landing_face1): the
// guy from the step 1 selfie turning once around, first with his own hair (face1.mp4), then with
// one catalog cut per chat suggestion (face1a.mp4 … face1h.mp4, same order as FACE1_LOOKS in
// src/data/landingSteps.ts).
//
// Pressing send swaps one clip for the next in the middle of a turn, so every clip is the same
// length, uses the same camera, and turns on the same schedule: frame i of any clip is at the
// same angle. A keyframe every 12 frames keeps the jump to "the same moment in another clip" cheap.
//
// The head is rendered with no background and laid over the paper it sits on in the page (see
// PAPER below). Transparent video was tried and dropped: Safari drew a white rim round the head.
//
// Like scripts/turntable-gif.mjs, it drives the dev-only page /lab/turntable frame by frame.
// Needs: `npm run dev` on :3000, the prebakes in public/prebake, ffmpeg on the PATH, and two heads in public/lab/
// (gitignored), both built from public/face1_selfie.webp: turntable_guy.splat is the selfie given
// the app's buzz cut (the try-on base), turntable_guy_own.splat is the selfie as it is.
// scripts/landing-step-heads.py says how they are made (and why the photo's background has to be
// cut away first).
//
//   node scripts/landing-step-clips.mjs                  # all nine clips
//   node scripts/landing-step-clips.mjs --only face1c    # one clip
//   node scripts/landing-step-clips.mjs --stills dir     # frame 0 of every clip, to check framing
//
// Options: --out public/landing_face1  --turn 1.2 (seconds per turn)  --slow 5 (how much faster the back
// of the head goes by than the face: speed = 1 + slow·sin; 0 = an even turn)  --size 788 (clip height;
// the frames are rendered at the clip's own size)  --page "fov=44&y=0.05" (framing, see turntable.ts)
// --alpha 1.5 (hair opacity gain; 1 = as the studio draws it)  --crf 24  --url http://localhost:3000
// --keep dir (keep the PNG frames there; a rerun with the same --turn, --slow and --size resumes from them)

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

const OWN = '/lab/turntable_guy_own.splat';
const BUZZ = '/lab/turntable_guy.splat';
const CLIPS = [
  { file: 'face1', base: OWN, look: '' },                           // his own hair, before any message
  { file: 'face1a', base: BUZZ, look: 'm-middlepart_darkbrown' },
  { file: 'face1b', base: BUZZ, look: 'm-messytextured_platinum' },
  { file: 'face1c', base: BUZZ, look: 'm-curlymop_lightbrown' },
  { file: 'face1d', base: BUZZ, look: 'm-slickedback_silver' },
  { file: 'face1e', base: BUZZ, look: 'm-mullet_jetblack' },
  { file: 'face1f', base: BUZZ, look: 'm-longcurls_darkbrown' },
  { file: 'face1g', base: BUZZ, look: 'm-manbun_jetblack' },
  { file: 'face1h', base: BUZZ, look: 'm-locs_darkbrown' },
];

// One turn, at 60 fps. The head whips round the back and takes its time past the face, without
// ever looking as if it has stopped there. Two versions bracket this one: 1 + 15·sin (what the
// clips these replaced were baked with, scripts/bake_face2_speed.py) read as stopping at the
// face, and 1 + 2·sin over 1.8 s read as too gentle.
const FPS = 60;
const FRAMES = Math.round(Number(opt('turn', '1.2')) * FPS);
const SLOW = Number(opt('slow', '5'));
const TURN = (() => {
  // Time taken to reach each point of the turn, then the points reached at evenly spaced times.
  const steps = 20_000;
  const time = [0];
  for (let k = 1; k <= steps; k++) time.push(time[k - 1] + 1 / (1 + SLOW * Math.sin((Math.PI * (k - 0.5)) / steps)));
  const turn = [];
  for (let i = 0, k = 0; i < FRAMES; i++) {
    const at = (time[steps] * i) / FRAMES;
    while (time[k + 1] <= at) k++;
    turn.push((k + (at - time[k]) / (time[k + 1] - time[k])) / steps);
  }
  return turn;
})();
const angleAt = (i) => -2 * Math.PI * TURN[i];

// The clip sits on the paper blob (public/blob.webp, 619x677) at 85% of its box, so it has the
// blob's shape and is laid over that same patch of the paper's grain. The patch is tinted to the
// tan the earlier clips had behind them: browsers show video a touch lighter than a picture, so
// the blob's own values would come out paler than the blob around them.
const BLOB = { w: 619, h: 677, inset: 0.85 };
const PAPER_TINT = 'rr=0.992:gg=0.975:bb=0.957'; // so the encoded clip's paper decodes to the earlier clips' (233, 210, 181); the blob is (238, 218, 191)

const origin = opt('url', 'http://localhost:3000');
const size = Number(opt('size', '788'));
const outDir = resolve(opt('out', 'public/landing_face1'));
const stillsDir = opt('stills', null);
const keepDir = opt('keep', null);
const only = (opt('only', '') || '').split(',').filter(Boolean);
const clips = CLIPS.filter((c) => !only.length || only.includes(c.file));
if (!clips.length) throw new Error(`--only is any of: ${CLIPS.map((c) => c.file).join(', ')}`);
const pageQuery = [`alpha=${opt('alpha', '1.5')}`, 'bg=transparent', opt('page', 'fov=44&y=0.05')].join('&');

const work = keepDir ? resolve(keepDir) : mkdtempSync(join(tmpdir(), 'step-clips-'));
mkdirSync(work, { recursive: true });
mkdirSync(outDir, { recursive: true });

// The render is square and has no background; the clip is the blob's shape, cut from its middle
// and laid on the paper. Its last tenth fades out, so the shoulders run into the paper instead of
// ending on the clip's flat edge.
const cropW = 2 * Math.round((size * BLOB.w) / BLOB.h / 2);
const paper = join(work, 'paper.png');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0xeddabe:s=${BLOB.w}x${BLOB.h}`, '-i', 'public/blob.webp',
  '-filter_complex', `[0][1]overlay,crop=iw*${BLOB.inset}:ih*${BLOB.inset},scale=${cropW}:${size}:flags=lanczos,colorchannelmixer=${PAPER_TINT}`, '-frames:v', '1', paper]);
const onPaper = `[1:v]format=rgba,crop=${cropW}:${size},geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip((H-Y)/(H*0.1),0,1)'[head];[0:v][head]overlay=format=rgb:shortest=1`;

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: size + 64, height: size + 96 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('[page]', e.message));
  let blank = '';
  let openBase = '';
  /** Load the stage with one head and learn what an empty canvas looks like. Also how a capture recovers when the dev server reloads the page under it. */
  const open = async (base) => {
    openBase = '';
    await page.goto(`${origin}/lab/turntable?size=${size}&base=${base}&meta=&${pageQuery}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__turntable || /^failed/.test(document.querySelector('[data-testid="turntable-status"]')?.textContent ?? ''), null, { timeout: 180_000 });
    const status = await page.textContent('[data-testid="turntable-status"]');
    if (status?.startsWith('failed')) throw new Error(status);
    await page.waitForFunction(() => window.__turntable.png().length > 100);
    await page.waitForTimeout(300);
    blank = await page.evaluate(() => window.__turntable.png());
    openBase = base;
  };
  /** Pose the head, then wait until the picture has stopped changing (splat loaded and re-sorted). */
  const settle = async (look, angle) => {
    await page.evaluate(([v, a]) => window.__turntable.show(v, a), [look, angle]);
    let last = '';
    let same = 0;
    for (let tries = 0; tries < 300; tries++) {
      await page.waitForTimeout(90);
      const cur = await page.evaluate(() => window.__turntable.png());
      if (cur !== blank && cur === last) { if (++same >= 2) return Buffer.from(cur.split(',')[1], 'base64'); }
      else same = 0;
      last = cur;
    }
    throw new Error(`frame never settled: ${look} @ ${angle}`);
  };
  /** One frame, surviving a page that reloaded mid-capture (a dev server recompiling does that). */
  const shoot = async (clip, angle) => {
    for (let attempt = 1; ; attempt++) {
      try {
        if (openBase !== clip.base) await open(clip.base);
        return await settle(clip.look, angle);
      } catch (err) {
        if (attempt >= 4) throw err;
        console.warn(`retrying ${clip.file} after: ${String(err.message ?? err).split('\n')[0]}`);
        openBase = '';
        await page.waitForTimeout(2000);
      }
    }
  };

  for (const clip of clips) {
    if (stillsDir) {
      mkdirSync(resolve(stillsDir), { recursive: true });
      const png = join(work, `${clip.file}_still.png`);
      writeFileSync(png, await shoot(clip, 0));
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', paper, '-i', png, '-filter_complex', onPaper, '-frames:v', '1', join(resolve(stillsDir), `${clip.file}.png`)]);
      console.log('still', clip.file);
      continue;
    }
    const dir = join(work, clip.file);
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < FRAMES; i++) {
      const file = join(dir, `f${String(i).padStart(4, '0')}.png`);
      if (keepDir && existsSync(file)) continue; // resume a kept run where it stopped
      writeFileSync(file, await shoot(clip, angleAt(i)));
    }
    const out = join(outDir, `${clip.file}.mp4`);
    // Tagged bt709 like the clips before these, so the tan behaves as theirs did. yuv420p +
    // faststart: plays everywhere and starts before the file has fully arrived.
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-framerate', String(FPS), '-i', paper, '-framerate', String(FPS), '-i', join(dir, 'f%04d.png'),
      '-filter_complex', `${onPaper},scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', opt('crf', '24'), '-g', '12', '-keyint_min', '12', '-sc_threshold', '0',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-movflags', '+faststart', '-an', out], { stdio: 'inherit' });
    console.log('wrote', out);
  }
} finally {
  await browser.close();
  if (!keepDir) rmSync(work, { recursive: true, force: true });
}
