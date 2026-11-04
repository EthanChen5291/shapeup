import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The root layout can't be rendered here (Clerk, next/font), so this guards the
// one line that matters: extensions edit <body>'s attributes before hydration.
describe('root layout', () => {
  it('ignores attribute-only hydration mismatches on <body> (browser extensions) but not on children', () => {
    const src = readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8');
    const body = src.match(/<body\s[^>]*>/)?.[0];
    expect(body).toBeDefined();
    expect(body).toContain('suppressHydrationWarning');
    // Only the two document-level elements carry it; it must not spread to content.
    expect(src.match(/suppressHydrationWarning/g)?.length).toBe(2);
  });
});
