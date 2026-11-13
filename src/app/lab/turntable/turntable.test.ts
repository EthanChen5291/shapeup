import { describe, expect, test } from 'vitest';
import { TURNTABLE_DEFAULTS, parseTurntableParams, turntableFrame } from './turntable';

describe('parseTurntableParams', () => {
  test('falls back to the defaults', () => {
    expect(parseTurntableParams(new URLSearchParams(''))).toEqual(TURNTABLE_DEFAULTS);
  });

  test('reads a framing from the URL and ignores garbage', () => {
    const p = parseTurntableParams(new URLSearchParams('size=480&fov=abc&y=0.3&bg=%23ffffff&base=/lab/other.splat&meta=&alpha=3'));
    expect(p).toEqual({ ...TURNTABLE_DEFAULTS, size: 480, y: 0.3, bg: '#ffffff', base: '/lab/other.splat', meta: '', hairAlpha: 3 });
  });

  test('refuses off-origin assets and non-hex colours', () => {
    const p = parseTurntableParams(new URLSearchParams('base=https://evil.example/x.splat&meta=//evil.example/m.json&bg=red&alpha=nope'));
    expect(p).toEqual(TURNTABLE_DEFAULTS);
  });
});

describe('turntableFrame', () => {
  test('one full turn that closes on itself', () => {
    expect(turntableFrame(0, 120, 12).angle).toBe(0);
    expect(turntableFrame(60, 120, 12).angle).toBeCloseTo(Math.PI);
    expect(turntableFrame(120, 120, 12)).toEqual(turntableFrame(0, 120, 12));
  });

  test('holds every look for the same number of frames, in order', () => {
    const looks = Array.from({ length: 120 }, (_, i) => turntableFrame(i, 120, 12).look);
    for (let l = 0; l < 12; l++) expect(looks.filter((x) => x === l)).toHaveLength(10);
    expect(looks).toEqual([...looks].sort((a, b) => a - b));
  });

  test('never indexes past the last look when frames do not divide evenly', () => {
    const looks = Array.from({ length: 100 }, (_, i) => turntableFrame(i, 100, 7).look);
    expect(Math.max(...looks)).toBe(6);
    expect(new Set(looks).size).toBe(7);
  });
});
