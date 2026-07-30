import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

type Bucket = {
  windowStart: number;
  count: number;
};

export type RateLimitRule = {
  key: string;
  limit: number;
  windowMs: number;
  label: string;
};

const buckets = new Map<string, Bucket>();

export const RATE_LIMITS = {
  // Chair mode mints one realtime token per take, and a take bills by the
  // second — so this is a spend limiter, not just an abuse limiter. Ten takes
  // per two minutes is far past any honest pace (a take runs ~30 seconds and
  // gets watched back), so a walk-in demo hammering retry never reads a
  // refusal — this stops scripts, not people. Must agree with the Convex-side
  // backstop in convex/chair.ts (TAKE_RATE_LIMIT); the per-barber daily budget
  // there is the real cap — this bounds the blast radius before that check is
  // even reached.
  lucyTokenUser: { limit: 10, windowMs: 2 * 60_000, label: 'lucy-token:user' },
  // Looser: shared shop wifi puts a whole barbershop behind one IP.
  lucyTokenIp: { limit: 30, windowMs: 2 * 60_000, label: 'lucy-token:ip' },
} as const;

export function getClientIp(req: NextRequest | Request): string {
  const forwarded = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || req.headers.get('x-real-ip') || 'unknown';
}

export function hashIdentifier(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

export function checkRateLimit(rule: RateLimitRule, now = Date.now()) {
  const bucketKey = `${rule.label}:${rule.key}`;
  const current = buckets.get(bucketKey);
  if (!current || now - current.windowStart >= rule.windowMs) {
    buckets.set(bucketKey, { windowStart: now, count: 1 });
    return { limited: false, remaining: rule.limit - 1, retryAfterSeconds: 0 };
  }

  if (current.count >= rule.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((rule.windowMs - (now - current.windowStart)) / 1000));
    return { limited: true, remaining: 0, retryAfterSeconds };
  }

  current.count += 1;
  return { limited: false, remaining: rule.limit - current.count, retryAfterSeconds: 0 };
}

export function rateLimitResponse(label: string, retryAfterSeconds: number) {
  return NextResponse.json(
    {
      // Presentable fallback for callers that render `error` directly; clients
      // that recognise `code` show their own copy with the retry time.
      error: 'That’s a lot at once — give it a moment and try again.',
      code: 'rate_limited',
      limit: label,
      retryAfterSeconds,
    },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } },
  );
}

export function enforceRateLimits(rules: RateLimitRule[], logContext: Record<string, string>) {
  for (const rule of rules) {
    const result = checkRateLimit(rule);
    if (result.limited) {
      console.warn('[rate-limit]', {
        limit: rule.label,
        retryAfterSeconds: result.retryAfterSeconds,
        ...logContext,
      });
      return rateLimitResponse(rule.label, result.retryAfterSeconds);
    }
  }
  return null;
}

export function resetRateLimitBucketsForTests() {
  buckets.clear();
}
