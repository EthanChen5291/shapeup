import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Settings' option tiles put text on a solid accent fill. In dark mode the settings
// floor lightens --denim, so the text on it must flip to --denim-on (navy) or it
// washes out. This reads the real values from globals.css and checks WCAG AA.
const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
const page = readFileSync(join(process.cwd(), 'src/app/dashboard/page.tsx'), 'utf8');

function token(block: string, name: string): string {
  const m = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`${name} not found`);
  return m[1];
}
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const baseBlock = css.slice(css.indexOf('--denim:'));                    // the base palette's --denim (light mode)
const darkBlock = css.slice(css.indexOf('html.dark .settings-floor {'));
const onRoot = css.slice(css.indexOf('--denim-on: #'), css.indexOf('--denim-on: #') + 40);

describe('settings option tiles on denim', () => {
  it('light mode: cream on deep denim passes AA', () => {
    expect(contrast(token(baseBlock, '--denim'), token(onRoot, '--denim-on'))).toBeGreaterThanOrEqual(4.5);
  });
  it('dark mode: navy on light denim passes AA, cream would not', () => {
    const fill = token(darkBlock, '--denim');
    expect(contrast(fill, token(darkBlock, '--denim-on'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(fill, '#fff8ea')).toBeLessThan(4.5); // the old hard-coded cream
  });
  it('the Dark theme option uses the flipping token, not a fixed colour', () => {
    expect(page).toMatch(/value: 'dark', label: t\('Dark'\), Icon: IconMoon, color: 'var\(--denim\)', on: 'var\(--denim-on\)'/);
  });
});
