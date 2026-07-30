// @vitest-environment jsdom

// The palette rule, which is all route and no preference: app surfaces are the
// dark studio, brand pages are the warm light one, and nothing a user (or an
// old localStorage entry) says can move either. Convex + navigation are stubbed
// the same way as BarberDashboard.test.tsx.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

let pathname = '/';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('convex/react', () => ({
  useQuery: () => undefined,
  useMutation: () => vi.fn(async () => null),
}));
vi.mock('@convex/_generated/api', () => ({
  api: { users: { getMe: 'users:getMe', updateSettings: 'users:updateSettings' } },
}));

import { SettingsProvider, clockHour12, isDarkOnlyRoute, useSettings } from './SettingsContext';

// Node 22 ships its own partial `localStorage`, which shadows jsdom's — pin a
// real Map-backed one (same workaround as barberIntent.test.ts).
beforeEach(() => {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, val: string) => void store.set(k, val),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
    writable: true,
    configurable: true,
  });
  document.documentElement.classList.remove('dark');
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0].trim();
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
});
afterEach(cleanup);

describe('isDarkOnlyRoute', () => {
  test('covers the dashboard, its tabs and the chair — not the brand pages', () => {
    expect(isDarkOnlyRoute('/barber')).toBe(true);
    expect(isDarkOnlyRoute('/barber/clients')).toBe(true);
    expect(isDarkOnlyRoute('/barber/clients/c1')).toBe(true);
    expect(isDarkOnlyRoute('/chair')).toBe(true);
    expect(isDarkOnlyRoute('/admin/feedback')).toBe(true);
    expect(isDarkOnlyRoute('/b/marcus')).toBe(false);
    expect(isDarkOnlyRoute('/')).toBe(false);
    expect(isDarkOnlyRoute('/for-barbers')).toBe(false);
    // A different page that merely starts with the same letters.
    expect(isDarkOnlyRoute('/barbershop')).toBe(false);
  });
});

describe('SettingsProvider palette application', () => {
  test('the app is dark', () => {
    pathname = '/barber/clients';
    render(<SettingsProvider>x</SettingsProvider>);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  test('a stale light preference cannot turn the app light again', () => {
    // Light mode is gone, but a returning barber still has the old key.
    window.localStorage.setItem('shapeup_settings', JSON.stringify({ theme: 'light' }));
    pathname = '/barber/card';
    render(<SettingsProvider>x</SettingsProvider>);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  test('brand pages stay light, stale dark preference and all', () => {
    window.localStorage.setItem('shapeup_settings', JSON.stringify({ theme: 'dark' }));
    pathname = '/';
    render(<SettingsProvider>x</SettingsProvider>);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  test('the client-facing card is a brand page, not an app surface', () => {
    pathname = '/b/marcus';
    render(<SettingsProvider>x</SettingsProvider>);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  test('leaving the app for a brand page takes the dark class off again', () => {
    pathname = '/barber';
    const { rerender } = render(<SettingsProvider>x</SettingsProvider>);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    pathname = '/pricing';
    rerender(<SettingsProvider>x</SettingsProvider>);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  test('the context exposes no theme knob to reach light mode with', () => {
    let seen: Record<string, unknown> = {};
    function Probe() {
      seen = useSettings() as unknown as Record<string, unknown>;
      return null;
    }
    pathname = '/barber';
    render(<SettingsProvider><Probe /></SettingsProvider>);
    expect(seen).not.toHaveProperty('theme');
    expect(seen).not.toHaveProperty('updateTheme');
  });
});

describe('language, and the hydration rule it has to obey', () => {
  test('the first render uses the server-supplied language, not localStorage', () => {
    // The bug this whole mechanism exists for: the server renders `t()` in
    // English while the client's hydrating render reads `ja` off localStorage,
    // React sees "Loading…" vs "読み込み中…" and throws the tree away. The
    // provider must ignore localStorage on pass one, no matter what it holds.
    window.localStorage.setItem('shapeup_settings', JSON.stringify({ language: 'ja' }));
    pathname = '/chair';

    let first: string | undefined;
    function Probe() {
      const { language } = useSettings();
      if (first === undefined) first = language;
      return null;
    }
    render(<SettingsProvider initialLanguage="en"><Probe /></SettingsProvider>);
    expect(first).toBe('en');
  });

  test('the server-supplied language is what the first render uses', () => {
    pathname = '/chair';
    let first: string | undefined;
    function Probe() {
      const { language } = useSettings();
      if (first === undefined) first = language;
      return null;
    }
    render(<SettingsProvider initialLanguage="ja"><Probe /></SettingsProvider>);
    expect(first).toBe('ja');
  });

  test('a pre-cookie localStorage preference is adopted after hydration', () => {
    window.localStorage.setItem('shapeup_settings', JSON.stringify({ language: 'ja' }));
    pathname = '/chair';

    let latest = '';
    function Probe() {
      latest = useSettings().language;
      return null;
    }
    render(<SettingsProvider initialLanguage="en"><Probe /></SettingsProvider>);

    // Adopted in an effect, and written to the cookie so the *next* server
    // render agrees and there is no second flash.
    expect(latest).toBe('ja');
    expect(document.cookie).toContain('shapeup_lang=ja');
  });

  test('an existing cookie wins over a stale localStorage entry', () => {
    document.cookie = 'shapeup_lang=es; Path=/';
    window.localStorage.setItem('shapeup_settings', JSON.stringify({ language: 'ja' }));
    pathname = '/chair';

    let latest = '';
    function Probe() {
      latest = useSettings().language;
      return null;
    }
    render(<SettingsProvider initialLanguage="es"><Probe /></SettingsProvider>);
    expect(latest).toBe('es');
  });

  test('switching languages writes the cookie the next server render reads', () => {
    pathname = '/barber';
    let ctx: ReturnType<typeof useSettings> | undefined;
    function Probe() {
      ctx = useSettings();
      return null;
    }
    render(<SettingsProvider initialLanguage="en"><Probe /></SettingsProvider>);

    act(() => ctx!.updateLanguage('ja'));
    expect(document.cookie).toContain('shapeup_lang=ja');
    expect(document.documentElement.lang).toBe('ja');
  });

  test('an unsupported cookie value never reaches the dictionary lookup', () => {
    pathname = '/barber';
    let ctx: ReturnType<typeof useSettings> | undefined;
    function Probe() {
      ctx = useSettings();
      return null;
    }
    render(<SettingsProvider initialLanguage="en"><Probe /></SettingsProvider>);

    act(() => ctx!.updateLanguage('fr'));
    // Unsupported values normalize to the site default (Japanese).
    expect(document.cookie).toContain('shapeup_lang=ja');
  });
});

describe('clockHour12', () => {
  test('only ever forces 24h — 12h is left to the locale', () => {
    expect(clockHour12(true)).toBe(false);
    expect(clockHour12(false)).toBeUndefined();
  });
});
