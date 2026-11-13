import { describe, expect, it } from 'vitest';
import { SWITCH_IN_MS, SWITCH_MAX_RATE, SWITCH_MIN_SCALE, SWITCH_OUT_MS, switchFrame } from './heroSwitch';

const END = SWITCH_OUT_MS + SWITCH_IN_MS;
const samples = (from: number, to: number, step = 4) => Array.from({ length: Math.floor((to - from) / step) }, (_, i) => switchFrame(from + i * step));

describe('switchFrame', () => {
  it('rests at full size and normal speed before and after', () => {
    expect(switchFrame(0)).toEqual({ scale: 1, rate: 1, swapped: false, done: false });
    expect(switchFrame(-5)).toEqual({ scale: 1, rate: 1, swapped: false, done: false });
    expect(switchFrame(END)).toEqual({ scale: 1, rate: 1, swapped: true, done: true });
    expect(switchFrame(END + 1000).done).toBe(true);
  });

  it('swaps renders at the smallest, fastest point', () => {
    const before = switchFrame(SWITCH_OUT_MS - 0.001);
    const after = switchFrame(SWITCH_OUT_MS);
    expect(before.swapped).toBe(false);
    expect(after.swapped).toBe(true);
    // Nothing jumps across the swap: same size, same speed.
    expect(before.scale).toBeCloseTo(SWITCH_MIN_SCALE, 3);
    expect(after.scale).toBeCloseTo(SWITCH_MIN_SCALE, 3);
    expect(before.rate).toBeCloseTo(SWITCH_MAX_RATE, 3);
    expect(after.rate).toBeCloseTo(SWITCH_MAX_RATE, 3);
  });

  it('speeds up all the way to the swap, then slows all the way back', () => {
    const out = samples(0, SWITCH_OUT_MS).map((f) => f.rate);
    const back = samples(SWITCH_OUT_MS, END).map((f) => f.rate);
    expect(out).toEqual([...out].sort((a, b) => a - b));
    expect(back).toEqual([...back].sort((a, b) => b - a));
    for (const r of [...out, ...back]) {
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(SWITCH_MAX_RATE);
    }
  });

  it('gets about 15% smaller, with only a subtle wind-up and bounce', () => {
    const scales = samples(0, END, 2).map((f) => f.scale);
    expect(Math.min(...scales)).toBeGreaterThan(SWITCH_MIN_SCALE - 0.005);
    const peak = Math.max(...scales);
    expect(peak).toBeGreaterThan(1.005); // it does bounce
    expect(peak).toBeLessThan(1.04); // but subtly
    // The wind-up before shrinking is there too.
    expect(Math.max(...samples(0, SWITCH_OUT_MS, 2).map((f) => f.scale))).toBeGreaterThan(1);
  });
});
