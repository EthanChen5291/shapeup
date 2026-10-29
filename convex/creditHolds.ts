import { mutation, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { currentMonthKey } from "./lib/freeGen";

// One creditHolds row per spent generation entitlement, keyed on the build's
// jobId. consumeGeneration still decrements the balance up front — that
// decrement *is* the reservation, so concurrent requests can't double-spend —
// and records the hold. The hold is what lets a build that never produced a
// head give the entitlement back:
//   completeBuild            → commit   (the user got their head)
//   failBuild                → release  (upstream failed)
//   startBuild supersedes    → release  (a newer build replaced a still-running one)
//   reapStaleBuilds (cron)   → release  (the after() callback died mid-build)
// Settling is idempotent: a hold moves out of "held" exactly once.

type Outcome = "committed" | "released";

export async function settleHoldByJobId(ctx: MutationCtx, jobId: string, outcome: Outcome) {
  const hold = await ctx.db
    .query("creditHolds")
    .withIndex("by_job_id", (q) => q.eq("jobId", jobId))
    .unique();
  if (!hold || hold.status !== "held") return { applied: false as const };

  if (outcome === "released") {
    const user = await ctx.db.get(hold.userId);
    if (user) {
      if (hold.path === "paid") {
        await ctx.db.patch(user._id, { credits: user.credits + 1 });
      } else if (user.freeGenMonthKey === currentMonthKey() && (user.freeGenUsedInMonth ?? 0) > 0) {
        // A free generation only goes back into the month it was taken from;
        // a stale month bucket already reads as zero used (see lib/freeGen.ts).
        await ctx.db.patch(user._id, { freeGenUsedInMonth: (user.freeGenUsedInMonth ?? 0) - 1 });
      }
    }
  }

  await ctx.db.patch(hold._id, { status: outcome, settledAt: Date.now() });
  return { applied: true as const };
}

async function settleOwnedHold(ctx: MutationCtx, jobId: string, outcome: Outcome) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthenticated");
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new Error("Not found");
  const hold = await ctx.db
    .query("creditHolds")
    .withIndex("by_job_id", (q) => q.eq("jobId", jobId))
    .unique();
  if (!hold || hold.userId !== user._id) return { applied: false as const };
  return settleHoldByJobId(ctx, jobId, outcome);
}

/** Sync-path success: the caller got a head, keep the charge. */
export const commit = mutation({
  args: { jobId: v.string() },
  handler: (ctx, args) => settleOwnedHold(ctx, args.jobId, "committed"),
});

/** Sync-path failure (or startBuild rejected after the charge): give it back. */
export const release = mutation({
  args: { jobId: v.string() },
  handler: (ctx, args) => settleOwnedHold(ctx, args.jobId, "released"),
});
