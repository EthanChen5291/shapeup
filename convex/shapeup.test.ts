/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { describe, expect, test, vi } from 'vitest';
import { api } from './_generated/api';
import { hasProfanity, isReservedUsername } from './lib/contentFilter';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

function authed(clerkId = 'user_123') {
  const t = convexTest(schema, modules);
  return t.withIdentity({
    subject: clerkId,
    tokenIdentifier: `https://clerk.test|${clerkId}`,
    email: `${clerkId}@example.com`,
    nickname: clerkId,
  });
}

describe('users and credits', () => {
  test('creates the current user from the authenticated Clerk identity with the welcome bundle', async () => {
    const t = authed();

    const userId = await t.mutation(api.users.getOrCreate, {});
    const me = await t.query(api.users.getMe, {});

    expect(me?._id).toBe(userId);
    expect(me?.clerkId).toBe('user_123');
    expect(me?.tokenIdentifier).toBe('https://clerk.test|user_123');
    // A real (non-disposable) email earns the one-time welcome bundle at creation.
    expect(me?.credits).toBe(5);
    expect(me?.welcomeGrantedAt).toBeTruthy();
  });

  test('deductCredit rejects users with no credits', async () => {
    const t = authed();

    const userId = await t.mutation(api.users.getOrCreate, {});
    // Spend down the welcome bundle so we exercise the zero-credit path.
    await t.run(async (ctx) => ctx.db.patch(userId, { credits: 0 }));

    await expect(t.mutation(api.users.deductCredit, {})).rejects.toThrow(/out of credits/);
  });

  test('setUsername rejects profane and reserved usernames', async () => {
    const t = authed();
    await t.mutation(api.users.getOrCreate, {});

    await expect(t.mutation(api.users.setUsername, { username: 'admin' })).rejects.toThrow(/reserved/);
    await expect(t.mutation(api.users.setUsername, { username: 'fuck_user' })).rejects.toThrow(/not allowed/);
  });

  test('setUsername rate-limits repeated account mutations', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const t = authed();
    await t.mutation(api.users.getOrCreate, {});

    for (let i = 0; i < 5; i += 1) {
      await expect(t.mutation(api.users.setUsername, { username: `user_${i}` })).resolves.toBe(`user_${i}`);
    }

    await expect(t.mutation(api.users.setUsername, { username: 'user_5' })).rejects.toThrow(/a lot at once/i);
  });
});

describe('content filtering', () => {
  test('detects profanity and reserved impersonation names', () => {
    expect(hasProfanity('f.u.c.k')).toBe(true);
    expect(isReservedUsername('Shape_Up')).toBe(true);
    expect(isReservedUsername('shapeupfan')).toBe(false);
  });
});

describe('durable rate limits', () => {
  test('consumes user-scoped limits against the authenticated identity', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const t = authed('rate_user');

    await expect(t.mutation(api.rateLimits.consume, {
      rules: [{ scope: 'user', label: 'edit:user', limit: 2, windowMs: 60_000 }],
    })).resolves.toMatchObject({ limited: false });

    await expect(t.mutation(api.rateLimits.consume, {
      rules: [{ scope: 'user', label: 'edit:user', limit: 2, windowMs: 60_000 }],
    })).resolves.toMatchObject({ limited: false });

    await expect(t.mutation(api.rateLimits.consume, {
      rules: [{ scope: 'user', label: 'edit:user', limit: 2, windowMs: 60_000 }],
    })).resolves.toMatchObject({ limited: true, label: 'edit:user', retryAfterSeconds: 60 });
  });

  test('consumes IP-scoped limits against a hashed IP key', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const t = authed('rate_ip_user');

    const first = await t.mutation(api.rateLimits.consume, {
      rules: [{ scope: 'ip', label: 'facelift:ip', keyHash: '0123456789ab', limit: 1, windowMs: 10_000 }],
    });
    const second = await t.mutation(api.rateLimits.consume, {
      rules: [{ scope: 'ip', label: 'facelift:ip', keyHash: '0123456789ab', limit: 1, windowMs: 10_000 }],
    });

    expect(first).toMatchObject({ limited: false });
    expect(second).toMatchObject({ limited: true, label: 'facelift:ip', retryAfterSeconds: 10 });
  });
});

describe('waitlist', () => {
  test('joins, normalizes, and deduplicates valid emails', async () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const t = convexTest(schema, modules);

    await expect(t.mutation(api.waitlist.joinWaitlist, {
      email: '  Person@Example.COM ',
      notifyOnRelease: false,
      hp: '',
    })).resolves.toBe('joined');

    await expect(t.mutation(api.waitlist.joinWaitlist, {
      email: 'person@example.com',
      notifyOnRelease: true,
      hp: '',
    })).resolves.toBe('already_joined');

    const rows = await t.run(async (ctx) => ctx.db.query('waitlist').collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: 'person@example.com', notifyOnRelease: true });
  });

  test('silently accepts honeypot submissions without saving', async () => {
    const t = convexTest(schema, modules);

    await expect(t.mutation(api.waitlist.joinWaitlist, {
      email: 'bot@example.com',
      notifyOnRelease: true,
      hp: 'filled',
    })).resolves.toBe('joined');

    const rows = await t.run(async (ctx) => ctx.db.query('waitlist').collect());
    expect(rows).toHaveLength(0);
  });

  test('rejects invalid and profane email addresses', async () => {
    const t = convexTest(schema, modules);

    await expect(t.mutation(api.waitlist.joinWaitlist, {
      email: 'not-an-email',
      notifyOnRelease: true,
      hp: '',
    })).rejects.toThrow(/valid email/);

    await expect(t.mutation(api.waitlist.joinWaitlist, {
      email: 'fuck@example.com',
      notifyOnRelease: true,
      hp: '',
    })).rejects.toThrow(/valid email/);
  });
});

// The Phase 1 `sessions.*` auth regressions that used to be reproduced here are
// gone with the module: convex/sessions.ts was the 3D-scan studio's session
// store, and both it and the studio have been removed. The `sessions` table
// itself is retained only so deleteCurrentUserData can still sweep legacy rows.
