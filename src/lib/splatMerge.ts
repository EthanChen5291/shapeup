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
// Axis cheat-sheet for the offsets, as measured on real heads (2026-11-04): object
// +x is the viewer's right, the FACE is at negative y (nose tip y ≈ −0.5), and +z
// is UP (eye line z = 0, nose tip z ≈ −0.24, crown z ≈ 0.5–0.65). So a negative dz
// pulls the hair DOWN over the hairline; the default −0.05 is that pull. (An earlier
// note here derived the opposite sign from the viewer's Euler angles; the bytes and
// the screen disagree with it.)

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
  /** Extra scale on x only (positions and Gaussian x extent), after `k`: sizes the hair to the
   *  wearer's head width at the temples (lib/splatFit axisFitScale). 1 = none. */
  kx?: number;
  /** Extra scale on y only (front–back), after `k`: the wearer's head depth. 1 = none. */
  ky?: number;
  dx?: number;
  dy?: number;
  dz?: number;
  /** Per-head vertical fit: hair rows above `anchor` (object z, the eye line) have their
   *  height above it, and their z extent, multiplied by `scale` (see lib/splatFit). With
   *  `hairline`, rows between the anchor and the house hairline are scaled by `scaleBelow`
   *  so the house hairline lands on the wearer's, and rows above it by `scale` about the
   *  wearer's hairline (continuous there). */
  zFit?: { anchor: number; scale: number; hairline?: { house: number; wearer: number; scaleBelow: number } };
  alpha?: number;
  /** Gain applied to the head rows' alpha (see PrebakeTransform.headAlpha). */
  headAlpha?: number;
  /** Extra gain on head rows above object z (the wearer's hairline): dims the buzz-cut
   *  stubble under the hair so a parting shows scalp, not a dark skull. 1 = off. */
  headAlphaAbove?: { z: number; gain: number };
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
  const { k, kx = 1, ky = 1, dx = 0, dy = 0, dz = 0, zFit, alpha = 1, headAlpha = 1, headAlphaAbove } = opts;
  const h = headAlpha === 1 ? new Uint8Array(head) : gainSplatAlpha(head, headAlpha);
  const p = new Uint8Array(prebake);
  const hn = Math.floor(h.length / SPLAT_ROW);
  const pn = Math.floor(p.length / SPLAT_ROW);
  const out = new Uint8Array((hn + pn) * SPLAT_ROW);
  out.set(h.subarray(0, hn * SPLAT_ROW), 0);
  out.set(p.subarray(0, pn * SPLAT_ROW), hn * SPLAT_ROW);
  const f = new Float32Array(out.buffer);
  if (headAlphaAbove && headAlphaAbove.gain !== 1) {
    for (let r = 0; r < hn; r++) {
      if (f[r * (SPLAT_ROW / 4) + 2] > headAlphaAbove.z) {
        const ai = r * SPLAT_ROW + 27;
        out[ai] = Math.min(255, Math.round(out[ai] * headAlphaAbove.gain));
      }
    }
  }
  // Scale pos+scale (first 6 of the 8 floats per row) of the prebake region.
  const fStart = hn * (SPLAT_ROW / 4);
  const gainAlpha = alpha !== 1;
  for (let r = 0; r < pn; r++) {
    const base = fStart + r * (SPLAT_ROW / 4);
    for (let j = 0; j < 6; j++) f[base + j] *= k;
    if (kx !== 1) { f[base] *= kx; f[base + 3] *= kx; }
    if (ky !== 1) { f[base + 1] *= ky; f[base + 4] *= ky; }
    const z = f[base + 2];
    if (zFit && z > zFit.anchor) {
      const hl = zFit.hairline;
      if (hl && z < hl.house) {
        f[base + 2] = zFit.anchor + (z - zFit.anchor) * hl.scaleBelow;
        f[base + 5] *= hl.scaleBelow;
      } else if (hl) {
        f[base + 2] = hl.wearer + (z - hl.house) * zFit.scale;
        f[base + 5] *= zFit.scale;
      } else {
        f[base + 2] = zFit.anchor + (z - zFit.anchor) * zFit.scale;
        f[base + 5] *= zFit.scale;
      }
    }
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
