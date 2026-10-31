import { describe, expect, it } from 'vitest';
import { fitToBox } from './fitToBox';

// A fake 3-line box holding 10 characters per line (20px per line).
function box(value = '') {
  return {
    value,
    clientHeight: 60,
    get scrollHeight() { return Math.max(1, Math.ceil(this.value.length / 10)) * 20; },
  };
}

describe('fitToBox', () => {
  it('passes text that fits straight through', () => {
    expect(fitToBox(box(), 'short')).toBe('short');
    expect(fitToBox(box(), 'x'.repeat(30))).toBe('x'.repeat(30));
  });

  it('trims a paste to the longest prefix that fits', () => {
    expect(fitToBox(box(), 'y'.repeat(45))).toBe('y'.repeat(30));
  });

  it('leaves the element showing its original value', () => {
    const el = box('kept');
    fitToBox(el, 'z'.repeat(80));
    expect(el.value).toBe('kept');
  });
});
