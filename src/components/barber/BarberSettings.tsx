'use client';

// ============================================================
// The dashboard's settings — a gear in the shell header, opening one popover.
//
// Deliberately five controls, not a settings page. The test for inclusion was
// "would a barber reach for this mid-day, between clients?" — anything that's
// really card content (name, bio, services, working hours) stays in the Card
// builder, where it's edited beside a live preview. So what's left is the shop
// floor's own knobs:
//
//   * Language — the chair is handed to the person sitting in it, so this is a
//     client-facing setting, not a personal one. First, and always visible.
//   * Clock — 12h vs 24h. Every appointment surface reads from it.
//   * Card live / Taking appointments — the two switches a barber actually
//     flips on a given day ("we're full", "I'm off this week"). They write the
//     same fields the builder does, so the builder stays the single owner of
//     the config underneath; only the flag moves from here.
//   * Improve the model — the chair records real clients' faces, so the
//     training opt-out belongs where the barber works, not buried in the
//     consumer app's settings floor.
//
// Sign out sits below a rule, separated from the toggles: shop tablets are
// shared, so leaving needs to be reachable, and destructive-ish actions don't
// share space with switches you flip casually.
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useClerk } from '@clerk/nextjs';
import { useMutation, useQuery } from 'convex/react';
import { presentableError } from '@/lib/errors';
import { api } from '@convex/_generated/api';
import { useSettings } from '@/contexts/SettingsContext';
import { useT } from '@/lib/i18n';

const LANGUAGES: { value: string; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'es', label: 'ES' },
  { value: 'ja', label: '日本' },
];

export default function BarberSettings() {
  const t = useT();
  const { signOut } = useClerk();
  const { language, clock24, aiTrainingOptOut, updateLanguage, updateClock24, updateAiTrainingOptOut } =
    useSettings();

  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const card = useQuery(api.barberPages.getMine);
  const setPublished = useMutation(api.barberPages.setPublished);
  const setBookingEnabled = useMutation(api.barberPages.setBookingEnabled);

  // Escape closes and hands focus back to the gear; a click anywhere else
  // dismisses. Both only while open, so the shell carries no idle listeners.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  // Mutations here are one flag each, so a failure has nothing to roll back —
  // the switch is driven by the query, which simply never changes.
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(t(presentableError(err, 'Something went wrong. Please try again.')));
    }
  }, [t]);

  const hasCard = Boolean(card);
  const hasHours = Boolean(card?.booking && card.booking.days.length > 0);

  return (
    <div className="bset" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`bset-trigger${open ? ' is-on' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t('Settings')}
        title={t('Settings')}
        onClick={() => setOpen((v) => !v)}
      >
        <GearIcon />
      </button>

      {open && (
        <div className="bset-panel" role="dialog" aria-label={t('Settings')}>
          <Row label={t('Language')} hint={t('Also what the chair shows your client')}>
            <div className="bset-seg" role="group" aria-label={t('Language')}>
              {LANGUAGES.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`bset-segbtn font-mono${language === opt.value ? ' is-on' : ''}`}
                  aria-pressed={language === opt.value}
                  onClick={() => updateLanguage(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </Row>

          <Row label={t('Clock')} hint={t('How appointment times read')}>
            <div className="bset-seg" role="group" aria-label={t('Clock')}>
              <button
                type="button"
                className={`bset-segbtn font-mono${!clock24 ? ' is-on' : ''}`}
                aria-pressed={!clock24}
                onClick={() => updateClock24(false)}
              >
                {t('12h')}
              </button>
              <button
                type="button"
                className={`bset-segbtn font-mono${clock24 ? ' is-on' : ''}`}
                aria-pressed={clock24}
                onClick={() => updateClock24(true)}
              >
                {t('24h')}
              </button>
            </div>
          </Row>

          <div className="bset-rule" />

          <Row
            label={t('Card is live')}
            hint={hasCard ? t('Clients can open /b/{slug}', { slug: card!.slug }) : t('No card yet')}
          >
            <Switch
              on={Boolean(card?.published)}
              disabled={!hasCard}
              label={t('Card is live')}
              onToggle={() => run(() => setPublished({ published: !card!.published }))}
            />
          </Row>

          <Row
            label={t('Taking appointments')}
            hint={hasHours ? t('Booking on your card') : t('Set working hours on your card first')}
          >
            <Switch
              on={Boolean(card?.booking?.enabled)}
              disabled={!hasHours}
              label={t('Taking appointments')}
              onToggle={() => run(() => setBookingEnabled({ enabled: !card!.booking!.enabled }))}
            />
          </Row>

          <Row label={t('Improve the model')} hint={t('Chair takes help train future cuts')}>
            <Switch
              on={!aiTrainingOptOut}
              label={t('Improve the model')}
              onToggle={() => updateAiTrainingOptOut(!aiTrainingOptOut)}
            />
          </Row>

          {error && (
            <p role="alert" className="bset-error font-sans">
              {error}
            </p>
          )}

          <div className="bset-rule" />

          <div className="bset-foot">
            <Link href="/barber/card" className="bset-link font-mono" onClick={() => setOpen(false)}>
              {t('Edit card')}
            </Link>
            <button type="button" className="bset-signout font-mono" onClick={() => signOut()}>
              {t('Sign out')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bset-row">
      <span className="bset-rowtext">
        <span className="bset-label font-sans">{label}</span>
        <span className="bset-hint font-sans">{hint}</span>
      </span>
      {children}
    </div>
  );
}

// A switch, not a checkbox: these are settings that take effect the moment
// they move, and there is no Save button on this panel.
function Switch({
  on,
  label,
  disabled = false,
  onToggle,
}: {
  on: boolean;
  label: string;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      className={`bset-switch${on ? ' is-on' : ''}`}
      onClick={onToggle}
    >
      <span className="bset-knob" />
    </button>
  );
}

function GearIcon() {
  // A cog, not a sun — the toothed body plus a hub, matching the consumer
  // dashboard's settings glyph. Same 1.9px-stroke, 24-box family as the rest
  // of this dashboard's icons.
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}
