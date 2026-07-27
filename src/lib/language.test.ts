// @vitest-environment jsdom

import { afterEach, describe, expect, test } from 'vitest';
import {
  LANG_COOKIE,
  SUPPORTED_LANGUAGES,
  normalizeLang,
  readLangCookie,
  writeLangCookie,
} from './language';

function clearCookies() {
  for (const pair of document.cookie.split(';')) {
    const name = pair.split('=')[0].trim();
    if (name) document.cookie = `${name}=; Path=/; Max-Age=0`;
  }
}
afterEach(clearCookies);

describe('normalizeLang', () => {
  test('passes through every language we ship', () => {
    for (const lang of SUPPORTED_LANGUAGES) expect(normalizeLang(lang)).toBe(lang);
  });

  test('falls back to English rather than reaching a missing dictionary', () => {
    // The cookie is user-writable, so this is the untrusted-input path.
    expect(normalizeLang('fr')).toBe('en');
    expect(normalizeLang('')).toBe('en');
    expect(normalizeLang(null)).toBe('en');
    expect(normalizeLang(undefined)).toBe('en');
    expect(normalizeLang('ja; Path=/')).toBe('en');
  });
});

describe('the language cookie', () => {
  test('round-trips through document.cookie', () => {
    expect(readLangCookie()).toBeNull();
    writeLangCookie('ja');
    expect(readLangCookie()).toBe('ja');
    writeLangCookie('es');
    expect(readLangCookie()).toBe('es');
  });

  test('is read by its own name, not a prefix of a neighbour', () => {
    document.cookie = `not_${LANG_COOKIE}=ja; Path=/`;
    expect(readLangCookie()).toBeNull();
    writeLangCookie('es');
    expect(readLangCookie()).toBe('es');
  });

  test('is scoped to the whole site and outlives the session', () => {
    writeLangCookie('ja');
    // jsdom drops attributes from document.cookie reads, so assert on the
    // serialization the browser is handed instead.
    let written = '';
    const spy = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
    Object.defineProperty(document, 'cookie', {
      set: (v: string) => { written = v; },
      get: () => '',
      configurable: true,
    });
    writeLangCookie('es');
    if (spy) Object.defineProperty(document, 'cookie', spy);
    expect(written).toContain('Path=/');
    expect(written).toContain('SameSite=Lax');
    expect(written).toMatch(/Max-Age=\d+/);
  });
});
