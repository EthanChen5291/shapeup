'use client';

// ============================================================
// The barber dashboard's shell: one dark-studio frame around every /barber
// page (always dark — it pairs with the chair; see isDarkOnlyRoute in
// SettingsContext). Tabs are the dashboard's map — Today (the working day),
// Clients (the book), Card (the public page), Insights (is it working) — and
// the chair deliberately is NOT a tab: it's the accent button, because it's a
// mode you enter with a client, not a page you browse.
//
// Rendered from app/barber/layout.tsx, NOT from each page, so switching tabs
// swaps only the panel underneath: the header, Clerk's session and the
// settings drawer's card subscription all stay mounted, which is what makes
// the second visit to a tab arrive with its data already in hand.
//
// Auth is gated here once (this repo gates in the component, not middleware)
// so each tab page only ever renders for a signed-in barber.
// ============================================================

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useUser } from '@clerk/nextjs';
import SignUpWidget from '@/components/SignUpWidget';
import { LogoHomeLink } from '@/components/AppUI';
import { useT } from '@/lib/i18n';
import BarberSettings from './BarberSettings';

export type BarberTab = 'today' | 'calendar' | 'clients' | 'card' | 'insights';

const TABS: { key: BarberTab; href: string; label: string }[] = [
  { key: 'today', href: '/barber', label: 'Today' },
  { key: 'calendar', href: '/barber/calendar', label: 'Calendar' },
  { key: 'clients', href: '/barber/clients', label: 'Clients' },
  { key: 'card', href: '/barber/card', label: 'Card' },
  { key: 'insights', href: '/barber/insights', label: 'Insights' },
];

/**
 * Which tab a URL belongs to — longest matching href wins, so a nested page
 * like /barber/clients/<id> still lights up Clients. Derived from the path
 * rather than passed down, because the shell outlives the page it frames.
 */
export function tabForPath(pathname: string | null): BarberTab {
  let best: BarberTab = 'today';
  let bestLength = 0;
  for (const tab of TABS) {
    if (!pathname) break;
    const hit = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
    if (hit && tab.href.length > bestLength) {
      best = tab.key;
      bestLength = tab.href.length;
    }
  }
  return best;
}

export default function BarberShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const { isSignedIn, isLoaded } = useUser();
  const pathname = usePathname();
  const active = tabForPath(pathname);

  // The tab you just tapped lights up on the tap, not when the next page
  // finishes arriving. Without this the pills sit dead for however long the
  // route takes and the tap reads as dropped — so the highlight moves
  // optimistically and the real pathname takes it back over on arrival.
  const [pending, setPending] = useState<BarberTab | null>(null);
  useEffect(() => setPending(null), [pathname]);
  const lit = pending ?? active;

  return (
    <div className="bshell">
      {/* One header row: logo, then the tabs sitting beside it, then the chair
          pinned right. On narrow screens the tabs drop to their own line. */}
      <header className="bshell-top">
        <LogoHomeLink />
        <nav className="bshell-nav" aria-label={t('Dashboard sections')}>
          {TABS.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              className={`bshell-tab${lit === tab.key ? ' is-on' : ''}${
                pending === tab.key ? ' is-pending' : ''
              }`}
              aria-current={active === tab.key ? 'page' : undefined}
              // New tab / new window is not a navigation here — leaving the
              // highlight alone keeps the pills honest about where you are.
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                setPending(tab.key === active ? null : tab.key);
              }}
            >
              {t(tab.label)}
            </Link>
          ))}
        </nav>
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
// the arrow and the chair stays fixed at every size. Exported because every
// "into the chair" control uses this same mark (see TodayView's appointment
// rows) — one glyph means one meaning.
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
      <h1 className="font-display">{t('Your barber dashboard')}</h1>
      <p className="font-sans">
        {t('Sign in to run the chair, keep every client’s reference shots, and manage your card.')}
      </p>
      <SignUpWidget onEnter={() => {}} redirectUrlComplete="/barber" />
    </div>
  );
}
