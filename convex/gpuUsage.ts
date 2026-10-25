import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

/**
 * Monthly primary-worker GPU-seconds metering + budget guard.
 *
 * Set the cap with:  npx convex env set GPU_BUDGET_SECONDS 3600
 * Leave it unset (or 0) to disable the guard entirely.
 *
 * The bucket is computed server-side from Date.now() (UTC, "YYYY-MM") so the
 * client can't spoof the period.
 */

function currentBucket(): string {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

function budgetSeconds(): number {
  const raw = process.env.GPU_BUDGET_SECONDS;
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0; // 0 = disabled
}

/** True when this month's GPU-seconds have hit the configured budget. */
export const isOverBudget = query({
  args: {},
  handler: async (ctx) => {
    const budget = budgetSeconds();
    if (budget === 0) return false; // guard disabled

    const row = await ctx.db
      .query("gpuUsage")
      .withIndex("by_bucket", (q) => q.eq("bucket", currentBucket()))
      .unique();

    return (row?.seconds ?? 0) >= budget;
  },
});

/** Current month's usage, for dashboards / debugging. */
export const usage = query({
  args: {},
  handler: async (ctx) => {
    const bucket = currentBucket();
    const row = await ctx.db
      .query("gpuUsage")
      .withIndex("by_bucket", (q) => q.eq("bucket", bucket))
      .unique();
    return {
      bucket,
      seconds: row?.seconds ?? 0,
      budgetSeconds: budgetSeconds(),
    };
  },
});

// One build's upstream attempts share a 240 s budget (UPSTREAM_BUDGET_MS in
// /api/facelift); anything beyond this per call is bogus, not real GPU time.
const MAX_SECONDS_PER_RECORD = 300;

/**
 * Atomically add GPU-seconds to the current month's counter. Called by
 * /api/facelift with the builder's Convex token — anonymous callers could
 * otherwise inflate the counter and trip the budget guard for everyone.
 */
export const record = mutation({
  args: { seconds: v.number() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    if (!(args.seconds > 0)) return; // ignore zero / NaN / negative
    const seconds = Math.min(args.seconds, MAX_SECONDS_PER_RECORD);

    const bucket = currentBucket();
    const row = await ctx.db
      .query("gpuUsage")
      .withIndex("by_bucket", (q) => q.eq("bucket", bucket))
      .unique();

    if (row) {
      await ctx.db.patch(row._id, { seconds: row.seconds + seconds });
    } else {
      await ctx.db.insert("gpuUsage", { bucket, seconds });
    }
  },
});
