// Blank-frame detection for the studio thumbnail capture.
//
// The WebGL canvas is transparent (alpha: true, backdrop is a CSS div behind
// it), so a frame captured before the splat has rendered is all-transparent —
// and JPEG has no alpha, so it is saved as solid black. A solid scene-colour
// background with no splat yields a flat single-colour frame instead. Both
// are "blank" for thumbnail purposes and must never be uploaded.

/** Frames to let the scene settle before the first capture attempt. */
export const THUMBNAIL_SETTLE_FRAMES = 3;
/** Re-check cadence while the frame is still blank (≈250 ms at 60 fps). */
export const THUMBNAIL_RETRY_EVERY_FRAMES = 15;
/** Give up after this many eligible frames (≈2 min at 60 fps). */
export const THUMBNAIL_MAX_FRAMES = 7200;

export interface BlankFrameOptions {
  /** Sample every Nth pixel (default 7 — ~37k samples on a 512² frame). */
  stride?: number;
  /** Alpha at or below this counts as "nothing drawn". */
  alphaFloor?: number;
  /** r, g and b all at or below this counts as black. */
  blackCeil?: number;
  /** Fraction of void (transparent/black) samples above which the frame is blank. */
  voidFraction?: number;
  /** Luma range (max − min) below which the frame is a flat fill. */
  minLumaSpread?: number;
}

/**
 * True when RGBA pixel data holds nothing worth keeping: nearly every sampled
 * pixel is transparent or black, or the whole frame is one flat colour.
 */
export function isBlankFrame(data: ArrayLike<number>, opts: BlankFrameOptions = {}): boolean {
  const {
    stride = 7,
    alphaFloor = 8,
    blackCeil = 10,
    voidFraction = 0.985,
    minLumaSpread = 8,
  } = opts;
  const pixelCount = Math.floor(data.length / 4);
  if (pixelCount === 0) return true;

  let samples = 0;
  let voids = 0;
  let minLuma = 255;
  let maxLuma = 0;
  for (let p = 0; p < pixelCount; p += stride) {
    const i = p * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    samples++;
    if (a <= alphaFloor || (r <= blackCeil && g <= blackCeil && b <= blackCeil)) {
      voids++;
      continue;
    }
    // Rec.601 luma, integer-ish; good enough to detect a flat fill.
    const luma = (r * 299 + g * 587 + b * 114) / 1000;
    if (luma < minLuma) minLuma = luma;
    if (luma > maxLuma) maxLuma = luma;
  }
  if (voids / samples >= voidFraction) return true;
  // Flat fill: every non-void sample has (almost) the same brightness.
  return maxLuma - minLuma < minLumaSpread;
}

/** Whether a capture should be attempted on this eligible frame index (1-based). */
export function shouldAttemptCapture(frame: number): boolean {
  if (frame < THUMBNAIL_SETTLE_FRAMES) return false;
  if (frame === THUMBNAIL_SETTLE_FRAMES) return true;
  return (frame - THUMBNAIL_SETTLE_FRAMES) % THUMBNAIL_RETRY_EVERY_FRAMES === 0;
}

/**
 * Thumbnails worth replacing: JPEGs from before the transparent capture (light
 * studio backdrop or solid black baked in, so they can't follow the theme), and
 * PNGs from before uploads were re-encoded as the much smaller WebP. The studio
 * recaptures any project still carrying one, once, when it's opened.
 */
export function isLegacyThumbnailKey(key: string | null | undefined): boolean {
  return !!key && key.startsWith('thumbnails/') && (key.endsWith('.jpg') || key.endsWith('.png'));
}

// ── Live re-capture when the view settles ─────────────────────────────────
// The first thumbnail is the default front-facing pose. After that, like a
// document thumbnail that tracks the last saved state, we re-capture once the
// user stops moving the camera — not on a timer, never mid-drag, and only if
// the pose actually changed. The capture itself still waits for a loaded,
// revealed, non-blank splat (ThumbnailCapture).

/** Camera must be still this long before a re-capture is considered. */
export const THUMBNAIL_VIEW_IDLE_MS = 1500;
/** At most one view-driven re-capture per this interval. */
export const THUMBNAIL_VIEW_MIN_INTERVAL_MS = 8000;
/** Pose must move at least this far (world units, position or target) to count. */
export const THUMBNAIL_VIEW_MIN_DELTA = 0.2;

export type ViewPose = { position: [number, number, number]; target: [number, number, number] };

function dist(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** True when the camera or its orbit target moved meaningfully since the last capture. */
export function viewChangedEnough(
  last: ViewPose | null,
  current: ViewPose,
  minDelta = THUMBNAIL_VIEW_MIN_DELTA,
): boolean {
  if (!last) return true;
  return dist(last.position, current.position) >= minDelta || dist(last.target, current.target) >= minDelta;
}

/** How long to wait before the next view-driven capture may fire. */
export function nextViewCaptureDelay(
  now: number,
  lastCaptureAt: number,
  idleMs = THUMBNAIL_VIEW_IDLE_MS,
  minIntervalMs = THUMBNAIL_VIEW_MIN_INTERVAL_MS,
): number {
  const untilAllowed = lastCaptureAt + minIntervalMs - now;
  return Math.max(idleMs, untilAllowed);
}
