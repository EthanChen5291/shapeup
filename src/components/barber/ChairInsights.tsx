'use client';

// ============================================================
// The chair's own numbers: visits, takes, and the tried-vs-chosen gap —
// which cuts hit the mirror versus which ones people actually walked out
// with. That gap is data no booking app has, so it leads the Insights tab.
// ============================================================

import { useMemo } from 'react';
import { useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import { hairstyleBySlug } from '@/data/hairstyles';
import { useT } from '@/lib/i18n';
import { ActivityBars, TriedVsChosenBars, type CutRow } from './charts';

export default function ChairInsights() {
  const t = useT();
  const summary = useQuery(api.chair.weekSummary);
  const series = useQuery(api.chair.dailySeries);
  const budget = useQuery(api.chair.budgetStatus);

  // One row per cut that hit the mirror this week, chosen counts joined on.
  const cutRows: CutRow[] = useMemo(() => {
    if (!summary) return [];
    const chosenByKey = new Map(
      summary.topChosen.map((c) => [c.cutSlug ?? c.cutLabel.toLowerCase(), c.count]),
    );
    return summary.topTried.map((c) => ({
      label: (c.cutSlug ? hairstyleBySlug(c.cutSlug)?.label : undefined) ?? c.cutLabel,
      tried: c.count,
      chosen: chosenByKey.get(c.cutSlug ?? c.cutLabel.toLowerCase()) ?? 0,
    }));
  }, [summary]);

  if (!summary) return null;

  const approvalRate =
    summary.takesThisWeek > 0
      ? Math.round((summary.approvedThisWeek / summary.takesThisWeek) * 100)
      : null;

  // Each tile carries its own hue so four numbers in a row don't read as one
  // block. Where a tile names something a chart below also plots, it wears that
  // series' color — the teal tile is the teal bars — and the odd one out sits
  // in plain ink rather than inventing a fourth hue the dark surface can't hold
  // (see the palette note in charts.tsx).
  const stats = [
    { value: String(summary.visitsThisWeek), label: t('Chair visits'), accent: 'b' },
    { value: String(summary.clientsThisWeek), label: t('Clients seen'), accent: 'ink' },
    { value: String(summary.returningThisWeek), label: t('Came back'), accent: 'c' },
    { value: approvalRate === null ? '—' : `${approvalRate}%`, label: t('Takes approved'), accent: 'a' },
  ];

  return (
    <section className="barber-insights" aria-label={t('The chair this week')}>
      <div className="barber-builder-section-head">
        <span className="font-mono barber-builder-label">{t('The chair this week')}</span>
        {budget && (
          <span className="font-mono barber-builder-count">
            {t('{n} takes left today', { n: budget.takesLeftToday })}
          </span>
        )}
      </div>

      <div className="barber-stats">
        {stats.map((s) => (
          <div key={s.label} className={`barber-stat is-${s.accent}`}>
            <span className="barber-stat-value font-display">{s.value}</span>
            <span className="barber-stat-label font-mono">{s.label}</span>
          </div>
        ))}
      </div>

      {series && series.length > 0 && (
        <ActivityBars
          points={series.map((p) => ({ dayKey: p.dayKey, takes: p.takes, visits: p.visits }))}
        />
      )}

      {cutRows.length > 0 ? (
        <TriedVsChosenBars rows={cutRows} />
      ) : (
        <p className="bdash-muted font-sans">{t('No takes yet this week.')}</p>
      )}

      {summary.takesThisWeek > 0 && summary.approvedThisWeek === 0 && (
        <ul className="barber-insight-notes">
          <li className="font-sans">
            {t('Takes are running but none got kept — when a look lands, “that’s the one” files the reference for next visit.')}
          </li>
        </ul>
      )}
    </section>
  );
}
