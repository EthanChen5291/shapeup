import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireConvexAdmin } from "./lib/adminAuth";

export const recordResult = mutation({
  args: {
    jobId:     v.string(),
    // Optional: omitted when the caller didn't request the raw .ply upload.
    plyS3Key:  v.optional(v.string()),
    splatS3Key: v.string(),
    metaS3Key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    // These rows are the ownership proof for /api/splat, so a caller may
    // only record keys inside the job's own folder, and only for a job id
    // nobody else has claimed. Recording the same job twice is a no-op.
    const folder = `facelifts/${args.jobId}/`;
    for (const key of [args.splatS3Key, args.plyS3Key, args.metaS3Key]) {
      if (key !== undefined && !key.startsWith(folder)) throw new Error("Key is outside the job folder");
    }
    const existing = await ctx.db
      .query("facelifts")
      .withIndex("by_job_id", q => q.eq("jobId", args.jobId))
      .take(10);
    if (existing.some(r => r.userId !== identity.tokenIdentifier)) throw new Error("Job belongs to another user");
    if (existing.length > 0) return;

    await ctx.db.insert("facelifts", {
      userId:    identity.tokenIdentifier,
      jobId:     args.jobId,
      plyS3Key:  args.plyS3Key,
      splatS3Key: args.splatS3Key,
      metaS3Key: args.metaS3Key,
    });
  },
});

export const getByJobId = query({
  args: { jobId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const row = await ctx.db
      .query("facelifts")
      .withIndex("by_job_id", q => q.eq("jobId", args.jobId))
      .first();
    return row?.userId === identity.tokenIdentifier ? row : null;
  },
});

export const getLatestByUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return ctx.db
      .query("facelifts")
      .withIndex("by_user_id", q => q.eq("userId", identity.tokenIdentifier))
      .order("desc")
      .first();
  },
});

// Admin: most recent rendered facelifts across all users. The
// /api/admin-facelifts route also restricts callers to admins; this enforces
// it independently.
export const listRecent = query({
  args: {},
  handler: async (ctx) => {
    await requireConvexAdmin(ctx);

    return await ctx.db.query("facelifts").order("desc").take(50);
  },
});
