// SPZ: Niantic's compressed Gaussian-splat format (version 2, no spherical
// harmonics), converted to and from the 32-byte antimatter15 .splat rows that
// drei's <Splat> and splatMerge use. Prebaked hair ships as .spz (~2.7× smaller)
// and is decoded back to .splat rows in the browser before the merge.
//
// After gunzip an .spz is a 16-byte header followed by one column per attribute:
//   header     magic "NGSP" (u32 0x5053474e), version u32 = 2, numPoints u32,
//              shDegree u8, fractionalBits u8, flags u8, reserved u8
//   positions  n×3×3 B  24-bit signed fixed point, little-endian
//   alphas     n B      opacity × 255 (the .splat alpha byte: lossless)
//   colors     n×3 B    SH DC coefficient × 0.15 × 255 + 127.5
//   scales     n×3 B    (ln(scale) + 10) × 16
//   rotations  n×3 B    quaternion x,y,z × 127.5 + 127.5 (w ≥ 0, rebuilt on read)
// Grouping each attribute into its own column is what makes the gzip pass work.
//
// Loss vs .splat: positions round to 1/4096 (heads span about ±1), scales to
// ~3% steps, colours by at most 1/255, rotations by under 1%. Alpha is exact.
//
// No path aliases or TS-only syntax: scripts/encode-prebakes-spz.mjs imports
// this file directly through Node's type stripping.

export const SPZ_MAGIC = 0x5053474e; // "NGSP" little-endian
export const SPZ_VERSION = 2;
const HEADER_BYTES = 16;
const FRACTIONAL_BITS = 12;
const SPLAT_ROW = 32;
const SH_C0 = 0.28209479177387814;
const COLOR_SCALE = 0.15;

const clampByte = (v: number) => Math.min(255, Math.max(0, Math.round(v)));

/** .splat rows → uncompressed SPZ bytes (gzip them with {@link encodeSpz}). */
export function packSpz(splat: Uint8Array): Uint8Array {
  if (splat.length % SPLAT_ROW !== 0) throw new Error(`.splat size ${splat.length} is not a multiple of ${SPLAT_ROW}`);
  const n = splat.length / SPLAT_ROW;
  const out = new Uint8Array(HEADER_BYTES + n * (9 + 1 + 3 + 3 + 3));
  const view = new DataView(out.buffer);
  view.setUint32(0, SPZ_MAGIC, true);
  view.setUint32(4, SPZ_VERSION, true);
  view.setUint32(8, n, true);
  out[12] = 0; // shDegree
  out[13] = FRACTIONAL_BITS;

  const src = new DataView(splat.buffer, splat.byteOffset, splat.byteLength);
  const posAt = HEADER_BYTES, alphaAt = posAt + n * 9, colorAt = alphaAt + n, scaleAt = colorAt + n * 3, rotAt = scaleAt + n * 3;
  const fixedScale = 1 << FRACTIONAL_BITS;
  for (let i = 0; i < n; i++) {
    const row = i * SPLAT_ROW;
    for (let a = 0; a < 3; a++) {
      const fixed = Math.max(-0x800000, Math.min(0x7fffff, Math.round(src.getFloat32(row + a * 4, true) * fixedScale)));
      const o = posAt + i * 9 + a * 3;
      out[o] = fixed & 0xff;
      out[o + 1] = (fixed >> 8) & 0xff;
      out[o + 2] = (fixed >> 16) & 0xff;
    }
    for (let a = 0; a < 3; a++) {
      const s = src.getFloat32(row + 12 + a * 4, true);
      out[scaleAt + i * 3 + a] = clampByte((Math.log(Math.max(s, 1e-30)) + 10) * 16);
      // .splat stores rgb = 0.5 + SH_C0·dc; SPZ stores the dc coefficient itself.
      const dc = (splat[row + 24 + a] / 255 - 0.5) / SH_C0;
      out[colorAt + i * 3 + a] = clampByte(dc * COLOR_SCALE * 255 + 127.5);
    }
    out[alphaAt + i] = splat[row + 27];
    // .splat quaternion bytes are (w, x, y, z), each q·128 + 128.
    let w = (splat[row + 28] - 128) / 128, x = (splat[row + 29] - 128) / 128;
    let y = (splat[row + 30] - 128) / 128, z = (splat[row + 31] - 128) / 128;
    const len = Math.hypot(w, x, y, z) || 1;
    const sign = w < 0 ? -1 : 1; // keep w ≥ 0 so it can be rebuilt from x, y, z
    w = (w / len) * sign; x = (x / len) * sign; y = (y / len) * sign; z = (z / len) * sign;
    out[rotAt + i * 3] = clampByte(x * 127.5 + 127.5);
    out[rotAt + i * 3 + 1] = clampByte(y * 127.5 + 127.5);
    out[rotAt + i * 3 + 2] = clampByte(z * 127.5 + 127.5);
  }
  return out;
}

/** Uncompressed SPZ bytes → .splat rows. Throws on anything it can't read. */
export function unpackSpz(spz: Uint8Array): Uint8Array {
  if (spz.length < HEADER_BYTES) throw new Error('SPZ too short');
  const view = new DataView(spz.buffer, spz.byteOffset, spz.byteLength);
  if (view.getUint32(0, true) !== SPZ_MAGIC) throw new Error('not an SPZ file');
  const version = view.getUint32(4, true);
  if (version !== SPZ_VERSION) throw new Error(`unsupported SPZ version ${version}`);
  const n = view.getUint32(8, true);
  const fractionalBits = spz[13];
  // Spherical-harmonic bytes, if any, follow the rotations; the viewer doesn't use them.
  if (spz.length < HEADER_BYTES + n * 19) throw new Error('SPZ truncated');

  const out = new Uint8Array(n * SPLAT_ROW);
  const dst = new DataView(out.buffer);
  const posAt = HEADER_BYTES, alphaAt = posAt + n * 9, colorAt = alphaAt + n, scaleAt = colorAt + n * 3, rotAt = scaleAt + n * 3;
  const fixedScale = 1 / (1 << fractionalBits);
  for (let i = 0; i < n; i++) {
    const row = i * SPLAT_ROW;
    for (let a = 0; a < 3; a++) {
      const o = posAt + i * 9 + a * 3;
      let fixed = spz[o] | (spz[o + 1] << 8) | (spz[o + 2] << 16);
      if (fixed & 0x800000) fixed -= 0x1000000; // sign-extend 24 → 32 bits
      dst.setFloat32(row + a * 4, fixed * fixedScale, true);
      dst.setFloat32(row + 12 + a * 4, Math.exp(spz[scaleAt + i * 3 + a] / 16 - 10), true);
      const dc = (spz[colorAt + i * 3 + a] - 127.5) / (COLOR_SCALE * 255);
      out[row + 24 + a] = clampByte(Math.min(1, Math.max(0, 0.5 + SH_C0 * dc)) * 255);
    }
    out[row + 27] = spz[alphaAt + i];
    const x = spz[rotAt + i * 3] / 127.5 - 1;
    const y = spz[rotAt + i * 3 + 1] / 127.5 - 1;
    const z = spz[rotAt + i * 3 + 2] / 127.5 - 1;
    const w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
    out[row + 28] = clampByte(w * 128 + 128);
    out[row + 29] = clampByte(x * 128 + 128);
    out[row + 30] = clampByte(y * 128 + 128);
    out[row + 31] = clampByte(z * 128 + 128);
  }
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const body = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}

/** .splat rows → an .spz file (gzipped SPZ). */
export async function encodeSpz(splat: Uint8Array): Promise<Uint8Array> {
  return pipe(packSpz(splat), new CompressionStream('gzip'));
}

/** An .spz file → .splat rows. Gunzips natively (DecompressionStream). */
export async function decodeSpz(file: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const bytes = file instanceof Uint8Array ? file : new Uint8Array(file);
  return unpackSpz(await pipe(bytes, new DecompressionStream('gzip')));
}
