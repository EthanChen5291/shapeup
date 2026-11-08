import { describe, expect, it } from 'vitest';
import { WIPE_DPR_STORAGE_KEY, adaptWipeDpr, canvasDpr, loadWipeDpr, saveWipeDpr } from './wipeDpr';

describe('canvasDpr', () => {
  it('gives each quality its resolution clamp when no wipe is running', () => {
    expect(canvasDpr('performance')).toBe(1);
    expect(canvasDpr('balanced')).toEqual([1, 1.5]);
    expect(canvasDpr('high')).toEqual([1, 2]);
  });

  it('uses the learned wipe level, capped by the quality and the screen', () => {
    expect(canvasDpr('high', 1, 2)).toBe(1);
    expect(canvasDpr('high', 2, 2)).toBe(2);
    expect(canvasDpr('balanced', 2, 2)).toBe(1.5); // quality cap
    expect(canvasDpr('high', 2, 1)).toBe(1);       // 1x screen: nothing above 1
    expect(canvasDpr('performance', 2, 3)).toBe(1);
  });
});

describe('adaptWipeDpr', () => {
  it('steps up after a fast wipe, down after a slow one, holds in between', () => {
    expect(adaptWipeDpr(1, 9, 130, 2)).toBe(1.5);   // 110 fps: headroom
    expect(adaptWipeDpr(1.5, 12, 100, 2)).toBe(2);  // exactly 80 fps still counts as headroom
    expect(adaptWipeDpr(2, 9, 130, 2)).toBe(2);     // already at the top
    expect(adaptWipeDpr(1.5, 40, 30, 2)).toBe(1);   // 25 fps: give up resolution
    expect(adaptWipeDpr(1, 40, 30, 2)).toBe(1);     // never below 1x
    expect(adaptWipeDpr(1.5, 33, 36, 2)).toBe(1.5); // 30 fps on the nose: hold
    expect(adaptWipeDpr(1, 21, 57, 2)).toBe(1);     // 48 fps at 1x (the MacBook): stepping up would land near 30, so hold
  });

  it('never climbs above the screen ratio and ignores wipes too short to judge', () => {
    expect(adaptWipeDpr(1, 8, 100, 1)).toBe(1);
    expect(adaptWipeDpr(1, 8, 100, 1.5)).toBe(1.5);
    expect(adaptWipeDpr(1.5, 8, 100, 1.5)).toBe(1.5);
    expect(adaptWipeDpr(1, 8, 3, 2)).toBe(1);
    expect(adaptWipeDpr(1.5, Number.NaN, 100, 2)).toBe(1.5);
  });
});

describe('wipe level storage', () => {
  const fake = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };

  it('round-trips a level and falls back to 1 on junk or no storage', () => {
    const s = fake();
    saveWipeDpr(1.5, s);
    expect(s.m.get(WIPE_DPR_STORAGE_KEY)).toBe('1.5');
    expect(loadWipeDpr(s)).toBe(1.5);
    s.setItem(WIPE_DPR_STORAGE_KEY, '7');
    expect(loadWipeDpr(s)).toBe(1);
    expect(loadWipeDpr(null)).toBe(1);
    expect(() => saveWipeDpr(2, null)).not.toThrow();
  });
});
