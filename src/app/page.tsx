'use client';

// ============================================================
// / — the front door, and the site is barber-first: signed-in users land on
// the barber dashboard, signed-out visitors get the barber pitch. The
// consumer try-on funnel still exists — clients arrive through a barber's
// card (/b/<slug>) or the studio landing kept at /try — it just isn't the
// front door any more.
// ============================================================

import { useEffect, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { useRouter } from 'next/navigation';
import { WaitlistPage } from '@/components/WaitlistPage';
import ForBarbersPage from '@/components/ForBarbersPage';
import { captureReferralFromUrl, clearPendingReferralCode, getPendingReferralCode } from '@/lib/referral';

export default function Home() {
  const { isSignedIn, isLoaded } = useUser();
  const router = useRouter();
  const getOrCreate = useMutation(api.users.getOrCreate);
  useQuery(api.users.getMe);

  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); captureReferralFromUrl(); }, []);

  useEffect(() => {
    if (isSignedIn) {
      getOrCreate({ referralCode: getPendingReferralCode() })
        .then(() => clearPendingReferralCode())
        .catch((err) => console.error('[Home] getOrCreate FAILED:', err));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  // Signed-in users go straight to work: the chair.
  useEffect(() => {
    if (isSignedIn) router.push('/chair');
  }, [isSignedIn, router]);

  // ── Waitlist gate ──
  const isWaitlistMode = process.env.NEXT_PUBLIC_WAITLIST_MODE === '1';
  const isTargetDomain = mounted && (
    window.location.hostname === 'nomorebadhaircuts.com' ||
    window.location.hostname === 'www.nomorebadhaircuts.com' ||
    process.env.NODE_ENV === 'development'
  ) && window.location.hostname !== 'dev.nomorebadhaircuts.com';
  if (isWaitlistMode && !mounted) return null;
  if (isWaitlistMode && isTargetDomain) return <WaitlistPage />;

  // Don't flash the pitch while Clerk is still resolving the session, or for
  // signed-in users who are about to be pushed to /barber.
  if (!isLoaded || isSignedIn) {
    return null;
  }

  return <ForBarbersPage />;
}
