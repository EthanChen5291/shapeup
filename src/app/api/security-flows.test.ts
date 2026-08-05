import { beforeEach, describe, expect, test, vi } from 'vitest';

// Cross-route security regressions: the checks that matter are the ones a route
// must perform BEFORE it does anything expensive or privileged. Each test drives
// the real route handler with its dependencies mocked wide open, so a passing
// status here means the route refused on its own merits rather than because a
// mock happened to fail.
//
// This file once also covered the 3D studio's routes (/api/facelift, /api/edit,
// /api/save-scan, /api/proxy-ply, /api/admin-s3, /api/gemini-hair-edit, …). Those
// routes were deleted with the studio and their tests went with them; the live
// try-on's own gate is covered in fal/realtime-token/route.test.ts.

describe('Stripe checkout route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/serverAuth');
    vi.unstubAllEnvs();
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123');
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', 'https://shapeup.test');
  });

  test('includes authenticated Clerk metadata so the webhook can grant credits', async () => {
    const createCheckoutSession = vi.fn().mockResolvedValue({ url: 'https://checkout.stripe.test/session' });
    vi.doMock('stripe', () => ({
      default: vi.fn(function Stripe() {
        return {
          checkout: { sessions: { create: createCheckoutSession } },
        };
      }),
    }));
    vi.doMock('@/lib/serverAuth', () => ({
      requireSignedIn: vi.fn().mockResolvedValue({
        response: null,
        session: { userId: 'user_123' },
      }),
    }));

    const { POST } = await import('./stripe/checkout/route');

    const res = await POST(new Request('https://shapeup.test/api/stripe/checkout', {
      method: 'POST',
      body: JSON.stringify({ plan: 'starter' }),
    }));

    expect(res.status).toBe(200);
    expect(createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        clerkId: 'user_123',
        plan: 'starter',
        credits: '8',
      }),
    }));
  });
});

describe('admin APIs', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/serverAuth');
    vi.unstubAllEnvs();
  });

  test('/api/admin-feedback rejects unauthenticated callers before returning feedback', async () => {
    // The Convex client is mocked to return data so a passing test can only
    // mean the route refused BEFORE querying — not that the query was empty.
    vi.doMock('convex/browser', () => ({
      ConvexHttpClient: vi.fn(function ConvexHttpClient() {
        return {
          query: vi.fn().mockResolvedValue([{ rating: 1, comment: 'leaked' }]),
        };
      }),
    }));

    const { GET } = await import('./admin-feedback/route');
    const res = await GET();

    expect([401, 403]).toContain(res.status);
  });
});
