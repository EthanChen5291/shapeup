// Step-by-step reconstructions of the head measurements in src/lib/splatFit.ts, for the
// /lab/fit explainer. The production functions (crownZ, hairlineZ, headWidthX, headDepthY,
// headCenterX) each return one number; these walk the SAME rules and keep every intermediate
// (per-cell transmittance walks, per-bin colours, the reference windows, the crossing
// arithmetic, the sorted percentiles) so the page can draw them. The constants below are
// copied from splatFit.ts, which does not export them; keep them identical. The colocated test
// checks each reconstruction's final value against the production function.

import { SPLAT_ROW } from '@/lib/splatMerge';

export type RGB = [number, number, number];

// ─── crownZ ──────────────────────────────────────────────────────────────────

/** splatFit.ts: X_EDGES / Y_EDGES / CELL / MIN_PER_CELL / TRANSMITTANCE. */
export const CROWN = {
  X_EDGES: [-0.15, -0.05, 0.05, 0.15],
  Y_EDGES: [-0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4],
  CELL: 0.1,
  MIN_PER_CELL: 20,
  TRANSMITTANCE: 0.3,
} as const;

export interface CrownWalkRow { z: number; a: number; t: number }
export interface CrownCell {
  index: number;
  ix: number;
  iy: number;
  x0: number; x1: number; y0: number; y1: number;
  count: number;
  /** the cell's rows, highest z first, with the running transmittance t = Π(1 − a) */
  walk: CrownWalkRow[];
  /** first walk index where t < TRANSMITTANCE, or null (cell skipped, or never opaque enough) */
  stop: number | null;
  stopZ: number | null;
  skipped: boolean;
}
export interface CrownSteps { cells: CrownCell[]; best: number | null; result: number | null; nx: number; ny: number }

export function crownSteps(bytes: ArrayBuffer | Uint8Array): CrownSteps {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const n = Math.floor(u8.byteLength / SPLAT_ROW);
  const dv = new DataView(u8.buffer, u8.byteOffset, n * SPLAT_ROW);
  const { X_EDGES, Y_EDGES, CELL, MIN_PER_CELL, TRANSMITTANCE } = CROWN;
  const nx = X_EDGES.length - 1, ny = Y_EDGES.length - 1;
  const rows: Array<Array<[number, number]>> = Array.from({ length: nx * ny }, () => []);
  for (let r = 0; r < n; r++) {
    const off = r * SPLAT_ROW;
    const x = dv.getFloat32(off, true), y = dv.getFloat32(off + 4, true), z = dv.getFloat32(off + 8, true);
    if (x < X_EDGES[0] || x >= X_EDGES[nx] || y < Y_EDGES[0] || y >= Y_EDGES[ny]) continue;
    const ix = Math.floor((x - X_EDGES[0]) / CELL), iy = Math.floor((y - Y_EDGES[0]) / CELL);
    rows[Math.min(ix, nx - 1) * ny + Math.min(iy, ny - 1)].push([z, u8[off + 27] / 255]);
  }
  let best: number | null = null, bestZ: number | null = null;
  const cells = rows.map((cell, index): CrownCell => {
    const ix = Math.floor(index / ny), iy = index % ny;
    const base = { index, ix, iy, x0: X_EDGES[ix], x1: X_EDGES[ix + 1], y0: Y_EDGES[iy], y1: Y_EDGES[iy + 1], count: cell.length };
    if (cell.length < MIN_PER_CELL) return { ...base, walk: [], stop: null, stopZ: null, skipped: true };
    cell.sort((a, b) => b[0] - a[0]);
    let t = 1, stop: number | null = null;
    const walk = cell.map(([z, a], i) => {
      t *= 1 - a;
      if (stop === null && t < TRANSMITTANCE) stop = i;
      return { z, a, t };
    });
    const stopZ = stop === null ? null : walk[stop].z;
    if (stopZ !== null && (bestZ === null || stopZ > bestZ)) { bestZ = stopZ; best = index; }
    return { ...base, walk, stop, stopZ, skipped: false };
  });
  return { cells, best, result: bestZ, nx, ny };
}

// ─── hairlineZ ───────────────────────────────────────────────────────────────

/** splatFit.ts: the HAIR_* / SKIN_REF_BINS / STUBBLE_REF_BINS / HAIRLINE_* constants. */
export const HAIRLINE = {
  X_SAMPLES: [-0.1, 0, 0.1],
  HALF_WIDTH: 0.05,
  Z_LO: 0.0, Z_HI: 0.66, Z_STEP: 0.03,
  MIN_ALPHA: 0.1,
  MIN_PER_BIN: 12,
  FRONT_FRACTION: 0.25,
  SKIN_REF_BINS: 3,
  STUBBLE_REF_BINS: 3,
  MIN_CONTRAST: 0.15,
  FRACTION: 0.5,
  MIN_Z: 0.15,
  CROWN_GAP: 0.08,
  MAX_SPREAD: 0.06,
} as const;

export const median = (vs: number[]) => { const s = [...vs].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
export const medianRGB = (cs: RGB[]): RGB => [median(cs.map((c) => c[0])), median(cs.map((c) => c[1])), median(cs.map((c) => c[2]))];
export const rgbDist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export interface HairBin {
  i: number;
  zLo: number; zHi: number;
  /** rows in the bin (alpha ≥ MIN_ALPHA, front half, within the column) */
  count: number;
  /** how many of them made the front-most quarter */
  frontCount: number;
  /** per-channel median of the front quarter, or null when the bin is too thin */
  colour: RGB | null;
}
export interface RunCheck { bins: number[]; consecutive: boolean; spread: number | null; accepted: boolean }
export interface Crossing { j: number; i: number; zA: number; zB: number; dA: number; dB: number; t: number; z: number }
export interface ColumnSteps {
  xc: number;
  bins: HairBin[];
  measurable: number[];
  /** every candidate forehead window tried, in order, until one was accepted */
  runs: RunCheck[];
  skinBins: number[] | null;
  skin: RGB | null;
  skinTop: number;
  above: number[];
  stubbleBins: number[];
  stubble: RGB | null;
  contrast: number | null;
  level: number | null;
  /** d = rgbDist(bin colour, forehead) for every measurable bin */
  trace: Array<{ i: number; z: number; d: number }>;
  crossing: Crossing | null;
  hairline: number | null;
  failure: string | null;
}
export interface HairlineSteps {
  columns: ColumnSteps[];
  sorted: number[];
  spread: number | null;
  median: number | null;
  minZ: number;
  maxZ: number;
  result: number | null;
  failure: string | null;
}

function columnSteps(u8: Uint8Array, dv: DataView, n: number, xc: number): ColumnSteps {
  const H = HAIRLINE;
  const nb = Math.ceil((H.Z_HI - H.Z_LO) / H.Z_STEP);
  const raw: Array<Array<[number, number, number, number]>> = Array.from({ length: nb }, () => []);
  for (let r = 0; r < n; r++) {
    const off = r * SPLAT_ROW;
    const a = u8[off + 27] / 255;
    if (a < H.MIN_ALPHA) continue;
    const x = dv.getFloat32(off, true), y = dv.getFloat32(off + 4, true), z = dv.getFloat32(off + 8, true);
    if (Math.abs(x - xc) >= H.HALF_WIDTH || y >= 0 || z < H.Z_LO || z >= H.Z_HI) continue;
    raw[Math.floor((z - H.Z_LO) / H.Z_STEP)].push([y, u8[off + 24] / 255, u8[off + 25] / 255, u8[off + 26] / 255]);
  }
  const bins: HairBin[] = raw.map((bin, i) => {
    const base = { i, zLo: H.Z_LO + i * H.Z_STEP, zHi: H.Z_LO + (i + 1) * H.Z_STEP, count: bin.length };
    if (bin.length < H.MIN_PER_BIN) return { ...base, frontCount: 0, colour: null };
    bin.sort((p, q) => p[0] - q[0]);
    const front = bin.slice(0, Math.max(8, Math.floor(bin.length * H.FRONT_FRACTION)));
    return { ...base, frontCount: front.length, colour: medianRGB(front.map((p) => [p[1], p[2], p[3]])) };
  });
  const colour = bins.map((b) => b.colour);
  const measurable: number[] = [];
  colour.forEach((c, i) => { if (c) measurable.push(i); });
  const out: ColumnSteps = {
    xc, bins, measurable, runs: [], skinBins: null, skin: null, skinTop: -1, above: [], stubbleBins: [], stubble: null,
    contrast: null, level: null, trace: [], crossing: null, hairline: null, failure: null,
  };
  // Forehead colour: the lowest SKIN_REF_BINS consecutive measurable bins that agree with each other.
  for (let s = 0; s + H.SKIN_REF_BINS <= measurable.length && !out.skin; s++) {
    const idx = measurable.slice(s, s + H.SKIN_REF_BINS);
    const consecutive = idx[H.SKIN_REF_BINS - 1] - idx[0] === H.SKIN_REF_BINS - 1;
    if (!consecutive) { out.runs.push({ bins: idx, consecutive, spread: null, accepted: false }); continue; }
    const cs = idx.map((i) => colour[i] as RGB);
    const spread = Math.max(...cs.flatMap((a) => cs.map((b) => rgbDist(a, b))));
    const accepted = spread <= H.MIN_CONTRAST;
    out.runs.push({ bins: idx, consecutive, spread, accepted });
    if (accepted) { out.skin = medianRGB(cs); out.skinBins = idx; out.skinTop = idx[H.SKIN_REF_BINS - 1]; }
  }
  if (!out.skin) { out.failure = 'no three consecutive measurable bins agree (no forehead colour)'; return out; }
  const skin = out.skin;
  out.trace = measurable.map((i) => ({ i, z: H.Z_LO + (i + 0.5) * H.Z_STEP, d: rgbDist(colour[i] as RGB, skin) }));
  out.above = measurable.filter((i) => i > out.skinTop);
  if (out.above.length < H.STUBBLE_REF_BINS) { out.failure = `fewer than ${H.STUBBLE_REF_BINS} measurable bins above the forehead window`; return out; }
  out.stubbleBins = out.above.slice(-H.STUBBLE_REF_BINS);
  out.stubble = medianRGB(out.stubbleBins.map((i) => colour[i] as RGB));
  out.contrast = rgbDist(out.stubble, skin);
  if (out.contrast < H.MIN_CONTRAST) { out.failure = `contrast ${out.contrast.toFixed(3)} < ${H.MIN_CONTRAST}: stubble the colour of the skin`; return out; }
  out.level = out.contrast * H.FRACTION;
  let j = out.skinTop;
  for (const i of out.above) {
    const d = rgbDist(colour[i] as RGB, skin);
    if (d > out.level) {
      const zA = H.Z_LO + (j + 0.5) * H.Z_STEP, zB = H.Z_LO + (i + 0.5) * H.Z_STEP;
      const dA = rgbDist(colour[j] as RGB, skin);
      const t = d > dA ? Math.min(1, Math.max(0, (out.level - dA) / (d - dA))) : 1;
      out.crossing = { j, i, zA, zB, dA, dB: d, t, z: zA + (zB - zA) * t };
      out.hairline = out.crossing.z;
      return out;
    }
    j = i;
  }
  out.failure = 'no bin above the forehead window crosses the level';
  return out;
}

export function hairlineSteps(bytes: ArrayBuffer | Uint8Array, crown: number | null): HairlineSteps {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const n = Math.floor(u8.byteLength / SPLAT_ROW);
  const dv = new DataView(u8.buffer, u8.byteOffset, n * SPLAT_ROW);
  const H = HAIRLINE;
  const columns = n === 0 ? [] : H.X_SAMPLES.map((xc) => columnSteps(u8, dv, n, xc));
  const minZ = H.MIN_Z;
  const maxZ = crown === null ? H.Z_HI - H.CROWN_GAP : crown - H.CROWN_GAP;
  const out: HairlineSteps = { columns, sorted: [], spread: null, median: null, minZ, maxZ, result: null, failure: null };
  if (n === 0) { out.failure = 'empty buffer'; return out; }
  const failed = columns.find((c) => c.hairline === null);
  if (failed) { out.failure = `column x = ${failed.xc} is unmeasurable (${failed.failure})`; return out; }
  out.sorted = columns.map((c) => c.hairline as number).sort((a, b) => a - b);
  out.spread = out.sorted[2] - out.sorted[0];
  out.median = out.sorted[1];
  if (out.spread > H.MAX_SPREAD) { out.failure = `spread ${out.spread.toFixed(3)} > ${H.MAX_SPREAD}: the three columns disagree`; return out; }
  if (out.median < minZ || out.median > maxZ) { out.failure = `median ${out.median.toFixed(3)} outside ${minZ}…${maxZ.toFixed(3)}`; return out; }
  out.result = out.median;
  return out;
}

// ─── temple band: headWidthX / headDepthY / headCenterX ──────────────────────

/** splatFit.ts: TEMPLE_Z / TEMPLE_FRONT_Y / TEMPLE_MIN_ALPHA / TEMPLE_MIN_ROWS. */
export const TEMPLE = { Z: [0.2, 0.3], FRONT_Y: 0.15, MIN_ALPHA: 0.1, MIN_ROWS: 100 } as const;

export interface Percentile { p: number; index: number; value: number }
export interface TempleSteps {
  /** every band row (alpha ≥ MIN_ALPHA, z in the band), with whether it is in the front half (y < FRONT_Y) */
  x: Float32Array; y: Float32Array; front: Uint8Array;
  /** sorted x of the front rows (width / centre) and sorted y of all band rows (depth) */
  xs: Float32Array | null; ys: Float32Array | null;
  x02: Percentile | null; x98: Percentile | null; y02: Percentile | null; y98: Percentile | null;
  width: number | null; depth: number | null; centre: number | null;
}

/** splatFit's q(): the value at index floor(p·n), capped at n − 1. */
const pct = (s: Float32Array, p: number): Percentile => { const index = Math.min(s.length - 1, Math.floor(p * s.length)); return { p, index, value: s[index] }; };

export function templeSteps(bytes: ArrayBuffer | Uint8Array): TempleSteps {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const n = Math.floor(u8.byteLength / SPLAT_ROW);
  const dv = new DataView(u8.buffer, u8.byteOffset, n * SPLAT_ROW);
  const xs: number[] = [], ys: number[] = [], fr: number[] = [];
  for (let r = 0; r < n; r++) {
    const off = r * SPLAT_ROW;
    if (u8[off + 27] / 255 < TEMPLE.MIN_ALPHA) continue;
    const y = dv.getFloat32(off + 4, true), z = dv.getFloat32(off + 8, true);
    if (z < TEMPLE.Z[0] || z >= TEMPLE.Z[1]) continue;
    xs.push(dv.getFloat32(off, true)); ys.push(y); fr.push(y < TEMPLE.FRONT_Y ? 1 : 0);
  }
  const x = Float32Array.from(xs), y = Float32Array.from(ys), front = Uint8Array.from(fr);
  const frontX = Float32Array.from(xs.filter((_, i) => fr[i] === 1)).sort();
  const allY = Float32Array.from(ys).sort();
  const sx = frontX.length >= TEMPLE.MIN_ROWS ? frontX : null;
  const sy = allY.length >= TEMPLE.MIN_ROWS ? allY : null;
  const x02 = sx && pct(sx, 0.02), x98 = sx && pct(sx, 0.98), y02 = sy && pct(sy, 0.02), y98 = sy && pct(sy, 0.98);
  return {
    x, y, front, xs: sx, ys: sy, x02, x98, y02, y98,
    width: x02 && x98 ? x98.value - x02.value : null,
    depth: y02 && y98 ? y98.value - y02.value : null,
    centre: x02 && x98 ? (x02.value + x98.value) / 2 : null,
  };
}
