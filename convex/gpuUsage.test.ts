/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

function authed(t: ReturnType<typeof convexTest>, clerkId: string) {
  return t.withIdentity({
    subject: clerkId,
    tokenIdentifier: `https://clerk.test|${clerkId}`,
  });
}

describe('gpuUsage.record', () => {
  test('rejects anonymous callers', async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(api.gpuUsage.record, { seconds: 100 })).rejects.toThrow('Unauthenticated');
    expect((await t.query(api.gpuUsage.usage, {})).seconds).toBe(0);
  });

  test('accumulates signed-in builds and clamps implausible per-call values', async () => {
    const t = convexTest(schema, modules);
    const user = authed(t, 'user_a');
    await user.mutation(api.gpuUsage.record, { seconds: 42 });
    await user.mutation(api.gpuUsage.record, { seconds: 1e9 });
    expect((await t.query(api.gpuUsage.usage, {})).seconds).toBe(42 + 300);
  });
});
