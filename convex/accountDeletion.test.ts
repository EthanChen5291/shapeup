/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const token = (id: string) => `https://clerk.test|${id}`;

function setup() {
  const t = convexTest(schema, modules);
  const as = (id: string) => t.withIdentity({ subject: id, tokenIdentifier: token(id), email: `${id}@example.com`, nickname: id });
  return { t, as };
}

async function seedUser(t: ReturnType<typeof convexTest>, id: string, projects = 1) {
  await t.run(async (ctx) => {
    await ctx.db.insert('users', {
      tokenIdentifier: token(id), clerkId: id, credits: 0,
      defaultScan: { lastImageS3Key: `pictures/${id}/scan.png`, thumbnailS3Key: `thumbnails/${id}-d.webp`, splatS3Key: `facelifts/${id}-d/output.splat`, updatedAt: 1 },
    });
    await ctx.db.insert('sessions', { userId: token(id), sessionId: `s-${id}`, createdAt: 1, scanS3Key: `pictures/${id}/scan.png` });
    await ctx.db.insert('facelifts', { userId: token(id), jobId: `${id}-f`, splatS3Key: `facelifts/${id}-f/output.splat` });
    for (let i = 0; i < projects; i++) {
      await ctx.db.insert('projects', {
        tokenIdentifier: token(id), name: `p${i}`, createdAt: 1, updatedAt: 1,
        lastImageS3Key: `pictures/${id}/scan.png`,
        lastEditImageS3Key: `edit-images/${id}-${i}.png`,
        thumbnailS3Key: `thumbnails/${id}-${i}.webp`,
        splatS3Key: `facelifts/${id}-e${i}/output.splat`,
        metaS3Key: `facelifts/${id}-e${i}/meta.json`,
        tryOnBaseSplatS3Key: `facelifts/${id}-b${i}/output.splat`,
        lastHairParams: undefined,
      });
    }
  });
}

const counts = (t: ReturnType<typeof convexTest>) => t.run(async (ctx) => ({
  users: (await ctx.db.query('users').collect()).length,
  sessions: (await ctx.db.query('sessions').collect()).length,
  facelifts: (await ctx.db.query('facelifts').collect()).length,
  projects: (await ctx.db.query('projects').collect()).length,
}));

describe('account deletion', () => {
  test('the batch lists every per-user file, including edit images, thumbnails, meta and try-on bases', async () => {
    const { t, as } = setup();
    await seedUser(t, 'alice');
    const batch = await as('alice').query(api.users.accountDeletionBatch, {});
    expect(batch.s3Keys).toEqual(expect.arrayContaining([
      'pictures/alice/scan.png',
      'edit-images/alice-0.png',
      'thumbnails/alice-0.webp',
      'thumbnails/alice-d.webp',
      'facelifts/alice-e0/output.splat',
      'facelifts/alice-e0/meta.json',
      'facelifts/alice-e0/turntable.mp4',
      'facelifts/alice-b0/output.splat',
      'facelifts/alice-f/meta.json',
      'facelifts/alice-d/output.splat',
    ]));
    expect(batch.sessionIds).toHaveLength(1);
    expect(batch.faceliftIds).toHaveLength(1);
    expect(batch.projectIds).toHaveLength(1);
    // Listing deletes nothing: the rows stay until the files are gone.
    expect(await counts(t)).toEqual({ users: 1, sessions: 1, facelifts: 1, projects: 1 });
  });

  test('never queues shared or foreign prefixes', async () => {
    const { t, as } = setup();
    await seedUser(t, 'alice', 0);
    await t.run(async (ctx) => {
      await ctx.db.insert('projects', { tokenIdentifier: token('alice'), name: 'x', createdAt: 1, updatedAt: 1, splatS3Key: 'prebake/men/buzz.splat' });
    });
    const batch = await as('alice').query(api.users.accountDeletionBatch, {});
    expect(batch.s3Keys.some((k) => k.startsWith('prebake/'))).toBe(false);
  });

  test('works past the old 200-row cap, batch by batch, then removes the user', async () => {
    const { t, as } = setup();
    await seedUser(t, 'heavy', 250);
    await seedUser(t, 'bob', 1);
    const alice = as('heavy');
    let rounds = 0;
    for (;;) {
      const batch = await alice.query(api.users.accountDeletionBatch, {});
      if (batch.sessionIds.length + batch.faceliftIds.length + batch.projectIds.length === 0) break;
      await alice.mutation(api.users.deleteAccountRows, { sessionIds: batch.sessionIds, faceliftIds: batch.faceliftIds, projectIds: batch.projectIds });
      rounds++;
    }
    expect(rounds).toBe(3);
    const final = await alice.mutation(api.users.deleteCurrentUserData, {});
    expect(final.done).toBe(true);
    // Only bob is left.
    expect(await counts(t)).toEqual({ users: 1, sessions: 1, facelifts: 1, projects: 1 });
  });

  test("deleteAccountRows skips another user's rows", async () => {
    const { t, as } = setup();
    await seedUser(t, 'alice', 1);
    await seedUser(t, 'bob', 1);
    const bobs = await as('bob').query(api.users.accountDeletionBatch, {});
    await as('alice').mutation(api.users.deleteAccountRows, { sessionIds: bobs.sessionIds, faceliftIds: bobs.faceliftIds, projectIds: bobs.projectIds });
    expect(await counts(t)).toEqual({ users: 2, sessions: 2, facelifts: 2, projects: 2 });
  });

  test('the final step returns leftover rows (with their keys) instead of orphaning them', async () => {
    const { t, as } = setup();
    await seedUser(t, 'alice', 1);
    const first = await as('alice').mutation(api.users.deleteCurrentUserData, {});
    expect(first.done).toBe(false);
    expect(first.s3Keys).toContain('edit-images/alice-0.png');
    expect((await counts(t)).users).toBe(1);
    const second = await as('alice').mutation(api.users.deleteCurrentUserData, {});
    expect(second.done).toBe(true);
    expect(second.s3Keys).toContain('pictures/alice/scan.png');
    expect(await counts(t)).toEqual({ users: 0, sessions: 0, facelifts: 0, projects: 0 });
  });
});

describe('splat ownership', () => {
  test('owner by facelift row, project, or default scan; nobody else', async () => {
    const { t, as } = setup();
    await seedUser(t, 'alice', 1);
    const alice = as('alice');
    expect(await alice.query(api.users.ownsSplatKey, { key: 'facelifts/alice-f/output.splat' })).toBe(true);
    expect(await alice.query(api.users.ownsSplatKey, { key: 'facelifts/alice-e0/meta.json' })).toBe(true);
    expect(await alice.query(api.users.ownsSplatKey, { key: 'facelifts/alice-b0/output.splat' })).toBe(true);
    expect(await alice.query(api.users.ownsSplatKey, { key: 'facelifts/alice-d/output.splat' })).toBe(true);
    expect(await as('mallory').query(api.users.ownsSplatKey, { key: 'facelifts/alice-f/output.splat' })).toBe(false);
    expect(await alice.query(api.users.ownsSplatKey, { key: 'facelifts/unknown/output.splat' })).toBe(false);
    expect(await alice.query(api.users.ownsSplatKey, { key: 'facelifts/alice-f/../x' })).toBe(false);
    expect(await t.query(api.users.ownsSplatKey, { key: 'facelifts/alice-f/output.splat' })).toBe(false);
  });

  test("recordResult can't claim another user's job or point outside the job folder", async () => {
    const { t, as } = setup();
    await seedUser(t, 'alice', 0);
    await expect(as('mallory').mutation(api.facelifts.recordResult, {
      jobId: 'alice-f', splatS3Key: 'facelifts/alice-f/output.splat',
    })).rejects.toThrow(/another user/);
    await expect(as('mallory').mutation(api.facelifts.recordResult, {
      jobId: 'mine', splatS3Key: 'facelifts/alice-f/output.splat',
    })).rejects.toThrow(/outside the job folder/);
    expect(await as('mallory').query(api.users.ownsSplatKey, { key: 'facelifts/alice-f/output.splat' })).toBe(false);
    // Recording your own job twice is harmless.
    await as('alice').mutation(api.facelifts.recordResult, { jobId: 'alice-f', splatS3Key: 'facelifts/alice-f/output.splat' });
    expect((await counts(t)).facelifts).toBe(1);
  });
});
