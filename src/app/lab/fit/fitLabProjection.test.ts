import { describe, expect, it } from 'vitest';
import { hairlineFit } from '@/lib/splatFit';
import { mergeSplatBuffersWith, SPLAT_ROW } from '@/lib/splatMerge';
import { bandFor, makeMapper, rowXYZ, samplePoints, spreadPick, VIEWS } from './fitLabProjection';

function splat(rows: Array<{ x?: number; y?: number; z: number; a?: number }>): ArrayBuffer {
  const buf = new ArrayBuffer(rows.length * SPLAT_ROW);
  const f = new Float32Array(buf);
  const u8 = new Uint8Array(buf);
  rows.forEach((r, i) => {
    f[i * 8] = r.x ?? 0; f[i * 8 + 1] = r.y ?? 0; f[i * 8 + 2] = r.z;
    f[i * 8 + 3] = 0.01; f[i * 8 + 4] = 0.01; f[i * 8 + 5] = 0.01;
    u8[i * SPLAT_ROW + 27] = Math.round((r.a ?? 1) * 255);
  });
  return buf;
}

const HOUSE = { anchorZ: 0, crownZ: 0.638, hairlineZ: 0.35 };

describe('bandFor', () => {
  const zFit = hairlineFit({ crown: 0.569, hairline: 0.357 }, HOUSE);
  it('splits at the anchor and the HOUSE hairline, matching the merge branch order', () => {
    expect(bandFor(-0.1, zFit)).toBe('below');
    expect(bandFor(0, zFit)).toBe('below'); // merge requires z > anchor
    expect(bandFor(0.2, zFit)).toBe('fringe');
    expect(bandFor(0.35, zFit)).toBe('above'); // z < house is strict
    expect(bandFor(0.5, zFit)).toBe('above');
  });
  it('one-point fit (no hairline) has a single band above the anchor', () => {
    const one = hairlineFit({ crown: 0.569, hairline: null }, HOUSE);
    expect(one.hairline).toBeUndefined();
    expect(bandFor(0.5, one)).toBe('fringe');
    expect(bandFor(0.5, undefined)).toBe('below');
  });
  it('agrees with what mergeSplatBuffersWith actually does to each band', () => {
    const hair = splat([{ z: -0.1 }, { z: 0.2 }, { z: 0.5 }]);
    const merged = mergeSplatBuffersWith(splat([]), hair, { k: 1, zFit });
    const hl = zFit.hairline!;
    expect(rowXYZ(merged, 0)[2]).toBeCloseTo(-0.1, 6);
    expect(rowXYZ(merged, 1)[2]).toBeCloseTo(0.2 * hl.scaleBelow, 6);
    expect(rowXYZ(merged, 2)[2]).toBeCloseTo(hl.wearer + (0.5 - hl.house) * zFit.scale, 6);
  });
});

describe('samplePoints', () => {
  const rows = Array.from({ length: 10 }, (_, i) => ({ x: i, y: -i, z: i / 10, a: i % 2 ? 1 : 0.05 }));
  it('keeps every stride-th row above minAlpha and remembers the row index', () => {
    const p = samplePoints(splat(rows), { stride: 1, minAlpha: 0.1 });
    expect(Array.from(p.rows)).toEqual([1, 3, 5, 7, 9]);
    expect(p.x[0]).toBe(1);
    expect(p.y[0]).toBe(-1);
    expect(p.z[4]).toBeCloseTo(0.9, 6);
  });
  it('reads a sub-range (the hair rows after the head rows of a merged buffer)', () => {
    const p = samplePoints(splat(rows), { start: 6, stride: 1 });
    expect(Array.from(p.rows)).toEqual([6, 7, 8, 9]);
    const s = samplePoints(splat(rows), { start: 0, count: 4, stride: 2 });
    expect(Array.from(s.rows)).toEqual([0, 2]);
  });
});

describe('views and mapper', () => {
  it('z is up on screen in side and front views; the face (−y) is left in side, bottom in top', () => {
    const m = makeMapper([-1, 1, -1, 1], 200, 200);
    const side = VIEWS.find((v) => v.id === 'side')!;
    const [hFace, vUp] = side.project(0, -0.5, 0.5);
    expect(hFace).toBeLessThan(0);
    const [, pyUp] = m.toPx(hFace, vUp);
    const [, pyEye] = m.toPx(hFace, 0);
    expect(pyUp).toBeLessThan(pyEye);
    const top = VIEWS.find((v) => v.id === 'top')!;
    const [, vFace] = top.project(0, -0.5, 0);
    expect(m.toPx(0, vFace)[1]).toBeGreaterThan(m.toPx(0, 0)[1]);
  });
  it('keeps one scale on both axes', () => {
    const m = makeMapper([-1, 1, -2, 2], 100, 100);
    expect(m.pxPerUnit).toBe(25);
    expect(m.toPx(0, 0)).toEqual([50, 50]);
  });
  it('spreadPick spreads examples through the list', () => {
    expect(spreadPick(2)).toEqual([0, 1]);
    expect(spreadPick(100)).toEqual([25, 50, 75]);
    expect(spreadPick(0)).toEqual([]);
  });
});
