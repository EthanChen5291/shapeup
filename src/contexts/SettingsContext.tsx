'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { DEFAULT_THEME, SETTINGS_STORAGE_KEY, resolveDark, type Theme } from '@/lib/theme';
import { runLanguageMist, runThemeTransition } from '@/lib/settingsTransitions';

export type { Theme } from '@/lib/theme';
export type RenderQuality = 'performance' | 'balanced' | 'high';

interface Settings {
  theme: Theme;
  renderQuality: RenderQuality;
  language: string;
  aiTrainingOptOut: boolean;
}

interface SettingsContextValue extends Settings {
  updateTheme: (t: Theme) => void;
  updateRenderQuality: (q: RenderQuality) => void;
  updateLanguage: (l: string) => void;
  updateAiTrainingOptOut: (v: boolean) => void;
}

const SettingsContext = createContext<SettingsContextValue>({
  theme: DEFAULT_THEME,
  renderQuality: 'balanced',
  language: 'en',
  aiTrainingOptOut: false,
  updateTheme: () => {},
  updateRenderQuality: () => {},
  updateLanguage: () => {},
  updateAiTrainingOptOut: () => {},
});

function readLocalSettings(): Partial<Settings> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeLocalSettings(patch: Partial<Settings>) {
  if (typeof window === 'undefined') return;
  try {
    const current = readLocalSettings();
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch { /* ignore */ }
}

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const userQuery = useQuery(api.users.getMe);
  const updateSettingsMutation = useMutation(api.users.updateSettings);
  const isLoggedIn = userQuery !== null && userQuery !== undefined;

  const local = useMemo(() => readLocalSettings(), []);

  const [theme, setTheme] = useState<Theme>(local.theme ?? DEFAULT_THEME);
  const [renderQuality, setRenderQuality] = useState<RenderQuality>(local.renderQuality ?? 'balanced');
  const [language, setLanguage] = useState<string>(local.language ?? 'en');
  const [aiTrainingOptOut, setAiTrainingOptOut] = useState<boolean>(local.aiTrainingOptOut ?? false);

  const hydratedFromConvex = useRef(false);
  useEffect(() => {
    if (!userQuery || hydratedFromConvex.current) return;
    hydratedFromConvex.current = true;
    if (userQuery.theme) setTheme(userQuery.theme);
    if (userQuery.renderQuality) setRenderQuality(userQuery.renderQuality);
    if (userQuery.language) setLanguage(userQuery.language);
    if (userQuery.aiTrainingOptOut != null) setAiTrainingOptOut(userQuery.aiTrainingOptOut);
  }, [userQuery]);

  // Reflect the chosen language on <html lang> for a11y / browser hints.
  useEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.lang = language || 'en';
  }, [language]);

  // Apply theme to <html>. The pre-paint script in layout.tsx does the same
  // from localStorage before hydration; this keeps it current afterwards.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.classList.toggle('dark', resolveDark(theme, pathname, mq.matches));
    };
    apply();
    if (theme !== 'system') return;
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme, pathname]);

  const persist = (patch: Partial<Settings>) => {
    writeLocalSettings(patch);
    if (isLoggedIn) updateSettingsMutation(patch as Parameters<typeof updateSettingsMutation>[0]).catch(() => {});
  };

  // User-initiated theme change: flip the class inside a cross-fade (no hard
  // cut); the effect above then keeps it in sync as before.
  const updateTheme = (t: Theme) => {
    runThemeTransition(() => {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      document.documentElement.classList.toggle('dark', resolveDark(t, pathname, prefersDark));
    });
    setTheme(t);
    persist({ theme: t });
  };
  const updateRenderQuality = (q: RenderQuality) => { setRenderQuality(q); persist({ renderQuality: q }); };
  // Text mists out, swaps language at the midpoint, then condenses back.
  const updateLanguage = (l: string) => { runLanguageMist(() => setLanguage(l)); persist({ language: l }); };
  const updateAiTrainingOptOut = (v: boolean) => { setAiTrainingOptOut(v); persist({ aiTrainingOptOut: v }); };

  const value = useMemo(() => ({
    theme, renderQuality, language, aiTrainingOptOut,
    updateTheme, updateRenderQuality, updateLanguage, updateAiTrainingOptOut,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [theme, renderQuality, language, aiTrainingOptOut]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export const useSettings = () => useContext(SettingsContext);
