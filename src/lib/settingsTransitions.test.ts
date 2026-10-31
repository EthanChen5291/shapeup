// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANG_MIST_IN_MS, LANG_MIST_OUT_MS, runLanguageMist, runThemeTransition } from './settingsTransitions';

const root = () => document.documentElement;
function setReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reduce }) as unknown as typeof window.matchMedia;
}

beforeEach(() => { vi.useFakeTimers(); setReducedMotion(false); root().className = ''; });
afterEach(() => {
  vi.useRealTimers();
  delete (document as { startViewTransition?: unknown }).startViewTransition;
});

describe('runThemeTransition', () => {
  it('cross-fades through the View Transitions API, freezing element transitions until it ends', async () => {
    let finish!: () => void;
    const finished = new Promise<void>((r) => { finish = r; });
    const start = vi.fn((cb: () => void) => { cb(); return { finished }; });
    (document as { startViewTransition?: unknown }).startViewTransition = start;
    const apply = vi.fn();
    runThemeTransition(apply);
    expect(start).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledOnce();
    expect(root().classList.contains('theme-switching')).toBe(true);
    finish();
    await finished;
    await Promise.resolve();
    expect(root().classList.contains('theme-switching')).toBe(false);
  });

  it('otherwise eases colours with a temporary class', () => {
    const apply = vi.fn();
    runThemeTransition(apply);
    expect(apply).toHaveBeenCalledOnce();
    expect(root().classList.contains('theme-fade')).toBe(true);
    vi.advanceTimersByTime(700);
    expect(root().classList.contains('theme-fade')).toBe(false);
  });

  it('just applies under reduced motion', () => {
    setReducedMotion(true);
    const apply = vi.fn();
    runThemeTransition(apply);
    expect(apply).toHaveBeenCalledOnce();
    expect(root().className).toBe('');
  });
});

describe('runLanguageMist', () => {
  it('mists out, swaps the language, then condenses back in', () => {
    const apply = vi.fn();
    runLanguageMist(apply);
    expect(root().classList.contains('lang-mist-out')).toBe(true);
    expect(apply).not.toHaveBeenCalled();

    vi.advanceTimersByTime(LANG_MIST_OUT_MS);
    expect(apply).toHaveBeenCalledOnce();
    expect(root().classList.contains('lang-mist-in')).toBe(true);
    expect(root().classList.contains('lang-mist-out')).toBe(false);

    vi.advanceTimersByTime(LANG_MIST_IN_MS);
    expect(root().className).toBe('');
  });

  it('switches immediately under reduced motion', () => {
    setReducedMotion(true);
    const apply = vi.fn();
    runLanguageMist(apply);
    expect(apply).toHaveBeenCalledOnce();
    expect(root().className).toBe('');
  });
});
