// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import LetterSpill, { PowerBorder } from './LetterSpill';

const LINE = 'your barber hears something different...';
afterEach(() => cleanup());

describe('LetterSpill', () => {
  it('renders a hidden layer with one inked copy per non-space character', () => {
    const { container } = render(<LetterSpill text={LINE} />);
    const layer = container.querySelector('.letter-spill')!;
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    const copies = [...layer.querySelectorAll<HTMLElement>('.letter-spill__letter')];
    expect(copies.length).toBe(LINE.replace(/ /g, '').length);
    expect(copies.map((c) => c.textContent).join('')).toBe(LINE.replace(/ /g, ''));
    for (const c of copies) expect(c.style.getPropertyValue('--ink')).toMatch(/^linear-gradient\(\d+deg, rgb\(.+\), rgb\(.+\)\)$/);
  });

  it('does nothing, and does not throw, when the page has no layout or no note', () => {
    const { container } = render(<LetterSpill text={LINE} />);
    const layer = container.querySelector('.letter-spill')!;
    expect(layer.hasAttribute('data-active')).toBe(false);
    window.dispatchEvent(new Event('resize'));
    document.dispatchEvent(new Event('scroll'));
    expect(layer.hasAttribute('data-active')).toBe(false);
  });

  it('leaves a note it cannot measure untouched (jsdom has no layout)', () => {
    const { container } = render(
      <main>
        <span className="crumpled-note" />
        <div data-spill-box />
        <LetterSpill text="ab" />
      </main>,
    );
    document.dispatchEvent(new Event('scroll'));
    expect(container.querySelector('.crumpled-note')!.hasAttribute('data-spilled')).toBe(false);
    expect(container.querySelector('.letter-spill')!.hasAttribute('data-active')).toBe(false);
  });
});

describe('PowerBorder', () => {
  it('renders an aria-hidden svg for the border to be drawn into', () => {
    const { container } = render(<div data-spill-box><PowerBorder /></div>);
    const svg = container.querySelector('svg.power-border')!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('letter spill stylesheet', () => {
  const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');
  const start = css.indexOf('/* ── Letter spill');
  const block = css.slice(start, css.indexOf('/* ── Stat card', start));

  it('leaves the real letters as a grey imprint while spilled, and keeps the copy layer clipped and untouchable', () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toMatch(/\.crumpled-note\[data-spilled\] > \[aria-hidden\] \{[^}]*filter: url\(#spill-grit\) grayscale\(1\)[^}]*opacity: 0\.6;/);
    expect(block).not.toMatch(/\.crumpled-note\[data-spilled\] > \[aria-hidden\] \{[^}]*visibility: hidden/);
    expect(block).toMatch(/\.letter-spill \{[^}]*pointer-events: none[^}]*\}/s);
    expect(block).toMatch(/\.letter-spill \{[^}]*overflow: hidden[^}]*\}/s);
  });

  it('fills the heading from --power where the browser can clip the gradient to text', () => {
    // The gradient exists only while the heading is lighting up: at rest it is plain ink.
    expect(block).not.toMatch(/\.power-text \{[^}]*gradient/);
    expect(block).toMatch(/@supports \(\(-webkit-background-clip: text\) or \(background-clip: text\)\) \{[^]*\.power-text\[data-lighting\] \{[^}]*var\(--power\)/);
  });

  it('lets the landing card tremble, and leaves the send button spotlight to real sizes instead of a scale', () => {
    expect(block).toMatch(/\.compare-card\[data-spill-table\] \{[^}]*rotate: var\(--spill-tremble, 0deg\)/);
    // The spotlight grows the button's own width and height (LandingPage), so nothing is scaled up and blurred.
    expect(css).not.toMatch(/@keyframes send-btn-spotlight/);
    expect(css).toMatch(/\.send-btn-spotlight \{ z-index: 5; \}/);
  });

  it('tips the note by --tip on top of its resting rotation', () => {
    expect(css).toMatch(/\.type-chonk \.crumpled-note \{[^}]*transform: rotate\(calc\(-1\.2deg \+ var\(--tip, 0deg\)\)\)/s);
  });
});
