/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

async function setup() {
  const t = convexTest(schema, modules).withIdentity({
    subject: 'layout_user', tokenIdentifier: 'https://clerk.test|layout_user', email: 'layout_user@example.com',
  });
  await t.mutation(api.users.getOrCreate, {});
  return t;
}

describe('users.setStudioLayout', () => {
  test('saves each dimension independently, keeping the other', async () => {
    const t = await setup();
    await t.mutation(api.users.setStudioLayout, { sidebarWidth: 372 });
    await t.mutation(api.users.setStudioLayout, { cutListHeight: 240 });
    expect((await t.query(api.users.getMe, {}))?.studioLayout).toEqual({ sidebarWidth: 372, cutListHeight: 240 });
  });

  test('clamps out-of-range values to the drag bounds', async () => {
    const t = await setup();
    await t.mutation(api.users.setStudioLayout, { sidebarWidth: 9999, cutListHeight: 5 });
    expect((await t.query(api.users.getMe, {}))?.studioLayout).toEqual({ sidebarWidth: 640, cutListHeight: 96 });
  });

  test('0 folds the trending list away (kept as 0, not clamped up)', async () => {
    const t = await setup();
    await t.mutation(api.users.setStudioLayout, { cutListHeight: 0 });
    expect((await t.query(api.users.getMe, {}))?.studioLayout).toEqual({ cutListHeight: 0 });
  });
});

describe('users.setStudioLayout clearing', () => {
  test('null clears one dimension back to the default and keeps the other', async () => {
    const t = convexTest(schema, modules).withIdentity({
      subject: 'layout_clear', tokenIdentifier: 'https://clerk.test|layout_clear', email: 'layout_clear@example.com',
    });
    await t.mutation(api.users.getOrCreate, {});
    await t.mutation(api.users.setStudioLayout, { sidebarWidth: 400, cutListHeight: 300 });
    await t.mutation(api.users.setStudioLayout, { cutListHeight: null });
    expect((await t.query(api.users.getMe, {}))?.studioLayout).toEqual({ sidebarWidth: 400 });
  });
});
