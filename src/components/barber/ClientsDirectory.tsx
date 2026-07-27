'use client';

// ============================================================
// The book: every client who has sat in this barber's chair (or tried a cut
// from their card), searchable, newest visit first. Each row opens the
// client's profile — the reference strip, notes, and history live there, not
// here, so this list stays fast to scan between two customers.
// ============================================================

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import { useT, type TFunction } from '@/lib/i18n';

export function timeAgo(t: TFunction, thenMs: number): string {
  const mins = Math.max(1, Math.round((Date.now() - thenMs) / 60_000));
  if (mins < 60) return t('{n}m ago', { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t('{n}h ago', { n: hours });
  return t('{n}d ago', { n: Math.round(hours / 24) });
}

/** Two-letter monogram for a client with no photo on file. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0]?.[1] ?? '');
  return (first + second).toUpperCase();
}

export default function ClientsDirectory() {
  const t = useT();
  const clients = useQuery(api.chair.listClients);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!clients) return clients;
    const needle = search.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter(
      (c) => c.name.toLowerCase().includes(needle) || (c.phone ?? '').includes(needle),
    );
  }, [clients, search]);

  return (
    <section className="bdash-page" aria-label={t('Clients')}>
      <header className="bdash-pagehead">
        <div className="bdash-titlerow">
          <h1 className="bdash-title font-display">
            <span className="hl-swipe-wrap">
              <span className="hl-swipe" aria-hidden />
              <span style={{ position: 'relative' }}>{t('Clients')}</span>
            </span>
          </h1>
          {clients && clients.length > 0 && (
            <span key={clients.length} className="count-ticket font-mono">
              № {String(clients.length).padStart(2, '0')}
            </span>
          )}
        </div>
      </header>

      {clients === null && (
        <div className="bdash-empty">
          <p className="font-sans">
            {t('Set up your barber card first — that’s what the chair files clients under.')}
          </p>
          <Link href="/barber/card" className="chip-suggest">
            {t('Set up my card')}
          </Link>
        </div>
      )}

      {clients !== null && (
        <>
          <input
            className="barber-input bdash-search font-sans"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('Search by name or phone')}
            aria-label={t('Search clients')}
          />

          {clients === undefined ? (
            <p className="bdash-muted font-sans">{t('Loading…')}</p>
          ) : filtered && filtered.length === 0 ? (
            <div className="bdash-empty">
              <p className="font-sans">
                {search
                  ? t('No client matches “{q}”.', { q: search })
                  : t('Nobody in the chair yet. Tap “Next client” when someone sits down.')}
              </p>
              {!search && (
                <Link href="/chair" className="chip-suggest">
                  {t('Open the chair')}
                </Link>
              )}
            </div>
          ) : (
            <ul className="bdash-clients">
              {(filtered ?? []).map((c) => (
                <li key={c.id}>
                  <Link href={`/barber/clients/${c.id}`} className="bdash-client-row">
                    <span className="bdash-monogram font-display" aria-hidden>
                      {initials(c.name)}
                    </span>
                    <span className="bdash-client-main">
                      <span className="bdash-client-name font-sans">{c.name}</span>
                      <span className="bdash-client-meta font-mono">
                        {[c.phone, c.notes ? t('Notes on file') : null]
                          .filter(Boolean)
                          .join(' · ') || t('Walk-in')}
                      </span>
                    </span>
                    <span className="bdash-client-when font-mono">{timeAgo(t, c.lastVisitAt)}</span>
                    <span className="bdash-chevron" aria-hidden>
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
