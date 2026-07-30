import { track } from './analytics';

export interface CheckoutOptions {
  /**
   * Plan id (starter/popular/pro). Omit for the server default ("popular"),
   * used by out-of-credits fallbacks that just need to send the user to buy.
   */
  plan?: string;
  /** Relative path to return to after payment (validated server-side). */
  returnUrl?: string;
  /** Where checkout was initiated, for funnel attribution. */
  source: string;
}

export type CheckoutResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

/** English source strings — run through t() where the error is displayed. */
const CHECKOUT_FAILED = 'Couldn’t open checkout. Check your connection and try again.';
const CHECKOUT_SIGNED_OUT = 'Your session expired — sign in again, then retry.';

/**
 * Start a Stripe checkout from one place: fire the `checkout_started` analytics
 * event, create the session, and redirect the browser to Stripe. Never throws:
 * resolves to `{ ok: true }` once the browser is navigating, or `{ ok: false }`
 * with an English error string the caller must show (via t()) — a checkout
 * click may never fail silently.
 *
 * Centralizes what used to be five divergent `/api/stripe/checkout` fetches so
 * the funnel is measured consistently and the request shape can't drift.
 */
export async function startCheckout({ plan, returnUrl, source }: CheckoutOptions): Promise<CheckoutResult> {
  // Mirror the server default ("popular") so the event reflects what's bought.
  track('checkout_started', { plan: plan ?? 'popular', source });

  // The out-of-credits fallbacks historically sent no body (server defaults the
  // plan); preserve that so behavior is identical to the call sites we replaced.
  const hasBody = plan != null || returnUrl != null;
  let res: Response;
  try {
    res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      ...(hasBody
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan, returnUrl }) }
        : {}),
    });
  } catch {
    return { ok: false, error: CHECKOUT_FAILED };
  }

  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (res.ok && data.url) {
    window.location.href = data.url;
    return { ok: true, url: data.url };
  }
  if (res.status === 401) return { ok: false, error: CHECKOUT_SIGNED_OUT };
  // The route's own failure branches send curated copy; anything else (bare
  // 500, HTML error page) gets the generic line.
  const serverMessage = typeof data.error === 'string' && data.error.trim() && data.error !== 'Unauthenticated'
    ? data.error
    : CHECKOUT_FAILED;
  return { ok: false, error: serverMessage };
}
