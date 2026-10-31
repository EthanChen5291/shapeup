/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

function owner(clerkId: string) {
  return convexTest(schema, modules).withIdentity({
    subject: clerkId,
    tokenIdentifier: `https://clerk.test|${clerkId}`,
    email: `${clerkId}@example.com`,
  });
}

describe('sidecar metaS3Key', () => {
  test('completeBuild stores the meta key when given and leaves it unset otherwise', async () => {
    const t = owner('meta_a');
    await t.mutation(api.users.getOrCreate, {});
    const projectId = await t.mutation(api.projects.create, { name: 'Meta' });

    await t.mutation(api.projects.startBuild, { projectId, jobId: 'j1' });
    await t.mutation(api.projects.completeBuild, { projectId, jobId: 'j1', splatS3Key: 'facelifts/j1/output.splat' });
    expect((await t.query(api.projects.get, { projectId }))?.metaS3Key).toBeUndefined();

    await t.mutation(api.projects.startBuild, { projectId, jobId: 'j2' });
    await t.mutation(api.projects.completeBuild, {
      projectId, jobId: 'j2', splatS3Key: 'facelifts/j2/output.splat', metaS3Key: 'facelifts/j2/meta.json',
    });
    expect((await t.query(api.projects.get, { projectId }))?.metaS3Key).toBe('facelifts/j2/meta.json');
  });

  test('facelifts.recordResult stores the meta key', async () => {
    const t = owner('meta_b');
    await t.mutation(api.users.getOrCreate, {});
    await t.mutation(api.facelifts.recordResult, {
      jobId: 'j3', splatS3Key: 'facelifts/j3/output.splat', metaS3Key: 'facelifts/j3/meta.json',
    });
    const row = await t.query(api.facelifts.getByJobId, { jobId: 'j3' });
    expect(row?.metaS3Key).toBe('facelifts/j3/meta.json');
  });
});
