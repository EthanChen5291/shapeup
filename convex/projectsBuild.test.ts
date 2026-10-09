/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

function ownerEnv(clerkId = 'owner_build') {
  const base = convexTest(schema, modules);
  return base.withIdentity({
    subject: clerkId,
    tokenIdentifier: `https://clerk.test|${clerkId}`,
    email: `${clerkId}@example.com`,
  });
}

async function setupOwnerAndProject(t: ReturnType<typeof ownerEnv>) {
  await t.mutation(api.users.getOrCreate, {});
  const projectId = await t.mutation(api.projects.create, { name: 'Build test' });
  return projectId;
}

describe('projects async build mutations', () => {
  test('startBuild sets buildStatus, buildJobId, buildStartedAt and clears buildError', async () => {
    const t = ownerEnv();
    const projectId = await setupOwnerAndProject(t);

    await t.mutation(api.projects.startBuild, { projectId, jobId: 'job_start' });

    const project = await t.query(api.projects.get, { projectId });
    expect(project?.buildStatus).toBe('building');
    expect(project?.buildJobId).toBe('job_start');
    expect(project?.buildStartedAt).toBeGreaterThan(0);
    expect(project?.buildError).toBeUndefined();
  });

  test('completeBuild applies when jobId matches and sets buildStatus to ready', async () => {
    const t = ownerEnv();
    const projectId = await setupOwnerAndProject(t);

    await t.mutation(api.projects.startBuild, { projectId, jobId: 'job_complete' });
    const result = await t.mutation(api.projects.completeBuild, {
      projectId,
      jobId: 'job_complete',
      splatS3Key: 'facelifts/job_complete/output.splat',
    });

    expect(result).toEqual({ applied: true });
    const project = await t.query(api.projects.get, { projectId });
    expect(project?.buildStatus).toBe('ready');
    expect(project?.splatS3Key).toBe('facelifts/job_complete/output.splat');
    expect(project?.buildError).toBeUndefined();
  });

  test('completeBuild returns { applied:false } for a stale jobId without touching the project', async () => {
    const t = ownerEnv();
    const projectId = await setupOwnerAndProject(t);

    await t.mutation(api.projects.startBuild, { projectId, jobId: 'job_new' });
    // Simulate a newer job superseding the old one:
    const result = await t.mutation(api.projects.completeBuild, {
      projectId,
      jobId: 'job_old_stale',
      splatS3Key: 'facelifts/job_old_stale/output.splat',
    });

    expect(result).toEqual({ applied: false });
    const project = await t.query(api.projects.get, { projectId });
    // Build is still 'building' from the newer job_new — not mutated by the stale call.
    expect(project?.buildStatus).toBe('building');
    expect(project?.buildJobId).toBe('job_new');
    expect(project?.splatS3Key).toBeUndefined();
  });

  test('completeBuild syncs defaultScan.splatS3Key when the selfie keys match', async () => {
    const base = convexTest(schema, modules);
    const t = base.withIdentity({
      subject: 'scan_sync_user',
      tokenIdentifier: 'https://clerk.test|scan_sync_user',
      email: 'scan_sync_user@example.com',
    });

    const userId = await t.mutation(api.users.getOrCreate, {});
    const projectId = await t.mutation(api.projects.create, { name: 'Scan sync project' });

    const sharedKey = 'pictures/scan_sync_user/selfie.jpg';

    // Set project's lastImageS3Key
    await base.run((ctx) =>
      ctx.db.patch(projectId, { lastImageS3Key: sharedKey }),
    );

    // Set user's defaultScan with the same lastImageS3Key
    await base.run((ctx) =>
      ctx.db.patch(userId, {
        defaultScan: {
          lastImageS3Key: sharedKey,
          updatedAt: Date.now(),
        },
      }),
    );

    await t.mutation(api.projects.startBuild, { projectId, jobId: 'job_scan' });
    await t.mutation(api.projects.completeBuild, {
      projectId,
      jobId: 'job_scan',
      splatS3Key: 'facelifts/job_scan/output.splat',
    });

    const updatedUser = await base.run((ctx) => ctx.db.get(userId));
    expect(updatedUser?.defaultScan?.splatS3Key).toBe('facelifts/job_scan/output.splat');
  });

  test('completeBuild does NOT update defaultScan when the selfie keys differ', async () => {
    const base = convexTest(schema, modules);
    const t = base.withIdentity({
      subject: 'scan_nosync_user',
      tokenIdentifier: 'https://clerk.test|scan_nosync_user',
      email: 'scan_nosync_user@example.com',
    });

    const userId = await t.mutation(api.users.getOrCreate, {});
    const projectId = await t.mutation(api.projects.create, { name: 'No-sync project' });

    await base.run((ctx) =>
      ctx.db.patch(projectId, { lastImageS3Key: 'pictures/nosync_user/selfie.jpg' }),
    );
    await base.run((ctx) =>
      ctx.db.patch(userId, {
        defaultScan: {
          lastImageS3Key: 'pictures/nosync_user/different.jpg',
          updatedAt: Date.now(),
        },
      }),
    );

    await t.mutation(api.projects.startBuild, { projectId, jobId: 'job_nosync' });
    await t.mutation(api.projects.completeBuild, {
      projectId,
      jobId: 'job_nosync',
      splatS3Key: 'facelifts/job_nosync/output.splat',
    });

    const updatedUser = await base.run((ctx) => ctx.db.get(userId));
    expect(updatedUser?.defaultScan?.splatS3Key).toBeUndefined();
  });

  test('failBuild sets buildStatus to failed and stores the error string', async () => {
    const t = ownerEnv();
    const projectId = await setupOwnerAndProject(t);

    await t.mutation(api.projects.startBuild, { projectId, jobId: 'job_fail' });
    const result = await t.mutation(api.projects.failBuild, {
      projectId,
      jobId: 'job_fail',
      error: 'Our 3D builder is busy right now. Please try again in a few minutes.',
    });

    expect(result).toEqual({ applied: true });
    const project = await t.query(api.projects.get, { projectId });
    expect(project?.buildStatus).toBe('failed');
    expect(project?.buildError).toBe(
      'Our 3D builder is busy right now. Please try again in a few minutes.',
    );
  });

  test('failBuild returns { applied:false } for a stale jobId', async () => {
    const t = ownerEnv();
    const projectId = await setupOwnerAndProject(t);

    await t.mutation(api.projects.startBuild, { projectId, jobId: 'job_new2' });
    const result = await t.mutation(api.projects.failBuild, {
      projectId,
      jobId: 'job_old_stale2',
      error: 'some error',
    });

    expect(result).toEqual({ applied: false });
    const project = await t.query(api.projects.get, { projectId });
    expect(project?.buildStatus).toBe('building');
  });

  test('non-owner calls to startBuild, completeBuild, and failBuild throw', async () => {
    const base = convexTest(schema, modules);
    const owner = base.withIdentity({
      subject: 'build_owner',
      tokenIdentifier: 'https://clerk.test|build_owner',
      email: 'build_owner@example.com',
    });
    const other = base.withIdentity({
      subject: 'build_other',
      tokenIdentifier: 'https://clerk.test|build_other',
      email: 'build_other@example.com',
    });

    const projectId = await owner.mutation(api.projects.create, { name: 'Owner project' });
    await owner.mutation(api.projects.startBuild, { projectId, jobId: 'job_auth' });

    await expect(
      other.mutation(api.projects.startBuild, { projectId, jobId: 'job_hijack' }),
    ).rejects.toThrow(/Not found/);

    await expect(
      other.mutation(api.projects.completeBuild, {
        projectId,
        jobId: 'job_auth',
        splatS3Key: 'facelifts/job_auth/output.splat',
      }),
    ).rejects.toThrow(/Not found/);

    await expect(
      other.mutation(api.projects.failBuild, {
        projectId,
        jobId: 'job_auth',
        error: 'hijacked',
      }),
    ).rejects.toThrow(/Not found/);
  });

  test('list projection includes buildStatus, buildStartedAt, and buildError', async () => {
    const t = ownerEnv('list_build_user');
    const projectId = await setupOwnerAndProject(t);

    await t.mutation(api.projects.startBuild, { projectId, jobId: 'job_list' });
    await t.mutation(api.projects.failBuild, {
      projectId,
      jobId: 'job_list',
      error: 'builder busy',
    });

    const projects = await t.query(api.projects.list, {});
    expect(projects).toHaveLength(1);
    expect(projects[0].buildStatus).toBe('failed');
    expect(projects[0].buildStartedAt).toBeGreaterThan(0);
    expect(projects[0].buildError).toBe('builder busy');
  });
});
