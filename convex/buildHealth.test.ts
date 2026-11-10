/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { FAILURE_RATE_ALERT, MIN_BUILDS, MIN_BUILDS_FOR_P95, P95_ALERT_MS, percentile, summarizeBuilds, type SettledHold } from './buildHealth';

const modules = import.meta.glob('./**/*.ts');

function authed(t: ReturnType<typeof convexTest>, clerkId: string) {
  return t.withIdentity({ subject: clerkId, tokenIdentifier: `https://clerk.test|${clerkId}`, email: `${clerkId}@example.com`, nickname: clerkId });
}
async function userWithProject(t: ReturnType<typeof convexTest>, clerkId: string) {
  const user = authed(t, clerkId);
  await user.mutation(api.users.getOrCreate, {});
  // Enough paid credits for every build a test starts.
  await t.run(async (ctx) => {
    const me = (await ctx.db.query('users').collect()).find((u) => u.tokenIdentifier.endsWith(`|${clerkId}`));
    await ctx.db.patch(me!._id, { credits: 50 });
  });
  const projectId = await user.mutation(api.projects.create, { name: 'Head' });
  return { user, projectId };
}
async function holdFor(t: ReturnType<typeof convexTest>, jobId: string) {
  const all = await t.run(async (ctx) => ctx.db.query('creditHolds').collect());
  return all.find((h) => h.jobId === jobId) ?? null;
}

const done = (ms: number): SettledHold => ({ status: 'committed', settleReason: 'completed', createdAt: 0, settledAt: ms });
const fail = (reason: 'failed' | 'stale'): SettledHold => ({ status: 'released', settleReason: reason, createdAt: 0, settledAt: 1 });

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('summarizeBuilds', () => {
  test('percentile uses nearest rank', () => {
    expect(percentile([], 95)).toBeNull();
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 95)).toBe(19);
  });

  test('a healthy hour raises nothing', () => {
    const h = summarizeBuilds([done(9000), done(10000), done(11000), done(12000), done(8000), fail('failed')]);
    expect(h).toMatchObject({ completed: 5, failed: 1, stale: 0, failureRate: 1 / 6 });
    expect(h.alerts).toEqual([expect.stringMatching(/Failure rate 17%/)]); // 1 of 6 is over 10 %
  });

  test('superseded builds are not failures, and legacy holds without a reason are skipped', () => {
    const h = summarizeBuilds([
      ...Array.from({ length: MIN_BUILDS }, () => done(9000)),
      { status: 'released', settleReason: 'superseded', createdAt: 0, settledAt: 1 },
      { status: 'released', createdAt: 0, settledAt: 1 },
    ]);
    expect(h).toMatchObject({ completed: MIN_BUILDS, superseded: 1, failureRate: 0, alerts: [] });
  });

  test('too few builds never alert, however bad the rate', () => {
    const h = summarizeBuilds([done(9000), fail('failed'), fail('stale')]);
    expect(h.failureRate).toBeCloseTo(2 / 3);
    expect(h.alerts).toEqual([]);
  });

  test('flags the failure rate and the p95 independently', () => {
    const slow = Array.from({ length: 20 }, (_, i) => done(i < 18 ? 10_000 : P95_ALERT_MS + 30_000));
    const h = summarizeBuilds([...slow, fail('stale'), fail('failed'), fail('failed')]);
    expect(h.failureRate).toBeGreaterThan(FAILURE_RATE_ALERT);
    expect(h.p95Ms).toBe(P95_ALERT_MS + 30_000);
    expect(h.alerts).toHaveLength(2);
    expect(h.alerts[1]).toMatch(/p95 build time 55\.0 s over 20 builds \(threshold 25 s\)/);
  });

  test('a slow hour alerts from just two builds; one build or fast builds do not', () => {
    expect(MIN_BUILDS_FOR_P95).toBe(2);
    expect(P95_ALERT_MS).toBe(25_000);
    expect(summarizeBuilds([done(31_000)]).alerts).toEqual([]);                       // one build: not enough
    expect(summarizeBuilds([done(9_000), done(24_000)]).alerts).toEqual([]);          // slowest under 25 s
    expect(summarizeBuilds([done(9_000), done(31_000)]).alerts).toEqual([expect.stringMatching(/p95 build time 31\.0 s over 2 builds/)]);
  });
});

describe('settle reasons and the alert path', () => {
  test('every way a build ends records why its hold settled', async () => {
    const t = convexTest(schema, modules);
    const { user, projectId } = await userWithProject(t, 'bh_a');
    for (const jobId of ['j_done', 'j_fail', 'j_super', 'j_new', 'j_stuck']) {
      await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId });
    }
    await user.mutation(api.projects.startBuild, { projectId, jobId: 'j_done' });
    await user.mutation(api.projects.completeBuild, { projectId, jobId: 'j_done', splatS3Key: 'k' });
    await user.mutation(api.projects.startBuild, { projectId, jobId: 'j_fail' });
    await user.mutation(api.projects.failBuild, { projectId, jobId: 'j_fail', error: 'busy' });
    await user.mutation(api.projects.startBuild, { projectId, jobId: 'j_super' });
    await user.mutation(api.projects.startBuild, { projectId, jobId: 'j_new' });
    await user.mutation(api.creditHolds.release, { jobId: 'j_new' });

    expect((await holdFor(t, 'j_done'))!.settleReason).toBe('completed');
    expect((await holdFor(t, 'j_fail'))!.settleReason).toBe('failed');
    expect((await holdFor(t, 'j_super'))!.settleReason).toBe('superseded');
    expect((await holdFor(t, 'j_new'))!.settleReason).toBe('failed');
  });

  test('the reaper records stale holds and schedules an alert', async () => {
    const t = convexTest(schema, modules);
    const { user, projectId } = await userWithProject(t, 'bh_b');
    await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: 'j_stuck' });
    await user.mutation(api.projects.startBuild, { projectId, jobId: 'j_stuck' });
    await t.run(async (ctx) => ctx.db.patch(projectId, { buildStartedAt: Date.now() - 20 * 60 * 1000 }));

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await t.mutation(internal.projects.reapStaleBuilds, {});
    expect((await holdFor(t, 'j_stuck'))!.settleReason).toBe('stale');
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const alert = warn.mock.calls.map((c) => String(c[0])).find((l) => l.includes('"event":"alert"'));
    expect(JSON.parse(alert!)).toMatchObject({ title: 'Builds reaped', delivered: false });
    expect(JSON.parse(alert!).lines.join(' ')).toContain('j_stuck');
  });

  test('check posts to the webhook only when a threshold is crossed', async () => {
    const t = convexTest(schema, modules);
    const { user } = await userWithProject(t, 'bh_c');
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('BUILD_ALERTS_WEBHOOK_URL', 'https://discord.test/hook');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Healthy: five completed builds.
    for (let i = 0; i < MIN_BUILDS; i++) {
      await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: `ok_${i}` });
      await user.mutation(api.creditHolds.commit, { jobId: `ok_${i}` });
    }
    await t.action(internal.buildHealth.check, {});
    expect(fetchMock).not.toHaveBeenCalled();

    // Unhealthy: five failures on top.
    for (let i = 0; i < MIN_BUILDS; i++) {
      await user.mutation(api.freeGen.consumeGeneration, { ipHash: 'ip', jobId: `bad_${i}` });
      await user.mutation(api.creditHolds.release, { jobId: `bad_${i}` });
    }
    await t.action(internal.buildHealth.check, {});
    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.embeds[0].description).toMatch(/Failure rate 50%/);
  });
});

describe('Sentry logs from Convex', () => {
  test('the hourly summary goes to Sentry Logs when SENTRY_DSN is set', async () => {
    const t = convexTest(schema, modules);
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('SENTRY_DSN', 'https://pubkey@o1.ingest.us.sentry.io/2');
    vi.stubEnv('SENTRY_ENVIRONMENT', 'test');
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await t.action(internal.buildHealth.check, {});

    const call = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([url]) => url.startsWith('https://o1.ingest.us.sentry.io/api/2/envelope/'));
    expect(call).toBeDefined();
    const item = JSON.parse(String(call![1].body).split('\n')[2]).items[0];
    expect(item).toMatchObject({ body: 'build.health', level: 'info' });
    expect(item.attributes).toMatchObject({ svc: { value: 'convex' }, completed: { value: 0 }, 'sentry.environment': { value: 'test' } });
  });
});
