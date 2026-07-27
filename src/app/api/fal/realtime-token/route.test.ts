import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getFunctionName } from 'convex/server';

// The token route is the money gate for chair mode: the endpoint it mints
// against bills per second of wall clock, so a token handed to the wrong caller
// is a bill, not just a leak. Every test here asks the same question — did a
// token get minted, and did FAL_KEY stay on the server?

const FAL_TOKEN_URL = 'https://rest.fal.ai/tokens/';

function request(body: unknown = { clientId: 'c1', prompt: 'give this person a low taper' }) {
  return new Request('https://shapeup.test/api/fal/realtime-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Mocks that let a request through every gate up to the mint itself. */
function allowAll({
  startTake = { ok: true, takeId: 'take_1', maxSeconds: 30, takesLeftToday: 9 } as unknown,
} = {}) {
  const mutation = vi.fn().mockResolvedValue(startTake);
  vi.doMock('@/lib/serverAuth', () => ({
    requireSignedIn: vi.fn().mockResolvedValue({
      response: null,
      session: { userId: 'user_123', getToken: vi.fn().mockResolvedValue('convex-jwt') },
    }),
  }));
  vi.doMock('@/lib/durableRateLimit', () => ({
    enforceDurableRateLimits: vi.fn().mockResolvedValue(null),
  }));
  vi.doMock('convex/browser', () => ({
    ConvexHttpClient: vi.fn(function ConvexHttpClient() {
      return { setAuth: vi.fn(), mutation };
    }),
  }));
  return { mutation };
}

function mockFalMint(body = '"JWT_TOKEN"', ok = true, status = 200) {
  const fetchSpy = vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => body,
  });
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.stubEnv('FAL_KEY', 'fal-secret-key');
  vi.stubEnv('NEXT_PUBLIC_CONVEX_URL', 'https://convex.test');
});

describe('gates before minting', () => {
  test('an unauthenticated caller is refused and nothing is minted', async () => {
    const fetchSpy = mockFalMint();
    vi.doMock('@/lib/serverAuth', () => ({
      requireSignedIn: vi.fn().mockResolvedValue({
        response: new Response('{"error":"Unauthenticated"}', { status: 401 }),
        session: null,
      }),
    }));

    const { POST } = await import('./route');
    const res = await POST(request() as never);

    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('a rate-limited caller is refused before the mint', async () => {
    const fetchSpy = mockFalMint();
    vi.doMock('@/lib/serverAuth', () => ({
      requireSignedIn: vi.fn().mockResolvedValue({
        response: null,
        session: { userId: 'user_123', getToken: vi.fn() },
      }),
    }));
    vi.doMock('@/lib/durableRateLimit', () => ({
      enforceDurableRateLimits: vi.fn().mockResolvedValue(
        new Response('{"error":"Rate limit exceeded"}', { status: 429 }),
      ),
    }));

    const { POST } = await import('./route');
    const res = await POST(request() as never);

    expect(res.status).toBe(429);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('a caller who is not a barber is refused — Convex throws, we do not mint', async () => {
    const fetchSpy = mockFalMint();
    const { mutation } = allowAll();
    mutation.mockRejectedValue(new Error('Chair mode is for barbers — set up your card first.'));

    const { POST } = await import('./route');
    const res = await POST(request() as never);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ ok: false, error: expect.stringMatching(/barber/i) });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('a client who has not consented cannot get a token', async () => {
    const fetchSpy = mockFalMint();
    const { mutation } = allowAll();
    mutation.mockRejectedValue(new Error('This client hasn’t agreed to be filmed yet.'));

    const { POST } = await import('./route');
    const res = await POST(request() as never);

    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('an over-budget barber is refused with the reason, and nothing is minted', async () => {
    const fetchSpy = mockFalMint();
    allowAll({ startTake: { ok: false, reason: 'daily_cap', takesLeftToday: 0 } });

    const { POST } = await import('./route');
    const res = await POST(request() as never);

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, reason: 'daily_cap', takesLeftToday: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('a request with no prompt is rejected before any budget is claimed', async () => {
    const fetchSpy = mockFalMint();
    const { mutation } = allowAll();

    const { POST } = await import('./route');
    const res = await POST(request({ clientId: 'c1' }) as never);

    expect(res.status).toBe(400);
    expect(mutation).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('a request naming neither a client nor a card is rejected', async () => {
    const { mutation } = allowAll();
    const { POST } = await import('./route');
    const res = await POST(request({ prompt: 'x' }) as never);
    expect(res.status).toBe(400);
    expect(mutation).not.toHaveBeenCalled();
  });

  test('malformed JSON is a 400, not a crash', async () => {
    allowAll();
    const { POST } = await import('./route');
    const res = await POST(
      new Request('https://shapeup.test/api/fal/realtime-token', {
        method: 'POST',
        body: 'not json',
      }) as never,
    );
    expect(res.status).toBe(400);
  });

  test('an unconfigured deployment says so instead of minting with undefined', async () => {
    vi.stubEnv('FAL_KEY', '');
    const fetchSpy = mockFalMint();
    const { POST } = await import('./route');
    const res = await POST(request() as never);
    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('refuses to mint when the Convex identity cannot be established', async () => {
    const fetchSpy = mockFalMint();
    vi.doMock('@/lib/serverAuth', () => ({
      requireSignedIn: vi.fn().mockResolvedValue({
        response: null,
        session: { userId: 'user_123', getToken: vi.fn().mockResolvedValue(null) },
      }),
    }));
    vi.doMock('@/lib/durableRateLimit', () => ({
      enforceDurableRateLimits: vi.fn().mockResolvedValue(null),
    }));

    const { POST } = await import('./route');
    const res = await POST(request() as never);

    expect(res.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('the mint itself', () => {
  test('scopes the token to the one endpoint and keeps FAL_KEY server-side', async () => {
    const fetchSpy = mockFalMint();
    allowAll();

    const { POST } = await import('./route');
    const res = await POST(request() as never);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(FAL_TOKEN_URL);
    expect(init.headers.Authorization).toBe('Key fal-secret-key');
    expect(JSON.parse(init.body)).toEqual({
      allowed_apps: ['lucy-2-5'],
      token_expiration: 120,
    });

    // The response carries the short-lived JWT and never the account key.
    expect(body.token).toBe('JWT_TOKEN');
    expect(JSON.stringify(body)).not.toContain('fal-secret-key');
  });

  // Regression. This route once posted `{ allowed_apps: ['decart/lucy-2-5/realtime'],
  // duration: 120 }` to `/tokens/realtime`; fal answers that with a 422 and every
  // take died on "The live model didn't answer" — while this file stayed green,
  // because it asserted the same wrong shape the route was sending.
  //
  // The shape above is not ours to choose: it is what @fal-ai/client's own
  // `getTemporaryAuthToken` sends (see node_modules/@fal-ai/client/src/auth.js),
  // i.e. what the browser would send if it held FAL_KEY directly. The package
  // doesn't export that module, so the values are mirrored by hand — this test
  // guards the half of it that a wrong constant can still break silently.
  test('scopes to the bare app alias, never the full endpoint id', async () => {
    const fetchSpy = mockFalMint();
    allowAll();

    const { POST } = await import('./route');
    await POST(request() as never);

    const { LUCY_REALTIME_APP, LUCY_REALTIME_ALIAS } = await import('@/lib/lucy/constants');
    const [, init] = fetchSpy.mock.calls[0];
    const [scoped] = JSON.parse(init.body).allowed_apps;

    expect(scoped).not.toContain('/');
    expect(LUCY_REALTIME_APP.split('/')).toContain(scoped);
    expect(scoped).toBe(LUCY_REALTIME_ALIAS);
  });

  test('passes the take through so the browser can reconcile its duration', async () => {
    mockFalMint();
    allowAll();
    const { POST } = await import('./route');
    const body = await (await POST(request() as never)).json();
    expect(body).toMatchObject({ ok: true, takeId: 'take_1', maxSeconds: 30, takesLeftToday: 9 });
  });

  test('claims the take with the caller-supplied cut and prompt', async () => {
    mockFalMint();
    const { mutation } = allowAll();

    const { POST } = await import('./route');
    await POST(
      request({
        clientId: 'c1',
        cutLabel: 'low taper fade',
        cutSlug: 'low-taper-fade-textured-fringe',
        prompt: 'give this person a low taper fade',
      }) as never,
    );

    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        clientId: 'c1',
        cutLabel: 'low taper fade',
        cutSlug: 'low-taper-fade-textured-fringe',
        prompt: 'give this person a low taper fade',
      }),
    );
  });

  test('a mint failure is a 502 and never leaks the upstream body', async () => {
    mockFalMint('quota exceeded for key fal-secret-key', false, 402);
    allowAll();

    const { POST } = await import('./route');
    const res = await POST(request() as never);
    const text = JSON.stringify(await res.json());

    expect(res.status).toBe(502);
    expect(text).not.toContain('fal-secret-key');
  });

  test('an empty token is treated as a failure rather than passed on', async () => {
    mockFalMint('""');
    allowAll();
    const { POST } = await import('./route');
    expect((await POST(request() as never)).status).toBe(502);
  });
});

// The card door: a client running the live mirror on /b/<slug>. Same gate, a
// different Convex claim — and the route must never let one body reach the
// other's mutation, because that is how a stranger would spend a barber's day
// without the consent check that guards it.
describe('the card door', () => {
  test('claims through startCardTake, never through the chair mutation', async () => {
    mockFalMint();
    const { mutation } = allowAll();

    const { POST } = await import('./route');
    const res = await POST(
      request({ slug: 'marcus', cutLabel: 'burst fade', prompt: 'give this person a burst fade' }) as never,
    );

    expect(res.status).toBe(200);
    expect(mutation).toHaveBeenCalledTimes(1);
    const [fn, args] = mutation.mock.calls[0];
    expect(getFunctionName(fn)).toBe('chair:startCardTake');
    expect(args).toEqual({
      slug: 'marcus',
      cutLabel: 'burst fade',
      cutSlug: undefined,
      prompt: 'give this person a burst fade',
    });
  });

  test('a clientId in the body still takes the chair door', async () => {
    mockFalMint();
    const { mutation } = allowAll();

    const { POST } = await import('./route');
    await POST(request({ clientId: 'c1', prompt: 'p' }) as never);

    const [fn, args] = mutation.mock.calls[0];
    expect(getFunctionName(fn)).toBe('chair:startTake');
    expect(args).toMatchObject({ clientId: 'c1' });
  });

  test('a visitor who never consented gets no token', async () => {
    const fetchSpy = mockFalMint();
    const { mutation } = allowAll();
    mutation.mockRejectedValue(new Error('Agree to be filmed before starting a take.'));

    const { POST } = await import('./route');
    const res = await POST(request({ slug: 'marcus', prompt: 'p' }) as never);

    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('an exhausted barber budget refuses the card the same way it refuses the chair', async () => {
    const fetchSpy = mockFalMint();
    allowAll({ startTake: { ok: false, reason: 'daily_cap', takesLeftToday: 0 } });

    const { POST } = await import('./route');
    const res = await POST(request({ slug: 'marcus', prompt: 'p' }) as never);

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ ok: false, reason: 'daily_cap', takesLeftToday: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
