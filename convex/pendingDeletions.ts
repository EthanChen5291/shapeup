import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx } from "./_generated/server";

// 20 minutes: gives a worker time to finish uploading even after the route
// gave up at 240 s, plus an extra buffer for the worst-case 900 s worker run.
const DELETION_DELAY_MS = 20 * 60 * 1000;
export const MAX_ATTEMPTS = 10;

export type DeletionReason =
  | "superseded_build"
  | "superseded_edit"
  | "stale_build"
  | "stale_edit";

/**
 * Enqueue S3 deletions for the three deterministic keys of a losing build job:
 *   facelifts/<jobId>/output.splat
 *   facelifts/<jobId>/output.ply   (may not exist; harmless to delete)
 *   facelifts/<jobId>/meta.json    (may not exist; harmless to delete)
 *
 * Call this at every site where a job is abandoned:
 *   - startBuild / startEditBuild supersede a still-running predecessor
 *   - reapStaleBuilds marks a timed-out job failed
 *
 * Idempotent: any key already in the outbox is skipped, so a double-call
 * (e.g. supersede then reap on the same jobId) enqueues each key only once.
 * Never call this for jobs that might still be referenced (winners, scans).
 */
export async function enqueueJobArtifactDeletions(
  ctx: MutationCtx,
  jobId: string,
  reason: DeletionReason,
) {
  const notBefore = Date.now() + DELETION_DELAY_MS;
  const createdAt = Date.now();
  const keys = [
    `facelifts/${jobId}/output.splat`,
    `facelifts/${jobId}/output.ply`,
    `facelifts/${jobId}/meta.json`,
  ];
  for (const s3Key of keys) {
    // Skip if already in the outbox — prevents double-enqueue on the same key.
    const existing = await ctx.db
      .query("pendingDeletions")
      .withIndex("by_s3Key", (q) => q.eq("s3Key", s3Key))
      .first();
    if (existing) continue;
    await ctx.db.insert("pendingDeletions", {
      s3Key,
      reason,
      jobId,
      notBefore,
      createdAt,
      attempts: 0,
    });
  }
}

/**
 * Returns rows that are past their notBefore time and have not exhausted
 * retries. Called by the s3Drain action to discover work.
 */
export const dueRows = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("pendingDeletions")
      .withIndex("by_notBefore", (q) => q.lte("notBefore", now))
      .take(500);
    // MAX_ATTEMPTS rows are dead weight — skip them so they don't block the
    // batch. An operator can inspect and delete them manually.
    return rows.filter((r) => r.attempts < MAX_ATTEMPTS);
  },
});

/**
 * Remove rows whose S3 keys were successfully deleted.
 * The console.log in s3Drain.drain is the durable audit trail.
 */
export const markDeleted = internalMutation({
  args: { ids: v.array(v.id("pendingDeletions")) },
  handler: async (ctx, args) => {
    for (const id of args.ids) {
      await ctx.db.delete(id);
    }
  },
});

/**
 * Increment the attempt counter and record the error text for a row that
 * failed. After MAX_ATTEMPTS the row is excluded from dueRows and left for
 * manual inspection.
 */
export const recordFailure = internalMutation({
  args: { id: v.id("pendingDeletions"), lastError: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return;
    await ctx.db.patch(args.id, {
      attempts: row.attempts + 1,
      lastError: args.lastError,
    });
  },
});
