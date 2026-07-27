'use client';

// ============================================================
// Today — the dashboard's front desk. One glance answers: who's booked, who
// just sat down, and is the chair ready. The primary action on this page is
// always the same one: open the chair.
//
// Bookings come from the card's native scheduler; the walk-in list is the
// chair roster. "Seat in the chair" hands a booked client straight to the
// station (see /chair?client=), so a booking and a walk-in end up as the same
// thing: a chairClients row with today's visit on it.
// ============================================================

import { useMemo } from 'react';
import Link from 'next/link';
import { useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import { useT, localeFor } from '@/lib/i18n';
import { clockHour12, useSettings } from '@/contexts/SettingsContext';
import { buildDayPulse } from '@/lib/chair/pulse';
import { DayPulseLines } from './charts';
import { EnterChairIcon } from './BarberShell';
import { initials, timeAgo } from './ClientsDirectory';

// These rows are today's only, so the date is noise — show the clock alone,
// split so the numerals can carry the row and the meridiem can sit under them.
// A 24h locale has no dayPeriod part; the meridiem just comes back empty.
function clockParts(
  ms: number,
  timeZone: string | undefined,
  hour12: boolean | undefined,
): { time: string; meridiem: string } {
  const parts = new Intl.DateTimeFormat(undefined, {
    ...(timeZone ? { timeZone } : {}),
    hour: 'numeric',
    minute: '2-digit',
    hour12,
  }).formatToParts(new Date(ms));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    time: `${part('hour')}:${part('minute')}`,
    meridiem: part('dayPeriod').toUpperCase(),
  };
}

function isToday(ms: number): boolean {
  const day = new Date(ms);
  const now = new Date();
  return (
    day.getFullYear() === now.getFullYear() &&
    day.getMonth() === now.getMonth() &&
    day.getDate() === now.getDate()
  );
}

export default function TodayView() {
  const t = useT();
  const { language, clock24 } = useSettings();
  const mine = useQuery(api.barberPages.getMine);
  const bookings = useQuery(api.barberBooking.listMyBookings);
  const clients = useQuery(api.chair.listClients);
  const budget = useQuery(api.chair.budgetStatus);
  const pulse = useQuery(api.chair.visitPulse);

  // Bucketed once per data change, not per render: `Date.now()` inside the
  // build would otherwise make every render a new object.
  const dayPulse = useMemo(() => (pulse ? buildDayPulse(pulse, Date.now()) : null), [pulse]);

  const todaysBookings = useMemo(
    () => (bookings ?? []).filter((b) => isToday(b.startMs)).sort((a, b) => a.startMs - b.startMs),
    [bookings],
  );
  const timezone = mine?.booking?.timezone;

  // The page title: the actual date, in the barber's language. "Today" is the
  // nav tab's job; up here the date itself is the heading.
  const dateLine = new Date().toLocaleDateString(localeFor(language), {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  // A barber without a card yet gets pointed at the one thing to do first.
  if (mine === null) {
    return (
      <section className="bdash-page" aria-label={t('Today')}>
        <header className="bdash-pagehead">
          <div>
            <h1 className="bdash-title font-display">{t('Welcome')}</h1>
            <p className="bdash-sub font-sans">
              {t('Set up your barber card first — it’s your public page, and it’s what the chair files clients under.')}
            </p>
          </div>
        </header>
        <Link href="/barber/card" className="btn btn-tomato bdash-cta">
          {t('Set up my card')}
        </Link>
      </section>
    );
  }

  return (
    <section className="bdash-page" aria-label={t('Today')}>
      <header className="bdash-pagehead">
        <div>
          <h1 className="bdash-title font-display">{dateLine}</h1>
        </div>
        {budget && (
          <span
            className={`bdash-budget font-mono${budget.takesLeftToday <= 3 ? ' is-low' : ''}`}
            title={t('Live takes left today')}
          >
            {t('{n} takes left today', { n: budget.takesLeftToday })}
          </span>
        )}
      </header>

      <div className="bdash-grid">
        {/* ── the chair: how the day is running, and the way into it ── */}
        <div className="bdash-card is-chair">
          <h2 className="bdash-cardtitle font-mono">{t('The chair')}</h2>
          {pulse === undefined ? (
            <p className="bdash-muted font-sans">{t('Loading…')}</p>
          ) : !dayPulse || (dayPulse.todayTotal === 0 && dayPulse.activeDays === 0) ? (
            // Nobody's sat down yet, ever — a flat chart of zeros says nothing,
            // so the card goes back to explaining what the chair is for.
            <p className="bdash-muted font-sans">
              {t('Live mirror, reference angles, filed under the client’s name — about a minute per customer.')}
            </p>
          ) : (
            <DayPulseLines pulse={dayPulse} />
          )}
          <Link href="/chair" className="btn btn-tomato bdash-cta">
            {t('Open the chair')}
          </Link>
        </div>

        {/* ── today's appointments ── */}
        <div className="bdash-card">
          <div className="bdash-cardhead">
            <h2 className="bdash-cardtitle font-mono">{t('Appointments today')}</h2>
            {todaysBookings.length > 0 && (
              <span className="bdash-count font-mono">{todaysBookings.length}</span>
            )}
          </div>
          {bookings === undefined ? (
            <p className="bdash-muted font-sans">{t('Loading…')}</p>
          ) : todaysBookings.length === 0 ? (
            <p className="bdash-muted font-sans">
              {mine?.booking?.enabled
                ? t('Nothing on the books today — walk-ins go straight to the chair.')
                : t('Booking is off. Turn it on in your card to take appointments here.')}
            </p>
          ) : (
            <ul className="bdash-appts">
              {todaysBookings.map((b) => {
                const clock = clockParts(b.startMs, timezone, clockHour12(clock24));
                return (
                  <li key={b.id} className="bdash-appt">
                    <span className="bdash-appt-clock">
                      <span className="bdash-appt-hour">{clock.time}</span>
                      {clock.meridiem ? (
                        <span className="bdash-appt-mer font-mono">{clock.meridiem}</span>
                      ) : null}
                    </span>
                    <span className="bdash-appt-who font-sans">
                      <strong className="bdash-appt-name">{b.clientName}</strong>
                      {b.service ? <span className="bdash-appt-service">{b.service}</span> : null}
                      {b.note ? <span className="bdash-appt-note">“{b.note}”</span> : null}
                    </span>
                    {/* Icon-only, the same arrow-into-chair mark as the header
                        button — the row already says who and when, so the
                        action just needs to be recognizable, not read. */}
                    <Link
                      className="chip-suggest bdash-appt-seat"
                      href={`/chair?name=${encodeURIComponent(b.clientName)}${b.clientPhone ? `&phone=${encodeURIComponent(b.clientPhone)}` : ''}&booking=${b.id}`}
                      aria-label={t('Seat in the chair')}
                      title={t('Seat in the chair')}
                    >
                      <EnterChairIcon />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ── recent clients ── */}
        <div className="bdash-card">
          <div className="bdash-cardhead">
            <h2 className="bdash-cardtitle font-mono">{t('Recent clients')}</h2>
            <Link href="/barber/clients" className="bdash-cardlink font-mono">
              {t('All clients')} →
            </Link>
          </div>
          {clients === undefined ? (
            <p className="bdash-muted font-sans">{t('Loading…')}</p>
          ) : !clients || clients.length === 0 ? (
            <p className="bdash-muted font-sans">
              {t('Nobody in the chair yet. Tap “Next client” when someone sits down.')}
            </p>
          ) : (
            <ul className="bdash-recent">
              {clients.slice(0, 6).map((c) => (
                <li key={c.id}>
                  <Link href={`/barber/clients/${c.id}`} className="bdash-recent-row">
                    <span className="bdash-monogram font-display" aria-hidden>
                      {initials(c.name)}
                    </span>
                    <span className="bdash-client-name font-sans">{c.name}</span>
                    <span className="bdash-client-when font-mono">{timeAgo(t, c.lastVisitAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
