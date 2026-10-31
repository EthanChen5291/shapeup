/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

function userEnv(base: ReturnType<typeof convexTest>, clerkId: string) {
  return base.withIdentity({
    subject: clerkId,
    tokenIdentifier: `https://clerk.test|${clerkId}`,
    email: `${clerkId}@example.com`,
  });
}

const sample = { gender: 'man', cutId: 'middlepart', variantId: 'middlepart_middlepart_brown', scale: 2.6, dx: 0.01, dy: -0.02, dz: -0.08, alpha: 1.3, headAlpha: 1.6 };

afterEach(() => vi.unstubAllEnvs());

describe('prebakeCalibrations', () => {
  test('an admin can submit and read back the latest per cut, newest first', async () => {
    vi.stubEnv('ADMIN_CLERK_IDS', 'admin_1');
    const base = convexTest(schema, modules);
    const admin = userEnv(base, 'admin_1');
    await admin.mutation(api.prebakeCalibrations.submit, { ...sample, scale: 2.5 });
    await admin.mutation(api.prebakeCalibrations.submit, { ...sample, scale: 2.7, note: 'better' });

    const latest = await admin.query(api.prebakeCalibrations.latestForCut, { cutId: 'middlepart' });
    expect(latest?.scale).toBe(2.7);
    expect(latest?.variantId).toBe(sample.variantId);
    expect(latest?.headAlpha).toBe(1.6);

    const all = await base.query(internal.prebakeCalibrations.list, {});
    expect(all.map((r) => r.scale)).toEqual([2.7, 2.5]);
    expect(all[0].note).toBe('better');
    expect(all[0].clerkId).toBe('admin_1');
  });

  test('non-admins cannot submit, and see null instead of other people’s calibrations', async () => {
    vi.stubEnv('ADMIN_CLERK_IDS', 'admin_1');
    const base = convexTest(schema, modules);
    const admin = userEnv(base, 'admin_1');
    const user = userEnv(base, 'user_9');
    await admin.mutation(api.prebakeCalibrations.submit, sample);

    await expect(user.mutation(api.prebakeCalibrations.submit, sample)).rejects.toThrow(/Forbidden/);
    expect(await user.query(api.prebakeCalibrations.latestForCut, { cutId: 'middlepart' })).toBeNull();
    // `list` is an internalQuery (CLI only). convex-test doesn't model public vs
    // internal visibility; the deployment and the generated types enforce it.
  });

  test('fails closed when no allowlist is configured', async () => {
    vi.stubEnv('ADMIN_CLERK_IDS', '');
    const base = convexTest(schema, modules);
    const someone = userEnv(base, 'admin_1');
    await expect(someone.mutation(api.prebakeCalibrations.submit, sample)).rejects.toThrow(/Forbidden/);
  });

  test('rejects nonsense numbers', async () => {
    vi.stubEnv('ADMIN_CLERK_IDS', 'admin_1');
    const admin = userEnv(convexTest(schema, modules), 'admin_1');
    await expect(admin.mutation(api.prebakeCalibrations.submit, { ...sample, scale: 0 })).rejects.toThrow(/positive/);
    await expect(admin.mutation(api.prebakeCalibrations.submit, { ...sample, dx: Number.NaN })).rejects.toThrow(/Invalid dx/);
  });
});
