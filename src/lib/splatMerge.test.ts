import { describe, expect, it } from 'vitest';
import { SPLAT_ROW, gainSplatAlpha, mergeSplatBuffers, mergeSplatBuffersWith } from './splatMerge';

// Build .splat rows: [x,y,z, sx,sy,sz] floats + rgba + quat bytes.
function rows(...specs: Array<{ pos: [number, number, number]; scale: [number, number, number]; rgba: number[] }>) {
  const buf = new ArrayBuffer(specs.length * SPLAT_ROW);
  specs.forEach((s, i) => {
    new Float32Array(buf, i * SPLAT_ROW, 6).set([...s.pos, ...s.scale]);
    new Uint8Array(buf, i * SPLAT_ROW + 24, 8).set([...s.rgba, 128, 128, 128, 255]);
  });
  return buf;
}

describe('mergeSplatBuffers', () => {
  it('keeps the head rows verbatim and appends rebased hair rows', () => {
    const head = rows({ pos: [1, 2, 3], scale: [0.1, 0.1, 0.1], rgba: [10, 20, 30, 40] });
    const hair = rows(
      { pos: [2, 4, 6], scale: [0.2, 0.4, 0.6], rgba: [50, 60, 70, 80] },
      { pos: [-1, 0, 1], scale: [0.1, 0.1, 0.1], rgba: [1, 2, 3, 4] },
    );
    const out = mergeSplatBuffers(head, hair, 0.5, 0.25);

    expect(out.byteLength).toBe(3 * SPLAT_ROW);
    expect(Array.from(out.subarray(0, SPLAT_ROW))).toEqual(Array.from(new Uint8Array(head)));

    const f = new Float32Array(out.buffer);
    // hair row 0: pos & scale × k, then z − dropZ
    expect(Array.from(f.subarray(8, 14))).toEqual([1, 2, 3 - 0.25, 0.1, 0.2, 0.3].map(Math.fround));
    expect(Array.from(f.subarray(16, 22))).toEqual([-0.5, 0, 0.5 - 0.25, 0.05, 0.05, 0.05].map(Math.fround));
    // colour + rotation bytes copied untouched
    expect(Array.from(out.subarray(SPLAT_ROW + 24, SPLAT_ROW + 32))).toEqual([50, 60, 70, 80, 128, 128, 128, 255]);
  });

  it('does not modify the input buffers', () => {
    const head = rows({ pos: [1, 1, 1], scale: [1, 1, 1], rgba: [0, 0, 0, 0] });
    const hair = rows({ pos: [2, 2, 2], scale: [1, 1, 1], rgba: [0, 0, 0, 0] });
    mergeSplatBuffers(head, hair, 3, 1);
    expect(Array.from(new Float32Array(hair, 0, 3))).toEqual([2, 2, 2]);
  });

  it('applies x/y/z offsets after scaling and gains the alpha byte, clamped', () => {
    const head = rows({ pos: [0, 0, 0], scale: [1, 1, 1], rgba: [0, 0, 0, 255] });
    const hair = rows(
      { pos: [2, 4, 6], scale: [1, 1, 1], rgba: [9, 9, 9, 100] },
      { pos: [0, 0, 0], scale: [1, 1, 1], rgba: [9, 9, 9, 200] },
    );
    const out = mergeSplatBuffersWith(head, hair, { k: 0.5, dx: 0.1, dy: -0.2, dz: 0.3, alpha: 1.5 });
    const f = new Float32Array(out.buffer);
    expect(Array.from(f.subarray(8, 11))).toEqual([1 + 0.1, 2 - 0.2, 3 + 0.3].map(Math.fround));
    // alpha 100 × 1.5 = 150; 200 × 1.5 clamps at 255; head alpha untouched
    expect(out[SPLAT_ROW + 27]).toBe(150);
    expect(out[2 * SPLAT_ROW + 27]).toBe(255);
    expect(out[27]).toBe(255);
  });

  it('legacy (k, dropZ) form is the same as dz = -dropZ', () => {
    const head = rows({ pos: [0, 0, 0], scale: [1, 1, 1], rgba: [0, 0, 0, 0] });
    const hair = rows({ pos: [1, 1, 1], scale: [1, 1, 1], rgba: [0, 0, 0, 10] });
    expect(Array.from(mergeSplatBuffers(head, hair, 2, 0.05))).toEqual(Array.from(mergeSplatBuffersWith(head, hair, { k: 2, dz: -0.05 })));
  });

  it('gains the head rows separately via headAlpha, and gainSplatAlpha copies', () => {
    const head = rows({ pos: [0, 0, 0], scale: [1, 1, 1], rgba: [0, 0, 0, 40] });
    const hair = rows({ pos: [0, 0, 0], scale: [1, 1, 1], rgba: [0, 0, 0, 40] });
    const out = mergeSplatBuffersWith(head, hair, { k: 1, headAlpha: 2 });
    expect(out[27]).toBe(80);
    expect(out[SPLAT_ROW + 27]).toBe(40);
    const gained = gainSplatAlpha(head, 1.5);
    expect(gained[27]).toBe(60);
    expect(new Uint8Array(head)[27]).toBe(40);
  });
});

describe('mergeSplatBuffersWith zFit', () => {
  it('squashes hair above the anchor toward it and leaves the rest alone', () => {
    const head = rows({ pos: [0, 0, 0], scale: [0.1, 0.1, 0.1], rgba: [0, 0, 0, 255] });
    const hair = rows(
      { pos: [0.1, 0.2, 0.6], scale: [0.02, 0.03, 0.04], rgba: [1, 2, 3, 4] }, // crown: above the anchor
      { pos: [0.1, 0.2, -0.3], scale: [0.02, 0.03, 0.04], rgba: [1, 2, 3, 4] }, // nape: below it
    );
    const out = mergeSplatBuffersWith(head, hair, { k: 1, dz: 0.01, zFit: { anchor: 0.1, scale: 0.5 } });
    const f = new Float32Array(out.buffer);
    // crown: z = 0.1 + (0.6 - 0.1) * 0.5, then the dz offset; z extent halved, x/y untouched
    const crown = Array.from(f.subarray(8, 14)), nape = Array.from(f.subarray(16, 22));
    [0.1, 0.2, 0.35 + 0.01, 0.02, 0.03, 0.02].forEach((v, i) => expect(crown[i]).toBeCloseTo(v, 6));
    [0.1, 0.2, -0.3 + 0.01, 0.02, 0.03, 0.04].forEach((v, i) => expect(nape[i]).toBeCloseTo(v, 6));
  });
});

describe('mergeSplatBuffersWith two-point hairline fit', () => {
  it('scales the fringe band about the anchor and the rest about the hairline, continuously', () => {
    const head = rows({ pos: [0, 0, 0], scale: [0.1, 0.1, 0.1], rgba: [0, 0, 0, 255] });
    const hair = rows(
      { pos: [0, -0.5, 0.35], scale: [0.02, 0.02, 0.04], rgba: [1, 2, 3, 4] }, // on the house hairline
      { pos: [0, -0.5, 0.175], scale: [0.02, 0.02, 0.04], rgba: [1, 2, 3, 4] }, // fringe band
      { pos: [0, -0.5, 0.55], scale: [0.02, 0.02, 0.04], rgba: [1, 2, 3, 4] }, // above
      { pos: [0, -0.5, -0.2], scale: [0.02, 0.02, 0.04], rgba: [1, 2, 3, 4] }, // below the eye line
    );
    const zFit = { anchor: 0, scale: 0.8, hairline: { house: 0.35, wearer: 0.3, scaleBelow: 0.3 / 0.35 } };
    const out = mergeSplatBuffersWith(head, hair, { k: 1, zFit });
    const f = new Float32Array(out.buffer);
    const z = (i: number) => f[8 * (i + 1) + 2], sz = (i: number) => f[8 * (i + 1) + 5];
    expect(z(0)).toBeCloseTo(0.3, 6);            // house hairline lands on the wearer's
    expect(z(1)).toBeCloseTo(0.15, 6);           // fringe band scaled about the anchor
    expect(sz(1)).toBeCloseTo(0.04 * 0.3 / 0.35, 6);
    expect(z(2)).toBeCloseTo(0.3 + 0.2 * 0.8, 6); // above: about the wearer hairline
    expect(sz(2)).toBeCloseTo(0.032, 6);
    expect(z(3)).toBeCloseTo(-0.2, 6);           // untouched
  });

  it('dims only the head rows above the hairline with headAlphaAbove', () => {
    const head = rows(
      { pos: [0, -0.4, 0.45], scale: [0.1, 0.1, 0.1], rgba: [0, 0, 0, 100] },
      { pos: [0, -0.4, 0.10], scale: [0.1, 0.1, 0.1], rgba: [0, 0, 0, 100] },
    );
    const hair = rows({ pos: [0, 0, 0.5], scale: [1, 1, 1], rgba: [0, 0, 0, 100] });
    const out = mergeSplatBuffersWith(head, hair, { k: 1, headAlpha: 1.5, headAlphaAbove: { z: 0.33, gain: 0.5 } });
    expect(out[27]).toBe(75);               // 100 × 1.5 × 0.5
    expect(out[SPLAT_ROW + 27]).toBe(150);  // 100 × 1.5
    expect(out[2 * SPLAT_ROW + 27]).toBe(100); // hair untouched
  });
});
