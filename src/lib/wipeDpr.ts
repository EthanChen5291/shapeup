// Canvas resolution for the splat viewer, and the adaptive drop while a replace wipe runs.
//
// Measured 2026-11-05 (MacBook, 120 Hz, 2x display): a style switch keeps the old cloud and
// the new one on screen for the 1.2 s wipe, and the GPU then paints two ~240k-Gaussian
// clouds full screen. The main thread is idle, but each frame took ~33 ms (30 fps) for the
// whole wipe; painting at 1x brought that to ~21 ms. How much of a wipe is pixel cost depends
// on the GPU, so the wipe resolution is learned per device rather than fixed: every wipe
// measures its own mean frame time, and the next wipe steps the resolution up when there was
// headroom (80 fps+) or down when it fell under 30 fps. The floor is 1x, and the level only
// applies during the wipe itself. It persists in localStorage.
//
// The drop goes through the Canvas `dpr` prop, not a setDpr() call from inside the scene:
// react-three-fiber re-applies the prop on every Canvas render, which undid an in-scene
// setDpr within ~100 ms (the loading state re-renders constantly during a switch).

export type RenderQuality = 'performance' | 'balanced' | 'high';

/** Resolutions a wipe may run at, lowest first. */
export const WIPE_DPR_STEPS = [1, 1.5, 2] as const;
/** A wipe whose frames averaged at most this (80 fps+) has real headroom and tries the next step
 *  up. A step up costs up to ~2.3x the pixel work, so a wipe at 50 fps that stepped up would land
 *  near 30 fps and then sit there: seen on a 2x MacBook, 21 ms at 1x → 31 ms at 1.5x, held. */
export const WIPE_FAST_MS = 12;
/** A wipe whose frames averaged more than this fell under 30 fps and steps down. The target is
 *  "never under 30 fps"; resolution is only given up when that is at stake, and never below 1x
 *  (the page's own pixel size, what every non-Retina screen shows all the time). */
export const WIPE_SLOW_MS = 33;
/** Fewer frames than this and the wipe is too short to judge. */
export const WIPE_MIN_FRAMES = 10;
export const WIPE_DPR_STORAGE_KEY = 'shapeup.wipeDpr.v2'; // v2: step-up threshold changed, old levels discarded

/** The most a quality setting ever renders at (the upper end of its clamp). */
export function qualityMaxDpr(quality: RenderQuality): number {
  return quality === 'performance' ? 1 : quality === 'balanced' ? 1.5 : 2;
}

/**
 * The Canvas `dpr` prop. With `wipeLevel` (a wipe is in flight) it is that level, capped by the
 * quality's maximum and the screen's own ratio; otherwise the quality's usual clamp.
 */
export function canvasDpr(quality: RenderQuality, wipeLevel?: number, devicePixelRatio = 1): number | [number, number] {
  if (wipeLevel !== undefined) return Math.max(1, Math.min(wipeLevel, qualityMaxDpr(quality), devicePixelRatio));
  if (quality === 'performance') return 1;
  return quality === 'balanced' ? [1, 1.5] : [1, 2];
}

/**
 * The wipe level to use next time, from how the last wipe went: one step up when it averaged
 * WIPE_FAST_MS or better (headroom), one step down when it averaged worse than WIPE_SLOW_MS
 * (under 30 fps), else unchanged.
 * Steps never leave WIPE_DPR_STEPS, never exceed the screen's ratio, and a wipe with too few
 * frames teaches nothing.
 */
export function adaptWipeDpr(current: number, meanFrameMs: number, frames: number, devicePixelRatio: number): number {
  if (frames < WIPE_MIN_FRAMES || !Number.isFinite(meanFrameMs)) return current;
  const steps = WIPE_DPR_STEPS.filter((s) => s <= Math.max(1, devicePixelRatio));
  let i = steps.findIndex((s) => s >= current);
  if (i < 0) i = steps.length - 1;
  if (meanFrameMs <= WIPE_FAST_MS) i = Math.min(steps.length - 1, i + 1);
  else if (meanFrameMs > WIPE_SLOW_MS) i = Math.max(0, i - 1);
  return steps[i];
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const storage = (): StorageLike | null => {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
};

/** The level learned on this device, or 1 (the safe start) when nothing usable is stored. */
export function loadWipeDpr(store: StorageLike | null = storage()): number {
  try {
    const v = Number(store?.getItem(WIPE_DPR_STORAGE_KEY));
    return (WIPE_DPR_STEPS as readonly number[]).includes(v) ? v : 1;
  } catch { return 1; }
}

export function saveWipeDpr(level: number, store: StorageLike | null = storage()): void {
  try { store?.setItem(WIPE_DPR_STORAGE_KEY, String(level)); } catch { /* private mode, quota: the default is fine */ }
}
