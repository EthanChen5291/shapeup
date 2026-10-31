// Visual transitions for user-initiated settings changes. Both are skipped for
// prefers-reduced-motion (the change just applies).

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => unknown };

/** Matches ::view-transition-* animation-duration in globals.css. */
export const THEME_FADE_MS = 650;

/**
 * Light ↔ dark: cross-fade the old look into the new one instead of a hard cut.
 * Uses the View Transitions API (snapshot cross-fade, timed in globals.css);
 * elsewhere, a short class that eases colours over.
 */
export function runThemeTransition(apply: () => void): void {
  if (typeof document === 'undefined' || reducedMotion()) { apply(); return; }
  const doc = document as ViewTransitionDoc;
  if (typeof doc.startViewTransition === 'function') {
    // Freeze element transitions until the cross-fade ends: otherwise elements
    // with their own colour transitions are snapshotted mid-way and keep
    // fading after the cross-fade, out of sync with the rest of the page.
    const root = document.documentElement;
    root.classList.add('theme-switching');
    const vt = doc.startViewTransition(apply) as { finished?: Promise<unknown> } | undefined;
    const done = () => root.classList.remove('theme-switching');
    if (vt?.finished) vt.finished.then(done, done);
    else window.setTimeout(done, THEME_FADE_MS);
    return;
  }
  const root = document.documentElement;
  root.classList.add('theme-fade');
  apply();
  window.setTimeout(() => root.classList.remove('theme-fade'), THEME_FADE_MS + 50);
}

export const LANG_MIST_OUT_MS = 130;
export const LANG_MIST_IN_MS = 220;

/**
 * Language switch: text blurs into a faint mist, swaps to the new language,
 * then condenses back — subtle and quick.
 */
export function runLanguageMist(apply: () => void): void {
  if (typeof document === 'undefined' || reducedMotion()) { apply(); return; }
  const root = document.documentElement;
  root.classList.remove('lang-mist-in');
  root.classList.add('lang-mist-out');
  window.setTimeout(() => {
    apply();
    root.classList.remove('lang-mist-out');
    root.classList.add('lang-mist-in');
    window.setTimeout(() => root.classList.remove('lang-mist-in'), LANG_MIST_IN_MS);
  }, LANG_MIST_OUT_MS);
}
