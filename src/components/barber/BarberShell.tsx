'use client';

// ============================================================
// The frame around the card builder — the one /barber page left now that the
// dashboard is gone and the chair is the barber app. No tabs: there is nothing
// to switch between any more, just the logo, the settings drawer, and the
// accent button into the chair (a mode you enter with a client, not a page
// you browse).
//
// Rendered from app/barber/layout.tsx so the header, Clerk's session and the
// settings drawer's card subscription stay mounted across navigations.
//
// Auth is gated here once (this repo gates in the component, not middleware)
// so the page below only ever renders for a signed-in barber.
// ============================================================

import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import SignUpWidget from '@/components/SignUpWidget';
import { LogoHomeLink } from '@/components/AppUI';
import { useT } from '@/lib/i18n';
import BarberSettings from './BarberSettings';

export default function BarberShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { isSignedIn, isLoaded } = useUser();

  return (
    <div className="bshell">
      <header className="bshell-top">
        <LogoHomeLink />
        {/* The right-hand pair. Settings is quiet furniture beside the chair —
            a gear, never a tab: it's a drawer you open and close, not a place
            you go. Signed-out visitors have nothing to configure yet. */}
        <div className="bshell-actions">
          {isSignedIn && <BarberSettings />}
          <Link
            href="/chair"
            className="bshell-chair btn btn-tomato"
            aria-label={t('Open the chair')}
            title={t('Open the chair')}
          >
            <EnterChairIcon />
          </Link>
        </div>
      </header>

      <main className="bshell-main">
        {!isLoaded ? null : isSignedIn ? children : <SignedOutPanel />}
      </main>
    </div>
  );
}

// The chair button carries no label — it's an arrow pointing into an
// isometric chair, i.e. "go sit down". Drawn as one SVG so the gap between
// the arrow and the chair stays fixed at every size.
export function EnterChairIcon() {
  return (
    <svg
      className="bshell-chair-icon"
      viewBox="0 0 44 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* arrow, pointing at the chair */}
      <path d="M1 12h12" />
      <path d="M9.5 8 13.5 12 9.5 16" />
      {/* isometric chair: seat, back panel, three visible legs */}
      <path d="M22 14 30 10 38 14 30 18Z" />
      <path d="M22 14V6l8-4v8" />
      <path d="M30 18v4M22 14v4M38 14v4" />
    </svg>
  );
}

function SignedOutPanel() {
  const t = useT();
  return (
    <div className="bshell-signedout">
      <h1 className="font-display">{t('Your barber card')}</h1>
      <p className="font-sans">
        {t('Sign in to build your card and run live try-ons in the chair.')}
      </p>
      <SignUpWidget onEnter={() => {}} redirectUrlComplete="/barber/card" />
    </div>
  );
}
