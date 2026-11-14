// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import CrumpledNote from './CrumpledNote';

const LINE = 'your barber hears something different...';
afterEach(() => cleanup());

describe('CrumpledNote', () => {
  it('reads as one phrase to assistive tech; the per-letter copy is hidden from it', () => {
    const { container } = render(<CrumpledNote text={LINE} />);
    expect(container.querySelector('.sr-only')?.textContent).toBe(LINE);
    const visual = container.querySelector('[aria-hidden="true"]')!;
    expect(visual.textContent).toBe(LINE);
    expect(container.querySelectorAll('.crumpled-note__letter').length).toBe(LINE.replace(/ /g, '').length);
  });

  it('keeps each word whole and gives every letter its own nudge and ink', () => {
    const { container } = render(<CrumpledNote text={LINE} />);
    expect([...container.querySelectorAll('.crumpled-note__word')].map((w) => w.textContent)).toEqual(LINE.split(' '));
    const letters = [...container.querySelectorAll<HTMLElement>('.crumpled-note__letter')];
    for (const l of letters) {
      expect(l.style.transform).toMatch(/^translateY\(-?[\d.]+em\) rotate\(-?[\d.]+deg\)$/);
      expect(l.style.getPropertyValue('--ink')).toMatch(/^linear-gradient\(\d+deg, rgb\(.+\), rgb\(.+\)\)$/);
    }
    expect(new Set(letters.map((l) => l.style.transform)).size).toBeGreaterThan(letters.length / 2);
  });

  it('has its paper and its text styling in the stylesheet, and the paper files exist', () => {
    const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
    const block = css.slice(css.indexOf('.type-chonk .crumpled-note {'), css.indexOf('/* ── Stat card'));
    expect(block).toMatch(/font-family: "Comic Sans MS"/);
    expect(block).toMatch(/font-size: 0\.8em/);
    // The ink only turns transparent where the browser can clip the gradient to the letters.
    expect(block).toMatch(/@supports \(\(-webkit-background-clip: text\) or \(background-clip: text\)\) \{[^}]*\.crumpled-note__letter \{[^}]*background-image: var\(--ink\)[^}]*color: transparent/s);
    const papers = [...block.matchAll(/url\((\/landing_paper\/[\w.]+)\)/g)].map((m) => m[1]);
    expect(papers).toEqual(['/landing_paper/receipt_wide.webp', '/landing_paper/receipt_tall.webp']);
    for (const p of papers) expect(existsSync(join(process.cwd(), 'public', p)), p).toBe(true);
  });
});
