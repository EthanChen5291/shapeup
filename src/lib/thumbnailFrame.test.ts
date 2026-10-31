import { describe, expect, it } from 'vitest';
import {
  isBlankFrame,
  isLegacyThumbnailKey,
  nextViewCaptureDelay,
  shouldAttemptCapture,
  THUMBNAIL_VIEW_IDLE_MS,
  THUMBNAIL_VIEW_MIN_INTERVAL_MS,
  viewChangedEnough,
  THUMBNAIL_RETRY_EVERY_FRAMES,
  THUMBNAIL_SETTLE_FRAMES,
} from './thumbnailFrame';

function frame(w: number, h: number, fill: (x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, a] = fill(x, y);
    const i = (y * w + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
  }
  return data;
}

describe('isBlankFrame', () => {
  it('flags a fully transparent frame (WebGL canvas before the splat renders)', () => {
    expect(isBlankFrame(frame(64, 64, () => [0, 0, 0, 0]))).toBe(true);
  });

  it('flags a solid black opaque frame (what the transparent capture becomes as JPEG)', () => {
    expect(isBlankFrame(frame(64, 64, () => [0, 0, 0, 255]))).toBe(true);
  });

  it('flags a flat single-colour frame (scene background with nothing in front)', () => {
    expect(isBlankFrame(frame(64, 64, () => [120, 90, 70, 255]))).toBe(true);
  });

  it('flags an empty buffer', () => {
    expect(isBlankFrame(new Uint8ClampedArray(0))).toBe(true);
  });

  it('accepts a frame with a rendered subject on a transparent backdrop', () => {
    // A centred "head": ~20% of pixels, shaded so luma varies.
    const data = frame(64, 64, (x, y) => {
      const dx = x - 32, dy = y - 32;
      if (dx * dx + dy * dy < 16 * 16) return [180 + dx, 140 + dy, 110, 255];
      return [0, 0, 0, 0];
    });
    expect(isBlankFrame(data)).toBe(false);
  });

  it('accepts a frame with a subject on a solid background', () => {
    const data = frame(64, 64, (x, y) => (x > 20 && x < 44 && y > 10 && y < 54 ? [200, 170, 150, 255] : [30, 30, 40, 255]));
    expect(isBlankFrame(data)).toBe(false);
  });

  it('still flags a frame where only a stray pixel or two is lit', () => {
    const data = frame(64, 64, (x, y) => (x === 3 && y === 3 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
    expect(isBlankFrame(data, { stride: 1 })).toBe(true);
  });
});

describe('shouldAttemptCapture', () => {
  it('waits for the settle frames, then retries on a fixed cadence', () => {
    for (let f = 1; f < THUMBNAIL_SETTLE_FRAMES; f++) expect(shouldAttemptCapture(f)).toBe(false);
    expect(shouldAttemptCapture(THUMBNAIL_SETTLE_FRAMES)).toBe(true);
    expect(shouldAttemptCapture(THUMBNAIL_SETTLE_FRAMES + 1)).toBe(false);
    expect(shouldAttemptCapture(THUMBNAIL_SETTLE_FRAMES + THUMBNAIL_RETRY_EVERY_FRAMES)).toBe(true);
    expect(shouldAttemptCapture(THUMBNAIL_SETTLE_FRAMES + 2 * THUMBNAIL_RETRY_EVERY_FRAMES)).toBe(true);
  });
});

describe('isLegacyThumbnailKey', () => {
  it('flags the old baked-backdrop JPEGs and the pre-WebP PNGs', () => {
    expect(isLegacyThumbnailKey('thumbnails/abc.jpg')).toBe(true);
    expect(isLegacyThumbnailKey('thumbnails/abc.png')).toBe(true);
  });
  it('accepts WebP thumbnails and non-thumbnail keys', () => {
    expect(isLegacyThumbnailKey('thumbnails/abc.webp')).toBe(false);
    expect(isLegacyThumbnailKey('pictures/sess/scan.png')).toBe(false);
    expect(isLegacyThumbnailKey(undefined)).toBe(false);
  });
});

describe('viewChangedEnough', () => {
  const pose = (p: [number, number, number], t: [number, number, number] = [0, 0, 0]) => ({ position: p, target: t });
  it('treats the very first capture as a change', () => {
    expect(viewChangedEnough(null, pose([0, 0, 4]))).toBe(true);
  });
  it('ignores a nudge below the threshold (damping settle, tiny drag)', () => {
    expect(viewChangedEnough(pose([0, 0, 4]), pose([0.05, 0.02, 4]))).toBe(false);
  });
  it('counts a real orbit or zoom', () => {
    expect(viewChangedEnough(pose([0, 0, 4]), pose([1.2, 0.3, 3.8]))).toBe(true);
    expect(viewChangedEnough(pose([0, 0, 4]), pose([0, 0, 3.2]))).toBe(true);
  });
  it('counts a pan of the orbit target even if the camera barely moved', () => {
    expect(viewChangedEnough(pose([0, 0, 4], [0, 0, 0]), pose([0, 0, 4], [0, 0.5, 0]))).toBe(true);
  });
});

describe('nextViewCaptureDelay', () => {
  it('waits for the idle window when the last capture was long ago', () => {
    expect(nextViewCaptureDelay(100_000, 0)).toBe(THUMBNAIL_VIEW_IDLE_MS);
  });
  it('stretches to respect the minimum interval after a recent capture', () => {
    const now = 10_000, last = 9_000;
    expect(nextViewCaptureDelay(now, last)).toBe(last + THUMBNAIL_VIEW_MIN_INTERVAL_MS - now);
  });
  it('never returns less than the idle window', () => {
    expect(nextViewCaptureDelay(50_000, 49_000, 1500, 2000)).toBe(1500);
  });
});
