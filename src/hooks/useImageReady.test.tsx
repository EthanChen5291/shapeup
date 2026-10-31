// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { cssBackgroundUrl, useImageReady } from './useImageReady';

afterEach(() => cleanup());

describe('cssBackgroundUrl', () => {
  it('pulls the URL out of a CSS background value', () => {
    expect(cssBackgroundUrl('url(/preview_bg.jpg) center / 100% 100% no-repeat')).toBe('/preview_bg.jpg');
    expect(cssBackgroundUrl("url('/a b.png')")).toBe('/a b.png');
    expect(cssBackgroundUrl('#1c1510')).toBeNull();
  });
});

describe('useImageReady', () => {
  it('is ready immediately for a solid colour (no URL)', () => {
    const { result } = renderHook(() => useImageReady(null));
    expect(result.current).toBe(true);
  });

  it('waits for the image to load, and resets when the URL changes', () => {
    const created: HTMLImageElement[] = [];
    const RealImage = window.Image;
    window.Image = class extends RealImage { constructor() { super(); created.push(this); } } as typeof Image;
    try {
      const { result, rerender } = renderHook(({ url }) => useImageReady(url), { initialProps: { url: '/a.jpg' } });
      expect(result.current).toBe(false);
      act(() => { created[0].onload?.(new Event('load')); });
      expect(result.current).toBe(true);
      rerender({ url: '/b.jpg' });
      expect(result.current).toBe(false);
    } finally {
      window.Image = RealImage;
    }
  });
});
