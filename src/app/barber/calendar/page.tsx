'use client';

// /barber/calendar — the week's appointments as a real calendar grid.
// Slots and working hours come from the card's booking config; the grid's
// one action is seating today's client in the chair.

import Link from 'next/link';
import { useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import WeekCalendar from '@/components/barber/WeekCalendar';
import { useT } from '@/lib/i18n';

export default function BarberCalendarPage() {
  return <CalendarBody />;
}

function CalendarBody() {
  const t = useT();
  const mine = useQuery(api.barberPages.getMine);

  if (mine === undefined) {
    return <p className="bdash-muted font-sans">{t('Loading…')}</p>;
  }
  if (mine === null) {
    return (
      <div className="bdash-empty">
        <p className="font-sans">
          {t('Set up your barber card first — appointments book through it.')}
        </p>
        <Link href="/barber/card" className="chip-suggest">
          {t('Set up my card')}
        </Link>
      </div>
    );
  }

  return (
    <section className="bdash-page" aria-label={t('Calendar')}>
      <WeekCalendar
        bookingDays={mine.booking?.days ?? []}
        bookingEnabled={Boolean(mine.booking?.enabled)}
      />
    </section>
  );
}
