import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Contract for the dark-mode contrast fixes in globals.css. These are pure CSS,
// so guard the rules themselves rather than rendered pixels.
const css = readFileSync(join(__dirname, 'globals.css'), 'utf8');

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`missing rule: ${selector}`);
  return css.slice(start, css.indexOf('}', start));
}

describe('dark-mode contrast overrides', () => {
  it.each([
    'html.dark .pill-tomato',
    'html.dark .btn-export-data',
  ])('%s sets a light foreground color', (selector) => {
    expect(rule(selector)).toMatch(/color:\s*(#ff|var\(--denim-lt\))/);
  });

  it('renders the 360° / Recap / try-ons action buttons flat, without a gradient', () => {
    expect(rule('.card-action')).not.toMatch(/gradient/);
  });
});
