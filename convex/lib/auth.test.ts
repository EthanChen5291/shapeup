/// <reference types="vite/client" />
// @vitest-environment edge-runtime

// The shared identity → users-row lookup. Worth its own tests because a dozen
// public functions now gate on it, and because the refusal must stay a
// ConvexError: production Convex redacts a plain Error to "Server Error", so a
// regression here would silently replace every sign-in prompt with nonsense.

import { convexTest } from 'convex-test';
import { ConvexError } from 'convex/values';
import { describe, expect, test } from 'vitest';
import { api } from '../_generated/api';
import schema from '../schema';
import { currentUser, requireUser } from './auth';

const modules = import.meta.glob('../**/*.ts');

function identity(t: ReturnType<typeof convexTest>, clerkId: string, email: string) {
  return t.withIdentity({
    subject: clerkId,
    tokenIdentifier: `https://clerk.test|${clerkId}`,
    email,
    nickname: clerkId,
  });
}

describe('currentUser', () => {
  test('returns null for a caller with no session', async () => {
    const t = convexTest(schema, modules);
    expect(await t.run((ctx) => currentUser(ctx))).toBeNull();
  });

  test('returns null for a session with no users row yet', async () => {
    const t = convexTest(schema, modules);
    const stranger = identity(t, 'no_row', 'no_row@example.com');
    expect(await stranger.run((ctx) => currentUser(ctx))).toBeNull();
  });

  test('returns the row matching the caller token', async () => {
    const t = convexTest(schema, modules);
    const user = identity(t, 'auth_a', 'auth_a@example.com');
    await user.mutation(api.users.getOrCreate, {});

    const found = await user.run((ctx) => currentUser(ctx));
    expect(found?.email).toBe('auth_a@example.com');
  });

  test('never returns another account for a different token', async () => {
    const t = convexTest(schema, modules);
    await identity(t, 'auth_b', 'auth_b@example.com').mutation(api.users.getOrCreate, {});
    const other = identity(t, 'auth_c', 'auth_c@example.com');
    await other.mutation(api.users.getOrCreate, {});

    const found = await other.run((ctx) => currentUser(ctx));
    expect(found?.email).toBe('auth_c@example.com');
  });
});

describe('requireUser', () => {
  test('refuses with a ConvexError so the copy survives production redaction', async () => {
    const t = convexTest(schema, modules);
    await expect(t.run((ctx) => requireUser(ctx))).rejects.toBeInstanceOf(ConvexError);
  });

  test('carries the caller-supplied copy', async () => {
    const t = convexTest(schema, modules);
    await expect(t.run((ctx) => requireUser(ctx, 'Sign in to book a time.'))).rejects.toThrow(
      /book a time/,
    );
  });

  test('returns the row when there is one', async () => {
    const t = convexTest(schema, modules);
    const user = identity(t, 'auth_d', 'auth_d@example.com');
    await user.mutation(api.users.getOrCreate, {});

    const found = await user.run((ctx) => requireUser(ctx));
    expect(found.email).toBe('auth_d@example.com');
  });
});
