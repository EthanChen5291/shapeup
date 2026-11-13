import { describe, expect, test } from 'vitest';
import { RECOVERY_CLOCK_SLACK_MS, editBuildOutcome, editJobPhotoKey, recoverEditJobId } from './editBuildWatch';

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

describe('editJobPhotoKey', () => {
  const photo = 'edit-images/abc.png';
  test('null while the image model is still working', () => {
    expect(editJobPhotoKey({ editBuildJobId: 'j1', editBuildStatus: 'building', editBuildStage: 'editing', lastEditImageS3Key: 'edit-images/older.png' }, 'j1')).toBeNull();
  });

  test('the photo once the job moved on to the 3D build, and after it finished either way', () => {
    expect(editJobPhotoKey({ editBuildJobId: 'j1', editBuildStatus: 'building', editBuildStage: 'building', lastEditImageS3Key: photo }, 'j1')).toBe(photo);
    // A live query can skip straight past "building": the stage stays put, so the photo still shows.
    expect(editJobPhotoKey({ editBuildJobId: 'j1', editBuildStatus: 'ready', editBuildStage: 'building', lastEditImageS3Key: photo, splatS3Key: 'k' }, 'j1')).toBe(photo);
    expect(editJobPhotoKey({ editBuildJobId: 'j1', editBuildStatus: 'failed', editBuildStage: 'building', lastEditImageS3Key: photo }, 'j1')).toBe(photo);
  });

  test('a job that failed in the image model, or one without stages, has no photo of its own', () => {
    expect(editJobPhotoKey({ editBuildJobId: 'j1', editBuildStatus: 'failed', editBuildStage: 'editing', lastEditImageS3Key: 'edit-images/older.png' }, 'j1')).toBeNull();
    expect(editJobPhotoKey({ editBuildJobId: 'j1', editBuildStatus: 'building', lastEditImageS3Key: 'edit-images/older.png' }, 'j1')).toBeNull();
  });

  test("another job's photo is never ours", () => {
    expect(editJobPhotoKey({ editBuildJobId: 'j0', editBuildStatus: 'ready', editBuildStage: 'building', lastEditImageS3Key: photo }, 'j1')).toBeNull();
  });
});
