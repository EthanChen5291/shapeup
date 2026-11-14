import { describe, expect, it } from 'vitest';
import { MAX_SHIFT_EM, MAX_TILT_DEG, crumpleText, inkAt } from './crumpledText';

const LINE = 'your barber hears something different...';
const rgb = (s: string) => s.match(/\d+/g)!.map(Number);
/** WCAG relative luminance. */
const luminance = (s: string) => {
  const [r, g, b] = rgb(s).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe('crumpleText', () => {
  it('keeps the words and every character, in order', () => {
    const words = crumpleText(LINE);
    expect(words.map((w) => w.map((l) => l.char).join(''))).toEqual(LINE.split(' '));
  });

  it('is the same every time (server and browser must agree)', () => {
    expect(crumpleText(LINE)).toEqual(crumpleText(LINE));
  });

  it('only nudges letters a little, and not all the same way', () => {
    const letters = crumpleText(LINE).flat();
    for (const l of letters) {
      expect(Math.abs(l.tilt)).toBeLessThanOrEqual(MAX_TILT_DEG);
      expect(Math.abs(l.shift)).toBeLessThanOrEqual(MAX_SHIFT_EM);
    }
    expect(MAX_TILT_DEG).toBeLessThan(5);
    expect(letters.some((l) => l.tilt > 0.5) && letters.some((l) => l.tilt < -0.5)).toBe(true);
    expect(letters.some((l) => l.shift > 0.01) && letters.some((l) => l.shift < -0.01)).toBe(true);
  });

  it('sprays the ink in one continuous pass: each letter starts in the colour the last one ended in', () => {
    const letters = crumpleText(LINE).flat();
    for (let i = 1; i < letters.length; i++) expect(letters[i].from).toBe(letters[i - 1].to);
    expect(letters[0].from).toBe(inkAt(0));
  });

  it('handles an empty line and stray spaces', () => {
    expect(crumpleText('')).toEqual([]);
    expect(crumpleText('  a  b ').map((w) => w.map((l) => l.char).join(''))).toEqual(['a', 'b']);
  });
});

describe('inkAt', () => {
  const samples = Array.from({ length: 201 }, (_, i) => inkAt(i / 200));

  it('is tomato with patches of a darker pinkish red and of an orange glow', () => {
    const base = [217, 78, 58];
    // somewhere it is clearly darker and pinker (less red and green, more blue) ...
    expect(samples.some((s) => { const [r, g, b] = rgb(s); return r < base[0] - 15 && g < base[1] - 12 && b > base[2] + 4; })).toBe(true);
    // ... and somewhere clearly more orange (more red and much more green)
    expect(samples.some((s) => { const [r, g] = rgb(s); return r > base[0] + 8 && g > base[1] + 18; })).toBe(true);
    // ... and stretches of it are still close to plain tomato
    expect(samples.filter((s) => rgb(s).every((v, i) => Math.abs(v - base[i]) < 6)).length).toBeGreaterThan(20);
  });

  it('stays subtle and readable: never far from tomato, never fainter than 3:1 on the white receipt', () => {
    const paper = luminance('rgb(250, 247, 240)');
    for (const s of samples) {
      const [r, g, b] = rgb(s);
      expect(Math.hypot(r - 217, g - 78, b - 58)).toBeLessThan(60);
      expect((paper + 0.05) / (luminance(s) + 0.05)).toBeGreaterThanOrEqual(3);
    }
  });

  it('changes smoothly, like an airbrush, with no hard steps', () => {
    for (let i = 1; i < samples.length; i++) {
      const [a, b] = [rgb(samples[i - 1]), rgb(samples[i])];
      expect(Math.max(...a.map((v, k) => Math.abs(v - b[k])))).toBeLessThanOrEqual(6);
    }
  });
});
