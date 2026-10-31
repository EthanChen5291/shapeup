'use client';

import { Suspense, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth, useUser } from '@clerk/nextjs';
import { withPostHog } from '@/lib/posthogClient';

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

// posthog-js itself loads lazily, after first paint (see src/lib/posthogClient.ts);
// these two components only queue work for it.
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  // Mirror ConvexClerkProvider: if PostHog isn't configured, no-op cleanly.
  if (!posthogKey) return <>{children}</>;
  return (
    <>
      <Suspense fallback={null}>
        <PostHogPageView />
      </Suspense>
      <PostHogIdentify />
      {children}
    </>
  );
}

function PostHogPageView() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    let url = window.origin + pathname;
    const search = searchParams.toString();
    if (search) url += `?${search}`;
    withPostHog((ph) => ph.capture('$pageview', { $current_url: url }));
  }, [pathname, searchParams]);

  return null;
}

function PostHogIdentify() {
  const { isSignedIn, isLoaded } = useAuth();
  const { user } = useUser();

  useEffect(() => {
    if (!isLoaded) return;
    withPostHog((ph) => {
      if (isSignedIn && user) {
        ph.identify(user.id, {
          email: user.primaryEmailAddress?.emailAddress,
          name: user.fullName ?? undefined,
        });
        // Fire a one-time signup event for genuinely new accounts. We can't ask
        // Clerk "did this user just sign up", so we treat an account created in
        // the last 10 minutes as a signup and guard with localStorage so it fires
        // at most once per user per browser (survives re-mounts and re-logins).
        try {
          const createdAt = user.createdAt?.getTime();
          const isRecent = createdAt != null && Date.now() - createdAt < 10 * 60 * 1000;
          const guardKey = `ph_signup_${user.id}`;
          if (isRecent && !localStorage.getItem(guardKey)) {
            localStorage.setItem(guardKey, '1');
            ph.capture('user_signed_up');
          }
        } catch {
          // localStorage unavailable / analytics must never break auth.
        }
      } else if (!isSignedIn) {
        // Logged out: detach the previous identity from this browser session.
        ph.reset();
      }
    });
  }, [isLoaded, isSignedIn, user]);

  return null;
}
