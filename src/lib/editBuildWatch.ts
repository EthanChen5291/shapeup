// A hair edit runs on the server (/api/edit-job: image edit, then 3D build; or
// /api/facelift { async, mode: 'edit' } for a photo the browser already made)
// and reports through the project document's editBuild* fields. EditPanel
// watches that document for its job id; these helpers read it.

export interface EditBuildDoc {
  editBuildStatus?: 'building' | 'ready' | 'failed';
  editBuildJobId?: string;
  editBuildStartedAt?: number;
  editBuildError?: string;
  editBuildStage?: 'editing' | 'building';
  lastEditImageS3Key?: string;
  splatS3Key?: string;
}

export type EditBuildOutcome =
  | { kind: 'pending' }
  | { kind: 'ready'; splatS3Key: string }
  | { kind: 'failed'; error: string | null }
  /** The document names a different job: not ours yet, or a newer edit replaced ours. */
  | { kind: 'other' };

/** Where edit build `jobId` stands according to `doc`. */
export function editBuildOutcome(doc: EditBuildDoc, jobId: string): EditBuildOutcome {
  if (doc.editBuildJobId !== jobId) return { kind: 'other' };
  if (doc.editBuildStatus === 'ready' && doc.splatS3Key) return { kind: 'ready', splatS3Key: doc.splatS3Key };
  if (doc.editBuildStatus === 'failed') return { kind: 'failed', error: doc.editBuildError ?? null };
  return { kind: 'pending' };
}

/**
 * The edited photo's key once edit job `jobId` has made it (its stage reached
 * "building"), whatever happened after; null while the image model is still
 * working, if it never produced one, or if the document names another job.
 */
export function editJobPhotoKey(doc: EditBuildDoc, jobId: string): string | null {
  if (doc.editBuildJobId !== jobId || doc.editBuildStage !== 'building') return null;
  return doc.lastEditImageS3Key ?? null;
}

/** Allowance for the gap between the browser's clock and the server's. */
export const RECOVERY_CLOCK_SLACK_MS = 60_000;

/**
 * After a refresh mid-edit, the job to reconnect to: the one the session saved,
 * else the project's edit build if it started after this edit did (the refresh
 * can land before the server's 202 told us its id). null = nothing to wait for.
 */
export function recoverEditJobId(doc: EditBuildDoc, saved: { jobId?: string; startedAt: number }): string | null {
  if (saved.jobId) return saved.jobId;
  if (!doc.editBuildJobId || doc.editBuildStartedAt === undefined) return null;
  return doc.editBuildStartedAt >= saved.startedAt - RECOVERY_CLOCK_SLACK_MS ? doc.editBuildJobId : null;
}
