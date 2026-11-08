/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

function setup() {
  const t = convexTest(schema, modules);
  const as = (id: string) => t.withIdentity({ subject: id, tokenIdentifier: `https://clerk.test|${id}`, email: `${id}@example.com`, nickname: id });
  return { t, as };
}

describe('projects.setTryOnSelection', () => {
  test('saves and clears the chosen style for the owner', async () => {
    const { as } = setup();
    const owner = as('sel_owner');
    await owner.mutation(api.users.getOrCreate, {});
    const projectId = await owner.mutation(api.projects.create, { name: 'Try-on' });

    await owner.mutation(api.projects.setTryOnSelection, { projectId, variantId: 'm-middlepart-darkbrown' });
    expect((await owner.query(api.projects.get, { projectId }))?.tryOnVariantId).toBe('m-middlepart-darkbrown');

    await owner.mutation(api.projects.setTryOnSelection, { projectId, variantId: null });
    expect((await owner.query(api.projects.get, { projectId }))?.tryOnVariantId).toBeUndefined();
  });

  test("another user can't set it, and malformed ids are rejected", async () => {
    const { as } = setup();
    const owner = as('sel_a');
    await owner.mutation(api.users.getOrCreate, {});
    const projectId = await owner.mutation(api.projects.create, { name: 'Mine' });
    await expect(as('sel_b').mutation(api.projects.setTryOnSelection, { projectId, variantId: 'm-buzz' })).rejects.toThrow(/Not found/);
    await expect(owner.mutation(api.projects.setTryOnSelection, { projectId, variantId: '../etc' })).rejects.toThrow(/Invalid try-on style/);
    await expect(owner.mutation(api.projects.setTryOnSelection, { projectId, variantId: 'x'.repeat(101) })).rejects.toThrow(/Invalid try-on style/);
  });

  test('a finished edit clears the saved style, so the project reopens on the edit', async () => {
    const { as } = setup();
    const owner = as('sel_edit');
    await owner.mutation(api.users.getOrCreate, {});
    const projectId = await owner.mutation(api.projects.create, { name: 'Edited' });
    await owner.mutation(api.projects.setTryOnSelection, { projectId, variantId: 'w-lob-mocha' });

    await owner.mutation(api.projects.startEditBuild, { projectId, jobId: 'edit_1' });
    await owner.mutation(api.projects.completeEditBuild, { projectId, jobId: 'edit_1', splatS3Key: 'facelifts/edit_1/output.splat' });
    expect((await owner.query(api.projects.get, { projectId }))?.tryOnVariantId).toBeUndefined();
  });
});
