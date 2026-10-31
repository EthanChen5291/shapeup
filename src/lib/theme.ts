export type Theme = 'light' | 'dark' | 'system';

/** Theme used when the visitor has no stored preference. The app is dark by default. */
export const DEFAULT_THEME: Theme = 'dark';

export const SETTINGS_STORAGE_KEY = 'shapeup_settings';

// Public marketing surfaces always render in the warm light palette — dark mode
// is an in-app preference and must never bleed onto the landing page (a returning
// signed-out user can still have `theme: 'dark'` persisted in localStorage).
export const LIGHT_ONLY_ROUTES: ReadonlySet<string> = new Set(['/']);

export function isTheme(v: unknown): v is Theme {
  return v === 'light' || v === 'dark' || v === 'system';
}

/** Decide whether `<html>` should carry the `dark` class. Pure; shared by the
 * React effect and the pre-paint script (keep `THEME_INIT_SCRIPT` in sync). */
export function resolveDark(theme: Theme, pathname: string, systemDark: boolean): boolean {
  if (LIGHT_ONLY_ROUTES.has(pathname)) return false;
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return systemDark;
}

/**
 * Runs inline in <head> before first paint so app routes never flash the light
 * palette. Mirrors `resolveDark` using only the stored localStorage preference;
 * the React effect in SettingsContext takes over (and applies the Convex-synced
 * preference) once hydrated.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var light=${JSON.stringify([...LIGHT_ONLY_ROUTES])};
var p=location.pathname;
if(light.indexOf(p)!==-1)return;
var t=${JSON.stringify(DEFAULT_THEME)};
try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_STORAGE_KEY)})||'{}');
if(s.theme==='light'||s.theme==='dark'||s.theme==='system')t=s.theme;}catch(e){}
var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
if(d)document.documentElement.classList.add('dark');
}catch(e){}})();`;
