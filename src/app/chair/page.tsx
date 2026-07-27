'use client';

// /chair — the barber's in-chair station.
//
// A separate route from /barber on purpose. The builder is something a barber
// sets up once at home; the chair is a tool they open on a tablet mid-shift and
// never scroll. Sharing a page would have meant the thing they use forty times
// a day living below the thing they use once.
//
// Signed-out visitors get the barber sign-in rather than a 404 — the QR on the
// mirror and the link in the dashboard both land here, and "who are you" is a
// better answer than "nothing here".

import { Suspense } from 'react';
import Link from 'next/link';
import { useUser } from '@clerk/nextjs';
import SignUpWidget from '@/components/SignUpWidget';
import ChairStation from '@/components/chair/ChairStation';
import ChairSkeleton from '@/components/chair/ChairSkeleton';
import { useT } from '@/lib/i18n';

// ChairStation reads ?name=&phone=&booking= (the Today view's "Seat in the
// chair" handoff) via useSearchParams, which Next requires behind Suspense.
export default function ChairPage() {
  return (
    <Suspense fallback={<ChairSkeleton />}>
      <ChairGate />
    </Suspense>
  );
}

function ChairGate() {
  const { isSignedIn, isLoaded } = useUser();
  const t = useT();

  // Greyed-out station rather than a spinner: the wait is short and the layout
  // is known, so showing it is more use than showing that we're busy.
  if (!isLoaded) return <ChairSkeleton />;

  if (!isSignedIn) {
    return (
      <main className="chair chair-boot">
        <div className="chair-panel">
          <h1 className="chair-title">{t('Chair mode')}</h1>
          <p className="chair-muted font-sans">
            {t('Sign in with your barber account to run live try-ons in the chair.')}
          </p>
          <SignUpWidget onEnter={() => {}} redirectUrlComplete="/chair" />
          <Link href="/barber/card" className="chair-link">
            {t('Set up a barber card first')}
          </Link>
        </div>
      </main>
    );
  }

  return <ChairStation />;
}
