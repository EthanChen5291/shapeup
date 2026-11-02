import { describe, expect, test } from 'vitest';
import { RECOVERY_CLOCK_SLACK_MS, editBuildOutcome, recoverEditJobId } from './editBuildWatch';

describe('editBuildOutcome', () => {
  test('pending while our job builds, then ready with the new head', () => {
    expect(editBuildOutcome({ editBuildJobId: 'j1', editBuildStatus: 'building' }, 'j1')).toEqual({ kind: 'pending' });
    expect(editBuildOutcome({ editBuildJobId: 'j1', editBuildStatus: 'ready', splatS3Key: 'facelifts/j1/output.splat' }, 'j1'))
      .toEqual({ kind: 'ready', splatS3Key: 'facelifts/j1/output.splat' });
  });

  test('failed carries the user-safe error', () => {
    expect(editBuildOutcome({ editBuildJobId: 'j1', editBuildStatus: 'failed', editBuildError: 'busy' }, 'j1'))
      .toEqual({ kind: 'failed', error: 'busy' });
  });

  test('another job id (stale snapshot or a newer edit) is "other", never our result', () => {
    expect(editBuildOutcome({ editBuildJobId: 'j0', editBuildStatus: 'ready', splatS3Key: 'k' }, 'j1')).toEqual({ kind: 'other' });
    expect(editBuildOutcome({}, 'j1')).toEqual({ kind: 'other' });
  });
});

describe('recoverEditJobId', () => {
  const startedAt = 1_000_000;
  test('prefers the saved job id', () => {
    expect(recoverEditJobId({ editBuildJobId: 'other', editBuildStartedAt: startedAt }, { jobId: 'mine', startedAt })).toBe('mine');
  });

  test("adopts the project's edit build when it started after this edit (within clock slack)", () => {
    expect(recoverEditJobId({ editBuildJobId: 'j', editBuildStartedAt: startedAt + 2000 }, { startedAt })).toBe('j');
    expect(recoverEditJobId({ editBuildJobId: 'j', editBuildStartedAt: startedAt - RECOVERY_CLOCK_SLACK_MS + 1 }, { startedAt })).toBe('j');
  });

  test('ignores an older edit build, or none', () => {
    expect(recoverEditJobId({ editBuildJobId: 'old', editBuildStartedAt: startedAt - RECOVERY_CLOCK_SLACK_MS - 1 }, { startedAt })).toBeNull();
    expect(recoverEditJobId({}, { startedAt })).toBeNull();
  });
});
