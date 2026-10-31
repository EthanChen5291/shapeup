/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import { MAX_EDIT_PROMPTS } from './projects';

const modules = import.meta.glob('./**/*.ts');

function userEnv(base: ReturnType<typeof convexTest>, clerkId: string) {
  return base.withIdentity({ subject: clerkId, tokenIdentifier: `https://clerk.test|${clerkId}`, email: `${clerkId}@example.com` });
}

async function setup() {
  const base = convexTest(schema, modules);
  const owner = userEnv(base, 'owner_recap');
  await owner.mutation(api.users.getOrCreate, {});
  const projectId = await owner.mutation(api.projects.create, { name: 'Recap test' });
  return { base, owner, projectId };
}

describe('projects.recordEditPrompt', () => {
  test('appends trimmed requests in order and ignores blank ones', async () => {
    const { owner, projectId } = await setup();
    await owner.mutation(api.projects.recordEditPrompt, { projectId, prompt: '  low taper fade  ' });
    await owner.mutation(api.projects.recordEditPrompt, { projectId, prompt: '   ' });
    await owner.mutation(api.projects.recordEditPrompt, { projectId, prompt: 'keep the fade, add a fringe' });
    const project = await owner.query(api.projects.get, { projectId });
    expect(project?.editPrompts?.map((e) => e.prompt)).toEqual(['low taper fade', 'keep the fade, add a fringe']);
  });

  test(`keeps only the newest ${MAX_EDIT_PROMPTS}`, async () => {
    const { owner, projectId } = await setup();
    for (let i = 0; i < MAX_EDIT_PROMPTS + 3; i++) {
      await owner.mutation(api.projects.recordEditPrompt, { projectId, prompt: `cut ${i}` });
    }
    const prompts = (await owner.query(api.projects.get, { projectId }))?.editPrompts ?? [];
    expect(prompts).toHaveLength(MAX_EDIT_PROMPTS);
    expect(prompts[0].prompt).toBe('cut 3');
    expect(prompts.at(-1)?.prompt).toBe(`cut ${MAX_EDIT_PROMPTS + 2}`);
  });

  test('another user cannot write to someone else’s project', async () => {
    const { base, projectId } = await setup();
    const intruder = userEnv(base, 'intruder_recap');
    await intruder.mutation(api.users.getOrCreate, {});
    await expect(intruder.mutation(api.projects.recordEditPrompt, { projectId, prompt: 'x' })).rejects.toThrow(/Not found/);
  });
});
