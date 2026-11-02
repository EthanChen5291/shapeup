import { describe, expect, it } from 'vitest';

describe('bubbleSize', () => {
  it('is the normal 168px on an ordinary screen', async () => {
    const { bubbleSize } = await import('./HairPreviewBubble');
    expect(bubbleSize(1440, 900)).toBe(168);
  });
  it('shrinks to 30% of the short side on a zoomed-in desktop, never below 96', async () => {
    const { bubbleSize } = await import('./HairPreviewBubble');
    expect(bubbleSize(605, 360)).toBe(108);
    expect(bubbleSize(300, 200)).toBe(96);
  });
});
