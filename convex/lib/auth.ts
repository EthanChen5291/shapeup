// The one way to get from a Clerk identity to our own users row.
//
// This lookup was open-coded in a dozen files and three of them had already
// grown a private copy of it, which is the usual sign it wanted to be shared.
// The copies had also drifted on the part that matters: some threw
// `new Error("Unauthenticated")`, which production Convex redacts to "Server
// Error" before anyone reads it, so the refusal that reached the screen was
// nothing like the one that was written. Everything here throws ConvexError,
// which survives redaction — the same rule convex/chair.ts already documents.

import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type AnyCtx = QueryCtx | MutationCtx;

/** Copy for a caller with no usable session. Deliberately plain and actionable. */
const DEFAULT_SIGN_IN_MESSAGE = "Sign in first.";

/**
 * The signed-in caller's user row, or null. Null covers both "no session" and
 * "session for an account we have no row for" — callers that care about the
 * difference are rare enough to check `ctx.auth.getUserIdentity()` themselves.
 */
export async function currentUser(ctx: AnyCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

/**
 * The signed-in caller's user row, or a refusal the person can actually read.
 * Pass `message` when the surface has better copy than the default — e.g.
 * "Sign in to book a time." reads far better on a booking form.
 */
export async function requireUser(
  ctx: AnyCtx,
  message: string = DEFAULT_SIGN_IN_MESSAGE,
): Promise<Doc<"users">> {
  const user = await currentUser(ctx);
  if (!user) throw new ConvexError(message);
  return user;
}
