// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { pillPath, SearchFocusRing, sweepDash } from './SearchFocusRing';

afterEach(() => cleanup());

describe('pillPath', () => {
  it('starts at top centre and runs clockwise around a pill', () => {
    const d = pillPath(220, 34, 1.5);
    expect(d.startsWith('M 110 0.75')).toBe(true);
    // right arc, bottom edge, left arc, close
    // radius = (33.25 - 0.75) / 2 = 16.25; arc centres at x = 203 and x = 17
    expect(d).toBe('M 110 0.75 H 203 A 16.25 16.25 0 0 1 203 33.25 H 17 A 16.25 16.25 0 0 1 17 0.75 Z');
  });
});

describe('sweepDash', () => {
  it('is empty at 0 and a full loop at 1, always centred on the start point', () => {
    expect(sweepDash(0)).toEqual({ dasharray: '0 100', dashoffset: 0 });
    expect(sweepDash(0.5)).toEqual({ dasharray: '50 50', dashoffset: 25 });
    expect(sweepDash(1)).toEqual({ dasharray: '100 0', dashoffset: 50 });
  });
  it('clamps out-of-range fractions', () => {
    expect(sweepDash(-1).dasharray).toBe('0 100');
    expect(sweepDash(2).dasharray).toBe('100 0');
  });
});

describe('SearchFocusRing', () => {
  it('exposes its active state for CSS hooks', () => {
    const { container, rerender } = render(<SearchFocusRing active={false} />);
    expect(container.querySelector('svg')?.getAttribute('data-active')).toBe('false');
    rerender(<SearchFocusRing active />);
    expect(container.querySelector('svg')?.getAttribute('data-active')).toBe('true');
  });

  it('hides the stroke at rest so the round cap leaves no dot', () => {
    // jsdom has no layout; fake a size so the path renders.
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 220, height: 34 } as DOMRect);
    const { container, rerender } = render(<SearchFocusRing active={false} />);
    const path = () => container.querySelector('path') as SVGPathElement;
    expect(path().style.opacity).toBe('0');
    rerender(<SearchFocusRing active />);
    expect(path().style.opacity).toBe('1');
    spy.mockRestore();
  });
});
