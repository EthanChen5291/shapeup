import { beforeEach, describe, expect, it, vi } from 'vitest';

// The checkout route must never answer a buy click with a bare 500: the client
// helper (lib/checkout.ts) relays `error` bodies verbatim to the person who
// clicked, so every failure branch here has to carry copy fit for a screen.

const { sessionsCreate } = vi.hoisted(() => ({ sessionsCreate: vi.fn() }));

vi.mock('stripe', () => ({
  default: vi.fn(function Stripe() {
    return { checkout: { sessions: { create: sessionsCreate } } };
  }),
}));

vi.mock('@/lib/serverAuth', () => ({
  requireSignedIn: vi.fn().mockResolvedValue({ response: null, session: { userId: 'user_1' } }),
}));

import { POST } from './route';

function request(body: unknown = { plan: 'pro' }) {
  return new Request('https://shapeup.test/api/stripe/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  sessionsCreate.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/stripe/checkout', () => {
  it('returns the session url on success', async () => {
    sessionsCreate.mockResolvedValue({ url: 'https://stripe.test/session' });

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://stripe.test/session' });
  });

  it('answers a Stripe failure with a 502 and copy a person can read', async () => {
    sessionsCreate.mockRejectedValue(new Error('StripeConnectionError: socket hang up'));

    const res = await POST(request());

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toBe('Couldn’t start checkout — the payment service didn’t respond. Try again in a moment.');
    // The raw Stripe error must stay in the server log, not the response.
    expect(JSON.stringify(body)).not.toContain('socket hang up');
  });

  it('treats a session created without a url as a failure, not a silent success', async () => {
    sessionsCreate.mockResolvedValue({ url: null });

    const res = await POST(request());

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe(
      'Couldn’t start checkout — the payment service didn’t respond. Try again in a moment.',
    );
  });
});
