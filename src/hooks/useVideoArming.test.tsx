// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ringNeighbors, useNearViewport } from './useVideoArming';

afterEach(() => vi.unstubAllGlobals());

describe('ringNeighbors', () => {
  it('keeps the active clip and both neighbours, wrapping round the ring', () => {
    expect([...ringNeighbors(0, 5)].sort()).toEqual([0, 1, 4]);
    expect([...ringNeighbors(4, 5)].sort()).toEqual([0, 3, 4]);
    expect([...ringNeighbors(0, 1)]).toEqual([0]);
    expect(ringNeighbors(0, 0).size).toBe(0);
  });
});

describe('useNearViewport', () => {
  it('flips true once the element nears the viewport and stays true', () => {
    let fire: (hit: boolean) => void = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: (e: { isIntersecting: boolean }[]) => void) { fire = (hit) => cb([{ isIntersecting: hit }]); }
      observe() {}
      disconnect = disconnect;
    });
    const ref = { current: document.createElement('div') };
    const { result } = renderHook(() => useNearViewport(ref));
    expect(result.current).toBe(false);
    act(() => fire(false));
    expect(result.current).toBe(false);
    act(() => fire(true));
    expect(result.current).toBe(true);
    expect(disconnect).toHaveBeenCalled();
  });
});
