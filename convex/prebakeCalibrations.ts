import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { requireConvexAdmin } from "./lib/adminAuth";

// Calibration log for the prebaked try-on hair (see src/data/prebakeTransforms.ts).
// Admin-only in both directions: submissions come from the studio sliders, and
// the latest one per cut is what the admin's own studio starts from next time.
//
//   npx convex run prebakeCalibrations:list            # newest first, all cuts (internal; CLI only)
//   npx convex run prebakeCalibrations:list '{"cutId":"middlepart"}'

const transformArgs = {
  scale: v.number(),
  dx: v.number(),
  dy: v.number(),
  dz: v.number(),
  alpha: v.number(),
};

async function isAdmin(ctx: Parameters<typeof requireConvexAdmin>[0]): Promise<boolean> {
  try { await requireConvexAdmin(ctx); return true; } catch { return false; }
}

export const submit = mutation({
  args: {
    projectId: v.optional(v.id("projects")),
    gender: v.string(),
    cutId: v.string(),
    variantId: v.string(),
    ...transformArgs,
    headAlpha: v.optional(v.number()),
    headScale: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await requireConvexAdmin(ctx);
    for (const key of ["scale", "dx", "dy", "dz", "alpha"] as const) {
      if (!Number.isFinite(args[key])) throw new Error(`Invalid ${key}`);
    }
    if (args.scale <= 0 || args.alpha <= 0) throw new Error("scale and alpha must be positive");
    return await ctx.db.insert("prebakeCalibrations", {
      clerkId: identity.subject,
      projectId: args.projectId,
      gender: args.gender,
      cutId: args.cutId,
      variantId: args.variantId,
      scale: args.scale,
      dx: args.dx,
      dy: args.dy,
      dz: args.dz,
      alpha: args.alpha,
      headAlpha: args.headAlpha,
      headScale: args.headScale,
      note: args.note?.slice(0, 500),
      createdAt: Date.now(),
    });
  },
});

/** Most recent submission for a cut (admins only; everyone else gets null). */
export const latestForCut = query({
  args: { cutId: v.string() },
  handler: async (ctx, { cutId }) => {
    if (!(await isAdmin(ctx))) return null;
    const row = await ctx.db
      .query("prebakeCalibrations")
      .withIndex("by_cut", (q) => q.eq("cutId", cutId))
      .order("desc")
      .first();
    if (!row) return null;
    const { scale, dx, dy, dz, alpha, headAlpha, variantId, createdAt } = row;
    return { scale, dx, dy, dz, alpha, headAlpha: headAlpha ?? 1, variantId, createdAt };
  },
});

/** Everything, newest first — for `npx convex run` when baking defaults.
 *  Internal: the CLI runs with the deployment key but no user identity, so an
 *  admin-identity check would always fail there; internal functions are not
 *  callable from clients at all. */
export const list = internalQuery({
  args: { cutId: v.optional(v.string()) },
  handler: async (ctx, { cutId }) => {
    const rows = cutId
      ? await ctx.db.query("prebakeCalibrations").withIndex("by_cut", (q) => q.eq("cutId", cutId)).order("desc").collect()
      : await ctx.db.query("prebakeCalibrations").order("desc").collect();
    return rows.map(({ _id, _creationTime, ...r }) => ({ id: _id, ...r }));
  },
});
