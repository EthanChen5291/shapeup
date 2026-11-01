import { describe, expect, it } from 'vitest';
import { GLIMPSE_OBSERVER_OPTIONS } from './glimpseOrbit';

describe('GLIMPSE_OBSERVER_OPTIONS', () => {
  it('keeps spinning until the section is completely off-screen', () => {
    expect(GLIMPSE_OBSERVER_OPTIONS.threshold).toBe(0);
  });
  it('extends the viewport vertically, so it never pauses with tips still showing', () => {
    const [vertical] = String(GLIMPSE_OBSERVER_OPTIONS.rootMargin).split(' ');
    expect(parseInt(vertical, 10)).toBeGreaterThan(0);
  });
});
