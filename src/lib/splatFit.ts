// Per-head fit for the catalog prebakes.
//
// The catalog hair is FaceLift-native: it lands on any head exactly where it sat
// on the house model. FaceLift normalises on the face, not the skull, and skull
// height above the eye line varies by ~0.25 object units between people (house
// male 0.64, a flat-crowned head 0.57, a tall one 0.76), so hair built on the
// house male hovers over a lower crown and is swallowed by a taller one. We
// measure the wearer's buzz-cut base head and fit the hair to it, each axis on
// its own:
//
//   z  crown (crownZ) and, when it can be read, hairline (hairlineZ): a
//      piecewise-linear vertical fit about the eye line (anchor) that puts the
//      house hairline on the wearer's and the house crown on theirs.
//   x  width and centre at the temple band (headWidthX / headCenterX).
//   y  depth at the temple band (headDepthY).
//
// Everything below the eye line (face, ears) never moves.
//
// All of it mirrors scripts/prebake-pipeline/fit.py, which measured the house
// values baked into prebakeCatalog.json. Keep the two identical.

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
// the head and find where the colour of the front-most Gaussians turns from
// forehead to stubble. hairlineZ does that; hairlineFit then maps house hairline →
// wearer hairline and house crown → wearer crown with a piecewise-linear
// vertical fit that is continuous at the hairline and leaves everything below
// the eye line alone (face and ears never move).
//
// Colour, not brightness: the column is binned in z and each bin keeps the
// median RGB of its front-most rows. The forehead colour is the lowest run of
// bins that agree with each other (the bins right above the eye line are often
// brow shadow, so the run may start a few bins up), the stubble colour is the
// top of the column, and the hairline is where a bin's RGB distance from the
// forehead crosses half the forehead→stubble contrast. Halving the contrast
// instead of using a fixed distance is what makes it work on dark skin (whose
// whole colour vector is only ~0.3 long) and on platinum or grey stubble (a
// ~0.3 shift on light skin) alike, and it lands within 0.004 of the previous
// brightness rule on the house heads. A column with no contrast (bald, or
// stubble the colour of the skin) is unmeasurable.
//
// Confidence: a hairline is accepted only when all three x samples agree and
// it lands in a plausible band below the crown; otherwise callers fall back to
// the one-point crown fit.

const HAIR_X_SAMPLES = [-0.1, 0, 0.1];
const HAIR_HALF_WIDTH = 0.05;
const HAIR_Z_LO = 0.0, HAIR_Z_HI = 0.66, HAIR_Z_STEP = 0.03;
const HAIR_MIN_ALPHA = 0.1;
const HAIR_MIN_PER_BIN = 12;
const HAIR_FRONT_FRACTION = 0.25; // front-most quarter of a bin = the surface facing the camera
const SKIN_REF_BINS = 3;          // the forehead colour: the lowest run of this many consecutive bins that agree
const STUBBLE_REF_BINS = 3;       // the stubble colour: the top-most bins of the column
const HAIR_MIN_CONTRAST = 0.15;   // RGB distance: forehead bins agree within this; forehead→stubble must exceed it
const HAIRLINE_FRACTION = 0.5;    // the hairline is where the front colour is this far from forehead to stubble
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

type RGB = [number, number, number];
const median = (vs: number[]) => { const s = [...vs].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
const medianRGB = (cs: RGB[]): RGB => [median(cs.map((c) => c[0])), median(cs.map((c) => c[1])), median(cs.map((c) => c[2]))];
const rgbDist = (a: RGB, b: RGB) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function hairlineAtColumn(u8: Uint8Array, dv: DataView, n: number, xc: number): number | null {
  const nb = Math.ceil((HAIR_Z_HI - HAIR_Z_LO) / HAIR_Z_STEP);
  const bins: Array<Array<[number, number, number, number]>> = Array.from({ length: nb }, () => []); // [y, r, g, b]
  for (let r = 0; r < n; r++) {
    const off = r * SPLAT_ROW;
    const a = u8[off + 27] / 255;
    if (a < HAIR_MIN_ALPHA) continue;
    const x = dv.getFloat32(off, true), y = dv.getFloat32(off + 4, true), z = dv.getFloat32(off + 8, true);
    if (Math.abs(x - xc) >= HAIR_HALF_WIDTH || y >= 0 || z < HAIR_Z_LO || z >= HAIR_Z_HI) continue;
    bins[Math.floor((z - HAIR_Z_LO) / HAIR_Z_STEP)].push([y, u8[off + 24] / 255, u8[off + 25] / 255, u8[off + 26] / 255]);
  }
  // Representative colour per bin: per-channel median of the front-most rows (null when the bin is too thin).
  const colour: Array<RGB | null> = bins.map((bin) => {
    if (bin.length < HAIR_MIN_PER_BIN) return null;
    bin.sort((p, q) => p[0] - q[0]); // most negative y first = nearest the camera
    const front = bin.slice(0, Math.max(8, Math.floor(bin.length * HAIR_FRONT_FRACTION)));
    return medianRGB(front.map((p) => [p[1], p[2], p[3]]));
  });
  const measurable: number[] = [];
  colour.forEach((c, i) => { if (c) measurable.push(i); });
  // Forehead colour: the lowest SKIN_REF_BINS consecutive measurable bins that agree with each other.
  // (The bins just above the eye line are often brow shadow, which disagrees with the forehead.)
  let skin: RGB | null = null, skinTop = -1;
  for (let s = 0; s + SKIN_REF_BINS <= measurable.length && !skin; s++) {
    const idx = measurable.slice(s, s + SKIN_REF_BINS);
    if (idx[SKIN_REF_BINS - 1] - idx[0] !== SKIN_REF_BINS - 1) continue;
    const cs = idx.map((i) => colour[i] as RGB);
    const spread = Math.max(...cs.flatMap((a) => cs.map((b) => rgbDist(a, b))));
    if (spread <= HAIR_MIN_CONTRAST) { skin = medianRGB(cs); skinTop = idx[SKIN_REF_BINS - 1]; }
  }
  if (!skin) return null;
  // Stubble colour: the top of the column. No contrast against the forehead = nothing to find.
  const above = measurable.filter((i) => i > skinTop);
  if (above.length < STUBBLE_REF_BINS) return null;
  const stubble = medianRGB(above.slice(-STUBBLE_REF_BINS).map((i) => colour[i] as RGB));
  const contrast = rgbDist(stubble, skin);
  if (contrast < HAIR_MIN_CONTRAST) return null;
  // Walk up: the first bin past the level is stubble; interpolate the crossing between the
  // last forehead bin's centre and this bin's centre.
  const level = contrast * HAIRLINE_FRACTION;
  let j = skinTop;
  for (const i of above) {
    const d = rgbDist(colour[i] as RGB, skin);
    if (d > level) {
      const zA = HAIR_Z_LO + (j + 0.5) * HAIR_Z_STEP, zB = HAIR_Z_LO + (i + 0.5) * HAIR_Z_STEP;
      const dA = rgbDist(colour[j] as RGB, skin);
      const t = d > dA ? Math.min(1, Math.max(0, (level - dA) / (d - dA))) : 1;
      return zA + (zB - zA) * t;
    }
    j = i;
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
// Head width, depth and centre, read at the temple band (z 0.2–0.3), where the
// skull is bare on a buzz cut and ears do not reach. Width and centre use the
// front half only (y < 0.15: brow to ear); depth runs the whole band, front of
// the forehead to the back of the head. A cut fitted on one head is centred and
// sized to another with these, each axis on its own: the hair's z is placed by
// the hairline/crown fit above, so only x and y are scaled here. (Scaling all
// three uniformly, as before, pushed the fringe forward off a wide forehead and
// fought the z fit; a wider head mostly needs wider hair, not a taller one.)
//
// Why it matters (2026-11-04, measured): the men's house head is narrower at the
// temples than two real wearers, so the hair that hugged its temples ended up
// inside their skulls and the side hair "floated" above a bare temple.

const TEMPLE_Z = [0.2, 0.3] as const;
const TEMPLE_FRONT_Y = 0.15;  // width/centre rows: forehead to ear, not the ears or the back
const TEMPLE_MIN_ALPHA = 0.1; // buzz heads are sheer: only ~150 rows in the band pass 0.25
const TEMPLE_MIN_ROWS = 100;
const AXIS_SCALE_RANGE = [0.85, 1.2] as const;

function templeSorted(bytes: ArrayBuffer | Uint8Array, axis: 'x' | 'y'): Float32Array | null {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const n = Math.floor(u8.byteLength / SPLAT_ROW);
  if (n === 0) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, n * SPLAT_ROW);
  const vs: number[] = [];
  for (let r = 0; r < n; r++) {
    const off = r * SPLAT_ROW;
    if (u8[off + 27] / 255 < TEMPLE_MIN_ALPHA) continue;
    const y = dv.getFloat32(off + 4, true), z = dv.getFloat32(off + 8, true);
    if (z < TEMPLE_Z[0] || z >= TEMPLE_Z[1]) continue;
    if (axis === 'x') {
      if (y >= TEMPLE_FRONT_Y) continue;
      vs.push(dv.getFloat32(off, true));
    } else {
      vs.push(y);
    }
  }
  if (vs.length < TEMPLE_MIN_ROWS) return null;
  return Float32Array.from(vs).sort();
}
const q = (s: Float32Array, p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];

/** Width of the head at the temple band (2nd–98th percentile of x), or null. */
export function headWidthX(bytes: ArrayBuffer | Uint8Array): number | null {
  const s = templeSorted(bytes, 'x');
  return s ? q(s, 0.98) - q(s, 0.02) : null;
}
/** Depth of the head at the temple band, forehead to occiput (2nd–98th percentile of y), or null. */
export function headDepthY(bytes: ArrayBuffer | Uint8Array): number | null {
  const s = templeSorted(bytes, 'y');
  return s ? q(s, 0.98) - q(s, 0.02) : null;
}
/** x centre of the head at the temple band: the midpoint of its 2nd–98th percentile extent, or null.
 *  NOT the median: a single-selfie FaceLift head has more Gaussians on one side than the other
 *  (1438 vs 1251 rows on one real head), so the median sat 0.06 off a head whose extent midpoint,
 *  eye band and nose tip all agreed on ≈0. Shifting hair by that moved it visibly the wrong way. */
export function headCenterX(bytes: ArrayBuffer | Uint8Array): number | null {
  const s = templeSorted(bytes, 'x');
  return s ? (q(s, 0.02) + q(s, 0.98)) / 2 : null;
}
/** Per-axis scale that sizes a cut fitted on the reference head to this one (clamped; 1 when unknown). */
export function axisFitScale(wearer: number | null, ref: number | undefined): number {
  if (wearer === null || ref === undefined || !(ref > 0)) return 1;
  return Math.min(AXIS_SCALE_RANGE[1], Math.max(AXIS_SCALE_RANGE[0], wearer / ref));
}
