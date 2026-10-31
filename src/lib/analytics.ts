import { withPostHog } from './posthogClient';

/**
 * Typed product-analytics events. Keep this list small and meaningful — these
 * are the funnel/conversion moments worth measuring, not every click.
 */
export type AnalyticsEvent =
  | 'user_signed_up'
  | 'project_created'
  | 'image_generated'
  | 'checkout_started'
  | 'purchase_completed'
  | 'refund_requested';

/**
 * Fire a product-analytics event. Safe to call anywhere:
 * - no-ops on the server,
 * - no-ops when PostHog isn't configured (no NEXT_PUBLIC_POSTHOG_KEY), and
 * - never throws into product flows.
 */
export function track(event: AnalyticsEvent, props?: Record<string, unknown>): void {
  // The client loads lazily; an event tracked first loads it right away (these
  // are funnel moments, often followed by a navigation) and is captured once ready.
  withPostHog((ph) => ph.capture(event, props), { urgent: true });
}
