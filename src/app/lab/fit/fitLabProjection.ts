// Pure helpers for the /lab/fit explainer: sample .splat rows into flat point arrays,
// name the z band a hair Gaussian falls in (which rule of the two-point fit moves it),
// and map object coordinates onto a 2D canvas for the three orthographic views.
// Nothing here re-implements the fit: band thresholds are read off the ZFit that
// lib/splatFit.hairlineFit produced, and "after" positions come from the merged bytes.

import type { ZFit } from '@/lib/splatFit';
import { SPLAT_ROW } from '@/lib/splatMerge';

/** Which rule of mergeSplatBuffersWith moved a hair row, by its z before the fit. */
export type Band = 'below' | 'fringe' | 'above';

export const BAND_LABEL: Record<Band, string> = {
  below: 'below the eye line: z unchanged',
  fringe: 'eye line → house hairline: ×scaleBelow about z = anchor',
  above: 'above the house hairline: re-anchored at the landed hairline, ×scaleAbove',
};

/** Same comparisons, same order, as the zFit branch in lib/splatMerge.mergeSplatBuffersWith. */
export function bandFor(z: number, zFit: ZFit | undefined): Band {
  if (!zFit || !(z > zFit.anchor)) return 'below';
  if (zFit.hairline && z < zFit.hairline.house) return 'fringe';
  if (zFit.hairline) return 'above';
  return 'fringe'; // one-point crown fit: everything above the anchor is one band
}

export interface Points {
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  /** alpha 0..1 */
  a: Float32Array;
  /** row index in the source buffer each point came from */
  rows: Int32Array;
}

export interface SampleOptions {
  /** first row to read (e.g. the hair region of a merged buffer) */
  start?: number;
  /** rows to consider from `start`; default to the end */
  count?: number;
  /** keep every n-th row */
  stride?: number;
  /** drop rows fainter than this (0..1) */
  minAlpha?: number;
}

/** Every `stride`-th row with alpha ≥ minAlpha, as flat arrays (positions only). */
export function samplePoints(bytes: ArrayBuffer | Uint8Array, opts: SampleOptions = {}): Points {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const total = Math.floor(u8.byteLength / SPLAT_ROW);
  const start = Math.max(0, opts.start ?? 0);
  const end = Math.min(total, start + (opts.count ?? total - start));
  const stride = Math.max(1, Math.floor(opts.stride ?? 1));
  const minAlpha = opts.minAlpha ?? 0;
  const dv = new DataView(u8.buffer, u8.byteOffset, total * SPLAT_ROW);
  const cap = Math.ceil(Math.max(0, end - start) / stride);
  const x = new Float32Array(cap), y = new Float32Array(cap), z = new Float32Array(cap), a = new Float32Array(cap);
  const rows = new Int32Array(cap);
  let n = 0;
  for (let r = start; r < end; r += stride) {
    const off = r * SPLAT_ROW;
    const alpha = u8[off + 27] / 255;
    if (alpha < minAlpha) continue;
    x[n] = dv.getFloat32(off, true);
    y[n] = dv.getFloat32(off + 4, true);
    z[n] = dv.getFloat32(off + 8, true);
    a[n] = alpha;
    rows[n] = r;
    n++;
  }
  return { x: x.subarray(0, n), y: y.subarray(0, n), z: z.subarray(0, n), a: a.subarray(0, n), rows: rows.subarray(0, n) };
}

/** Read one row's (x, y, z) straight from a .splat buffer. */
export function rowXYZ(bytes: ArrayBuffer | Uint8Array, row: number): [number, number, number] {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const off = row * SPLAT_ROW;
  return [dv.getFloat32(off, true), dv.getFloat32(off + 4, true), dv.getFloat32(off + 8, true)];
}

export type ViewId = 'side' | 'front' | 'top';

/**
 * Orthographic views in the FaceLift object frame (x right, y back / face at −y, z up).
 *   side  : horizontal = y (face at −y is on the left), vertical = z (up)
 *   front : horizontal = x, vertical = z (up)
 *   top   : horizontal = x, vertical = y (face at −y is at the bottom, like looking down at the head)
 */
export interface View {
  id: ViewId;
  label: string;
  hAxis: 'x' | 'y';
  vAxis: 'y' | 'z';
  /** world → view coordinates (view h grows right, view v grows UP) */
  project: (x: number, y: number, z: number) => [number, number];
}

export const VIEWS: View[] = [
  { id: 'side', label: 'Side view (y vs z) — face on the left', hAxis: 'y', vAxis: 'z', project: (_x, y, z) => [y, z] },
  { id: 'front', label: 'Front view (x vs z)', hAxis: 'x', vAxis: 'z', project: (x, _y, z) => [x, z] },
  { id: 'top', label: 'Top view (x vs y) — face at the bottom', hAxis: 'x', vAxis: 'y', project: (x, y) => [x, y] },
];

export interface Mapper {
  /** view (h, v) → canvas pixels (px right, py down) */
  toPx: (h: number, v: number) => [number, number];
  width: number;
  height: number;
  pxPerUnit: number;
}

/**
 * Pixel mapping for a view: `range` is the world window [hMin, hMax, vMin, vMax] in view
 * coordinates, fit into `width`×`height` with the same scale on both axes (no squash).
 */
export function makeMapper(range: [number, number, number, number], width: number, height: number): Mapper {
  const [hMin, hMax, vMin, vMax] = range;
  const pxPerUnit = Math.min(width / (hMax - hMin), height / (vMax - vMin));
  const hMid = (hMin + hMax) / 2, vMid = (vMin + vMax) / 2;
  return {
    width,
    height,
    pxPerUnit,
    toPx: (h, v) => [width / 2 + (h - hMid) * pxPerUnit, height / 2 - (v - vMid) * pxPerUnit],
  };
}

/** Three evenly spread sample indices from a sorted list (first quartile, median, third quartile). */
export function spreadPick(n: number, count = 3): number[] {
  if (n <= 0) return [];
  if (n <= count) return Array.from({ length: n }, (_, i) => i);
  return Array.from({ length: count }, (_, i) => Math.min(n - 1, Math.floor(((i + 1) * n) / (count + 1))));
}
