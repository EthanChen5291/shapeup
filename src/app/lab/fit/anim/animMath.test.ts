import { describe, expect, it } from 'vitest';
import { hairlineFit } from '@/lib/splatFit';
import { mergeSplatBuffersWith, SPLAT_ROW, type MergeOptions } from '@/lib/splatMerge';
import { bandOf, countMoved, easeInOut, objToThree, pickSample, reshapeHeadZ, rowColors, rowsToThree, ruler, scaleAbout, stepMovesRow, stepOpts, twoBandZ } from './animMath';

const HOUSE = { anchorZ: 0, crownZ: 0.638, hairlineZ: 0.35 };
const zFit = hairlineFit({ crown: 0.569, hairline: 0.357 }, HOUSE);
const uniform = hairlineFit({ crown: 0.569, hairline: null }, HOUSE);

function splat(rows: Array<[number, number, number]>, rgb: [number, number, number] = [0.5, 0.25, 0.1]): ArrayBuffer {
  const buf = new ArrayBuffer(rows.length * SPLAT_ROW);
  const f = new Float32Array(buf), u8 = new Uint8Array(buf);
  rows.forEach(([x, y, z], i) => {
    f[i * 8] = x; f[i * 8 + 1] = y; f[i * 8 + 2] = z; f[i * 8 + 3] = f[i * 8 + 4] = f[i * 8 + 5] = 0.01;
    u8[i * SPLAT_ROW + 24] = Math.round(rgb[0] * 255); u8[i * SPLAT_ROW + 25] = Math.round(rgb[1] * 255); u8[i * SPLAT_ROW + 26] = Math.round(rgb[2] * 255); u8[i * SPLAT_ROW + 27] = 255;
  });
  return buf;
}

describe('primer arithmetic', () => {
  it('scaleAbout leaves the pivot in place and grows displacement with distance', () => {
    expect(scaleAbout(0.35, 0.35, 0.8)).toBe(0.35);
    expect(scaleAbout(0.5, 0.35, 0.8)).toBeCloseTo(0.47, 10);
    expect(Math.abs(scaleAbout(0.65, 0.35, 0.8) - 0.65)).toBeGreaterThan(Math.abs(scaleAbout(0.5, 0.35, 0.8) - 0.5));
  });
  it('ruler is inclusive and even', () => {
    expect(ruler(-0.3, 0.7, 41)[0]).toBe(-0.3);
    expect(ruler(-0.3, 0.7, 41)[40]).toBeCloseTo(0.7, 10);
    expect(ruler(-0.3, 0.7, 41)[26]).toBeCloseTo(0.35, 10);
  });
  it('twoBandZ is continuous at the house hairline and tear opens a gap', () => {
    const hl = zFit.hairline!;
    expect(bandOf(0, zFit)).toBe('below');
    expect(bandOf(0.2, zFit)).toBe('fringe');
    expect(bandOf(0.35, zFit)).toBe('above');
    expect(twoBandZ(-0.2, zFit)).toBe(-0.2);
    expect(twoBandZ(0.2, zFit)).toBeCloseTo(0.2 * hl.scaleBelow, 10);
    const fromBelow = twoBandZ(0.35 - 1e-9, zFit), fromAbove = twoBandZ(0.35, zFit);
    expect(Math.abs(fromBelow - fromAbove)).toBeLessThan(1e-6);
    expect(fromAbove).toBeCloseTo(hl.wearer, 10);
    const torn = twoBandZ(0.35, zFit, true);
    expect(torn).toBeCloseTo(0.35 * zFit.scale, 10);
    expect(Math.abs(torn - hl.wearer)).toBeGreaterThan(0.03);
  });
  it('twoBandZ matches what the merge does to a row', () => {
    const hair = splat([[0, 0, -0.1], [0, 0, 0.2], [0, 0, 0.5]]);
    const merged = mergeSplatBuffersWith(new ArrayBuffer(0), hair, { k: 1, zFit });
    const f = new Float32Array(merged.buffer);
    expect(f[2]).toBeCloseTo(twoBandZ(-0.1, zFit), 6);
    expect(f[10]).toBeCloseTo(twoBandZ(0.2, zFit), 6);
    expect(f[18]).toBeCloseTo(twoBandZ(0.5, zFit), 6);
  });
});

describe('reshapeHeadZ', () => {
  const w = { hairline: 0.357, crown: 0.569 }, h = { hairline: 0.35, crown: 0.638 };
  it('maps the house hairline and crown onto the wearer’s, leaves the face alone', () => {
    expect(reshapeHeadZ(-0.2, w, h)).toBe(-0.2);
    expect(reshapeHeadZ(0.35, w, h)).toBeCloseTo(0.357, 10);
    expect(reshapeHeadZ(0.638, w, h)).toBeCloseTo(0.569, 10);
    expect(reshapeHeadZ(0.175, w, h)).toBeCloseTo(0.1785, 10);
  });
});

describe('stepOpts', () => {
  const full: MergeOptions = { k: 1, kx: 0.965, ky: 0.891, dx: -0.01, dy: 0, dz: 0, zFit, alpha: 1, headAlpha: 1 };
  it('switches options on one step at a time and ends at the full opts', () => {
    expect(stepOpts(0, full, uniform)).toMatchObject({ k: 1, kx: 1, ky: 1, dx: 0, zFit: undefined });
    expect(stepOpts(2, full, uniform)).toMatchObject({ kx: 0.965, ky: 1, dx: 0 });
    expect(stepOpts(3, full, uniform)).toMatchObject({ kx: 0.965, ky: 0.891, dx: 0 });
    const s4 = stepOpts(4, full, uniform).zFit!;
    expect(s4.scale).toBe(1);
    expect(s4.hairline).toMatchObject({ house: 0.35, wearer: 0.35, scaleBelow: zFit.hairline!.scaleBelow });
    expect(stepOpts(5, full, uniform).zFit).toBe(zFit);
    expect(stepOpts(5, full, uniform).dx).toBe(0);
    expect(stepOpts(6, full, uniform)).toEqual(full);
    expect(stepOpts(7, full, uniform).zFit).toBe(uniform);
  });
  it('step 4 leaves the upper band exactly where it was', () => {
    const hair = splat([[0, 0, 0.2], [0, 0, 0.5]]);
    const f = new Float32Array(mergeSplatBuffersWith(new ArrayBuffer(0), hair, stepOpts(4, full, uniform)).buffer);
    expect(f[2]).toBeCloseTo(0.2 * zFit.hairline!.scaleBelow, 6);
    expect(f[10]).toBeCloseTo(0.5, 6);
  });
  it('stepMovesRow follows the bands', () => {
    expect(stepMovesRow(4, 0.2, zFit)).toBe(true);
    expect(stepMovesRow(4, 0.5, zFit)).toBe(false);
    expect(stepMovesRow(4, -0.1, zFit)).toBe(false);
    expect(stepMovesRow(5, 0.5, zFit)).toBe(true);
    expect(stepMovesRow(5, 0.2, zFit)).toBe(false);
    expect(stepMovesRow(1, 0.5, zFit)).toBe(false);
    expect(stepMovesRow(2, -0.5, zFit)).toBe(true);
  });
});

describe('buffers → three.js', () => {
  it('objToThree puts object z up and the face (−y) toward +z', () => {
    expect(objToThree(0.1, -0.5, 0.3)).toEqual([0.1, 0.3, 0.5]);
  });
  it('rowsToThree reads the requested rows with an offset and a z map', () => {
    const buf = splat([[1, 2, 3], [4, 5, 6], [7, 8, 9]]);
    const out = rowsToThree(buf, Int32Array.from([0, 1]), 1, (z) => z * 2);
    expect(Array.from(out)).toEqual([4, 12, -5, 7, 18, -8]);
  });
  it('rowColors reads rgb bytes, grey when asked', () => {
    const buf = splat([[0, 0, 0]], [1, 0, 0]);
    const c = rowColors(buf, Int32Array.from([0]));
    expect(c[0]).toBeCloseTo(1, 6); expect(c[1]).toBe(0);
    const g = rowColors(buf, Int32Array.from([0]), true);
    expect(g[0]).toBe(g[1]); expect(g[1]).toBe(g[2]);
  });
  it('countMoved, easeInOut, pickSample', () => {
    expect(countMoved(Float32Array.from([0, 0, 0, 1, 1, 1]), Float32Array.from([0, 0, 0, 1, 1, 2]))).toBe(1);
    expect(easeInOut(0)).toBe(0); expect(easeInOut(1)).toBe(1); expect(easeInOut(0.5)).toBe(0.5);
    const xs = Float32Array.from([0, 0.5, 0.05]), ys = Float32Array.from([-0.5, -0.5, -0.5]), zs = Float32Array.from([0.1, 0.3, 0.32]);
    expect(pickSample(xs, ys, zs, 0.3)).toBe(2); // index 1 is off the midline
  });
});
