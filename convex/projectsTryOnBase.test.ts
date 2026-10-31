/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

function userEnv(base: ReturnType<typeof convexTest>, clerkId: string) {
  return base.withIdentity({
    subject: clerkId,
    tokenIdentifier: `https://clerk.test|${clerkId}`,
    email: `${clerkId}@example.com`,
  });
}

async function setup() {
  const base = convexTest(schema, modules);
  const owner = userEnv(base, 'owner_tryon');
  await owner.mutation(api.users.getOrCreate, {});
  const projectId = await owner.mutation(api.projects.create, { name: 'Try-on test' });
  return { base, owner, projectId };
}

describe('projects.setTryOnBase', () => {
  test('stores the buzz-cut base keys on the owner’s project', async () => {
    const { owner, projectId } = await setup();
    await owner.mutation(api.projects.setTryOnBase, {
      projectId,
      splatS3Key: 'facelifts/job_buzz/output.splat',
      metaS3Key: 'facelifts/job_buzz/meta.json',
    });
    const project = await owner.query(api.projects.get, { projectId });
    expect(project?.tryOnBaseSplatS3Key).toBe('facelifts/job_buzz/output.splat');
    expect(project?.tryOnBaseMetaS3Key).toBe('facelifts/job_buzz/meta.json');
  });

  test('rejects keys that are not worker output keys', async () => {
    const { owner, projectId } = await setup();
    await expect(owner.mutation(api.projects.setTryOnBase, {
      projectId,
      splatS3Key: 'pictures/someone-else.jpg',
    })).rejects.toThrow(/Invalid splat key/);
    await expect(owner.mutation(api.projects.setTryOnBase, {
      projectId,
      splatS3Key: 'facelifts/job_ok/output.splat',
      metaS3Key: 'facelifts/../secrets.json',
    })).rejects.toThrow(/Invalid meta key/);
  });

  test('another user cannot set the base on someone else’s project', async () => {
    const { base, projectId } = await setup();
    const intruder = userEnv(base, 'intruder_tryon');
    await intruder.mutation(api.users.getOrCreate, {});
    await expect(intruder.mutation(api.projects.setTryOnBase, {
      projectId,
      splatS3Key: 'facelifts/job_x/output.splat',
    })).rejects.toThrow(/Not found/);
  });
});
