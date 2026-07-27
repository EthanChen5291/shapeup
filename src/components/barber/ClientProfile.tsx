'use client';

// ============================================================
// One client's page: the visual history of their hair.
//
// Top to bottom it answers the barber's real questions in order:
//   who is this + how do I reach them → what do I always need to remember
//   about them (preferences) → what did we do each visit (the reference
//   strip: chosen take, angles, note, chips) → the raw footage (every take,
//   kept) → and, apart from everything else, the erase button that honours
//   the in-chair consent tap.
//
// Media comes back from listVisits/listTakes with URLs already signed, so
// this page is pure composition — no fetching logic of its own.
// ============================================================

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { ANGLE_SPECS } from '@/lib/chair/angles';
import { useT } from '@/lib/i18n';
import { initials, timeAgo } from './ClientsDirectory';

function visitDate(startedAt: number): string {
  return new Date(startedAt).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ClientProfile({ clientId }: { clientId: Id<'chairClients'> }) {
  const t = useT();
  const router = useRouter();
  const client = useQuery(api.chair.getClient, { clientId });
  const visits = useQuery(api.chair.listVisits, { clientId });
  const takes = useQuery(api.chair.listTakes, { clientId });
  const card = useQuery(api.chair.myCard);
  const updateNotes = useMutation(api.chair.updateClientNotes);
  const deleteClient = useMutation(api.chair.deleteClient);

  // Preferences: hydrate once from the loaded client, then the barber owns it.
  const [notesDraft, setNotesDraft] = useState('');
  const [notesHydrated, setNotesHydrated] = useState(false);
  const [notesState, setNotesState] = useState<'idle' | 'dirty' | 'saving' | 'saved'>('idle');
  useEffect(() => {
    if (!notesHydrated && client) {
      setNotesDraft(client.notes ?? '');
      setNotesHydrated(true);
    }
  }, [client, notesHydrated]);

  const saveNotes = useCallback(async () => {
    setNotesState('saving');
    try {
      await updateNotes({ clientId, notes: notesDraft });
      setNotesState('saved');
    } catch {
      setNotesState('dirty');
    }
  }, [clientId, notesDraft, updateNotes]);

  // Erase: bounded batches until the backend reports done, then leave the page.
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const erase = useCallback(async () => {
    setDeleting(true);
    try {
      for (let i = 0; i < 20; i += 1) {
        const { done } = await deleteClient({ clientId });
        if (done) break;
      }
      router.push('/barber/clients');
    } finally {
      setDeleting(false);
    }
  }, [clientId, deleteClient, router]);

  const [showAllTakes, setShowAllTakes] = useState(false);

  if (client === undefined) {
    return <p className="bdash-muted font-sans">{t('Loading…')}</p>;
  }
  if (client === null) {
    return (
      <div className="bdash-empty">
        <p className="font-sans">{t('That client isn’t in your book any more.')}</p>
        <Link href="/barber/clients" className="chip-suggest">
          ← {t('All clients')}
        </Link>
      </div>
    );
  }

  return (
    <section className="bdash-page" aria-label={client.name}>
      <Link href="/barber/clients" className="bdash-back font-mono">
        ← {t('All clients')}
      </Link>

      {/* ── header ── */}
      <header className="bdash-profilehead">
        <span className="bdash-monogram is-large font-display" aria-hidden>
          {initials(client.name)}
        </span>
        <div className="bdash-profilemain">
          <h1 className="bdash-title font-display">{client.name}</h1>
          <p className="bdash-sub font-sans">
            {[
              client.phone,
              t('Client since {date}', { date: visitDate(client.createdAt) }),
              client.fromCard ? t('Joined from your card') : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          <p className="bdash-consent font-mono">
            {client.consented
              ? t('Filming consent on file · {date}', {
                  date: visitDate(client.consentAt ?? client.createdAt),
                })
              : t('No filming consent yet — the chair will ask first')}
          </p>
        </div>
        <span className="bdash-client-when font-mono">
          {t('Last visit')} · {timeAgo(t, client.lastVisitAt)}
        </span>
      </header>

      {/* Contact + rebook, while they're still in the shop. */}
      <div className="bdash-actions">
        {client.phone && (
          <>
            <a className="chip-suggest" href={`tel:${client.phone}`}>
              {t('Call')}
            </a>
            <a className="chip-suggest" href={`sms:${client.phone}`}>
              {t('Text')}
            </a>
          </>
        )}
        {card?.bookingEnabled && (
          <a
            className="chip-suggest"
            href={`/b/${card.slug}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('Book their next visit ↗')}
          </a>
        )}
      </div>

      {/* ── standing preferences ── */}
      <div className="bdash-card">
        <div className="bdash-cardhead">
          <h2 className="bdash-cardtitle font-mono">{t('Preferences')}</h2>
          {notesState === 'saved' && <span className="bdash-savedchip font-mono">{t('Saved')}</span>}
        </div>
        <textarea
          className="barber-input font-sans"
          rows={2}
          maxLength={300}
          value={notesDraft}
          onChange={(e) => {
            setNotesDraft(e.target.value);
            setNotesState('dirty');
          }}
          placeholder={t('Prefers scissors over clippers. Sensitive around the ears.')}
          aria-label={t('Preferences')}
        />
        <button
          type="button"
          className="chip-suggest"
          onClick={() => void saveNotes()}
          disabled={notesState !== 'dirty'}
        >
          {notesState === 'saving' ? t('Saving…') : t('Save preferences')}
        </button>
      </div>

      {/* ── the reference strip: one entry per visit ── */}
      <div className="bdash-card">
        <div className="bdash-cardhead">
          <h2 className="bdash-cardtitle font-mono">{t('Visits')}</h2>
          {visits && visits.length > 0 && (
            <span className="bdash-count font-mono">{visits.length}</span>
          )}
        </div>

        {visits === undefined ? (
          <p className="bdash-muted font-sans">{t('Loading…')}</p>
        ) : !visits || visits.length === 0 ? (
          <p className="bdash-muted font-sans">
            {t('No visits on record yet — their first chair session will land here.')}
          </p>
        ) : (
          <ol className="bdash-visits">
            {visits.map((visit) => (
              <li key={visit.id} className="bdash-visit">
                <div className="bdash-visit-head">
                  <span className="bdash-visit-date font-sans">{visitDate(visit.startedAt)}</span>
                  <span className="bdash-visit-meta font-mono">
                    {[visit.serviceName, visit.chosenTake && t(visit.chosenTake.cutLabel)]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>

                {visit.chips && visit.chips.length > 0 && (
                  <ul className="bdash-chiprow" aria-label={t('Quick facts')}>
                    {visit.chips.map((chip) => (
                      <li key={chip} className="bdash-chip font-mono">
                        {chip.startsWith('#') ? chip : t(chip)}
                      </li>
                    ))}
                  </ul>
                )}
                {visit.note && <p className="bdash-visit-note font-sans">“{visit.note}”</p>}

                {visit.chosenTake && visit.chosenTake.angles.length > 0 ? (
                  <ul className="bdash-angles">
                    {visit.chosenTake.angles.map((angle) => {
                      const spec = ANGLE_SPECS.find((s) => s.key === angle.key);
                      return angle.url ? (
                        <li key={angle.key}>
                          <a href={angle.url} target="_blank" rel="noopener noreferrer">
                            <img
                              src={angle.url}
                              alt={t('{angle} reference for {name}', {
                                angle: spec ? t(spec.label) : angle.key,
                                name: client.name,
                              })}
                              loading="lazy"
                            />
                          </a>
                          <span className="font-mono">{spec ? t(spec.label) : angle.key}</span>
                        </li>
                      ) : null;
                    })}
                  </ul>
                ) : visit.chosenTake?.posterUrl ? (
                  <img
                    className="bdash-visit-poster"
                    src={visit.chosenTake.posterUrl}
                    alt={t(visit.chosenTake.cutLabel)}
                    loading="lazy"
                  />
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* ── every take, kept ── */}
      <div className="bdash-card">
        <div className="bdash-cardhead">
          <h2 className="bdash-cardtitle font-mono">{t('All takes')}</h2>
          {takes && takes.length > 0 && <span className="bdash-count font-mono">{takes.length}</span>}
        </div>
        {takes === undefined ? (
          <p className="bdash-muted font-sans">{t('Loading…')}</p>
        ) : !takes || takes.length === 0 ? (
          <p className="bdash-muted font-sans">{t('No takes recorded for this client.')}</p>
        ) : (
          <>
            <ul className="bdash-takes">
              {(showAllTakes ? takes : takes.slice(0, 6)).map((take) => (
                <li key={take.id} className={`bdash-take is-${take.status}`}>
                  {take.posterUrl ? (
                    <img src={take.posterUrl} alt={t(take.cutLabel)} loading="lazy" />
                  ) : (
                    <span className="bdash-take-blank" aria-hidden />
                  )}
                  <span className="bdash-take-label font-sans">{t(take.cutLabel)}</span>
                  <span className="bdash-take-meta font-mono">
                    {take.status === 'approved'
                      ? t('Approved')
                      : take.status === 'discarded'
                        ? t('Passed on')
                        : t('Take')}
                    {' · '}
                    {timeAgo(t, take.createdAt)}
                  </span>
                  {take.videoUrl && (
                    <a
                      className="chip-suggest"
                      href={take.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {t('Play the take')}
                    </a>
                  )}
                </li>
              ))}
            </ul>
            {takes.length > 6 && (
              <button
                type="button"
                className="chair-link"
                onClick={() => setShowAllTakes((v) => !v)}
              >
                {showAllTakes ? t('Show fewer') : t('Show all {n} takes', { n: takes.length })}
              </button>
            )}
          </>
        )}
      </div>

      {/* ── the other half of the consent tap ── */}
      <div className="bdash-danger">
        {confirming ? (
          <>
            <span className="font-sans">
              {t('Erase {name}’s takes, photos and record? This can’t be undone.', {
                name: client.name,
              })}
            </span>
            <button
              type="button"
              className="chair-danger-btn"
              onClick={() => void erase()}
              disabled={deleting}
            >
              {deleting ? t('Erasing…') : t('Erase everything')}
            </button>
            <button type="button" className="chip-suggest" onClick={() => setConfirming(false)}>
              {t('Keep')}
            </button>
          </>
        ) : (
          <button type="button" className="chair-danger-btn" onClick={() => setConfirming(true)}>
            {t('Delete this client’s data')}
          </button>
        )}
      </div>
    </section>
  );
}
