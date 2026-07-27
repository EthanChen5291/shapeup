// The builder's page-level width is a stylesheet fact, and the surface it
// governs (.barber-builder) only renders for a signed-in barber — out of reach
// of the signed-out e2e run. So this guards the rule itself: the builder goes
// edge to edge inside .bshell-main like every other dashboard tab, instead of
// sitting in a centered column with dark gutters either side.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.resolve(__dirname, '../../globals.css'), 'utf8');

/** The declaration block of a top-level rule, e.g. `.barber-builder`. */
function block(selector: string): string {
  const match = css.match(new RegExp(`\\n${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`));
  expect(match, `expected a ${selector} rule in globals.css`).toBeTruthy();
  return match![1];
}

describe('barber card builder width', () => {
  const builder = block('.barber-builder');

  it('is not capped or centered — it fills the dashboard shell', () => {
    expect(builder).not.toMatch(/max-width/);
    expect(builder).not.toMatch(/margin:\s*0\s+auto/);
  });

  it('leaves the horizontal gutter to the shell so tabs line up', () => {
    // .bshell-main's own padding is the only horizontal inset; a second one
    // here would indent the card tab relative to Today / Clients / Insights.
    const padding = builder.match(/padding:\s*([^;]+);/)?.[1] ?? '';
    expect(padding).toMatch(/^\S+\s+0(\s|$)/);
    expect(block('.bshell-main')).toMatch(/padding:/);
  });

  it('keeps the preview column below the card’s 960px desktop split', () => {
    // The preview must stay the phone layout a client actually sees, so its
    // upper bound has to clear the @container bcard (min-width: 960px) switch.
    const columns = builder.match(/grid-template-columns:\s*([^;]+);/)?.[1] ?? '';
    const upperBound = columns.match(/clamp\([^)]*?,\s*([\d.]+)px\s*\)/)?.[1];
    expect(Number(upperBound ?? columns.match(/(\d+)px/)?.[1])).toBeLessThan(960);
  });
});
