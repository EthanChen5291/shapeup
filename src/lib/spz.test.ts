import { describe, expect, test } from 'vitest';
import { SPZ_MAGIC, decodeSpz, encodeSpz, packSpz, unpackSpz } from './spz';

/** .splat rows from plain values: pos, scale, rgba bytes, quaternion (w,x,y,z) floats. */
function splat(rows: Array<{ p: number[]; s: number[]; rgba: number[]; q: number[] }>): Uint8Array {
  const out = new Uint8Array(rows.length * 32);
  const v = new DataView(out.buffer);
  rows.forEach((r, i) => {
    const o = i * 32;
    r.p.forEach((x, k) => v.setFloat32(o + k * 4, x, true));
    r.s.forEach((x, k) => v.setFloat32(o + 12 + k * 4, x, true));
    r.rgba.forEach((x, k) => { out[o + 24 + k] = x; });
    r.q.forEach((x, k) => { out[o + 28 + k] = Math.min(255, Math.max(0, Math.round(x * 128 + 128))); });
  });
  return out;
}
const f32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset).getFloat32(at, true);
const quat = (b: Uint8Array, row: number) => {
  const q = [0, 1, 2, 3].map((k) => (b[row * 32 + 28 + k] - 128) / 128);
  const l = Math.hypot(...q);
  return q.map((x) => x / l);
};
const angleDeg = (a: number[], b: number[]) => (2 * Math.acos(Math.min(1, Math.abs(a.reduce((s, x, k) => s + x * b[k], 0)))) * 180) / Math.PI;

const SAMPLE = [
  { p: [0.123456, -0.98765, 1.2], s: [0.05, 0.001, 0.12], rgba: [200, 30, 128, 77], q: [0.9, 0.3, -0.2, 0.25] },
  // w < 0: the encoder flips the whole quaternion (same rotation).
  { p: [-1.5, 0, 0.0001], s: [0.2, 0.2, 0.2], rgba: [0, 255, 64, 255], q: [-0.6, 0.5, 0.4, -0.48] },
];

describe('SPZ codec', () => {
  test('writes a v2 header with the point count', () => {
    const packed = packSpz(splat(SAMPLE));
    const v = new DataView(packed.buffer);
    expect(v.getUint32(0, true)).toBe(SPZ_MAGIC);
    expect(v.getUint32(4, true)).toBe(2);
    expect(v.getUint32(8, true)).toBe(2);
    expect(packed[12]).toBe(0); // no spherical harmonics
    expect(packed.length).toBe(16 + 2 * 19);
  });

  test('round-trips within the format precision (alpha exact)', () => {
    const src = splat(SAMPLE);
    const back = unpackSpz(packSpz(src));
    expect(back.length).toBe(src.length);
    for (let i = 0; i < SAMPLE.length; i++) {
      const o = i * 32;
      for (let k = 0; k < 3; k++) {
        expect(Math.abs(f32(back, o + k * 4) - f32(src, o + k * 4))).toBeLessThanOrEqual(1 / 8192 + 1e-7);
        expect(Math.abs(f32(back, o + 12 + k * 4) / f32(src, o + 12 + k * 4) - 1)).toBeLessThan(0.033);
        expect(Math.abs(back[o + 24 + k] - src[o + 24 + k])).toBeLessThanOrEqual(1);
      }
      expect(back[o + 27]).toBe(src[o + 27]);
      expect(angleDeg(quat(back, i), quat(src, i))).toBeLessThan(3);
    }
  });

  test('gzip wrapper round-trips and shrinks a realistic cloud', async () => {
    const rows = Array.from({ length: 4000 }, (_, i) => ({
      p: [Math.sin(i) * 0.8, Math.cos(i * 1.3) * 0.8, (i % 97) / 120], s: [0.01 + (i % 7) / 500, 0.02, 0.005],
      rgba: [120 + (i % 20), 80, 60, 40 + (i % 150)], q: [0.8, 0.4, 0.3, 0.33],
    }));
    const src = splat(rows);
    const file = await encodeSpz(src);
    expect(file[0]).toBe(0x1f); // gzip magic
    expect(file.length).toBeLessThan(src.length / 2);
    const back = await decodeSpz(file);
    expect(back.length).toBe(src.length);
    expect(back[27]).toBe(src[27]);
  });

  test('rejects files it cannot read (the loader then falls back to .splat)', async () => {
    const good = packSpz(splat(SAMPLE));
    const badMagic = good.slice(); badMagic[0] ^= 0xff;
    expect(() => unpackSpz(badMagic)).toThrow(/not an SPZ/);
    const v3 = good.slice(); new DataView(v3.buffer).setUint32(4, 3, true);
    expect(() => unpackSpz(v3)).toThrow(/version 3/);
    expect(() => unpackSpz(good.slice(0, good.length - 5))).toThrow(/truncated/);
    expect(() => packSpz(new Uint8Array(33))).toThrow(/multiple of 32/);
    await expect(decodeSpz(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});
