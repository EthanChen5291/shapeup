'use client';

// The chair's loading state, drawn as the chair.
//
// A spinner on a black tablet says "wait" and nothing else — and when the
// station does arrive the whole layout snaps into place under the barber's
// thumb. Greying out the shapes that are about to appear says the same "wait"
// while also saying where the name form will be, so the first tap of a shift
// lands on a target that never moved.

import { useT } from '@/lib/i18n';

/** The recent list — a "Recent" label and a few client rows. */
export function ChairRosterSkeleton({ rows = 3 }: { rows?: number }) {
  const t = useT();

  return (
    <>
      <div className="chair-skel-group" aria-hidden>
        <span className="chair-skel chair-skel-section" />
        <ul className="chair-list">
          {Array.from({ length: rows }, (_, i) => (
            <li key={i}>
              {/* The row keeps its real shape — border, radius, height — and
                  only its contents shimmer, so nothing shifts when the names
                  land in it. */}
              <div className="chair-skel-row" style={{ animationDelay: `${i * 90}ms` }}>
                <span className="chair-skel chair-skel-name" />
                <span className="chair-skel chair-skel-meta" />
              </div>
            </li>
          ))}
        </ul>
      </div>
      {/* The shapes are decoration; this is the part a screen reader gets. */}
      <span className="sr-only" role="status">{t('Loading…')}</span>
    </>
  );
}

/** The whole station, before Clerk has said who the barber is. */
export default function ChairSkeleton() {
  return (
    <main className="chair" aria-busy="true">
      <header className="chair-head">
        <span className="chair-skel chair-skel-back" aria-hidden />
        <span className="chair-skel chair-skel-title" aria-hidden />
        <span className="chair-skel chair-skel-budget" aria-hidden />
      </header>

      <div className="chair-panel">
        <div className="chair-skel chair-skel-heading" aria-hidden />
        <div className="chair-skel chair-skel-input" aria-hidden />
        <div className="chair-skel chair-skel-input" aria-hidden />
        <div className="chair-skel chair-skel-btn" aria-hidden />
        <ChairRosterSkeleton />
      </div>
    </main>
  );
}
