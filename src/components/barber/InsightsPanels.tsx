'use client';

// ============================================================
// The Insights tab's panels, lifted verbatim from the card builder when the
// dashboard grew tabs: the card's week-over-week numbers, upcoming
// appointments, and the chair-side inbox of cuts clients sent from the card.
// Chair-specific analytics (visits, chosen cuts) live in ChairInsights.
// ============================================================

import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { hairstyleBySlug } from '@/data/hairstyles';
import { formatEventTime } from '@/lib/calendarLinks';
import { useT, type TFunction } from '@/lib/i18n';

function timeAgo(t: TFunction, thenMs: number): string {
  const mins = Math.max(1, Math.round((Date.now() - thenMs) / 60_000));
  if (mins < 60) return t('{n}m ago', { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t('{n}h ago', { n: hours });
  return t('{n}d ago', { n: Math.round(hours / 24) });
}

// ── insights: is the card working? ──
export interface WeekTotals {
  views: number;
  tryOns: number;
  linkClicks: number;
  bookingClicks: number;
  /** Legacy: the card's old photo step. Nothing writes it any more. */
  selfieStarts: number;
  previews: number;
}

export function InsightsPanel({
  insights,
  totals,
  referralStats,
}: {
  insights?: { last7: WeekTotals; prev7: WeekTotals; topStyles: { slug: string; count: number }[] };
  totals?: { views: number; tryOns: number; linkClicks: number };
  referralStats?: { friendsJoined: number } | null;
}) {
  const t = useT();

  const last7 = insights?.last7;
  const prev7 = insights?.prev7;

  // Same accent scheme as the chair's tiles (see ChairInsights): traffic teal,
  // mirror coral, a finished take violet. Booking taps — the one that pays —
  // stays in plain ink, which is the loudest thing on the dark surface.
  const stats = [
    { value: last7?.views ?? 0, prev: prev7?.views ?? 0, label: t('Scans'), total: totals?.views ?? 0, accent: 'b' },
    { value: last7?.tryOns ?? 0, prev: prev7?.tryOns ?? 0, label: t('Try-ons'), total: totals?.tryOns ?? 0, accent: 'a' },
    { value: last7?.previews ?? 0, prev: prev7?.previews ?? 0, label: t('Previews finished'), total: undefined, accent: 'c' },
    { value: last7?.bookingClicks ?? 0, prev: prev7?.bookingClicks ?? 0, label: t('Booking taps'), total: undefined, accent: 'ink' },
  ];

  // A few plain-language reads on the numbers — insights, not a dashboard.
  const notes: string[] = [];
  if (last7) {
    const top = insights?.topStyles[0];
    const topCut = top ? hairstyleBySlug(top.slug) : undefined;
    if (topCut && top && top.count > 1) {
      notes.push(t('“{cut}” is your most-tried style.', { cut: t(topCut.label) }));
    }
    if (last7.bookingClicks > 0) {
      notes.push(t('Your booking link got {n} taps this week.', { n: last7.bookingClicks }));
    }
    // tryOn → preview is the whole funnel now that the card runs a live take:
    // a tap that never became a finished take is someone who backed out at the
    // camera, which is the thing a barber can actually do something about.
    if (last7.tryOns >= 3 && last7.previews < last7.tryOns / 2) {
      notes.push(t('Clients often leave before finishing a take — tell them it’s 30 seconds and they can watch it live.'));
    }
    if (prev7 && prev7.views > 0 && last7.views > prev7.views) {
      notes.push(t('Scans are up from last week ({a} → {b}).', { a: prev7.views, b: last7.views }));
    }
  }
  if ((referralStats?.friendsJoined ?? 0) > 0) {
    notes.push(t('{n} clients joined ShapeUp through your card.', { n: referralStats!.friendsJoined }));
  }

  return (
    <section className="barber-insights" aria-label={t('Insights')}>
      <div className="barber-builder-section-head">
        <span className="font-mono barber-builder-label">{t('This week')}</span>
      </div>
      <div className="barber-stats">
        {stats.map((s) => {
          const delta = s.value - s.prev;
          return (
            <div key={s.label} className={`barber-stat is-${s.accent}`}>
              <span className="barber-stat-value font-display">{s.value}</span>
              <span className="barber-stat-label font-mono">{s.label}</span>
              {delta !== 0 && (
                <span className={`barber-stat-delta font-mono ${delta > 0 ? 'is-up' : 'is-down'}`}>
                  {delta > 0 ? `+${delta}` : delta} {t('vs last week')}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {insights && insights.topStyles.length > 0 && (
        <div className="barber-top-styles">
          <span className="font-mono barber-builder-label">{t('Most-tried styles')}</span>
          <ul>
            {insights.topStyles.slice(0, 5).map((row) => {
              const cut = hairstyleBySlug(row.slug);
              if (!cut) return null;
              return (
                <li key={row.slug} className="font-sans">
                  <img src={`/hair-previews/${row.slug}.png`} alt="" width={28} height={28} loading="lazy" />
                  <span>{t(cut.label)}</span>
                  <span className="font-mono">{row.count}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {notes.length > 0 && (
        <ul className="barber-insight-notes">
          {notes.map((note) => (
            <li key={note} className="font-sans">{note}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── upcoming appointments booked through the card ──
export function BookingsPanel({ timezone }: { timezone: string }) {
  const t = useT();
  const bookings = useQuery(api.barberBooking.listMyBookings);
  const cancelBooking = useMutation(api.barberBooking.cancel);
  const [busyId, setBusyId] = useState<string | null>(null);

  const cancel = async (id: string, clientName: string) => {
    if (!window.confirm(t('Cancel {name}’s appointment? They’ll be emailed that the time is off.', { name: clientName }))) return;
    setBusyId(id);
    try {
      await cancelBooking({ bookingId: id as Id<'barberBookings'> });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="barber-insights" aria-label={t('Upcoming appointments')}>
      <div className="barber-builder-section-head">
        <span className="font-mono barber-builder-label">{t('Upcoming appointments')}</span>
      </div>
      {!bookings || bookings.length === 0 ? (
        <p className="font-sans" style={{ fontSize: 13, color: 'var(--smoke)', margin: 0, lineHeight: 1.5 }}>
          {t('Nothing on the books yet — slots are live on your card.')}
        </p>
      ) : (
        <ul className="barber-bookings">
          {bookings.map((b) => (
            <li key={b.id} className="barber-booking-row">
              <div className="barber-booking-when font-mono">{formatEventTime(b.startMs, timezone)}</div>
              <div className="barber-booking-who font-sans">
                <strong>{b.clientName}</strong>
                {b.service ? <span> · {b.service}</span> : null}
                {(b.clientPhone || b.clientEmail) ? (
                  <span className="barber-booking-contact"> · {b.clientPhone ?? b.clientEmail}</span>
                ) : null}
                {b.note ? <span className="barber-booking-note">“{b.note}”</span> : null}
              </div>
              <button
                type="button"
                className="chip-suggest is-danger"
                onClick={() => void cancel(b.id, b.clientName)}
                disabled={busyId === b.id}
              >
                {busyId === b.id ? t('Cancelling…') : t('Cancel')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── the chair-side inbox: cuts clients sent through the card ──
export function ClientRequestsPanel() {
  const t = useT();
  const sends = useQuery(api.barberTryOn.listMySends);
  if (!sends || sends.length === 0) return null;

  return (
    <section className="barber-insights" aria-label={t('Client requests')}>
      <div className="barber-builder-section-head">
        <span className="font-mono barber-builder-label">{t('Client requests')}</span>
        <span className="font-mono barber-builder-count">{sends.length}</span>
      </div>
      <p className="font-sans" style={{ fontSize: 12, color: 'var(--smoke)', margin: '0 0 10px', lineHeight: 1.5 }}>
        {t('Cuts clients sent from your card — what they want before they sit down.')}
      </p>
      <ul className="barber-sends">
        {sends.map((s) => (
          <li key={s.id} className="barber-send-row">
            <img src={s.imageUrl} alt={t('Client preview: {cut}', { cut: t(s.cutLabel) })} loading="lazy" width={64} height={64} />
            <div className="barber-send-body font-sans">
              <strong>{t(s.cutLabel)}</strong>
              {s.clientRequest && s.clientRequest !== s.cutLabel ? (
                <span className="barber-send-req">“{s.clientRequest}”</span>
              ) : null}
              <span className="barber-send-meta font-mono">
                {[s.clientEmail ?? s.clientPhone, timeAgo(t, s.createdAt)].filter(Boolean).join(' · ')}
              </span>
            </div>
            {s.videoUrl ? (
              <a className="chip-suggest" href={s.videoUrl} target="_blank" rel="noopener noreferrer">
                {t('View 360°')}
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
