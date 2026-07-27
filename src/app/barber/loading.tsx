'use client';

// The dashboard's between-tabs state, and the reason a tab switch commits the
// instant it's tapped: with a loading boundary here React can swap the panel
// straight away and fill it while the next tab's code and data arrive, instead
// of holding the old tab on screen until everything has landed.
//
// Drawn as the shape of a tab — a title row and a couple of cards — for the
// same reason as ChairSkeleton: greying out what's about to appear says "wait"
// while also saying where it will be, so nothing jumps when it lands.

import { useT } from '@/lib/i18n';

export default function BarberTabLoading() {
  const t = useT();

  return (
    /* Deliberately not .bdash-page: that class means the real working
       surface, and e2e asserts it never renders for a signed-out visitor. */
    <div className="bshell-skel-page" aria-busy="true">
      <div className="bshell-skel-head" aria-hidden>
        <span className="bshell-skel bshell-skel-title" />
        <span className="bshell-skel bshell-skel-action" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="bshell-skel-card" style={{ animationDelay: `${i * 90}ms` }} aria-hidden>
          <span className="bshell-skel bshell-skel-line" />
          <span className="bshell-skel bshell-skel-line is-short" />
        </div>
      ))}
      {/* The shapes are decoration; this is the part a screen reader gets. */}
      <span className="sr-only" role="status">{t('Loading…')}</span>
    </div>
  );
}
