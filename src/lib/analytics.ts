import posthog from 'posthog-js';

/**
 * Which door a take came through. The two surfaces run the same hook against
 * the same budget, so every take event carries this — without it the numbers
 * blend the barber's own station into clients scanning the QR, and those are
 * different products with different failure modes.
 */
export type TakeSurface = 'chair' | 'card';

/**
 * Typed product-analytics events. Keep this list small and meaningful — these
 * are the funnel/conversion moments worth measuring, not every click.
 *
 * The take events are the core loop: a sitting is
 * `consent_granted → take_started → (take_resteered ×N) → take_completed →
 * take_approved | take_discarded | sitting_scrapped`. Measuring all five
 * endings is the point — a take that gets discarded is the model failing, and
 * that is invisible if you only count takes that started.
 *
 * NEVER attach the prompt text to an event. It is free-form input typed about
 * a person who is sitting in a chair, and it does not belong in a third-party
 * analytics store. `cutSlug`/`cutLabel` come from our own catalog and are safe.
 */
export type AnalyticsEvent =
  | 'user_signed_up'
  | 'checkout_started'
  // ── the live-take loop ────────────────────────────────────────────────
  /** Consent accepted; the camera is about to go live. */
  | 'consent_granted'
  /** A token was minted and the session is opening — this is what costs money. */
  | 'take_started'
  /** Refused before any spend: daily cap, global budget, or the pace limiter. */
  | 'take_refused'
  /** Re-steered mid-take without a reconnect. High counts mean weak first renders. */
  | 'take_resteered'
  /** The clip finished and is in hand. */
  | 'take_completed'
  /** Started but never produced a clip — connect failed or the relay died. */
  | 'take_failed'
  /** Kept: the barber picked reference shots off it. */
  | 'take_approved'
  /** "Try another" — this take was not the one. */
  | 'take_discarded'
  /** "None of these" — the whole sitting was scrapped, files included. */
  | 'sitting_scrapped'
  // ── card surfaces ─────────────────────────────────────────────────────
  /** A card visitor sent their finished take to the barber's inbox. */
  | 'take_sent_to_barber'
  /** An appointment was booked through a card's native scheduler. */
  | 'booking_made'
  /** A barber published their public card for the first time. */
  | 'card_published';

/**
 * Fire a product-analytics event. Safe to call anywhere:
 * - no-ops on the server,
 * - no-ops when PostHog isn't configured (no NEXT_PUBLIC_POSTHOG_KEY), and
 * - never throws into product flows.
 */
export function track(event: AnalyticsEvent, props?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  try {
    // posthog.__loaded is only true after init() runs, which is gated on the
    // key being present (see PostHogProvider). Guards against capturing into an
    // uninitialized client.
    if (!posthog.__loaded) return;
    posthog.capture(event, props);
  } catch {
    // Analytics must never break the product.
  }
}
