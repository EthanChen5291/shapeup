// PostHog, loaded lazily. posthog-js is a sizeable library and nothing on screen
// depends on it, so it is fetched once the browser is idle after first paint
// (or immediately, if an event is tracked before then). Every caller goes
// through withPostHog(), which runs once the client is ready; calls made earlier
// are simply held in the promise chain, in order.

import type { PostHog } from 'posthog-js';

// Reverse-proxied through Next.js rewrites (see next.config.ts) so events are
// posted to our own origin and survive ad-blockers. ui_host points at the real
// PostHog app so "view in PostHog" links resolve correctly.
const API_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? '/ingest';
const UI_HOST = 'https://us.posthog.com';
const IDLE_TIMEOUT_MS = 3000;

let client: Promise<PostHog | null> | null = null;
let startNow: (() => void) | null = null;

function load(): Promise<PostHog | null> {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (typeof window === 'undefined' || !key) return Promise.resolve(null);
  if (client) return client;
  client = new Promise<PostHog | null>((resolve) => {
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      import('posthog-js')
        .then(({ default: posthog }) => {
          if (!posthog.__loaded) {
            posthog.init(key, {
              api_host: API_HOST,
              ui_host: UI_HOST,
              // Pageviews are captured manually (App Router navigations don't reload the page).
              capture_pageview: false,
              capture_pageleave: true,
              person_profiles: 'identified_only',
            });
          }
          resolve(posthog);
        })
        .catch(() => resolve(null));
    };
    startNow = start;
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(start, { timeout: IDLE_TIMEOUT_MS });
    else setTimeout(start, 1500);
  });
  return client;
}

/** Run `fn` with the PostHog client once it's loaded; no-op without a key or on the server. Never throws. */
export function withPostHog(fn: (ph: PostHog) => void, { urgent = false }: { urgent?: boolean } = {}): void {
  const ready = load();
  if (urgent) startNow?.();
  void ready.then((ph) => {
    if (!ph) return;
    try { fn(ph); } catch { /* analytics must never break the product */ }
  });
}

/** Test hook: forget the loaded client. */
export function resetPostHogClientForTests() { client = null; startNow = null; }
