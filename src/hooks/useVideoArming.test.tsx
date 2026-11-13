// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useNearViewport } from './useVideoArming';

afterEach(() => vi.unstubAllGlobals());

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
