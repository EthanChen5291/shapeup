'use client';

import { useEffect, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { useRouter } from 'next/navigation';
import { WaitlistPage } from '@/components/WaitlistPage';
import LandingPage from '@/components/LandingPage';
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

  // Redirect signed-in users to /dashboard
  useEffect(() => {
    if (isSignedIn) router.push('/dashboard');
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

  // Signed-in visitors are redirected to /dashboard by the middleware before this
  // page is served, so render the landing page straight away rather than waiting
  // for Clerk to load in the browser. The client-side redirect above stays as a
  // fallback (e.g. a session that only resolves in the browser).
  if (isSignedIn) {
    return null;
  }

  return <LandingPage onEnter={() => router.push('/dashboard')} />;
}
