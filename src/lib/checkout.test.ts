// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }));
vi.mock('./analytics', () => ({ track: trackMock }));

import { startCheckout } from './checkout';

describe('startCheckout', () => {
  beforeEach(() => {
    trackMock.mockReset();
    // Make location assignable without triggering jsdom's "navigation not
    // implemented" error when the helper sets href.
    Object.defineProperty(window, 'location', { value: { href: '' }, writable: true });
  });

  it('fires checkout_started with plan + source and redirects to the Stripe url', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ url: 'https://stripe.test/session' }) });
    vi.stubGlobal('fetch', fetchMock);

    const result = await startCheckout({ plan: 'pro', returnUrl: '/studio/x', source: 'pricing_popup' });

    expect(trackMock).toHaveBeenCalledWith('checkout_started', { plan: 'pro', source: 'pricing_popup' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/stripe/checkout',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ plan: 'pro', returnUrl: '/studio/x' }) }),
    );
    expect(result).toEqual({ ok: true, url: 'https://stripe.test/session' });
    expect(window.location.href).toBe('https://stripe.test/session');
  });

  it('sends no body for the default-plan fallback and labels the event "popular"', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ url: 'https://stripe.test/s2' }) });
    vi.stubGlobal('fetch', fetchMock);

    await startCheckout({ source: 'facelift_out_of_credits' });

    expect(trackMock).toHaveBeenCalledWith('checkout_started', {
      plan: 'popular',
      source: 'facelift_out_of_credits',
    });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBeUndefined();
  });

  it('fails with a generic message and no redirect when the server returns no url', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) }));

    const result = await startCheckout({ plan: 'starter', source: 'pricing_page' });

    expect(result).toEqual({ ok: false, error: 'Couldn’t open checkout. Check your connection and try again.' });
    expect(window.location.href).toBe('');
  });

  it('surfaces the route’s curated copy when the server fails with an error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({ error: 'Couldn’t start checkout — the payment service didn’t respond. Try again in a moment.' }),
      }),
    );

    const result = await startCheckout({ plan: 'pro', source: 'pricing_page' });

    expect(result).toEqual({
      ok: false,
      error: 'Couldn’t start checkout — the payment service didn’t respond. Try again in a moment.',
    });
  });

  it('maps a 401 to sign-in copy instead of the raw "Unauthenticated" body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'Unauthenticated' }) }),
    );

    const result = await startCheckout({ plan: 'pro', source: 'landing_page' });

    expect(result).toEqual({ ok: false, error: 'Your session expired — sign in again, then retry.' });
    expect(window.location.href).toBe('');
  });

  it('never throws when the network is down — resolves with the generic message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const result = await startCheckout({ plan: 'pro', source: 'pricing_popup' });

    expect(result).toEqual({ ok: false, error: 'Couldn’t open checkout. Check your connection and try again.' });
  });

  it('treats a non-JSON error page as the generic failure, not "[object Object]"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => { throw new SyntaxError('Unexpected token <'); } }),
    );

    const result = await startCheckout({ plan: 'pro', source: 'pricing_page' });

    expect(result).toEqual({ ok: false, error: 'Couldn’t open checkout. Check your connection and try again.' });
  });
});
