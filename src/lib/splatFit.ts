// Per-head vertical fit for the catalog prebakes.
//
// The catalog hair is FaceLift-native: it lands on any head exactly where it sat
// on the house model. FaceLift normalises on the face, not the skull, and skull
// height above the eye line varies by ~0.25 object units between people (house
// male 0.64, a flat-crowned head 0.57, a tall one 0.76), so hair built on the
// house male hovers over a lower crown and is swallowed by a taller one. We
// measure the wearer's crown from their buzz-cut base head and scale the hair
// vertically about the eye line (anchor) so the house crown lands on theirs.
//
// Only height is fitted. Width and depth were tried (scale to the ear line and the
// nose) and rejected: shrinking the shell flattens the volume long hair is meant to
// have. A narrower or flatter face gets the hair as built.
//
// crownZ mirrors scripts/prebake-pipeline/fit.py (crown_z), which measured the
// house crowns baked into prebakeCatalog.json. Keep the two identical.

import { SPLAT_ROW } from './splatMerge';

// Column cells over the top of the head (FaceLift object units: x right, y back, z up).
const X_EDGES = [-0.15, -0.05, 0.05, 0.15];
const Y_EDGES = [-0.2, -0.1, 0, 0.1, 0.2, 0.3, 0.4];
const CELL = 0.1;
const MIN_PER_CELL = 20;
// Looking straight down a column, the skull is where this much light is blocked;
// a buzz cut's sheer fuzz above it is walked through.
const TRANSMITTANCE = 0.3;
/**
 * Squash only, never stretch. Squashing onto a lower crown reads fine down to ~0.7; any
 * stretch reads as pulled strands and a taller forehead, because the fringe is pinned to
 * the house hairline and only the crown moves. On a taller skull the hair's own volume
 * covers the difference (checked on a 0.764 crown against a 0.638 house crown).
 */
const FIT_SCALE_RANGE = [0.7, 1.0] as const;

/** Highest point of the solid head seen from above, or null when the top is empty. */
export function crownZ(bytes: ArrayBuffer | Uint8Array): number | null {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const n = Math.floor(u8.byteLength / SPLAT_ROW);
  const dv = new DataView(u8.buffer, u8.byteOffset, n * SPLAT_ROW);
  const nx = X_EDGES.length - 1, ny = Y_EDGES.length - 1;
  const cells: Array<Array<[number, number]>> = Array.from({ length: nx * ny }, () => []);
  for (let r = 0; r < n; r++) {
    const off = r * SPLAT_ROW;
    const x = dv.getFloat32(off, true), y = dv.getFloat32(off + 4, true), z = dv.getFloat32(off + 8, true);
    if (x < X_EDGES[0] || x >= X_EDGES[nx] || y < Y_EDGES[0] || y >= Y_EDGES[ny]) continue;
    const ix = Math.floor((x - X_EDGES[0]) / CELL), iy = Math.floor((y - Y_EDGES[0]) / CELL);
    cells[Math.min(ix, nx - 1) * ny + Math.min(iy, ny - 1)].push([z, u8[off + 27] / 255]);
  }
  let best: number | null = null;
  for (const cell of cells) {
    if (cell.length < MIN_PER_CELL) continue;
    cell.sort((a, b) => b[0] - a[0]);
    let t = 1;
    for (const [z, a] of cell) {
      t *= 1 - a;
      if (t < TRANSMITTANCE) { best = best === null ? z : Math.max(best, z); break; }
    }
  }
  return best;
}

/** Vertical scale about the anchor that puts the house crown on the wearer's. */
export function crownFitScale(wearerCrown: number, houseCrown: number, anchor: number): number {
  const s = (wearerCrown - anchor) / (houseCrown - anchor);
  if (!Number.isFinite(s)) return 1;
  return Math.min(FIT_SCALE_RANGE[1], Math.max(FIT_SCALE_RANGE[0], s));
}

// ---------------------------------------------------------------------------
// Hairline.
//
// The crown fit pins the fringe to the house hairline, so on a wearer whose
// hairline sits lower than the house model's, a band of buzz-cut stubble shows
// between the two (it reads as a raised hairline; worst on parted cuts). The
// buzz-cut base makes the wearer's hairline measurable: walk up the front of
// the head and find where the front-most Gaussians turn from skin-bright to
// stubble-dark. hairlineZ does that; hairlineFit then maps house hairline →
// wearer hairline and house crown → wearer crown with a piecewise-linear
// vertical fit that is continuous at the hairline and leaves everything below
// the eye line alone (face and ears never move).
//
// Confidence: brightness only separates skin from stubble when the two differ
// (dark skin under dark stubble, grey or blonde stubble, or a fully bald base
// can fool it), so a hairline is accepted only when all three x samples agree
// and it lands in a plausible band below the crown; otherwise callers fall back
// to the one-point crown fit.

const HAIR_X_SAMPLES = [-0.1, 0, 0.1];
const HAIR_HALF_WIDTH = 0.05;
const HAIR_Z_LO = 0.0, HAIR_Z_HI = 0.66, HAIR_Z_STEP = 0.03;
const HAIR_MIN_ALPHA = 0.1;
const HAIR_MIN_PER_BIN = 12;
const HAIR_FRONT_FRACTION = 0.25; // front-most quarter of a bin = the surface facing the camera
const SKIN_LUMA = 0.5;            // a bin at least this bright (median of its front rows) is forehead
const STUBBLE_RATIO = 0.6;        // the hairline is where brightness drops below skin × this
const MIN_SKIN_BINS = 2;
const HAIRLINE_MIN_Z = 0.15;      // above the brows
const HAIRLINE_CROWN_GAP = 0.08;  // and well below the crown
const HAIRLINE_MAX_SPREAD = 0.06; // the three x samples must agree this closely
/** Vertical scale allowed for the fringe band (eye line → hairline); a short band, so a little stretch is fine. */
const BELOW_SCALE_RANGE = [0.6, 1.4] as const;
/** Hairline → crown band of the two-point fit. The fringe is pinned to the hairline, so a modest
 *  stretch here only lifts the crown; without it a short cut fitted to a lower crown sits inside a
 *  taller skull (seen 2026-11-04 on a 0.62 crown vs a 0.57 reference). */
const ABOVE_SCALE_RANGE = [0.7, 1.25] as const;
/** Real hair overlaps the skin/stubble boundary; landing the fringe exactly on it reads as floating. */
export const HAIRLINE_OVERLAP = 0.025;

function hairlineAtColumn(u8: Uint8Array, dv: DataView, n: number, xc: number): number | null {
  const nb = Math.ceil((HAIR_Z_HI - HAIR_Z_LO) / HAIR_Z_STEP);
  const bins: Array<Array<[number, number]>> = Array.from({ length: nb }, () => []); // [y, luma]
  for (let r = 0; r < n; r++) {
    const off = r * SPLAT_ROW;
    const a = u8[off + 27] / 255;
    if (a < HAIR_MIN_ALPHA) continue;
    const x = dv.getFloat32(off, true), y = dv.getFloat32(off + 4, true), z = dv.getFloat32(off + 8, true);
    if (Math.abs(x - xc) >= HAIR_HALF_WIDTH || y >= 0 || z < HAIR_Z_LO || z >= HAIR_Z_HI) continue;
    const luma = (0.299 * u8[off + 24] + 0.587 * u8[off + 25] + 0.114 * u8[off + 26]) / 255;
    bins[Math.floor((z - HAIR_Z_LO) / HAIR_Z_STEP)].push([y, luma]);
  }
  // Median luma of the front-most rows per bin (NaN when the bin is too thin).
  const luma = bins.map((bin) => {
    if (bin.length < HAIR_MIN_PER_BIN) return NaN;
    bin.sort((p, q) => p[0] - q[0]); // most negative y first = nearest the camera
    const front = bin.slice(0, Math.max(8, Math.floor(bin.length * HAIR_FRONT_FRACTION))).map((p) => p[1]).sort((p, q) => p - q);
    return front[Math.floor(front.length / 2)];
  });
  let skinBins = 0, skinSum = 0;
  for (let i = 0; i < nb; i++) {
    const L = luma[i];
    if (Number.isNaN(L)) continue;
    if (skinBins >= MIN_SKIN_BINS) {
      const skin = skinSum / skinBins;
      const level = skin * STUBBLE_RATIO;
      if (L < level) {
        // Interpolate the crossing between the last skin bin's centre and this bin's centre.
        let j = i - 1;
        while (j >= 0 && Number.isNaN(luma[j])) j--;
        const zA = HAIR_Z_LO + (j + 0.5) * HAIR_Z_STEP, zB = HAIR_Z_LO + (i + 0.5) * HAIR_Z_STEP;
        const LA = luma[j];
        const t = LA > L ? Math.min(1, Math.max(0, (LA - level) / (LA - L))) : 1;
        return zA + (zB - zA) * t;
      }
    }
    if (L >= SKIN_LUMA) { skinBins++; skinSum += L; }
  }
  return null;
}

/**
 * The wearer's hairline (object z) read off a buzz-cut base, or null when it cannot be
 * trusted. `crown` is the same head's crownZ when known; it bounds the plausible band.
 */
export function hairlineZ(bytes: ArrayBuffer | Uint8Array, crown: number | null = null): number | null {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const n = Math.floor(u8.byteLength / SPLAT_ROW);
  if (n === 0) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, n * SPLAT_ROW);
  const found: number[] = [];
  for (const xc of HAIR_X_SAMPLES) {
    const z = hairlineAtColumn(u8, dv, n, xc);
    if (z === null) return null;
    found.push(z);
  }
  found.sort((a, b) => a - b);
  if (found[2] - found[0] > HAIRLINE_MAX_SPREAD) return null;
  const z = found[1];
  const maxZ = crown === null ? HAIR_Z_HI - HAIRLINE_CROWN_GAP : crown - HAIRLINE_CROWN_GAP;
  if (z < HAIRLINE_MIN_Z || z > maxZ) return null;
  return z;
}

/** Vertical fit for a catalog cut's rows above the eye line (see lib/splatMerge MergeOptions.zFit). */
export interface ZFit {
  anchor: number;
  /** Scale about the anchor (one-point fit), or about the hairline for rows above it (two-point fit). */
  scale: number;
  /** Two-point fit: house hairline → wearer hairline, continuous at the hairline. */
  hairline?: { house: number; wearer: number; scaleBelow: number };
}

export interface HouseFit {
  anchorZ: number;
  crownZ: number;
  hairlineZ?: number;
  /** Reference head's x centre and width at the temple band (headCenterX / headWidthX), for per-head centring and sizing. */
  centerX?: number;
  widthX?: number;
}

/**
 * The fit to apply for this wearer: two-point when both hairlines are known, else the
 * one-point crown fit. `wearer.hairline` null = unmeasurable (fall back).
 */
export function hairlineFit(wearer: { crown: number; hairline: number | null }, house: HouseFit): ZFit {
  const anchor = house.anchorZ;
  if (wearer.hairline === null || house.hairlineZ === undefined || house.hairlineZ <= anchor || house.crownZ <= house.hairlineZ) {
    return { anchor, scale: crownFitScale(wearer.crown, house.crownZ, anchor) };
  }
  const target = wearer.hairline - HAIRLINE_OVERLAP;
  const rawBelow = (target - anchor) / (house.hairlineZ - anchor);
  const scaleBelow = Number.isFinite(rawBelow) ? Math.min(BELOW_SCALE_RANGE[1], Math.max(BELOW_SCALE_RANGE[0], rawBelow)) : 1;
  // Where the house hairline actually lands after clamping, so the segment above stays continuous.
  const wearerHairline = anchor + (house.hairlineZ - anchor) * scaleBelow;
  const rawAbove = (wearer.crown - wearerHairline) / (house.crownZ - house.hairlineZ);
  const scale = Number.isFinite(rawAbove) ? Math.min(ABOVE_SCALE_RANGE[1], Math.max(ABOVE_SCALE_RANGE[0], rawAbove)) : 1;
  return { anchor, scale, hairline: { house: house.hairlineZ, wearer: wearerHairline, scaleBelow } };
}


// ---------------------------------------------------------------------------
// Head width and centre, read at the temple band (z 0.2–0.3, front half), where
// the skull is bare on a buzz cut and ears do not reach. A cut fitted on one head
// is centred and sized to another with these.

const TEMPLE_Z = [0.2, 0.3] as const;
const TEMPLE_MIN_ALPHA = 0.1; // buzz heads are sheer: only ~150 rows in the band pass 0.25
const TEMPLE_MIN_ROWS = 100;
const WIDTH_SCALE_RANGE = [0.85, 1.2] as const;

function templeXs(bytes: ArrayBuffer | Uint8Array): Float32Array | null {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const n = Math.floor(u8.byteLength / SPLAT_ROW);
  if (n === 0) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, n * SPLAT_ROW);
  const xs: number[] = [];
  for (let r = 0; r < n; r++) {
    const off = r * SPLAT_ROW;
    if (u8[off + 27] / 255 < TEMPLE_MIN_ALPHA) continue;
    const y = dv.getFloat32(off + 4, true), z = dv.getFloat32(off + 8, true);
    if (y >= 0.15 || z < TEMPLE_Z[0] || z >= TEMPLE_Z[1]) continue;
    xs.push(dv.getFloat32(off, true));
  }
  if (xs.length < TEMPLE_MIN_ROWS) return null;
  return Float32Array.from(xs).sort();
}
const q = (s: Float32Array, p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];

/** Width of the head at the temple band (2nd–98th percentile of x), or null. */
export function headWidthX(bytes: ArrayBuffer | Uint8Array): number | null {
  const s = templeXs(bytes);
  return s ? q(s, 0.98) - q(s, 0.02) : null;
}
/** x centre of the head at the temple band (median x), or null. */
export function headCenterX(bytes: ArrayBuffer | Uint8Array): number | null {
  const s = templeXs(bytes);
  return s ? q(s, 0.5) : null;
}
/** Uniform scale that sizes a cut fitted on the reference head to this one (clamped). */
export function widthFitScale(wearerWidth: number | null, refWidth: number | undefined): number {
  if (wearerWidth === null || refWidth === undefined || !(refWidth > 0)) return 1;
  return Math.min(WIDTH_SCALE_RANGE[1], Math.max(WIDTH_SCALE_RANGE[0], wearerWidth / refWidth));
}
/** Object-space x shift that moves a cut from the reference head's centre to this one's. */
export function centerFitDx(wearerCenter: number | null, refCenter: number | undefined): number {
  if (wearerCenter === null || refCenter === undefined) return 0;
  return wearerCenter - refCenter;
}
