// Pure helpers for /lab/fit/anim. The fit numbers themselves always come from lib/splatFit
// (hairlineFit, axisFitScale) and the merge from lib/splatMerge; these only build the
// per-step option sets, the primer's ruler arithmetic, the stand-in head reshape, and the
// object → three.js coordinate mapping.

import type { ZFit } from '@/lib/splatFit';
import { SPLAT_ROW, type MergeOptions } from '@/lib/splatMerge';

/** z′ = P + (z − P) × s: scaling about a pivot. The point at P does not move. */
export const scaleAbout = (z: number, P: number, s: number) => P + (z - P) * s;

/** n evenly spaced values from lo to hi (inclusive). */
export function ruler(lo: number, hi: number, n: number): number[] {
  return Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
}

export type Band = 'below' | 'fringe' | 'above';

/** The band a z falls in for a two-point fit, with the merge's own comparisons (z > anchor, z < house). */
export function bandOf(z: number, zFit: ZFit): Band {
  if (!(z > zFit.anchor)) return 'below';
  if (zFit.hairline && z < zFit.hairline.house) return 'fringe';
  return zFit.hairline ? 'above' : 'fringe';
}

/**
 * The piecewise vertical rule of lib/splatMerge for one z. `tear` deliberately pivots the
 * upper band about the anchor instead of re-anchoring it at the landed hairline (the bug the
 * primer shows: the bands come apart at the house hairline).
 */
export function twoBandZ(z: number, zFit: ZFit, tear = false): number {
  const band = bandOf(z, zFit);
  if (band === 'below') return z;
  const hl = zFit.hairline;
  if (band === 'fringe') return scaleAbout(z, zFit.anchor, hl ? hl.scaleBelow : zFit.scale);
  if (!hl) return scaleAbout(z, zFit.anchor, zFit.scale);
  return tear ? scaleAbout(z, zFit.anchor, zFit.scale) : hl.wearer + (z - hl.house) * zFit.scale;
}

/**
 * Stand-in for the wearer's base head: the house head's rows above the eye line stretched so the
 * house hairline lands on the wearer's hairline and the house crown on the wearer's crown
 * (two straight segments; below the eye line untouched).
 */
export function reshapeHeadZ(z: number, wearer: { hairline: number; crown: number }, house: { hairline: number; crown: number }): number {
  if (!(z > 0)) return z;
  if (z < house.hairline) return z * (wearer.hairline / house.hairline);
  return wearer.hairline + (z - house.hairline) * ((wearer.crown - wearer.hairline) / (house.crown - house.hairline));
}

export type StepId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const STEP_TITLE: Record<StepId, string> = {
  0: 'As baked: hair on the house head',
  1: 'Swap the head for the wearer’s',
  2: 'Width: x × kx about the plane x = 0',
  3: 'Depth: y × ky about the plane y = 0',
  4: 'Lower band: 0 < z < 0.35 scaled about the eye line',
  5: 'Upper band: z ≥ 0.35 re-anchored at the landed hairline',
  6: 'Centre: x += dx',
  7: 'Instead: one uniform squash about the eye line (crown ratio only)',
};

/**
 * The production MergeOptions for a step: `full` is what QuickTryOns builds for this wearer;
 * later steps are neutralised (kx = ky = 1, dx = 0, zFit off or half-off), so every state is
 * literally mergeSplatBuffersWith with some options switched off.
 *   step 0/1  nothing but k
 *   step 2    + kx
 *   step 3    + ky
 *   step 4    + the lower band only (upper band pinned: wearer hairline = house, scale 1)
 *   step 5    + the upper band (the full zFit)
 *   step 6    + dx (= full)
 *   step 7    full, but zFit replaced by the one-point crown fit (`uniform`)
 */
export function stepOpts(step: StepId, full: MergeOptions, uniform: ZFit): MergeOptions {
  const base: MergeOptions = { ...full, kx: 1, ky: 1, dx: 0, zFit: undefined };
  const zFit = full.zFit;
  if (step <= 1) return base;
  if (step === 2) return { ...base, kx: full.kx };
  if (step === 3) return { ...base, kx: full.kx, ky: full.ky };
  if (step === 4) {
    const lowerOnly: ZFit | undefined = zFit?.hairline
      ? { anchor: zFit.anchor, scale: 1, hairline: { house: zFit.hairline.house, wearer: zFit.hairline.house, scaleBelow: zFit.hairline.scaleBelow } }
      : zFit;
    return { ...base, kx: full.kx, ky: full.ky, zFit: lowerOnly };
  }
  if (step === 5) return { ...base, kx: full.kx, ky: full.ky, zFit };
  if (step === 6) return { ...full };
  return { ...full, zFit: uniform };
}

/** Which original-z rows a step moves (for highlighting): null = all rows, [] = none. */
export function stepMovesRow(step: StepId, z: number, zFit: ZFit | undefined): boolean {
  if (step === 1) return false;
  if (step === 4) return !!zFit?.hairline && z > zFit.anchor && z < zFit.hairline.house;
  if (step === 5) return !!zFit?.hairline && z >= zFit.hairline.house;
  if (step === 7) return z > (zFit?.anchor ?? 0);
  return true;
}

/** FaceLift object frame (x right, y back, z up) → three.js (x right, y up, z toward the camera). */
export const objToThree = (x: number, y: number, z: number): [number, number, number] => [x, z, -y];

/** Read the rows `rows` of a .splat (object coords) into a flat three.js xyz array. */
export function rowsToThree(bytes: ArrayBuffer | Uint8Array, rows: Int32Array, rowOffset = 0, mapZ?: (z: number) => number): Float32Array {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const out = new Float32Array(rows.length * 3);
  for (let i = 0; i < rows.length; i++) {
    const off = (rowOffset + rows[i]) * SPLAT_ROW;
    const x = dv.getFloat32(off, true), y = dv.getFloat32(off + 4, true);
    let z = dv.getFloat32(off + 8, true);
    if (mapZ) z = mapZ(z);
    const [tx, ty, tz] = objToThree(x, y, z);
    out[i * 3] = tx; out[i * 3 + 1] = ty; out[i * 3 + 2] = tz;
  }
  return out;
}

/** Per-row rgb (0..1) for `rows`, optionally forced to a grey from luminance. */
export function rowColors(bytes: ArrayBuffer | Uint8Array, rows: Int32Array, grey = false): Float32Array {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const out = new Float32Array(rows.length * 3);
  for (let i = 0; i < rows.length; i++) {
    const off = rows[i] * SPLAT_ROW;
    const r = u8[off + 24] / 255, g = u8[off + 25] / 255, b = u8[off + 26] / 255;
    if (grey) { const l = 0.35 + 0.45 * (0.299 * r + 0.587 * g + 0.114 * b); out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = l; }
    else { out[i * 3] = r; out[i * 3 + 1] = g; out[i * 3 + 2] = b; }
  }
  return out;
}

/** Rows whose xyz differ between two flat arrays (beyond float noise). */
export function countMoved(a: Float32Array, b: Float32Array, eps = 1e-6): number {
  let n = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (Math.abs(a[i] - b[i]) > eps || Math.abs(a[i + 1] - b[i + 1]) > eps || Math.abs(a[i + 2] - b[i + 2]) > eps) n++;
  }
  return n;
}

/** Smoothstep ease in/out on 0..1. */
export const easeInOut = (t: number) => { const u = Math.min(1, Math.max(0, t)); return u * u * (3 - 2 * u); };

/** Index of the sample point nearest `targetZ` among `zs`, restricted to the front (y < yMax) and near the midline (|x| < xMax). */
export function pickSample(xs: Float32Array, ys: Float32Array, zs: Float32Array, targetZ: number, xMax = 0.12, yMax = -0.1): number {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < zs.length; i++) {
    if (Math.abs(xs[i]) >= xMax || ys[i] >= yMax) continue;
    const d = Math.abs(zs[i] - targetZ);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
