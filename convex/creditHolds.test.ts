/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

function authed(t: ReturnType<typeof convexTest>, clerkId: string) {
  return t.withIdentity({
    subject: clerkId,
    tokenIdentifier: `https://clerk.test|${clerkId}`,
    email: `${clerkId}@example.com`,
    nickname: clerkId,
  });
}

// t.run's ctx isn't typed with the schema's indexes, so scan (test-only).
async function holdFor(t: ReturnType<typeof convexTest>, jobId: string) {
  const all = await t.run(async (ctx) => ctx.db.query('creditHolds').collect());
  return all.find((h) => h.jobId === jobId) ?? null;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('creditHolds — reserve, commit, release', () => {
  test('consumeGeneration with a jobId spends a paid credit and records a held hold', async () => {
    vi.setSystemTime(Date.UTC(2026, 0, 15));
    const t = convexTest(schema, modules);
    const user = authed(t, 'hold_paid');
    await user.mutation(api.users.getOrCreate, {});
    const before = (await user.query(api.users.getMe, {}))!.credits;

    const res = await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'job_paid' });
    expect(res.path).toBe('paid');
    expect((await user.query(api.users.getMe, {}))!.credits).toBe(before - 1);

    const hold = await holdFor(t, 'job_paid');
    expect(hold).toMatchObject({ jobId: 'job_paid', path: 'paid', status: 'held' });
  });

  test('consumeGeneration without a jobId still charges, just without a hold', async () => {
    const t = convexTest(schema, modules);
    const user = authed(t, 'hold_none');
    await user.mutation(api.users.getOrCreate, {});
    const before = (await user.query(api.users.getMe, {}))!.credits;
    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip' });
    expect((await user.query(api.users.getMe, {}))!.credits).toBe(before - 1);
    expect(await t.run(async (ctx) => ctx.db.query('creditHolds').collect())).toHaveLength(0);
  });

  test('release gives the paid credit back exactly once', async () => {
    const t = convexTest(schema, modules);
    const user = authed(t, 'hold_release');
    await user.mutation(api.users.getOrCreate, {});
    const before = (await user.query(api.users.getMe, {}))!.credits;
    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'job_rel' });

    expect(await user.mutation(api.creditHolds.release, { jobId: 'job_rel' })).toEqual({ applied: true });
    expect((await user.query(api.users.getMe, {}))!.credits).toBe(before);
    expect((await holdFor(t, 'job_rel'))!.status).toBe('released');

    // Idempotent: a second release is a no-op, not a free credit.
    expect(await user.mutation(api.creditHolds.release, { jobId: 'job_rel' })).toEqual({ applied: false });
    expect((await user.query(api.users.getMe, {}))!.credits).toBe(before);
  });

  test('commit keeps the charge and blocks a later release', async () => {
    const t = convexTest(schema, modules);
    const user = authed(t, 'hold_commit');
    await user.mutation(api.users.getOrCreate, {});
    const before = (await user.query(api.users.getMe, {}))!.credits;
    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'job_commit' });

    expect(await user.mutation(api.creditHolds.commit, { jobId: 'job_commit' })).toEqual({ applied: true });
    expect(await user.mutation(api.creditHolds.release, { jobId: 'job_commit' })).toEqual({ applied: false });
    expect((await user.query(api.users.getMe, {}))!.credits).toBe(before - 1);
    expect((await holdFor(t, 'job_commit'))!.status).toBe('committed');
  });

  test('releasing a free-generation hold restores this month\'s quota', async () => {
    vi.setSystemTime(Date.UTC(2026, 0, 15));
    const t = convexTest(schema, modules);
    const user = authed(t, 'hold_free');
    const userId = await user.mutation(api.users.getOrCreate, {});
    await t.run(async (ctx) => ctx.db.patch(userId, { credits: 0 }));

    const res = await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip-f', fingerprintHash: 'dev-f', jobId: 'job_free' });
    expect(res.path).toBe('free');
    const used = (await user.query(api.users.getMe, {}))!.freeGenRemaining;

    await user.mutation(api.creditHolds.release, { jobId: 'job_free' });
    expect((await user.query(api.users.getMe, {}))!.freeGenRemaining).toBe(used + 1);
    // Abuse signals are kept: the device still counts toward its monthly cap.
    expect(await t.run(async (ctx) => ctx.db.query('freeGenGrants').collect())).toHaveLength(2);
  });

  test('another user cannot settle someone else\'s hold', async () => {
    const t = convexTest(schema, modules);
    const owner = authed(t, 'hold_owner');
    const other = authed(t, 'hold_other');
    await owner.mutation(api.users.getOrCreate, {});
    await other.mutation(api.users.getOrCreate, {});
    await owner.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'job_owned' });

    expect(await other.mutation(api.creditHolds.release, { jobId: 'job_owned' })).toEqual({ applied: false });
    expect((await holdFor(t, 'job_owned'))!.status).toBe('held');
  });
});

describe('creditHolds — settled by the build lifecycle', () => {
  async function userWithProject(t: ReturnType<typeof convexTest>, clerkId: string) {
    const user = authed(t, clerkId);
    await user.mutation(api.users.getOrCreate, {});
    const projectId = await user.mutation(api.projects.create, { name: 'Hold test' });
    return { user, projectId };
  }

  test('completeBuild commits the hold; failBuild releases it', async () => {
    const t = convexTest(schema, modules);
    const { user, projectId } = await userWithProject(t, 'life_a');
    const before = (await user.query(api.users.getMe, {}))!.credits;

    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'job_ok' });
    await user.mutation(api.projects.startBuild, { projectId, jobId: 'job_ok' });
    await user.mutation(api.projects.completeBuild, { projectId, jobId: 'job_ok', splatS3Key: 'facelifts/job_ok/output.splat' });
    expect((await holdFor(t, 'job_ok'))!.status).toBe('committed');
    expect((await user.query(api.users.getMe, {}))!.credits).toBe(before - 1);

    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'job_bad' });
    await user.mutation(api.projects.startBuild, { projectId, jobId: 'job_bad' });
    await user.mutation(api.projects.failBuild, { projectId, jobId: 'job_bad', error: 'busy' });
    expect((await holdFor(t, 'job_bad'))!.status).toBe('released');
    expect((await user.query(api.users.getMe, {}))!.credits).toBe(before - 1);
  });

  test('a double submit releases the superseded job\'s hold, so one head costs one credit', async () => {
    const t = convexTest(schema, modules);
    const { user, projectId } = await userWithProject(t, 'life_b');
    const before = (await user.query(api.users.getMe, {}))!.credits;

    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'job_1' });
    await user.mutation(api.projects.startBuild, { projectId, jobId: 'job_1' });
    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'job_2' });
    await user.mutation(api.projects.startBuild, { projectId, jobId: 'job_2' });

    expect((await holdFor(t, 'job_1'))!.status).toBe('released');
    expect((await holdFor(t, 'job_2'))!.status).toBe('held');
    expect((await user.query(api.users.getMe, {}))!.credits).toBe(before - 1);

    // The late write from job_1 is still ignored, and settles nothing.
    expect(await user.mutation(api.projects.completeBuild, { projectId, jobId: 'job_1', splatS3Key: 'k1' })).toEqual({ applied: false });
    expect((await holdFor(t, 'job_2'))!.status).toBe('held');
  });

  test('reapStaleBuilds fails builds stuck past the cutoff and releases their holds', async () => {
    const t = convexTest(schema, modules);
    const { user, projectId } = await userWithProject(t, 'life_c');
    const fresh = await user.mutation(api.projects.create, { name: 'Fresh' });
    const before = (await user.query(api.users.getMe, {}))!.credits;

    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'job_stuck' });
    await user.mutation(api.projects.startBuild, { projectId, jobId: 'job_stuck' });
    await user.mutation(api.projects.startBuild, { projectId: fresh, jobId: 'job_fresh' });
    await t.run(async (ctx) => ctx.db.patch(projectId, { buildStartedAt: Date.now() - 20 * 60 * 1000 }));

    expect(await t.mutation(internal.projects.reapStaleBuilds, {})).toEqual({ reaped: 1 });

    const stuck = await user.query(api.projects.get, { projectId });
    expect(stuck?.buildStatus).toBe('failed');
    expect(stuck?.buildError).toMatch(/timed out/);
    expect((await holdFor(t, 'job_stuck'))!.status).toBe('released');
    expect((await user.query(api.users.getMe, {}))!.credits).toBe(before);

    const stillFresh = await user.query(api.projects.get, { projectId: fresh });
    expect(stillFresh?.buildStatus).toBe('building');
  });
});
