// The prompt-suggestion gender toggle is an account-wide preference: it is
// saved to the user's Convex document (users.setSuggestionGender) so it applies
// to every project on every device. This module is the per-browser cache that
// makes the first paint right before the account value arrives.

export type Gender = 'mens' | 'womens';

export const GENDER_STORAGE_KEY = 'shapeup-gender';

export function isGender(value: unknown): value is Gender {
  return value === 'mens' || value === 'womens';
}

// Reads the cached choice, defaulting to 'mens'. Tolerates a non-browser
// environment and unavailable/blocked localStorage (private mode, quota).
export function loadGender(storage?: Pick<Storage, 'getItem'>): Gender {
  const store = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
  if (!store) return 'mens';
  try {
    const v = store.getItem(GENDER_STORAGE_KEY);
    return isGender(v) ? v : 'mens';
  } catch {
    return 'mens';
  }
}

// Caches the choice. No-op (never throws) when storage is unavailable.
export function saveGender(gender: Gender, storage?: Pick<Storage, 'setItem'>): void {
  const store = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage);
  if (!store) return;
  try {
    store.setItem(GENDER_STORAGE_KEY, gender);
  } catch {
    // non-fatal
  }
}
