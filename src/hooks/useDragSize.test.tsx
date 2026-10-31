// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useDragSize } from './useDragSize';

// Node 22+ ships a stub global localStorage that shadows jsdom's; use a Map.
let store: Map<string, string>;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  });
});
afterEach(() => vi.unstubAllGlobals());

const pointer = (y: number) => ({
  button: 0, clientX: 0, clientY: y, pointerId: 1,
  preventDefault: () => {}, currentTarget: { setPointerCapture: () => {}, setAttribute: () => {} },
}) as unknown as React.PointerEvent<HTMLElement>;

describe('useDragSize', () => {
  it('settles a released drag through `snap` and reports it', () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() => useDragSize({
      storageKey: 'k', initial: 176, min: 0, max: 480, axis: 'y',
      snap: (v) => (v < 64 ? 0 : v), onCommit,
    }));
    act(() => { result.current.handleProps.onPointerDown(pointer(300)); });
    act(() => { result.current.handleProps.onPointerMove(pointer(300 - 140)); }); // 176 → 36
    act(() => { result.current.handleProps.onPointerUp(); });
    expect(result.current.size).toBe(0);
    expect(onCommit).toHaveBeenCalledWith(0);
    expect(store.get('k')).toBe('0');
  });

  it('restores a stored 0 (a folded list) instead of treating it as unset', () => {
    store.set('k', '0');
    const { result } = renderHook(() => useDragSize({ storageKey: 'k', initial: 176, min: 0, max: 480, axis: 'y', fallback: 200 }));
    expect(result.current.size).toBe(0);
  });

  it('uses the fallback when nothing is stored', () => {
    const { result } = renderHook(() => useDragSize({ storageKey: 'k', initial: 176, min: 0, max: 480, axis: 'y', fallback: 200 }));
    expect(result.current.size).toBe(200);
  });
});
