import { describe, expect, test } from 'vitest';
import { snapshotSize, SNAPSHOT_MAX_WIDTH } from './snapshot';

describe('snapshotSize', () => {
  test('caps width and preserves aspect ratio', () => {
    expect(snapshotSize(1280, 720)).toEqual({ width: SNAPSHOT_MAX_WIDTH, height: 90 });
    expect(snapshotSize(720, 1280)).toEqual({
      width: SNAPSHOT_MAX_WIDTH,
      height: Math.round((SNAPSHOT_MAX_WIDTH * 1280) / 720),
    });
  });

  test('a source narrower than the cap is not upscaled', () => {
    expect(snapshotSize(100, 75)).toEqual({ width: 100, height: 75 });
  });

  test('degenerate dimensions still produce a drawable canvas', () => {
    const zero = snapshotSize(0, 0);
    expect(zero.width).toBeGreaterThanOrEqual(2);
    expect(zero.height).toBeGreaterThanOrEqual(2);
    const sliver = snapshotSize(4000, 1);
    expect(sliver.height).toBeGreaterThanOrEqual(2);
  });
});
