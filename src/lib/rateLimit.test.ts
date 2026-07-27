import { describe, expect, test } from 'vitest';
import { RATE_LIMITS, checkRateLimit, resetRateLimitBucketsForTests } from './rateLimit';

describe('rate limiter', () => {
  test('a take (token mint) is capped at 2 per 2 minutes per user', () => {
    // The product's stated pace. If this changes, change the Convex backstop
    // in convex/chair.ts (TAKE_RATE_LIMIT) with it — they must agree.
    expect(RATE_LIMITS.lucyTokenUser).toMatchObject({ limit: 2, windowMs: 120_000 });
  });

  test('limits requests inside a window and recovers after reset', () => {
    resetRateLimitBucketsForTests();
    const rule = { key: 'user_123', limit: 2, windowMs: 1000, label: 'test:user' };

    expect(checkRateLimit(rule, 0).limited).toBe(false);
    expect(checkRateLimit(rule, 100).limited).toBe(false);
    expect(checkRateLimit(rule, 200)).toMatchObject({ limited: true, retryAfterSeconds: 1 });
    expect(checkRateLimit(rule, 1100).limited).toBe(false);
  });
});
