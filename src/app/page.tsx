'use client';

// ============================================================
// / — the front door opens straight onto the chair: signed-out visitors get
// the chair's sign-in gate (styled like the rest of the chair UI), signed-in
// barbers get Lucy's name + phone screen. The barber pitch lives at
// /for-barbers; the consumer funnel still enters through a barber's card
// (/b/<slug>) or the studio landing at /try.
// ============================================================

import { useEffect, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { useRouter } from 'next/navigation';
import { WaitlistPage } from '@/components/WaitlistPage';
import { captureReferralFromUrl, clearPendingReferralCode, getPendingReferralCode } from '@/lib/referral';

export default function Home() {
  const { isSignedIn } = useUser();
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

  // ── Waitlist gate ──
  const isWaitlistMode = process.env.NEXT_PUBLIC_WAITLIST_MODE === '1';
  const isTargetDomain = mounted && (
    window.location.hostname === 'nomorebadhaircuts.com' ||
    window.location.hostname === 'www.nomorebadhaircuts.com' ||
    process.env.NODE_ENV === 'development'
  ) && window.location.hostname !== 'dev.nomorebadhaircuts.com';
  const waitlisted = isWaitlistMode && isTargetDomain;

  // Everyone else goes to the chair. Its own gate decides between the sign-in
  // panel and the name form, so / never needs to wait on Clerk to route.
  useEffect(() => {
    if (!mounted || waitlisted) return;
    router.replace('/chair');
  }, [mounted, waitlisted, router]);

  if (waitlisted) return <WaitlistPage />;
  return null;
}
