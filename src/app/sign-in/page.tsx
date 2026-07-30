'use client';

import { useEffect } from 'react';
import { useUser } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import SignUpWidget from '@/components/SignUpWidget';
import { useSettings } from '@/contexts/SettingsContext';
import { useT } from '@/lib/i18n';
import type { Lang } from '@/lib/language';

// The sign-in screen is the first thing a shop's monitor shows, so the
// language choice lives here rather than behind a settings door. EN/JA only:
// the two languages the demo shops run in — the full set stays in settings.
const LANGUAGES: { value: Lang; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語' },
];

export default function SignInPage() {
  const { isSignedIn } = useUser();
  const router = useRouter();
  const { language, updateLanguage } = useSettings();
  const t = useT();

  // Already signed in? Skip the form entirely.
  useEffect(() => {
    if (isSignedIn) router.replace('/dashboard');
  }, [isSignedIn, router]);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        padding: 24,
        background: 'var(--ink, #14100c)',
      }}
    >
      <div
        role="group"
        aria-label={t('Language')}
        style={{
          display: 'flex',
          gap: 6,
          padding: 4,
          borderRadius: 12,
          background: 'rgba(255,255,255,0.06)',
        }}
      >
        {LANGUAGES.map((opt) => (
          <button
            key={opt.value}
            type="button"
            aria-pressed={language === opt.value}
            onClick={() => updateLanguage(opt.value)}
            style={{
              minHeight: 44,
              padding: '10px 18px',
              borderRadius: 9,
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 700,
              color: language === opt.value ? '#170a07' : 'rgba(255,255,255,0.75)',
              background: language === opt.value ? '#ef6b55' : 'transparent',
              transition: 'background 150ms ease-out, color 150ms ease-out',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <SignUpWidget onEnter={() => router.push('/chair')} redirectUrlComplete="/chair" />
    </main>
  );
}
