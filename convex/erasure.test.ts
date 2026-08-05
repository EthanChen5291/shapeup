/// <reference types="vite/client" />
// @vitest-environment edge-runtime

// What "delete my data" actually hands back to the caller. The mutation returns
// the S3 keys for /api/account/delete to erase, so a key it fails to collect is
// an object that silently outlives the account — the failure is invisible from
// inside Convex, which is exactly why it needs pinning here.

import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

function identity(t: ReturnType<typeof convexTest>, clerkId: string, email: string) {
  return t.withIdentity({
    subject: clerkId,
    tokenIdentifier: `https://clerk.test|${clerkId}`,
    email,
    nickname: clerkId,
  });
}

describe('deleteCurrentUserData', () => {
  test('collects every face-derived asset on the user, thumbnail included', async () => {
    const t = convexTest(schema, modules);
    const user = identity(t, 'erase_a', 'erase_a@example.com');
    await user.mutation(api.users.getOrCreate, {});

    // setDefaultScan was removed with the 3D studio, so seed the legacy shape
    // directly — these rows still exist in deployed data.
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query('users')
        .withIndex('by_token', (q) => q.eq('tokenIdentifier', 'https://clerk.test|erase_a'))
        .unique();
      await ctx.db.patch(row!._id, {
        defaultScan: {
          lastImageS3Key: 'pictures/erase_a/face.png',
          thumbnailS3Key: 'thumbnails/erase_a/thumb.png',
          updatedAt: Date.now(),
        },
      });
    });

    const result = await user.mutation(api.users.deleteCurrentUserData, {});

    expect(result.s3Keys).toContain('pictures/erase_a/face.png');
    // The regression this file exists for: a thumbnail is derived from the
    // user's face, so leaving it behind is not an erasure.
    expect(result.s3Keys).toContain('thumbnails/erase_a/thumb.png');
  });

  test('ignores keys outside the erasable prefixes', async () => {
    const t = convexTest(schema, modules);
    const user = identity(t, 'erase_b', 'erase_b@example.com');
    await user.mutation(api.users.getOrCreate, {});

    await t.run(async (ctx) => {
      const row = await ctx.db
        .query('users')
        .withIndex('by_token', (q) => q.eq('tokenIdentifier', 'https://clerk.test|erase_b'))
        .unique();
      await ctx.db.patch(row!._id, {
        defaultScan: {
          // Not one of ours — an absolute URL must never become a delete target.
          lastImageUrl: 'https://example.com/somebody-elses.png',
          updatedAt: Date.now(),
        },
      });
    });

    const result = await user.mutation(api.users.deleteCurrentUserData, {});
    expect(result.s3Keys).toHaveLength(0);
  });

  test('refuses an unauthenticated caller', async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.users.deleteCurrentUserData, {})).rejects.toThrow(
      /sign in/i,
    );
  });
});
