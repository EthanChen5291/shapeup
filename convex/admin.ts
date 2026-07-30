import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// Admin-only helpers, meant to be invoked from the CLI via `npx convex run`
// (which only exposes `internal*` functions), never from the client. Run them
// against the dev deployment by default; pass `--prod` to target production.
//
//   List every account's username/credits:
//     npx convex run admin:listAccounts
//   Grant tokens (credits) to one account:
//     npx convex run admin:grantTokens '{"username":"alice","amount":5}'
//   Per-demo-account usage report (or `npm run sales:usage`, which reads the
//   emails out of scripts/sales-accounts.local.csv for you):
//     npx convex run admin:salesUsage '{"emails":["eagle@shapeup.com"]}'

/**
 * List every account in the current deployment with its username, email,
 * Clerk id, and current token balance (the `credits` field). Sorted by
 * username so the output is stable and easy to scan.
 */
export const listAccounts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const users = await ctx.db.query("users").collect();
    return users
      .map((u) => ({
        username: u.username ?? null,
        email: u.email ?? null,
        clerkId: u.clerkId,
        credits: u.credits,
      }))
      .sort((a, b) => (a.username ?? "~").localeCompare(b.username ?? "~"));
  },
});

// Bounded scans for the usage report (per Convex guidelines: never unbounded
// .collect() on tables that grow). Demo accounts run a handful of in-chair
// demos a day, so these caps are years of headroom; a capped count is reported
// as "cap+" rather than silently passed off as exact.
const USAGE_BUCKET_SCAN = 400; // chairUsage rows = days with at least one take
const CLIENT_SCAN = 500; // chairClients rows = people who sat for a demo

export interface SalesAccountUsage {
  email: string;
  /** False until the account has signed in once (no Convex users row yet). */
  signedIn: boolean;
  credits: number | null;
  /** The account's barber card, where all chair-demo activity hangs. */
  pageSlug: string | null;
  /** Lucy seconds billed to this account's chair (claim minus refunds). */
  videoSeconds: number;
  takes: number;
  /** Distinct people in this account's chair roster (walk-ins + card visitors). */
  customersReached: string;
  /** How many of those came in through the public card on their own phone. */
  viaCard: number;
  lastActiveAt: number | null;
}

/**
 * Usage report for the sales demo accounts: seconds of live video spent,
 * take count, and customers reached, per account. Everything is read from the
 * tables chair mode already maintains (chairUsage, chairClients) — this
 * records nothing new, it attributes what's already metered.
 */
export const salesUsage = internalQuery({
  args: { emails: v.array(v.string()) },
  handler: async (ctx, args): Promise<SalesAccountUsage[]> => {
    if (args.emails.length > 50) throw new Error("Pass at most 50 emails per call");
    const report: SalesAccountUsage[] = [];

    for (const raw of args.emails) {
      const email = raw.trim().toLowerCase();
      if (!email) continue;
      const empty: SalesAccountUsage = {
        email,
        signedIn: false,
        credits: null,
        pageSlug: null,
        videoSeconds: 0,
        takes: 0,
        customersReached: "0",
        viaCard: 0,
        lastActiveAt: null,
      };

      const user = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .unique();
      if (!user) {
        report.push(empty);
        continue;
      }
      empty.signedIn = true;
      empty.credits = user.credits;

      const page = await ctx.db
        .query("barberPages")
        .withIndex("by_owner", (q) => q.eq("ownerUserId", user._id))
        .first();
      if (!page) {
        report.push(empty);
        continue;
      }
      empty.pageSlug = page.slug;

      const usage = await ctx.db
        .query("chairUsage")
        .withIndex("by_page_and_bucket", (q) => q.eq("pageId", page._id))
        .take(USAGE_BUCKET_SCAN);
      for (const row of usage) {
        empty.videoSeconds += row.seconds;
        empty.takes += row.takes;
      }

      const clients = await ctx.db
        .query("chairClients")
        .withIndex("by_page_and_visit", (q) => q.eq("pageId", page._id))
        .order("desc")
        .take(CLIENT_SCAN);
      empty.customersReached =
        clients.length >= CLIENT_SCAN ? `${CLIENT_SCAN}+` : String(clients.length);
      empty.viaCard = clients.filter((c) => c.visitorTokenIdentifier).length;
      empty.lastActiveAt = clients[0]?.lastVisitAt ?? null;

      report.push(empty);
    }
    return report;
  },
});

/**
 * Grant `amount` tokens (credits) to a single account, identified by exactly
 * one of username / email / clerkId. `amount` may be negative to deduct.
 * Returns the matched account and its new balance.
 */
export const grantTokens = internalMutation({
  args: {
    amount: v.number(),
    username: v.optional(v.string()),
    email: v.optional(v.string()),
    clerkId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.amount)) {
      throw new Error("amount must be a finite number");
    }
    const selectors = [args.username, args.email, args.clerkId].filter(
      (v) => v !== undefined,
    );
    if (selectors.length !== 1) {
      throw new Error("Pass exactly one of: username, email, clerkId");
    }

    const user = args.username
      ? await ctx.db
          .query("users")
          .withIndex("by_username", (q) => q.eq("username", args.username))
          .unique()
      : args.email
        ? await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", args.email))
            .unique()
        : await ctx.db
            .query("users")
            .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId!))
            .unique();

    if (!user) {
      throw new Error(
        `No account found for ${JSON.stringify({
          username: args.username,
          email: args.email,
          clerkId: args.clerkId,
        })}`,
      );
    }

    const credits = user.credits + args.amount;
    await ctx.db.patch(user._id, { credits });
    return {
      username: user.username ?? null,
      email: user.email ?? null,
      clerkId: user.clerkId,
      granted: args.amount,
      credits,
    };
  },
});
