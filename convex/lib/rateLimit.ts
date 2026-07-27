import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";

/**
 * Fixed-window limiter for mutations, refusing with a ConvexError the client
 * can put straight on screen. Thrown as ConvexError on purpose: a plain Error's
 * message is redacted to "Server Error" in production, which would turn every
 * rate refusal into a mystery for the person tapping the button.
 *
 * `message` is the user-facing copy for this particular limit; the data also
 * carries `code: "rate_limited"` and `retryAfterSeconds` so callers (e.g.
 * /api/fal/realtime-token) can answer with a real 429 + Retry-After.
 */
export async function enforceMutationRateLimit(
  ctx: MutationCtx,
  key: string,
  limit: number,
  windowMs: number,
  message = "That’s a lot at once — give it a moment and try again.",
) {
  const now = Date.now();
  const existing = await ctx.db
    .query("rateLimits")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();

  if (!existing || now - existing.windowStart >= windowMs) {
    if (existing) {
      await ctx.db.patch(existing._id, { windowStart: now, count: 1 });
    } else {
      await ctx.db.insert("rateLimits", { key, windowStart: now, count: 1 });
    }
    return;
  }

  if (existing.count >= limit) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((windowMs - (now - existing.windowStart)) / 1000),
    );
    throw new ConvexError({ code: "rate_limited", message, retryAfterSeconds });
  }

  await ctx.db.patch(existing._id, { count: existing.count + 1 });
}
