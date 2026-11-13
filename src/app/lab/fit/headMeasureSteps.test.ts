import { describe, expect, it } from 'vitest';
import { crownZ, hairlineZ, headCenterX, headDepthY, headWidthX } from '@/lib/splatFit';
import { SPLAT_ROW } from '@/lib/splatMerge';
import { crownSteps, hairlineSteps, rgbDist, templeSteps } from './headMeasureSteps';

interface Row { x: number; y: number; z: number; a: number; rgb: [number, number, number] }

function splat(rows: Row[]): ArrayBuffer {
  const buf = new ArrayBuffer(rows.length * SPLAT_ROW);
  const f = new Float32Array(buf), u8 = new Uint8Array(buf);
  rows.forEach((r, i) => {
    f[i * 8] = r.x; f[i * 8 + 1] = r.y; f[i * 8 + 2] = r.z;
    f[i * 8 + 3] = f[i * 8 + 4] = f[i * 8 + 5] = 0.01;
    u8[i * SPLAT_ROW + 24] = Math.round(r.rgb[0] * 255); u8[i * SPLAT_ROW + 25] = Math.round(r.rgb[1] * 255); u8[i * SPLAT_ROW + 26] = Math.round(r.rgb[2] * 255);
    u8[i * SPLAT_ROW + 27] = Math.round(r.a * 255);
  });
  return buf;
}

const SKIN: [number, number, number] = [0.8, 0.6, 0.5];
const SHADOW: [number, number, number] = [0.5, 0.35, 0.3];
const HAIR: [number, number, number] = [0.2, 0.15, 0.1];

/** A synthetic buzz head: three front columns with brow shadow, forehead, then stubble above
 *  z = 0.36; a solid crown cell; a temple band spread in x and y. */
function syntheticHead(): ArrayBuffer {
  const rows: Row[] = [];
  for (const xc of [-0.1, 0, 0.1]) {
    for (let i = 0; i < 22; i++) {
      for (let k = 0; k < 20; k++) {
        const rgb = i < 2 ? SHADOW : i < 12 ? SKIN : HAIR;
        rows.push({ x: xc + ((k % 5) - 2) * 0.01, y: -0.3 + k * 0.004, z: i * 0.03 + 0.015, a: 0.8, rgb });
      }
    }
  }
  // crown cell ix = 1 (x −0.05..0.05), iy = 2 (y 0..0.1): 30 rows from z 0.6 down, alpha 0.3 → t < 0.3 on the 4th row
  for (let k = 0; k < 30; k++) rows.push({ x: 0.01, y: 0.05, z: 0.6 - k * 0.005, a: 0.3, rgb: HAIR });
  // temple band
  for (let k = 0; k < 200; k++) rows.push({ x: -0.4 + (k / 199) * 0.8, y: -0.45 + ((k * 7) % 200) / 199 * 0.9, z: 0.25, a: 0.5, rgb: SKIN });
  return splat(rows);
}

describe('crownSteps', () => {
  const buf = syntheticHead();
  it('reaches the same crown as crownZ and exposes the transmittance walk', () => {
    const s = crownSteps(buf);
    expect(s.result).toBe(crownZ(buf));
    expect(s.best).not.toBeNull();
    const cell = s.cells[s.best!];
    expect([cell.ix, cell.iy]).toEqual([1, 2]);
    // alpha is a byte: 0.3 → 77/255 = 0.302, so t = 0.698^k; 0.698^3 = 0.340 > 0.3, 0.698^4 = 0.237 < 0.3
    expect(cell.stop).toBe(3);
    expect(cell.walk[0].t).toBeCloseTo(1 - 77 / 255, 6);
    expect(cell.walk[3].t).toBeCloseTo(cell.walk[0].t ** 4, 6);
    expect(cell.stopZ).toBeCloseTo(0.6 - 3 * 0.005, 5);
    expect(s.cells.filter((c) => c.skipped).length).toBeGreaterThan(0);
  });
});

describe('hairlineSteps', () => {
  const buf = syntheticHead();
  const crown = crownZ(buf);
  it('reaches the same hairline as hairlineZ', () => {
    const s = hairlineSteps(buf, crown);
    expect(hairlineZ(buf, crown)).not.toBeNull();
    expect(s.result).toBe(hairlineZ(buf, crown));
    expect(s.result).toBeCloseTo(0.36, 6);
  });
  it('skips the brow-shadow bins, takes the lowest agreeing window, and interpolates the crossing', () => {
    const col = hairlineSteps(buf, crown).columns[1];
    expect(col.xc).toBe(0);
    expect(col.runs[0]).toMatchObject({ bins: [0, 1, 2], accepted: false });
    expect(col.runs[0].spread).toBeCloseTo(rgbDist(SHADOW, SKIN), 2);
    expect(col.skinBins).toEqual([2, 3, 4]);
    expect(col.stubbleBins).toEqual([19, 20, 21]);
    expect(col.contrast).toBeCloseTo(rgbDist(HAIR, SKIN), 2);
    expect(col.level).toBeCloseTo(col.contrast! / 2, 6);
    expect(col.crossing).toMatchObject({ j: 11, i: 12 });
    expect(col.crossing!.t).toBeCloseTo(0.5, 6);
    expect(col.hairline).toBeCloseTo(0.36, 6);
    expect(col.trace.find((t) => t.i === 5)!.d).toBeCloseTo(0, 6);
  });
  it('reports why a column fails', () => {
    const s = hairlineSteps(new ArrayBuffer(0), null);
    expect(s.result).toBeNull();
    expect(s.failure).toBeTruthy();
  });
});

describe('templeSteps', () => {
  const buf = syntheticHead();
  it('matches headWidthX / headDepthY / headCenterX', () => {
    const s = templeSteps(buf);
    expect(s.width).toBe(headWidthX(buf));
    expect(s.depth).toBe(headDepthY(buf));
    expect(s.centre).toBe(headCenterX(buf));
    expect(s.x02!.index).toBe(Math.floor(0.02 * s.xs!.length));
    expect(s.front.length).toBe(s.x.length);
  });
});
