// Merge a prebaked hair-only .splat INTO a head .splat so they render as one
// <Splat> cloud. Rendering the hair as a *second* transparent cloud washes it out:
// drei sorts each cloud on its own, so the faint hair Gaussians interleaved with
// the scalp never composite in depth order. One cloud = one global sort.
// (Ported from the prebake branch, 14494ee.)
//
// The prebakes were fitted to a head drawn with the default viewer transform, and
// head and hair share its rotation + position, differing only in uniform scale.
// Rebasing a hair point into head object space is then one scalar:
//   R·sH·xH + T = R·sP·xP + T  ⇒  xH = (sP/sH)·xP
// so each hair row's position and Gaussian scale are multiplied by k = sP/sH, an
// object-space offset is added, and the alpha byte may be gained (the hair sits
// in the scalp's depth range, so a touch more opacity stops it reading as sheer).
//
// Axis cheat-sheet for the offsets (head object space → world, given the viewer
// rotation [-π/2, π, π]): +x → world +x (viewer's right), +y → world +z (toward
// the camera / out of the face), +z → world −y (DOWN). So "raise the hair" is a
// negative dz.

// antimatter15 .splat row: pos f32×3 | scale f32×3 | rgba u8×4 | quat u8×4.
export const SPLAT_ROW = 32;

/** How a prebaked hair cloud is placed on a head (see resolvePrebakeTransform). */
export interface PrebakeTransform {
  /** Hair fit scale before dividing by the head's own viewer scale. */
  scale: number;
  /** Object-space offsets, applied after scaling (see axis note above). */
  dx: number;
  dy: number;
  dz: number;
  /** Alpha gain: 1 = as baked; >1 makes the hair denser. Bytes clamp at 255. */
  alpha: number;
  /** Alpha gain for the HEAD (buzz-cut base) rows: a sheer scalp lets hair show through. */
  headAlpha: number;
}

export const PREBAKE_DEFAULT_TRANSFORM: PrebakeTransform = {
  scale: 2.721, // hair fit on the head (2.474 + 10%), tuned by eye on the prebake branch
  dx: 0,
  dy: 0,
  dz: -0.05, // the long-standing "dropZ 0.05" nudge, expressed as an added offset
  // Both clouds are sheer as baked (FaceLift heads: most top-of-head Gaussians
  // have alpha < 32/255), so the scalp showed through the hair and the head
  // through itself. Moderate gains; per-cut calibration refines them.
  alpha: 1.4,
  headAlpha: 1.5,
};

/** @deprecated kept for callers/tests that still think in (scale, dropZ). */
export const PREBAKE_OVERLAY = {
  scale: PREBAKE_DEFAULT_TRANSFORM.scale,
  dropZ: -PREBAKE_DEFAULT_TRANSFORM.dz,
};

export interface MergeOptions {
  /** Uniform scale applied to hair positions and Gaussian scales (= transform.scale / headScale). */
  k: number;
  dx?: number;
  dy?: number;
  dz?: number;
  alpha?: number;
  /** Gain applied to the head rows' alpha (see PrebakeTransform.headAlpha). */
  headAlpha?: number;
}

/** Copy of a .splat with every row's alpha byte multiplied by `gain` (clamped). 1 → same bytes. */
export function gainSplatAlpha(bytes: ArrayBuffer | Uint8Array, gain: number): Uint8Array {
  const src = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const out = new Uint8Array(src);
  if (gain === 1) return out;
  const n = Math.floor(out.length / SPLAT_ROW);
  for (let r = 0; r < n; r++) {
    const ai = r * SPLAT_ROW + 27;
    out[ai] = Math.min(255, Math.round(out[ai] * gain));
  }
  return out;
}

export function mergeSplatBuffersWith(head: ArrayBuffer, prebake: ArrayBuffer, opts: MergeOptions): Uint8Array {
  const { k, dx = 0, dy = 0, dz = 0, alpha = 1, headAlpha = 1 } = opts;
  const h = headAlpha === 1 ? new Uint8Array(head) : gainSplatAlpha(head, headAlpha);
  const p = new Uint8Array(prebake);
  const hn = Math.floor(h.length / SPLAT_ROW);
  const pn = Math.floor(p.length / SPLAT_ROW);
  const out = new Uint8Array((hn + pn) * SPLAT_ROW);
  out.set(h.subarray(0, hn * SPLAT_ROW), 0);
  out.set(p.subarray(0, pn * SPLAT_ROW), hn * SPLAT_ROW);
  // Scale pos+scale (first 6 of the 8 floats per row) of the prebake region.
  const f = new Float32Array(out.buffer);
  const fStart = hn * (SPLAT_ROW / 4);
  const gainAlpha = alpha !== 1;
  for (let r = 0; r < pn; r++) {
    const base = fStart + r * (SPLAT_ROW / 4);
    for (let j = 0; j < 6; j++) f[base + j] *= k;
    f[base] += dx;
    f[base + 1] += dy;
    f[base + 2] += dz;
    if (gainAlpha) {
      const ai = (hn + r) * SPLAT_ROW + 27;
      out[ai] = Math.min(255, Math.round(out[ai] * alpha));
    }
  }
  return out;
}

/** Legacy signature: uniform scale k and a downward nudge subtracted from z. */
export function mergeSplatBuffers(head: ArrayBuffer, prebake: ArrayBuffer, k: number, dropZ: number): Uint8Array {
  return mergeSplatBuffersWith(head, prebake, { k, dz: -dropZ });
}
