'use client';

// The chair's loading state, drawn as the chair.
//
// A spinner on a black tablet says "wait" and nothing else — and when the
// station does arrive the whole layout snaps into place under the barber's
// thumb. Greying out the shapes that are about to appear says the same "wait"
// while also saying where the name form will be, so the first tap of a shift
// lands on a target that never moved.

import { useT } from '@/lib/i18n';

/** The whole station, before Clerk has said who the barber is. */
export default function ChairSkeleton() {
  const t = useT();

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
      </div>

      {/* The shapes are decoration; this is the part a screen reader gets. */}
      <span className="sr-only" role="status">{t('Loading…')}</span>
    </main>
  );
}
