// Every hairstyle preview is the same square PNG on a white plate
// (public/hair-previews/<slug>.png), reused at half a dozen sizes across the
// chair, the card and the dashboard. Wherever it lands it wears rounded
// corners — a hard-cornered square reads as a pasted-in screenshot next to the
// pills and tiles around it. The corners are a stylesheet fact, and most of
// these surfaces only render for a signed-in barber, so this guards the rules
// themselves rather than the DOM.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.resolve(__dirname, '../app/globals.css'), 'utf8');

/** The declaration block of a rule, e.g. `.chair-steer-chip img`. */
function block(selector: string): string {
  const escaped = selector.replace(/\./g, '\\.');
  const match = css.match(new RegExp(`\\n${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `expected a ${selector} rule in globals.css`).toBeTruthy();
  return match![1];
}

/** Radius in px, or Infinity for a pill/circle — anything but a square corner. */
function radiusOf(selector: string): number {
  const value = block(selector).match(/border-radius:\s*([^;]+)/)?.[1]?.trim() ?? '';
  if (/%|9999px|999px/.test(value)) return Infinity;
  return Number.parseFloat(value);
}

describe('hair preview thumbnails', () => {
  // The two the chair shows: the menu tile and the steer chip beside the mirror.
  it.each([
    ['.chair-cut img', 68],
    ['.chair-steer-chip img', 26],
  ])('%s is rounded, and not so much that it eats the plate', (selector, size) => {
    const radius = radiusOf(selector);
    expect(radius).toBeGreaterThan(0);
    expect(radius).toBeLessThanOrEqual(size / 2);
  });

  it('rounds its corners no harder than the tile holding it', () => {
    // A preview curvier than its own tile bows inward against the border.
    expect(radiusOf('.chair-cut img')).toBeLessThanOrEqual(radiusOf('.chair-cut'));
  });

  it('scales the chip preview down with itself, not to a bare 1–2px', () => {
    // 26px of art with a 2px corner is square to the eye; keep it proportional
    // to the tile's 68px/14px so the two read as the same object.
    expect(radiusOf('.chair-steer-chip img')).toBeGreaterThanOrEqual(4);
  });

  // The rest were already round — circles cut from the same plate. They're
  // listed so a new square one can't slip in beside them.
  it.each([
    '.bt-chip img',
    '.ltp-chip img',
    '.barber-style-pick img',
    '.barber-top-styles img',
    '.bt-ready-cut',
  ])('%s stays rounded', (selector) => {
    expect(radiusOf(selector)).toBeGreaterThan(0);
  });
});
