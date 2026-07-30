'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { isDarkOnlyRoute } from '@/lib/darkRoutes';
import { DEFAULT_LANG, type Lang, normalizeLang, readLangCookie, writeLangCookie } from '@/lib/language';

// Re-exported because this is where callers already look for it (BarberShell,
// the dark-mode notes in globals.css); the list itself lives in lib/darkRoutes
// so the server layout can read it too.
export { isDarkOnlyRoute };

export type RenderQuality = 'performance' | 'balanced' | 'high';

interface Settings {
  renderQuality: RenderQuality;
  language: string;
  aiTrainingOptOut: boolean;
  // Force a 24-hour clock on the surfaces that show appointment times. Off
  // means "follow the language's own convention" — see clockHour12().
  clock24: boolean;
}

interface SettingsContextValue extends Settings {
  updateRenderQuality: (q: RenderQuality) => void;
  updateLanguage: (l: string) => void;
  updateAiTrainingOptOut: (v: boolean) => void;
  updateClock24: (v: boolean) => void;
}

// The bare-context default stays 'en' (the t() source language): the app never
// renders without SettingsProvider, so this is only reached by unwrapped
// component tests. The deployed default lives in lib/language's DEFAULT_LANG.
const SettingsContext = createContext<SettingsContextValue>({
  renderQuality: 'balanced',
  language: 'en',
  aiTrainingOptOut: false,
  clock24: false,
  updateRenderQuality: () => {},
  updateLanguage: () => {},
  updateAiTrainingOptOut: () => {},
  updateClock24: () => {},
});

/**
 * `hour12` for `Intl.DateTimeFormat`, from the stored preference: `false` when
 * the barber asked for a 24-hour clock, otherwise `undefined` so the locale
 * decides (en-US → 12h, es-ES → 24h). Never `true` — forcing 12h on a locale
 * that doesn't use it is worse than leaving it alone.
 */
export function clockHour12(clock24: boolean): boolean | undefined {
  return clock24 ? false : undefined;
}

function readLocalSettings(): Partial<Settings> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem('shapeup_settings');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeLocalSettings(patch: Partial<Settings>) {
  if (typeof window === 'undefined') return;
  try {
    const current = readLocalSettings();
    localStorage.setItem('shapeup_settings', JSON.stringify({ ...current, ...patch }));
  } catch { /* ignore */ }
}

export function SettingsProvider({
  children,
  // Read from the language cookie by the root layout, so the server and the
  // client's hydrating render start from the same value. Everything else here
  // still comes from localStorage, which is safe only because none of it
  // reaches server-rendered markup — language does, via `t()`. See lib/language.
  initialLanguage = DEFAULT_LANG,
}: {
  children: React.ReactNode;
  initialLanguage?: Lang;
}) {
  const pathname = usePathname();
  const userQuery = useQuery(api.users.getMe);
  const updateSettingsMutation = useMutation(api.users.updateSettings);
  const isLoggedIn = userQuery !== null && userQuery !== undefined;

  const local = useMemo(() => readLocalSettings(), []);

  const [renderQuality, setRenderQuality] = useState<RenderQuality>(local.renderQuality ?? 'balanced');
  const [language, setLanguage] = useState<string>(initialLanguage);
  const [aiTrainingOptOut, setAiTrainingOptOut] = useState<boolean>(local.aiTrainingOptOut ?? false);
  const [clock24, setClock24] = useState<boolean>(local.clock24 ?? false);

  // Barbers who picked a language before the cookie existed have it only in
  // localStorage. Adopt it once, after hydration (never during — that is the
  // mismatch this whole mechanism exists to avoid), and write the cookie so
  // every later load is server-rendered in their language from the first byte.
  useEffect(() => {
    if (readLangCookie()) return;
    const stored = readLocalSettings().language;
    const adopted = normalizeLang(stored ?? initialLanguage);
    if (adopted !== language) setLanguage(adopted);
    writeLangCookie(adopted);
    // Mount only: a later render must not re-adopt a preference the barber has
    // since changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hydratedFromConvex = useRef(false);
  useEffect(() => {
    if (!userQuery || hydratedFromConvex.current) return;
    hydratedFromConvex.current = true;
    if (userQuery.renderQuality) setRenderQuality(userQuery.renderQuality);
    // Signing in on a new device is the one time the account's language can
    // differ from the cookie; write it back so the next load doesn't flash.
    if (userQuery.language) {
      setLanguage(userQuery.language);
      writeLangCookie(normalizeLang(userQuery.language));
    }
    if (userQuery.aiTrainingOptOut != null) setAiTrainingOptOut(userQuery.aiTrainingOptOut);
    if (userQuery.clock24 != null) setClock24(userQuery.clock24);
  }, [userQuery]);

  // Reflect the chosen language on <html lang> for a11y / browser hints. The
  // root layout already sets it from the cookie, so this is a no-op on first
  // paint and only earns its keep when the barber switches languages live.
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = language || DEFAULT_LANG;
  }, [language]);

  // The palette is a property of the route, not a preference: app surfaces get
  // `.dark`, the brand pages don't (see lib/darkRoutes). Nothing here reads
  // localStorage or `prefers-color-scheme` — there is no light mode to reach,
  // and a stale `theme` left in either place is ignored. The same rule runs
  // pre-paint in the root layout; this keeps it true across client navigation.
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDarkOnlyRoute(pathname));
  }, [pathname]);

  const persist = (patch: Partial<Settings>) => {
    writeLocalSettings(patch);
    if (isLoggedIn) updateSettingsMutation(patch as Parameters<typeof updateSettingsMutation>[0]).catch(() => {});
  };

  const updateRenderQuality = (q: RenderQuality) => { setRenderQuality(q); persist({ renderQuality: q }); };
  const updateLanguage = (l: string) => {
    setLanguage(l);
    // The cookie is what the next server render reads; localStorage keeps it
    // alongside the other settings for the signed-out case.
    writeLangCookie(normalizeLang(l));
    persist({ language: l });
  };
  const updateAiTrainingOptOut = (v: boolean) => { setAiTrainingOptOut(v); persist({ aiTrainingOptOut: v }); };
  const updateClock24 = (v: boolean) => { setClock24(v); persist({ clock24: v }); };

  const value = useMemo(() => ({
    renderQuality, language, aiTrainingOptOut, clock24,
    updateRenderQuality, updateLanguage, updateAiTrainingOptOut, updateClock24,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [renderQuality, language, aiTrainingOptOut, clock24]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);
