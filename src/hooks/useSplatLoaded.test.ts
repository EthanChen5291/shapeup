// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// Minimal stand-in for drei's zustand-backed useProgress store: the hook only
// uses getState/subscribe, and tests drive it through `emit`.
type ProgressState = { active: boolean; item: string; loaded: number; total: number };
let state: ProgressState;
let listeners: Array<(s: ProgressState) => void>;
function emit(next: Partial<ProgressState>) {
  state = { ...state, ...next };
  for (const l of listeners) l(state);
}
vi.mock('@react-three/drei', () => ({
  useProgress: {
    getState: () => state,
    subscribe: (l: (s: ProgressState) => void) => {
      listeners.push(l);
      return () => { listeners = listeners.filter((x) => x !== l); };
    },
  },
}));

import { isSplatFinished, useSplatLoaded } from './useSplatLoaded';

const SRC = '/api/proxy-ply?key=facelifts/job-1/output.splat';

beforeEach(() => {
  state = { active: false, item: '', loaded: 0, total: 0 };
  listeners = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('useSplatLoaded', () => {
  it('fires once when the manager finishes streaming our url', () => {
    const onLoaded = vi.fn();
    renderHook(() => useSplatLoaded(SRC, onLoaded));

    emit({ active: true, item: SRC, loaded: 0, total: 1 });   // itemStart
    expect(onLoaded).not.toHaveBeenCalled();
    emit({ active: true, item: SRC, loaded: 1, total: 1 });   // itemEnd → onProgress
    emit({ active: false });                                  // onLoad
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  it('ignores other items finishing', () => {
    const onLoaded = vi.fn();
    renderHook(() => useSplatLoaded(SRC, onLoaded));
    emit({ active: true, item: '/other.ply', loaded: 0, total: 1 });
    emit({ active: true, item: '/other.ply', loaded: 1, total: 1 });
    emit({ active: false });
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it('does nothing while src is null', () => {
    const onLoaded = vi.fn();
    renderHook(() => useSplatLoaded(null, onLoaded));
    emit({ active: true, item: SRC, loaded: 1, total: 1 });
    emit({ active: false });
    vi.advanceTimersByTime(60_000);
    expect(onLoaded).not.toHaveBeenCalled();
  });

  it('fires immediately if the url already finished before subscribing', () => {
    const onLoaded = vi.fn();
    state = { active: false, item: SRC, loaded: 1, total: 1 };
    renderHook(() => useSplatLoaded(SRC, onLoaded));
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  it('falls back to the safety timeout when the manager stays silent', () => {
    const onLoaded = vi.fn();
    renderHook(() => useSplatLoaded(SRC, onLoaded, 5_000));
    vi.advanceTimersByTime(4_999);
    expect(onLoaded).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLoaded).toHaveBeenCalledTimes(1);
    // A late store event must not double-fire.
    emit({ active: true, item: SRC, loaded: 1, total: 1 });
    emit({ active: false });
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  it('re-arms for a new src', () => {
    const onLoaded = vi.fn();
    const { rerender } = renderHook(({ src }) => useSplatLoaded(src, onLoaded), { initialProps: { src: SRC } });
    emit({ active: true, item: SRC, loaded: 1, total: 1 });
    emit({ active: false });
    expect(onLoaded).toHaveBeenCalledTimes(1);

    const NEXT = '/api/proxy-ply?key=facelifts/job-2/output.splat';
    rerender({ src: NEXT });
    emit({ active: true, item: NEXT, loaded: 1, total: 2 }); // another item still pending
    expect(onLoaded).toHaveBeenCalledTimes(1);
    emit({ active: true, item: NEXT, loaded: 2, total: 2 });
    expect(onLoaded).toHaveBeenCalledTimes(2);
  });
});

describe('isSplatFinished', () => {
  it('is false at itemStart and true after itemEnd', () => {
    expect(isSplatFinished({ active: true, item: SRC, loaded: 0, total: 1 }, SRC)).toBe(false);
    expect(isSplatFinished({ active: true, item: SRC, loaded: 1, total: 1 }, SRC)).toBe(true);
    expect(isSplatFinished({ active: false, item: SRC, loaded: 1, total: 1 }, SRC)).toBe(true);
    expect(isSplatFinished({ active: false, item: '/x', loaded: 1, total: 1 }, SRC)).toBe(false);
  });
});
