import { describe, expect, it } from 'vitest';
import { heroBlobRadius, withinHeadRadius } from './headHitArea';

const box = { left: 100, top: 50, width: 400, height: 400 }; // centre (300, 250)

describe('withinHeadRadius', () => {
  it('accepts points on or inside the radius, rejects points outside', () => {
    expect(withinHeadRadius(300, 250, box, 10)).toBe(true);
    expect(withinHeadRadius(300 + 164, 250, box, 164)).toBe(true);
    expect(withinHeadRadius(300 + 165, 250, box, 164)).toBe(false);
    // the box corner is far outside a head-sized radius
    expect(withinHeadRadius(110, 60, box, heroBlobRadius(box))).toBe(false);
  });
});

describe('hero radii', () => {
  it('uses the smaller side so a tall box does not widen the hit area', () => {
    expect(heroBlobRadius({ left: 0, top: 0, width: 400, height: 1000 })).toBeCloseTo(144);
  });
});
