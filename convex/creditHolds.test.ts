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

    expect(await t.mutation(internal.projects.reapStaleBuilds, {})).toEqual({ reaped: 1, reapedEdits: 0 });

    const stuck = await user.query(api.projects.get, { projectId });
    expect(stuck?.buildStatus).toBe('failed');
    expect(stuck?.buildError).toMatch(/timed out/);
    expect((await holdFor(t, 'job_stuck'))!.status).toBe('released');
    expect((await user.query(api.users.getMe, {}))!.credits).toBe(before);

    const stillFresh = await user.query(api.projects.get, { projectId: fresh });
    expect(stillFresh?.buildStatus).toBe('building');
  });

  test('edit builds: complete commits and swaps the head + meta without the build ghost or defaultScan', async () => {
    const t = convexTest(schema, modules);
    const { user, projectId } = await userWithProject(t, 'edit_a');
    await t.run(async (ctx) => {
      await ctx.db.patch(projectId, { lastImageS3Key: 'pictures/x/scan.png', splatS3Key: 'facelifts/orig/output.splat', metaS3Key: 'facelifts/orig/meta.json', buildStatus: 'ready' });
      const u = (await ctx.db.query('users').collect()).find((r) => r.clerkId === 'edit_a')!;
      await ctx.db.patch(u._id, { defaultScan: { lastImageS3Key: 'pictures/x/scan.png', splatS3Key: 'facelifts/orig/output.splat', updatedAt: 1 } });
    });

    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'edit_ok' });
    await user.mutation(api.projects.startEditBuild, { projectId, jobId: 'edit_ok' });
    let p = await user.query(api.projects.get, { projectId });
    expect(p?.editBuildStatus).toBe('building');
    expect(p?.buildStatus).toBe('ready'); // no ghost

    await user.mutation(api.projects.completeEditBuild, { projectId, jobId: 'edit_ok', splatS3Key: 'facelifts/edit_ok/output.splat' });
    p = await user.query(api.projects.get, { projectId });
    expect(p?.editBuildStatus).toBe('ready');
    expect(p?.splatS3Key).toBe('facelifts/edit_ok/output.splat');
    expect(p?.metaS3Key).toBeUndefined(); // the old head's meta must not describe the new head
    expect((await holdFor(t, 'edit_ok'))!.status).toBe('committed');
    const me = await t.run(async (ctx) => (await ctx.db.query('users').collect()).find((r) => r.clerkId === 'edit_a')!);
    expect(me.defaultScan?.splatS3Key).toBe('facelifts/orig/output.splat');
  });

  test('edit builds: a newer edit releases the superseded hold, late results are ignored, failures refund', async () => {
    const t = convexTest(schema, modules);
    const { user, projectId } = await userWithProject(t, 'edit_b');
    const before = (await user.query(api.users.getMe, {}))!.credits;

    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'e1' });
    await user.mutation(api.projects.startEditBuild, { projectId, jobId: 'e1' });
    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'e2' });
    await user.mutation(api.projects.startEditBuild, { projectId, jobId: 'e2' });
    expect((await holdFor(t, 'e1'))!.status).toBe('released');
    expect(await user.mutation(api.projects.completeEditBuild, { projectId, jobId: 'e1', splatS3Key: 'facelifts/e1/output.splat' })).toEqual({ applied: false });

    await user.mutation(api.projects.failEditBuild, { projectId, jobId: 'e2', error: 'busy' });
    expect((await user.query(api.projects.get, { projectId }))?.editBuildStatus).toBe('failed');
    expect((await holdFor(t, 'e2'))!.status).toBe('released');
    expect((await user.query(api.users.getMe, {}))!.credits).toBe(before);
  });

  test('reapStaleBuilds also fails stuck edit builds and refunds them', async () => {
    const t = convexTest(schema, modules);
    const { user, projectId } = await userWithProject(t, 'edit_c');
    const before = (await user.query(api.users.getMe, {}))!.credits;
    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'edit_stuck' });
    await user.mutation(api.projects.startEditBuild, { projectId, jobId: 'edit_stuck' });
    await t.run(async (ctx) => ctx.db.patch(projectId, { editBuildStartedAt: Date.now() - 20 * 60 * 1000 }));

    expect(await t.mutation(internal.projects.reapStaleBuilds, {})).toEqual({ reaped: 0, reapedEdits: 1 });
    const p = await user.query(api.projects.get, { projectId });
    expect(p?.editBuildStatus).toBe('failed');
    expect(p?.editBuildError).toMatch(/timed out/);
    expect((await user.query(api.users.getMe, {}))!.credits).toBe(before);
  });
});

describe('edit jobs — the image edit and the 3D build as one job (/api/edit-job)', () => {
  async function userWithProject(t: ReturnType<typeof convexTest>, clerkId: string) {
    const user = authed(t, clerkId);
    await user.mutation(api.users.getOrCreate, {});
    const projectId = await user.mutation(api.projects.create, { name: 'Edit job test' });
    return { user, projectId };
  }

  test('editing → building → ready: the photo is linked at the hand-off, the hold commits at the end', async () => {
    const t = convexTest(schema, modules);
    const { user, projectId } = await userWithProject(t, 'job_a');
    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'j1' });
    await user.mutation(api.projects.startEditBuild, { projectId, jobId: 'j1', stage: 'editing' });
    let p = await user.query(api.projects.get, { projectId });
    expect(p).toMatchObject({ editBuildStatus: 'building', editBuildStage: 'editing', editBuildJobId: 'j1' });

    expect(await user.mutation(api.projects.markEditImageReady, { projectId, jobId: 'j1', lastEditImageS3Key: 'edit-images/j1.png' }))
      .toEqual({ applied: true });
    p = await user.query(api.projects.get, { projectId });
    expect(p).toMatchObject({ editBuildStatus: 'building', editBuildStage: 'building', lastEditImageS3Key: 'edit-images/j1.png' });
    expect((await holdFor(t, 'j1'))!.status).toBe('held');

    await user.mutation(api.projects.completeEditBuild, { projectId, jobId: 'j1', splatS3Key: 'facelifts/j1/output.splat', prompt: 'short fade' });
    p = await user.query(api.projects.get, { projectId });
    // The stage stays: a client that missed the hand-off still knows this job made the photo.
    expect(p).toMatchObject({ editBuildStatus: 'ready', editBuildStage: 'building', splatS3Key: 'facelifts/j1/output.splat' });
    expect(p?.editPrompts?.map((e) => e.prompt)).toEqual(['short fade']);
    expect((await holdFor(t, 'j1'))!.status).toBe('committed');
  });

  test("a superseded job's photo is refused (so it is never built), and its hold was already released", async () => {
    const t = convexTest(schema, modules);
    const { user, projectId } = await userWithProject(t, 'job_b');
    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'old' });
    await user.mutation(api.projects.startEditBuild, { projectId, jobId: 'old', stage: 'editing' });
    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'new' });
    await user.mutation(api.projects.startEditBuild, { projectId, jobId: 'new', stage: 'editing' });

    expect(await user.mutation(api.projects.markEditImageReady, { projectId, jobId: 'old', lastEditImageS3Key: 'edit-images/old.png' }))
      .toEqual({ applied: false });
    const p = await user.query(api.projects.get, { projectId });
    expect(p).toMatchObject({ editBuildJobId: 'new', editBuildStage: 'editing' });
    expect(p?.lastEditImageS3Key).toBeUndefined();
    expect((await holdFor(t, 'old'))!.status).toBe('released');
  });

  test('a failed or reaped job cannot be moved on to the build afterwards', async () => {
    const t = convexTest(schema, modules);
    const { user, projectId } = await userWithProject(t, 'job_c');
    await user.mutation(api.projects.startEditBuild, { projectId, jobId: 'j_fail', stage: 'editing' });
    await user.mutation(api.projects.failEditBuild, { projectId, jobId: 'j_fail', error: "We couldn't create that look. Please try again." });
    expect(await user.mutation(api.projects.markEditImageReady, { projectId, jobId: 'j_fail', lastEditImageS3Key: 'edit-images/late.png' }))
      .toEqual({ applied: false });
    // Failed while editing: the stage says no photo came out of it.
    expect(await user.query(api.projects.get, { projectId })).toMatchObject({ editBuildStatus: 'failed', editBuildStage: 'editing' });
  });

  test('the reaper fails a job stuck in the image edit and refunds it', async () => {
    const t = convexTest(schema, modules);
    const { user, projectId } = await userWithProject(t, 'job_d');
    const before = (await user.query(api.users.getMe, {}))!.credits;
    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'j_stuck' });
    await user.mutation(api.projects.startEditBuild, { projectId, jobId: 'j_stuck', stage: 'editing' });
    await t.run(async (ctx) => ctx.db.patch(projectId, { editBuildStartedAt: Date.now() - 20 * 60 * 1000 }));

    expect(await t.mutation(internal.projects.reapStaleBuilds, {})).toEqual({ reaped: 0, reapedEdits: 1 });
    expect((await user.query(api.projects.get, { projectId }))?.editBuildStatus).toBe('failed');
    expect((await user.query(api.users.getMe, {}))!.credits).toBe(before);
  });

  test("another user can't move someone's edit job along", async () => {
    const t = convexTest(schema, modules);
    const { user, projectId } = await userWithProject(t, 'job_owner');
    await user.mutation(api.projects.startEditBuild, { projectId, jobId: 'j_own', stage: 'editing' });
    const other = authed(t, 'job_other');
    await other.mutation(api.users.getOrCreate, {});
    await expect(other.mutation(api.projects.markEditImageReady, { projectId, jobId: 'j_own', lastEditImageS3Key: 'edit-images/x.png' }))
      .rejects.toThrow(/Not found/);
  });

  test('a photo-first edit (no stage) clears the stage a previous edit job left', async () => {
    const t = convexTest(schema, modules);
    const { user, projectId } = await userWithProject(t, 'job_e');
    await user.mutation(api.projects.startEditBuild, { projectId, jobId: 'staged', stage: 'editing' });
    await user.mutation(api.projects.startEditBuild, { projectId, jobId: 'plain' });
    expect((await user.query(api.projects.get, { projectId }))?.editBuildStage).toBeUndefined();
  });
});
