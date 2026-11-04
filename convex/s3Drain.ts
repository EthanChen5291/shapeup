"use node";

// This file contains only an internalAction; it must stay Node-only.
// Queries and mutations that back this action live in convex/pendingDeletions.ts.

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  S3Client,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import type { Doc, Id } from "./_generated/dataModel";

const S3_BATCH_LIMIT = 1000; // AWS DeleteObjects max per call

function buildClient(): { client: S3Client; bucket: string } | null {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION;
  const bucket = process.env.AWS_S3_BUCKET_NAME;
  if (!accessKeyId || !secretAccessKey || !region || !bucket) {
    console.log(
      "[s3Drain] missing AWS credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET_NAME); skipping drain",
    );
    return null;
  }
  const client = new S3Client({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
  return { client, bucket };
}

/**
 * Drain the S3 deletion outbox. Scheduled hourly from convex/crons.ts.
 *
 * This is NOT a bucket-wide sweep — it only deletes the specific keys
 * enqueued by enqueueJobArtifactDeletions (facelifts/<jobId>/…) for jobs
 * that lost a supersede race or were reaped as stale. Keys still referenced
 * by any active project are never enqueued, so this is safe to run blindly.
 *
 * Env vars required on BOTH deployments (dev + prod):
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, AWS_S3_BUCKET_NAME
 * If any is absent the drain logs one line and returns without touching rows.
 *
 * On partial S3 failures: each errored key gets its attempts incremented and
 * lastError stored. After MAX_ATTEMPTS (10) the row is excluded from future
 * runs and left for manual inspection.
 */
export const drain = internalAction({
  args: {},
  handler: async (ctx) => {
    const aws = buildClient();
    if (!aws) return;
    const { client, bucket } = aws;

    const rows = (await ctx.runQuery(
      internal.pendingDeletions.dueRows,
      {},
    )) as Array<Doc<"pendingDeletions">>;

    if (rows.length === 0) return;

    for (let offset = 0; offset < rows.length; offset += S3_BATCH_LIMIT) {
      const batch = rows.slice(offset, offset + S3_BATCH_LIMIT);
      const objects = batch.map((r) => ({ Key: r.s3Key }));

      let deletedKeys: string[];
      let erroredEntries: Array<{ Key?: string; Message?: string }>;

      try {
        const response = await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: objects, Quiet: false },
          }),
        );
        deletedKeys = (response.Deleted ?? [])
          .map((d) => d.Key)
          .filter((k): k is string => k != null);
        erroredEntries = response.Errors ?? [];
      } catch (err) {
        // Whole batch failed (network/auth error) — record failure on every row.
        const msg = err instanceof Error ? err.message : String(err);
        for (const row of batch) {
          await ctx.runMutation(internal.pendingDeletions.recordFailure, {
            id: row._id as Id<"pendingDeletions">,
            lastError: msg,
          });
        }
        continue;
      }

      // Mark successfully deleted rows for removal.
      const succeededIds: Array<Id<"pendingDeletions">> = [];
      const deletedSet = new Set(deletedKeys);
      for (const row of batch) {
        if (deletedSet.has(row.s3Key)) {
          // Each log line is the durable audit trail for this deletion.
          console.log(
            `[s3Drain] deleted s3://${bucket}/${row.s3Key} reason=${row.reason} jobId=${row.jobId}`,
          );
          succeededIds.push(row._id as Id<"pendingDeletions">);
        }
      }
      if (succeededIds.length > 0) {
        await ctx.runMutation(internal.pendingDeletions.markDeleted, {
          ids: succeededIds,
        });
      }

      // Record per-key S3 errors.
      const erroredKeyMap = new Map(
        erroredEntries
          .filter((e) => e.Key != null)
          .map((e) => [e.Key!, e.Message ?? "S3 DeleteObjects error"]),
      );
      for (const row of batch) {
        const errMsg = erroredKeyMap.get(row.s3Key);
        if (errMsg !== undefined) {
          await ctx.runMutation(internal.pendingDeletions.recordFailure, {
            id: row._id as Id<"pendingDeletions">,
            lastError: errMsg,
          });
        }
      }
    }
  },
});
