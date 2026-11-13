import { internalMutation, mutation, query } from "./_generated/server";
import { settleHoldByJobId } from "./creditHolds";
import { internal } from "./_generated/api";
import { enqueueJobArtifactDeletions } from "./pendingDeletions";
import { v, ConvexError } from "convex/values";
import { hairParamsValidator, lastProfileValidator } from "./validators";
import { grantReferralReward } from "./lib/referrals";
import { isOnEmailAllowlist } from "./lib/allowlist";

export const MAX_PROJECTS_PER_USER = 5;
// Allowlisted demo/dev accounts get a much higher cap so a single shared demo
// account doesn't fill up after 5 cuts mid-presentation.
export const MAX_PROJECTS_DEMO = 50;

export const list = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const rows = await ctx.db
      .query("projects")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .order("desc")
      .take(50);
    return Promise.all(rows.map(async ({ _id, _creationTime, name, thumbnailS3Key, thumbnailStorageId, createdAt, updatedAt, savedAt, lastAccessedAt, splatS3Key, buildStatus, buildStartedAt, buildError }) => {
      // Resolve thumbnail: S3 key is served fresh via /api/img on the client;
      // Convex storageId is resolved here at query time so the URL is always valid.
      // Old thumbnailUrl (stored time-limited URL) is intentionally omitted.
      const thumbnailUrl = !thumbnailS3Key && thumbnailStorageId
        ? (await ctx.storage.getUrl(thumbnailStorageId)) ?? undefined
        : undefined;
      return { _id, _creationTime, name, thumbnailUrl, thumbnailS3Key, createdAt, updatedAt, savedAt, lastAccessedAt, splatS3Key, buildStatus, buildStartedAt, buildError };
    }));
  },
});

export const create = mutation({
  // seedFromDefaultScan: copy the user's saved scan (image/splat/profile) into the
  // new project so it opens straight into the studio with no re-scan or GPU build.
  // The copy lives on the project, so later edits to the default scan don't touch it.
  args: { name: v.string(), seedFromDefaultScan: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    // Fetched once and reused for the cap check, seeding, and referral reward.
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    const cap = isOnEmailAllowlist(user, identity) ? MAX_PROJECTS_DEMO : MAX_PROJECTS_PER_USER;
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .take(cap + 1);
    if (existing.length >= cap) {
      throw new ConvexError(
        `You've reached the limit of ${cap} projects. Delete one to make room for a new cut.`,
      );
    }
    const isFirstProject = existing.length === 0;
    const now = Date.now();

    let seed: Record<string, unknown> = {};
    if (args.seedFromDefaultScan) {
      const ds = user?.defaultScan;
      if (ds) {
        seed = {
          lastImageS3Key: ds.lastImageS3Key,
          lastImageUrl: ds.lastImageUrl,
          thumbnailS3Key: ds.thumbnailS3Key,
          splatS3Key: ds.splatS3Key,
          lastSplatUrl: ds.lastSplatUrl,
          lastProfile: ds.lastProfile,
          lastHairParams: ds.lastHairParams,
        };
      }
    }

    const projectId = await ctx.db.insert("projects", {
      tokenIdentifier: identity.tokenIdentifier,
      name: args.name,
      createdAt: now,
      updatedAt: now,
      ...seed,
    });

    // A referred user's first project unlocks the referral reward for both parties.
    if (isFirstProject && user) {
      await grantReferralReward(ctx, user._id);
    }

    return projectId;
  },
});

export const save = mutation({
  args: {
    projectId: v.id("projects"),
    thumbnailUrl: v.optional(v.string()),
    thumbnailS3Key: v.optional(v.string()),
    lastHairParams: v.optional(hairParamsValidator),
    lastProfile: v.optional(lastProfileValidator),
    lastImageUrl: v.optional(v.string()),
    lastImageS3Key: v.optional(v.string()),
    lastEditImageS3Key: v.optional(v.string()),
    lastSplatUrl: v.optional(v.string()),
    splatS3Key: v.optional(v.string()),
    bgBrightness: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Not found");
    }
    const { projectId, ...fields } = args;
    await ctx.db.patch(projectId, { ...fields, updatedAt: Date.now() });
  },
});

export const rename = mutation({
  args: { projectId: v.id("projects"), name: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Not found");
    }
    await ctx.db.patch(args.projectId, { name: args.name, updatedAt: Date.now() });
  },
});

export const toggleSave = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Not found");
    }
    await ctx.db.patch(args.projectId, {
      savedAt: project.savedAt ? undefined : Date.now(),
    });
  },
});

// Records that a project was opened, so the dashboard's "recent" tab can sort
// by most-recently-accessed. Persisted server-side, so the order survives refresh.
export const markAccessed = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Not found");
    }
    await ctx.db.patch(args.projectId, { lastAccessedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Not found");
    }
    await ctx.db.delete(args.projectId);
  },
});

export const get = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) return null;
    return project;
  },
});

export const generateThumbnailUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return ctx.storage.generateUploadUrl();
  },
});

export const saveThumbnail = mutation({
  args: { projectId: v.id("projects"), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) throw new Error("Not found");
    // Store the storageId — never the URL. URL is resolved fresh in the list query.
    await ctx.db.patch(args.projectId, {
      thumbnailStorageId: args.storageId,
      thumbnailUrl: undefined,
      updatedAt: Date.now(),
    });
  },
});

// ---- Async 3D build tracking ----
// All three mutations share the same owner check as `save`. `completeBuild` and
// `failBuild` additionally guard against stale jobs: if another build has been
// started since this one (different buildJobId), the response is a silent
// { applied: false } rather than an error so the caller can distinguish stale
// from auth failures.

export const startBuild = mutation({
  args: {
    projectId: v.id("projects"),
    jobId: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Not found");
    }
    // Superseding a build that is still running: its result will be ignored
    // by the stale-job check below, so give its entitlement back now. This is
    // what stops a double submit from costing two credits for one head.
    let supersededJobId: string | undefined;
    if (project.buildStatus === "building" && project.buildJobId && project.buildJobId !== args.jobId) {
      supersededJobId = project.buildJobId;
      await settleHoldByJobId(ctx, project.buildJobId, "released", "superseded");
      await enqueueJobArtifactDeletions(ctx, project.buildJobId, "superseded_build");
    }
    const now = Date.now();
    await ctx.db.patch(args.projectId, {
      buildStatus: "building",
      buildJobId: args.jobId,
      buildStartedAt: now,
      buildError: undefined,
      updatedAt: now,
    });
    // The route tells the worker to drop the superseded job so it stops costing GPU time.
    return { applied: true, ...(supersededJobId ? { supersededJobId } : {}) };
  },
});

export const completeBuild = mutation({
  args: {
    projectId: v.id("projects"),
    jobId: v.string(),
    splatS3Key: v.string(),
    metaS3Key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Not found");
    }
    // Stale-job check: a newer startBuild may have superseded this job.
    if (project.buildJobId !== args.jobId) {
      return { applied: false };
    }
    const now = Date.now();
    await ctx.db.patch(args.projectId, {
      splatS3Key: args.splatS3Key,
      ...(args.metaS3Key ? { metaS3Key: args.metaS3Key } : {}),
      buildStatus: "ready",
      buildError: undefined,
      updatedAt: now,
    });
    // The user got their head: the entitlement spent at startBuild is final.
    await settleHoldByJobId(ctx, args.jobId, "committed", "completed");

    // If this project's selfie is still the user's defaultScan source, keep
    // the defaultScan's splatS3Key in sync so new projects seeded from it
    // start with the latest build.
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (
      user?.defaultScan &&
      user.defaultScan.lastImageS3Key != null &&
      project.lastImageS3Key != null &&
      user.defaultScan.lastImageS3Key === project.lastImageS3Key
    ) {
      await ctx.db.patch(user._id, {
        defaultScan: {
          ...user.defaultScan,
          splatS3Key: args.splatS3Key,
          updatedAt: now,
        },
      });
    }

    return { applied: true };
  },
});

export const failBuild = mutation({
  args: {
    projectId: v.id("projects"),
    jobId: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Not found");
    }
    if (project.buildJobId !== args.jobId) {
      return { applied: false };
    }
    await ctx.db.patch(args.projectId, {
      buildStatus: "failed",
      buildError: args.error,
      updatedAt: Date.now(),
    });
    // No head was produced: give the entitlement back.
    await settleHoldByJobId(ctx, args.jobId, "released", "failed");
    return { applied: true };
  },
});

// ---- Hair-edit builds ----
// Same lifecycle as startBuild/completeBuild/failBuild, on the edit* fields.
// Differences: an edit never touches buildStatus (no build ghost) or the
// user's defaultScan (that's the original selfie's head, not an edited one),
// and a finished edit also replaces the head's meta.json.

export const startEditBuild = mutation({
  args: {
    projectId: v.id("projects"),
    jobId: v.string(),
    // "editing": the server makes the edited photo first (/api/edit-job), then
    // markEditImageReady moves the job on to "building". Omitted: the photo
    // already exists and the 3D build starts now.
    stage: v.optional(v.literal("editing")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Not found");
    }
    // A newer edit supersedes a running one: its result will be ignored, so
    // give its entitlement back now.
    let supersededJobId: string | undefined;
    if (project.editBuildStatus === "building" && project.editBuildJobId && project.editBuildJobId !== args.jobId) {
      supersededJobId = project.editBuildJobId;
      await settleHoldByJobId(ctx, project.editBuildJobId, "released", "superseded");
      await enqueueJobArtifactDeletions(ctx, project.editBuildJobId, "superseded_edit");
    }
    await ctx.db.patch(args.projectId, {
      editBuildStatus: "building",
      editBuildJobId: args.jobId,
      editBuildStartedAt: Date.now(),
      editBuildError: undefined,
      editBuildStage: args.stage,
    });
    return { applied: true, ...(supersededJobId ? { supersededJobId } : {}) };
  },
});

// An edit job's photo is done: link it to the project and move the job on to
// the 3D build. Fenced like completeEditBuild: false when a newer edit replaced
// this one (or it was reaped), and the caller must then not build it.
export const markEditImageReady = mutation({
  args: { projectId: v.id("projects"), jobId: v.string(), lastEditImageS3Key: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Not found");
    }
    if (project.editBuildJobId !== args.jobId || project.editBuildStatus !== "building") {
      return { applied: false };
    }
    await ctx.db.patch(args.projectId, {
      lastEditImageS3Key: args.lastEditImageS3Key,
      editBuildStage: "building",
      updatedAt: Date.now(),
    });
    return { applied: true };
  },
});

export const completeEditBuild = mutation({
  args: {
    projectId: v.id("projects"),
    jobId: v.string(),
    splatS3Key: v.string(),
    metaS3Key: v.optional(v.string()),
    // The request that produced this cut, for Recap (see recordEditPrompt).
    prompt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Not found");
    }
    if (project.editBuildJobId !== args.jobId) return { applied: false };
    const editPrompts = args.prompt === undefined ? undefined : appendEditPrompt(project.editPrompts, args.prompt);
    await ctx.db.patch(args.projectId, {
      ...(editPrompts ? { editPrompts } : {}),
      splatS3Key: args.splatS3Key,
      // The edited head's own sidecar (or none), never the previous head's.
      metaS3Key: args.metaS3Key,
      // A fresh edit is what the project should show on reopen, not an older try-on.
      tryOnVariantId: undefined,
      editBuildStatus: "ready",
      editBuildError: undefined,
      updatedAt: Date.now(),
    });
    await settleHoldByJobId(ctx, args.jobId, "committed", "completed");
    return { applied: true };
  },
});

export const failEditBuild = mutation({
  args: { projectId: v.id("projects"), jobId: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Not found");
    }
    if (project.editBuildJobId !== args.jobId) return { applied: false };
    await ctx.db.patch(args.projectId, { editBuildStatus: "failed", editBuildError: args.error });
    await settleHoldByJobId(ctx, args.jobId, "released", "failed");
    return { applied: true };
  },
});

// ---- Recap: the requests behind the current cut ----
export const MAX_EDIT_PROMPTS = 20;
const MAX_EDIT_PROMPT_CHARS = 500; // same cap as the prompt box

/** The prompt list with `prompt` appended (trimmed, capped), or null if it's empty. */
function appendEditPrompt(list: Array<{ prompt: string; at: number }> | undefined, raw: string) {
  const prompt = raw.trim().slice(0, MAX_EDIT_PROMPT_CHARS);
  if (!prompt) return null;
  return [...(list ?? []), { prompt, at: Date.now() }].slice(-MAX_EDIT_PROMPTS);
}

export const recordEditPrompt = mutation({
  args: { projectId: v.id("projects"), prompt: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Not found");
    }
    const editPrompts = appendEditPrompt(project.editPrompts, args.prompt);
    if (editPrompts) await ctx.db.patch(args.projectId, { editPrompts });
  },
});

// ---- Quick try-ons ----
// The buzz-cut base head the prebaked hair presets are merged onto. Built once
// per project by the client (hair edit → /api/facelift), then remembered here so
// later sessions skip the GPU build. Keys must be worker output keys, so a client
// can't point the base at some other object in the bucket.
const TRY_ON_SPLAT_KEY = /^facelifts\/[A-Za-z0-9_-]+\/output\.splat$/;
const TRY_ON_META_KEY = /^facelifts\/[A-Za-z0-9_-]+\/meta\.json$/;

export const setTryOnBase = mutation({
  args: {
    projectId: v.id("projects"),
    splatS3Key: v.string(),
    metaS3Key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Not found");
    }
    if (!TRY_ON_SPLAT_KEY.test(args.splatS3Key)) throw new ConvexError("Invalid splat key");
    if (args.metaS3Key !== undefined && !TRY_ON_META_KEY.test(args.metaS3Key)) {
      throw new ConvexError("Invalid meta key");
    }
    await ctx.db.patch(args.projectId, {
      tryOnBaseSplatS3Key: args.splatS3Key,
      tryOnBaseMetaS3Key: args.metaS3Key,
      updatedAt: Date.now(),
    });
  },
});

// The chosen try-on style (a prebake variant id), or null to clear it. Only an
// id is stored: the hair is merged onto the base in the browser on reopen, so a
// reopened look picks up any fit improvements made since.
const TRY_ON_VARIANT_ID = /^[a-z0-9][a-z0-9_-]{0,99}$/i;

export const setTryOnSelection = mutation({
  args: { projectId: v.id("projects"), variantId: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const project = await ctx.db.get(args.projectId);
    if (!project || project.tokenIdentifier !== identity.tokenIdentifier) {
      throw new Error("Not found");
    }
    if (args.variantId !== null && !TRY_ON_VARIANT_ID.test(args.variantId)) {
      throw new ConvexError("Invalid try-on style");
    }
    await ctx.db.patch(args.projectId, { tryOnVariantId: args.variantId ?? undefined });
  },
});

// Builds run inside Vercel's after(), which is cancelled when the function
// times out or the instance dies — then neither completeBuild nor failBuild
// ever arrives and the project sits in "building" forever. The cron in
// crons.ts calls this every 5 minutes. The cutoff is generous relative to
// UPSTREAM_BUDGET_MS (240 s) + the route's 300 s maxDuration.
export const BUILD_STALE_AFTER_MS = 10 * 60 * 1000;

export const reapStaleBuilds = internalMutation({
  args: { staleAfterMs: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - (args.staleAfterMs ?? BUILD_STALE_AFTER_MS);
    const stale = await ctx.db
      .query("projects")
      .withIndex("by_buildStatus_and_buildStartedAt", (q) =>
        q.eq("buildStatus", "building").lt("buildStartedAt", cutoff),
      )
      .take(50);
    for (const project of stale) {
      await ctx.db.patch(project._id, {
        buildStatus: "failed",
        buildError: "The build timed out. Please try again.",
        updatedAt: Date.now(),
      });
      if (project.buildJobId) {
        await settleHoldByJobId(ctx, project.buildJobId, "released", "stale");
        await enqueueJobArtifactDeletions(ctx, project.buildJobId, "stale_build");
      }
    }
    // Hair-edit builds run the same way and can die the same way.
    const staleEdits = await ctx.db
      .query("projects")
      .withIndex("by_editBuildStatus_and_editBuildStartedAt", (q) =>
        q.eq("editBuildStatus", "building").lt("editBuildStartedAt", cutoff),
      )
      .take(50);
    for (const project of staleEdits) {
      await ctx.db.patch(project._id, {
        editBuildStatus: "failed",
        editBuildError: "The edit timed out. Please try again.",
      });
      if (project.editBuildJobId) {
        await settleHoldByJobId(ctx, project.editBuildJobId, "released", "stale");
        await enqueueJobArtifactDeletions(ctx, project.editBuildJobId, "stale_edit");
      }
    }
    // Every reap means a build's after() died without reporting back: page someone.
    if (stale.length + staleEdits.length > 0) {
      await ctx.scheduler.runAfter(0, internal.buildHealth.notify, {
        title: "Builds reaped",
        lines: [
          `${stale.length} build(s) and ${staleEdits.length} edit(s) were stuck in "building" for over ${Math.round((args.staleAfterMs ?? BUILD_STALE_AFTER_MS) / 60000)} min.`,
          "Their after() callback died without reporting back; credits were refunded.",
          ...[...stale.map((p) => p.buildJobId), ...staleEdits.map((p) => p.editBuildJobId)].filter(Boolean).slice(0, 10).map((id) => `job ${id}`),
        ],
      });
    }
    return { reaped: stale.length, reapedEdits: staleEdits.length };
  },
});

// One-time migration: backfill lastImageS3Key for records that have only lastImageUrl.
// Presigned S3 URLs embed the key in the path: https://BUCKET.s3.REGION.amazonaws.com/KEY?...
export const migrateLastImageUrls = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("projects").collect();
    let migrated = 0;
    for (const row of rows) {
      if (!row.lastImageUrl || row.lastImageS3Key) continue;
      try {
        const pathname = new URL(row.lastImageUrl).pathname.slice(1); // strip leading /
        if (pathname.startsWith("pictures/")) {
          await ctx.db.patch(row._id, { lastImageS3Key: pathname });
          migrated++;
        }
      } catch {
        // skip malformed URLs
      }
    }
    return { migrated };
  },
});
