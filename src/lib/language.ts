// ============================================================
// Which language the app is in — and where that answer is stored.
//
// The preference used to live only in localStorage, which the server cannot
// read. That made the first paint a lie: the server rendered every `t()` string
// in English, then the client's hydrating render read localStorage, produced
// Japanese, and React threw the whole tree away as a hydration mismatch
// (ChairSkeleton's "Loading…" vs "読み込み中…" was just the first string it
// reached). A cookie is the fix, because both sides can read it — the server
// seeds SettingsProvider with it, so pass one agrees by construction.
//
// Lives in a plain module (not SettingsContext or lib/i18n, both client
// boundaries) so the server layout can read it — same reason as lib/darkRoutes.
// ============================================================

export type Lang = 'en' | 'es' | 'ja';

/** Every language the app ships. Keep in step with lib/i18n's DICTIONARIES. */
export const SUPPORTED_LANGUAGES: readonly Lang[] = ['en', 'es', 'ja'];

export const LANG_COOKIE = 'shapeup_lang';

/** A year — long enough that a barber never re-picks, short enough to expire. */
const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * A trusted `Lang` from anything at all. The cookie is user-writable and a
 * stored preference can outlive the language that set it, so a value we don't
 * ship falls back to English rather than reaching a missing dictionary.
 */
export function normalizeLang(value: string | null | undefined): Lang {
  return SUPPORTED_LANGUAGES.includes(value as Lang) ? (value as Lang) : 'en';
}

/** The cookie's raw value, or `null` off the browser / when unset. */
export function readLangCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${LANG_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Persist the language for the *next* server render. Not `httpOnly` on purpose
 * — the client writes it, and there is nothing sensitive in "this barber reads
 * Spanish". `SameSite=Lax` because the only thing that ever reads it is our own
 * top-level navigation.
 */
export function writeLangCookie(lang: Lang) {
  if (typeof document === 'undefined') return;
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${LANG_COOKIE}=${lang}; Path=/; Max-Age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}
