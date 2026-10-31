import { describe, it, expect } from 'vitest';
import { DEFAULT_THEME, THEME_INIT_SCRIPT, resolveDark } from './theme';

describe('theme defaults', () => {
  it('is dark by default', () => {
    expect(DEFAULT_THEME).toBe('dark');
  });
});

describe('resolveDark', () => {
  it('honours an explicit preference on app routes', () => {
    expect(resolveDark('dark', '/dashboard', false)).toBe(true);
    expect(resolveDark('light', '/dashboard', true)).toBe(false);
  });
  it('follows the OS when set to system', () => {
    expect(resolveDark('system', '/dashboard', true)).toBe(true);
    expect(resolveDark('system', '/dashboard', false)).toBe(false);
  });
  it('keeps the landing page light regardless of preference', () => {
    expect(resolveDark('dark', '/', true)).toBe(false);
    expect(resolveDark('system', '/', true)).toBe(false);
  });
});

/** Run the pre-paint script against a fake browser and return whether it added `.dark`. */
function runInitScript(opts: { pathname: string; stored?: string | null; systemDark?: boolean }): boolean {
  const classes = new Set<string>();
  const fakeWindow = {
    matchMedia: () => ({ matches: opts.systemDark ?? false }),
  };
  const env = {
    location: { pathname: opts.pathname },
    localStorage: { getItem: () => opts.stored ?? null },
    document: { documentElement: { classList: { add: (c: string) => classes.add(c) } } },
    window: fakeWindow,
  };
  const fn = new Function('location', 'localStorage', 'document', 'window', THEME_INIT_SCRIPT);
  fn(env.location, env.localStorage, env.document, env.window);
  return classes.has('dark');
}

describe('THEME_INIT_SCRIPT (pre-paint)', () => {
  it('applies dark on app routes when nothing is stored', () => {
    expect(runInitScript({ pathname: '/dashboard' })).toBe(true);
  });
  it('respects a stored light preference', () => {
    expect(runInitScript({ pathname: '/dashboard', stored: JSON.stringify({ theme: 'light' }) })).toBe(false);
  });
  it('follows the OS for a stored system preference', () => {
    const stored = JSON.stringify({ theme: 'system' });
    expect(runInitScript({ pathname: '/dashboard', stored, systemDark: true })).toBe(true);
    expect(runInitScript({ pathname: '/dashboard', stored, systemDark: false })).toBe(false);
  });
  it('never darkens the landing page', () => {
    expect(runInitScript({ pathname: '/', stored: JSON.stringify({ theme: 'dark' }) })).toBe(false);
  });
  it('falls back to dark on corrupt storage', () => {
    expect(runInitScript({ pathname: '/studio/abc', stored: '{not json' })).toBe(true);
  });
  it('matches resolveDark for every combination', () => {
    for (const theme of ['light', 'dark', 'system'] as const) {
      for (const pathname of ['/', '/dashboard']) {
        for (const systemDark of [true, false]) {
          expect(runInitScript({ pathname, stored: JSON.stringify({ theme }), systemDark }))
            .toBe(resolveDark(theme, pathname, systemDark));
        }
      }
    }
  });
});
