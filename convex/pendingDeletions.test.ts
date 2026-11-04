/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { MAX_ATTEMPTS } from './pendingDeletions';

const modules = import.meta.glob('./**/*.ts');

// Mirrors the authed() helper in creditHolds.test.ts: returns an authed
// wrapper around the base convexTest instance.
function authed(t: ReturnType<typeof convexTest>, clerkId: string) {
  return t.withIdentity({
    subject: clerkId,
    tokenIdentifier: `https://clerk.test|${clerkId}`,
    email: `${clerkId}@example.com`,
  });
}

async function setupProject(user: ReturnType<typeof authed>) {
  await user.mutation(api.users.getOrCreate, {});
  return user.mutation(api.projects.create, { name: 'Deletion test' });
}

// Collect all pendingDeletions rows via the base (unauthenticated) runner.
// t.run's ctx isn't typed with schema indexes, so a full collect() is used —
// acceptable for small test tables (comment mirrors creditHolds.test.ts).
async function allPending(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => ctx.db.query('pendingDeletions').collect());
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('pendingDeletions — supersede enqueues', () => {
  test('startBuild superseding a running build enqueues 3 rows with notBefore >= 20 min', async () => {
    vi.setSystemTime(Date.UTC(2026, 0, 15, 12, 0, 0));
    const t = convexTest(schema, modules);
    const user = authed(t, 'pd_sup_build');
    const projectId = await setupProject(user);

    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'old_job' });
    await user.mutation(api.projects.startBuild, { projectId, jobId: 'old_job' });

    const before = Date.now();
    // A second startBuild supersedes old_job
    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'new_job' });
    await user.mutation(api.projects.startBuild, { projectId, jobId: 'new_job' });

    const rows = await allPending(t);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.s3Key).sort()).toEqual([
      'facelifts/old_job/meta.json',
      'facelifts/old_job/output.ply',
      'facelifts/old_job/output.splat',
    ]);
    for (const r of rows) {
      expect(r.reason).toBe('superseded_build');
      expect(r.jobId).toBe('old_job');
      expect(r.notBefore).toBeGreaterThanOrEqual(before + 20 * 60 * 1000);
      expect(r.attempts).toBe(0);
    }
  });

  test('startEditBuild superseding a running edit enqueues 3 rows with reason superseded_edit', async () => {
    vi.setSystemTime(Date.UTC(2026, 0, 15, 13, 0, 0));
    const t = convexTest(schema, modules);
    const user = authed(t, 'pd_sup_edit');
    const projectId = await setupProject(user);

    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'old_edit' });
    await user.mutation(api.projects.startEditBuild, { projectId, jobId: 'old_edit' });

    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'new_edit' });
    await user.mutation(api.projects.startEditBuild, { projectId, jobId: 'new_edit' });

    const rows = await allPending(t);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.reason).toBe('superseded_edit');
      expect(r.jobId).toBe('old_edit');
    }
  });
});

describe('pendingDeletions — reap enqueues', () => {
  test('reapStaleBuilds enqueues 3 rows for a timed-out build', async () => {
    vi.setSystemTime(Date.UTC(2026, 0, 15, 14, 0, 0));
    const t = convexTest(schema, modules);
    const user = authed(t, 'pd_reap_build');
    const projectId = await setupProject(user);

    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'stale_job' });
    await user.mutation(api.projects.startBuild, { projectId, jobId: 'stale_job' });
    // Wind the clock back so the build appears stale to the reaper
    await t.run(async (ctx) =>
      ctx.db.patch(projectId, { buildStartedAt: Date.now() - 20 * 60 * 1000 }),
    );

    await t.mutation(internal.projects.reapStaleBuilds, {});

    const rows = await allPending(t);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.reason).toBe('stale_build');
      expect(r.jobId).toBe('stale_job');
    }
  });

  test('reapStaleBuilds enqueues 3 rows for a timed-out edit build', async () => {
    vi.setSystemTime(Date.UTC(2026, 0, 15, 15, 0, 0));
    const t = convexTest(schema, modules);
    const user = authed(t, 'pd_reap_edit');
    const projectId = await setupProject(user);

    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'stale_edit' });
    await user.mutation(api.projects.startEditBuild, { projectId, jobId: 'stale_edit' });
    await t.run(async (ctx) =>
      ctx.db.patch(projectId, { editBuildStartedAt: Date.now() - 20 * 60 * 1000 }),
    );

    await t.mutation(internal.projects.reapStaleBuilds, {});

    const rows = await allPending(t);
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.reason).toBe('stale_edit');
      expect(r.jobId).toBe('stale_edit');
    }
  });
});

describe('pendingDeletions — idempotent enqueue', () => {
  test('a double supersede on the same jobId enqueues each key only once', async () => {
    vi.setSystemTime(Date.UTC(2026, 0, 15, 16, 0, 0));
    const t = convexTest(schema, modules);
    const user = authed(t, 'pd_idem');
    const projectId = await setupProject(user);

    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'dup_job' });
    await user.mutation(api.projects.startBuild, { projectId, jobId: 'dup_job' });

    // First supersede: dup_job gets 3 rows
    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'win_job' });
    await user.mutation(api.projects.startBuild, { projectId, jobId: 'win_job' });
    expect(await allPending(t)).toHaveLength(3);

    // Second supersede: win_job gets 3 new rows; dup_job rows must NOT be re-inserted
    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'win2_job' });
    await user.mutation(api.projects.startBuild, { projectId, jobId: 'win2_job' });
    const all = await allPending(t);
    expect(all).toHaveLength(6);
    expect(all.filter((r) => r.jobId === 'dup_job')).toHaveLength(3);
  });
});

describe('pendingDeletions — dueRows query and recordFailure', () => {
  test('dueRows returns only rows past notBefore and excludes exhausted ones', async () => {
    vi.setSystemTime(Date.UTC(2026, 0, 15, 17, 0, 0));
    const t = convexTest(schema, modules);
    const now = Date.now();

    await t.run(async (ctx) => {
      // Due and eligible
      await ctx.db.insert('pendingDeletions', {
        s3Key: 'facelifts/due_job/output.splat',
        reason: 'stale_build',
        jobId: 'due_job',
        notBefore: now - 1000,
        createdAt: now - 25 * 60 * 1000,
        attempts: 0,
      });
      // Not yet due
      await ctx.db.insert('pendingDeletions', {
        s3Key: 'facelifts/future_job/output.splat',
        reason: 'stale_build',
        jobId: 'future_job',
        notBefore: now + 60 * 1000,
        createdAt: now - 5 * 60 * 1000,
        attempts: 0,
      });
      // Due but exhausted — must be excluded
      await ctx.db.insert('pendingDeletions', {
        s3Key: 'facelifts/dead_job/output.splat',
        reason: 'stale_build',
        jobId: 'dead_job',
        notBefore: now - 1000,
        createdAt: now - 25 * 60 * 1000,
        attempts: MAX_ATTEMPTS,
      });
    });

    const due = await t.query(internal.pendingDeletions.dueRows, {});
    expect(due).toHaveLength(1);
    expect(due[0].jobId).toBe('due_job');
  });

  test('recordFailure increments attempts and stores lastError', async () => {
    vi.setSystemTime(Date.UTC(2026, 0, 15, 18, 0, 0));
    const t = convexTest(schema, modules);

    const id = await t.run(async (ctx) =>
      ctx.db.insert('pendingDeletions', {
        s3Key: 'facelifts/fail_job/output.splat',
        reason: 'superseded_build',
        jobId: 'fail_job',
        notBefore: Date.now() - 1000,
        createdAt: Date.now() - 25 * 60 * 1000,
        attempts: 0,
      }),
    );

    await t.mutation(internal.pendingDeletions.recordFailure, {
      id,
      lastError: 'network timeout',
    });
    const row = await t.run(async (ctx) => ctx.db.get(id));
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toBe('network timeout');

    await t.mutation(internal.pendingDeletions.recordFailure, {
      id,
      lastError: 'access denied',
    });
    const row2 = await t.run(async (ctx) => ctx.db.get(id));
    expect(row2?.attempts).toBe(2);
    expect(row2?.lastError).toBe('access denied');
  });
});
