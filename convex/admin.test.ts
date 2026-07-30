/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

describe('salesUsage', () => {
  test('attributes chair video seconds, takes, and customers to each account', async () => {
    const t = convexTest(schema, modules);

    await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', {
        tokenIdentifier: 'https://clerk.test|user_eagle',
        clerkId: 'user_eagle',
        email: 'eagle@shapeup.com',
        credits: 5,
      });
      const pageId = await ctx.db.insert('barberPages', {
        slug: 'eagle-demo',
        ownerUserId: userId,
        displayName: 'Eagle Demo',
        links: [],
        styles: [],
        published: true,
        createdAt: 1_000,
        updatedAt: 1_000,
      });
      await ctx.db.insert('chairUsage', { pageId, bucket: '2026-07-29', takes: 3, seconds: 70 });
      await ctx.db.insert('chairUsage', { pageId, bucket: '2026-07-30', takes: 2, seconds: 45 });
      await ctx.db.insert('chairClients', {
        pageId,
        name: 'Marcus T.',
        nameKey: 'marcus t.',
        createdAt: 2_000,
        lastVisitAt: 5_000,
      });
      await ctx.db.insert('chairClients', {
        pageId,
        name: 'Deja',
        nameKey: 'deja',
        visitorTokenIdentifier: 'https://clerk.test|user_visitor',
        createdAt: 3_000,
        lastVisitAt: 9_000,
      });

      // A second account that exists but never opened a barber card.
      await ctx.db.insert('users', {
        tokenIdentifier: 'https://clerk.test|user_maple',
        clerkId: 'user_maple',
        email: 'maple@shapeup.com',
        credits: 5,
      });
    });

    const report = await t.query(internal.admin.salesUsage, {
      emails: ['Eagle@shapeup.com', 'maple@shapeup.com', 'ghost@shapeup.com'],
    });

    expect(report).toEqual([
      {
        email: 'eagle@shapeup.com',
        signedIn: true,
        credits: 5,
        pageSlug: 'eagle-demo',
        videoSeconds: 115,
        takes: 5,
        customersReached: '2',
        viaCard: 1,
        lastActiveAt: 9_000,
      },
      {
        email: 'maple@shapeup.com',
        signedIn: true,
        credits: 5,
        pageSlug: null,
        videoSeconds: 0,
        takes: 0,
        customersReached: '0',
        viaCard: 0,
        lastActiveAt: null,
      },
      {
        email: 'ghost@shapeup.com',
        signedIn: false,
        credits: null,
        pageSlug: null,
        videoSeconds: 0,
        takes: 0,
        customersReached: '0',
        viaCard: 0,
        lastActiveAt: null,
      },
    ]);
  });

  test('refuses an unbounded email list', async () => {
    const t = convexTest(schema, modules);
    const emails = Array.from({ length: 51 }, (_, i) => `a${i}@shapeup.com`);
    await expect(t.query(internal.admin.salesUsage, { emails })).rejects.toThrow(/at most 50/);
  });
});
