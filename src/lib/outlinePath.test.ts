import { describe, expect, it } from 'vitest';
import { pillOutlinePath } from './outlinePath';

describe('pillOutlinePath', () => {
  it('starts at top centre and runs counter-clockwise around the rounded rect', () => {
    expect(pillOutlinePath(200, 100, 0, 10)).toBe(
      'M 100 0 L 10 0 A 10 10 0 0 0 0 10 L 0 90 A 10 10 0 0 0 10 100 L 190 100 A 10 10 0 0 0 200 90 L 200 10 A 10 10 0 0 0 190 0 L 100 0',
    );
  });

  it('caps the radius at a full pill and honours the inset', () => {
    // radius Infinity on a 40-tall box with inset 2 → r = (38 - 2) / 2 = 18
    expect(pillOutlinePath(120, 40, 2).startsWith('M 60 2 L 20 2 A 18 18 0 0 0 2 20')).toBe(true);
  });
});
