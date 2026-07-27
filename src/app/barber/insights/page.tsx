'use client';

// /barber/insights — is any of it working? The card's week-over-week numbers,
// upcoming appointments, the chair-side inbox, and the chair's own analytics.

import { useQuery } from 'convex/react';
import Link from 'next/link';
import { api } from '@convex/_generated/api';
import ChairInsights from '@/components/barber/ChairInsights';
import {
  BookingsPanel,
  ClientRequestsPanel,
  InsightsPanel,
} from '@/components/barber/InsightsPanels';
import { useT } from '@/lib/i18n';

export default function BarberInsightsPage() {
  return <InsightsBody />;
}

function InsightsBody() {
  const t = useT();
  const mine = useQuery(api.barberPages.getMine);
  const referralStats = useQuery(api.users.getReferralStats);

  if (mine === undefined) {
    return <p className="bdash-muted font-sans">{t('Loading…')}</p>;
  }
  if (mine === null) {
    return (
      <div className="bdash-empty">
        <p className="font-sans">
          {t('Set up your barber card first — insights start once it’s live.')}
        </p>
        <Link href="/barber/card" className="chip-suggest">
          {t('Set up my card')}
        </Link>
      </div>
    );
  }

  return (
    <section className="bdash-page" aria-label={t('Insights')}>
      <header className="bdash-pagehead">
        <div>
          <h1 className="bdash-title font-display">
            <span className="hl-swipe-wrap">
              <span className="hl-swipe" aria-hidden />
              <span style={{ position: 'relative' }}>{t('Insights')}</span>
            </span>
          </h1>
          <p className="bdash-sub font-sans">
            {t('What your card and your chair did this week.')}
          </p>
        </div>
      </header>

      <ChairInsights />
      <InsightsPanel insights={mine.insights} totals={mine.totals} referralStats={referralStats} />
      {mine.booking?.enabled && <BookingsPanel timezone={mine.booking.timezone} />}
      <ClientRequestsPanel />
    </section>
  );
}
