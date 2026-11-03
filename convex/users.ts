import { internalMutation, mutation, query } from "./_generated/server";
import { ConvexError } from "convex/values";
import { v } from "convex/values";
import { validateUsernameBusinessRules } from "./lib/contentFilter";
import { enforceMutationRateLimit } from "./lib/rateLimit";
import { maybeAttachReferral, uniqueReferralCode } from "./lib/referrals";
import { isOnEmailAllowlist } from "./lib/allowlist";
import { hairParamsValidator, lastProfileValidator } from "./validators";
import { freeGenRemainingForUser } from "./lib/freeGen";
import { isDisposableEmailDomain } from "./lib/disposableEmail";
import { requireConvexAdmin } from "./lib/adminAuth";
import { BIOMETRIC_CONSENT_VERSION, coversIdentityCheck } from "./lib/biometricConsent";

// Plan ranking — higher index = more premium. Drives the displayed plan tier.
const PLAN_RANK = ["starter", "popular", "pro"] as const;
type PlanId = (typeof PLAN_RANK)[number];

const USERNAME_CHANGE_LIMIT = 5;
const USERNAME_CHANGE_WINDOW_MS = 60 * 60 * 1000;

// One-time acquisition grants (in credits). Welcome lands at account creation;
// the phone bonus lands after a verified phone is attached (see claimPhoneBonus).
export const WELCOME_BUNDLE_CREDITS = 5;
export const PHONE_BONUS_CREDITS = 5;

/**
 * The patch that grants the one-time welcome bundle, or `{}` if the user has
 * already received it or has no permanent (non-disposable) email. Idempotent
 * via `welcomeGrantedAt`, so it's safe to fold into every getOrCreate
 * resolution path — each human is credited exactly once, and pre-bundle
 * accounts get backfilled the next time they load the app.
 */
function welcomeGrantPatch(
  user: { credits: number; welcomeGrantedAt?: number; email?: string },
  identityEmail?: string,
): { credits: number; welcomeGrantedAt: number } | Record<string, never> {
  if (user.welcomeGrantedAt) return {};
  const email = (user.email || identityEmail || "").toLowerCase().trim();
  if (!email || isDisposableEmailDomain(email)) return {};
  return { credits: user.credits + WELCOME_BUNDLE_CREDITS, welcomeGrantedAt: Date.now() };
}

export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;

    // The unused monthly free generations behave like trailing credits in the
    // UI: paid credits are always spent first, so `availableGenerations` is what
    // the user can actually run right now. They reset (not accumulate) each
    // calendar month — see convex/lib/freeGen.ts and convex/freeGen.ts.
    const freeGenRemaining = freeGenRemainingForUser(user);
    return {
      ...user,
      freeGenRemaining,
      availableGenerations: user.credits + freeGenRemaining,
    };
  },
});

export const getOrCreate = mutation({
  args: { referralCode: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (existing) {
      const patch: Record<string, unknown> = {};
      // Backfill a referral code for accounts that predate the referral feature.
      if (!existing.referralCode) {
        patch.referralCode = await uniqueReferralCode(ctx);
      }
      // Backfill email for accounts created before the `convex` JWT template
      // emitted the `email` claim. Without it, the free-generation gate in
      // convex/freeGen.ts rejects them with "a permanent email is required",
      // since `user.email` was stored empty and never updated afterward.
      if (!existing.email && identity.email) {
        patch.email = identity.email;
      }
      // Welcome bundle (also backfills accounts that predate it). Uses the
      // freshly-backfilled email when we just set it above.
      Object.assign(
        patch,
        welcomeGrantPatch({ ...existing, email: (patch.email as string | undefined) ?? existing.email }, identity.email),
      );
      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(existing._id, patch);
      }
      return existing._id;
    }

    // Check for a pending user created by the webhook before first login
    const pending = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", identity.subject))
      .unique();
    if (pending) {
      await ctx.db.patch(pending._id, {
        tokenIdentifier: identity.tokenIdentifier,
        email: identity.email ?? pending.email,
        username: identity.nickname ?? pending.username,
        referralCode: pending.referralCode ?? (await uniqueReferralCode(ctx)),
        ...welcomeGrantPatch({ ...pending, email: identity.email ?? pending.email }, identity.email),
      });
      await maybeAttachReferral(ctx, pending._id, args.referralCode);
      return pending._id;
    }

    // Cross-auth-method linking: signing in with a second method (e.g. Google
    // after email/password) yields a different Clerk subject/token, so the two
    // lookups above miss and we'd otherwise create a duplicate account — forcing
    // the user through username setup again. If there's an existing account with
    // the same VERIFIED email, adopt it onto this identity instead. The
    // emailVerified guard is essential: adopting on an unverified email would let
    // anyone claim another user's account by signing up with their address.
    if (identity.email && identity.emailVerified) {
      const email = identity.email;
      // .first() (not .unique()): if earlier duplicates already exist for this
      // email, tolerate them rather than throwing and blocking login.
      const byEmail = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();
      if (byEmail) {
        await ctx.db.patch(byEmail._id, {
          tokenIdentifier: identity.tokenIdentifier,
          clerkId: identity.subject,
          username: byEmail.username ?? identity.nickname ?? undefined,
          referralCode: byEmail.referralCode ?? (await uniqueReferralCode(ctx)),
          ...welcomeGrantPatch(byEmail, identity.email),
        });
        await maybeAttachReferral(ctx, byEmail._id, args.referralCode);
        return byEmail._id;
      }
    }

    // Fresh account: seed the welcome bundle inline when the email is a real,
    // non-disposable address (Sybil backstop). welcomeGrantPatch keeps the two
    // creation-time paths — this insert and the adopt patches above — in sync.
    const welcome = welcomeGrantPatch({ credits: 0, email: identity.email }, identity.email);
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      clerkId: identity.subject,
      email: identity.email,
      username: identity.nickname ?? undefined,
      credits: welcome.credits ?? 0,
      welcomeGrantedAt: welcome.welcomeGrantedAt,
      referralCode: await uniqueReferralCode(ctx),
    });
    await maybeAttachReferral(ctx, userId, args.referralCode);
    return userId;
  },
});

export const getReferralStats = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;

    const referrals = await ctx.db
      .query("referrals")
      .withIndex("by_referrer", (q) => q.eq("referrerUserId", user._id))
      .take(500);
    const rewarded = referrals.filter((r) => r.status === "rewarded").length;
    const pending = referrals.length - rewarded;

    return {
      referralCode: user.referralCode ?? null,
      friendsJoined: referrals.length,
      friendsRewarded: rewarded,
      friendsPending: pending,
      tokensEarned: rewarded * 3,
    };
  },
});

export const hasBiometricConsent = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    return Boolean(user?.biometricConsentAt);
  },
});

/** Whether the caller accepted a notice that covers the edit identity check. */
export const hasIdentityCheckConsent = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    return Boolean(user?.biometricConsentAt) && coversIdentityCheck(user?.biometricConsentVersion);
  },
});

// Confirms the signed-in user owns a given S3 image key. Used by /api/img to
// gate access to sensitive per-user assets (scans / edited face images) so a
// leaked or guessed key can't be fetched by another account. Checks the user's
// own sessions, projects, and saved defaultScan — all keys the user legitimately
// references. Returns false for anyone else (and the unauthenticated case).
export const ownsImageKey = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;
    const token = identity.tokenIdentifier;

    // Sessions (raw scan uploads) — indexed by owner.
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_id", (q) => q.eq("userId", token))
      .collect();
    if (sessions.some((s) => s.scanS3Key === key || s.imageUrl === key)) return true;

    // Projects (snapshots: scan + edit image + thumbnail) — indexed by owner.
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", token))
      .collect();
    if (
      projects.some(
        (p) =>
          p.lastImageS3Key === key ||
          p.lastEditImageS3Key === key ||
          p.thumbnailS3Key === key,
      )
    ) {
      return true;
    }

    // The reusable default scan stored on the user doc.
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", token))
      .unique();
    const ds = user?.defaultScan;
    if (ds && (ds.lastImageS3Key === key || ds.thumbnailS3Key === key)) return true;

    return false;
  },
});

// Confirms the signed-in user owns a facelift output (facelifts/<jobId>/…).
// Used by /api/splat so a leaked or guessed splat key can't be fetched by
// another account. The facelift row (looked up by job id) is the normal proof;
// projects and the default scan cover keys copied from older builds.
export const ownsSplatKey = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;
    const token = identity.tokenIdentifier;

    const jobId = /^facelifts\/([^/]+)\/[^/]+$/.exec(key)?.[1];
    if (!jobId) return false;
    const rows = await ctx.db
      .query("facelifts")
      .withIndex("by_job_id", (q) => q.eq("jobId", jobId))
      .take(10);
    if (rows.some((r) => r.userId === token)) return true;

    const prefix = `facelifts/${jobId}/`;
    const inJob = (value: unknown) => typeof value === "string" && value.startsWith(prefix);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", token))
      .take(500);
    if (projects.some((p) => [p.splatS3Key, p.metaS3Key, p.tryOnBaseSplatS3Key, p.tryOnBaseMetaS3Key].some(inJob))) {
      return true;
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", token))
      .unique();
    return inJob(user?.defaultScan?.splatS3Key);
  },
});

export const recordBiometricConsent = mutation({
  args: { noticeVersion: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    let user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (!user) {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: identity.tokenIdentifier,
        clerkId: identity.subject,
        email: identity.email,
        username: identity.nickname ?? undefined,
        credits: 0,
      });
      user = await ctx.db.get(userId);
    }
    if (!user) throw new Error("User not found");

    const consentAt = Date.now();
    await ctx.db.patch(user._id, {
      biometricConsentAt: consentAt,
      biometricConsentVersion: args.noticeVersion ?? BIOMETRIC_CONSENT_VERSION,
    });
    return { consentAt };
  },
});

// Records the user's answer to the one-time "Improve ShapeUp?" prompt. Stamping
// promptedAt (even on decline) is what guarantees the prompt only ever shows once.
// Bounds mirror the studio's drag handles; clamped here so a client can't store junk.
export const STUDIO_LAYOUT_BOUNDS = {
  sidebarWidth: { min: 280, max: 640 },
  cutListHeight: { min: 96, max: 480 },
} as const;

export const setSuggestionGender = mutation({
  args: { gender: v.union(v.literal("mens"), v.literal("womens")) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new Error("User not found");
    if (user.suggestionGender === args.gender) return;
    await ctx.db.patch(user._id, { suggestionGender: args.gender });
  },
});

export const setStudioLayout = mutation({
  // A number saves that dimension; null clears it (back to the auto default).
  args: {
    sidebarWidth: v.optional(v.union(v.number(), v.null())),
    cutListHeight: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new Error("User not found");

    const next = { ...(user.studioLayout ?? {}) };
    for (const key of ["sidebarWidth", "cutListHeight"] as const) {
      const value = args[key];
      if (value === null) { delete next[key]; continue; }
      if (value === undefined || !Number.isFinite(value)) continue;
      const { min, max } = STUDIO_LAYOUT_BOUNDS[key];
      // The trending list can be folded away entirely: 0 = collapsed to its header.
      if (key === "cutListHeight" && value <= 0) { next[key] = 0; continue; }
      next[key] = Math.round(Math.min(max, Math.max(min, value)));
    }
    await ctx.db.patch(user._id, { studioLayout: next });
  },
});

export const setImproveShapeUp = mutation({
  args: { optIn: v.boolean() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new Error("User not found");

    await ctx.db.patch(user._id, {
      improveShapeUpOptIn: args.optIn,
      improveShapeUpPromptedAt: Date.now(),
    });
  },
});

export const deductCredit = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError("Couldn't find your account. Please reload and try again.");

    // Dev/demo allowlist: bypass the paywall entirely for allowlisted emails,
    // even when they have no credits.
    if (isOnEmailAllowlist(user, identity)) {
      return user.credits;
    }

    if (user.credits <= 0) throw new ConvexError("You're out of credits. Add more to continue.");

    await ctx.db.patch(user._id, { credits: user.credits - 1 });
    return user.credits - 1;
  },
});

/** True when the current user is an allowlisted demo/dev account. */
/** Whether the caller is on the admin allowlist (drives admin-only UI such as the
 *  try-on calibration sliders). Fails closed. */
export const amIAdmin = query({
  args: {},
  handler: async (ctx) => {
    try { await requireConvexAdmin(ctx); return true; } catch { return false; }
  },
});

export const isAllowlisted = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return false;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    return isOnEmailAllowlist(user, identity);
  },
});

export const setUsername = mutation({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");

    await enforceMutationRateLimit(
      ctx,
      `users:setUsername:${identity.tokenIdentifier}`,
      USERNAME_CHANGE_LIMIT,
      USERNAME_CHANGE_WINDOW_MS,
    );

    const trimmed = args.username.trim();
    if (trimmed.length < 2 || trimmed.length > 20) throw new ConvexError("Username must be between 2 and 20 characters.");
    if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) throw new ConvexError("Only letters, numbers, and underscores are allowed.");
    const businessRuleError = validateUsernameBusinessRules(trimmed);
    if (businessRuleError) throw new ConvexError(businessRuleError);

    const existing = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", trimmed))
      .unique();
    if (existing) throw new ConvexError("That username is already taken. Try another one.");

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError("Couldn't find your account. Try signing out and back in.");

    await ctx.db.patch(user._id, { username: trimmed });
    return trimmed;
  },
});

// Per-user S3 prefixes. Anything else (e.g. the shared prebake/ hair library)
// is never queued for deletion, even if a row happens to point at it.
const USER_S3_PREFIXES = ["pictures/", "facelifts/", "projects/", "edit-images/", "thumbnails/"];

function pushKey(keys: Set<string>, value: unknown) {
  if (typeof value !== "string") return;
  if (USER_S3_PREFIXES.some((prefix) => value.startsWith(prefix))) keys.add(value);
}

// A facelift job writes several files into facelifts/<jobId>/, and older rows
// don't record all of them (meta.json, turntable.mp4), so queue the whole set.
// Deleting a key that doesn't exist is a no-op in S3.
const FACELIFT_JOB_FILES = ["output.splat", "output.ply", "meta.json", "turntable.mp4"];
function pushFaceliftKey(keys: Set<string>, value: unknown) {
  pushKey(keys, value);
  if (typeof value !== "string") return;
  const job = /^facelifts\/([^/]+)\//.exec(value)?.[1];
  if (job) for (const file of FACELIFT_JOB_FILES) keys.add(`facelifts/${job}/${file}`);
}

type Row = Record<string, unknown>;
function sessionKeys(keys: Set<string>, s: Row) {
  pushKey(keys, s.scanS3Key);
  pushKey(keys, s.imageUrl);
}
function faceliftKeys(keys: Set<string>, f: Row) {
  pushFaceliftKey(keys, f.splatS3Key);
  pushFaceliftKey(keys, f.plyS3Key);
  pushFaceliftKey(keys, f.metaS3Key);
}
function projectKeys(keys: Set<string>, p: Row) {
  for (const field of ["lastImageS3Key", "lastImageUrl", "lastEditImageS3Key", "thumbnailS3Key", "thumbnailUrl"]) {
    pushKey(keys, p[field]);
  }
  for (const field of ["splatS3Key", "metaS3Key", "lastSplatUrl", "tryOnBaseSplatS3Key", "tryOnBaseMetaS3Key"]) {
    pushFaceliftKey(keys, p[field]);
  }
}
function defaultScanKeys(keys: Set<string>, ds: Row | undefined) {
  if (!ds) return;
  pushKey(keys, ds.lastImageS3Key);
  pushKey(keys, ds.lastImageUrl);
  pushKey(keys, ds.thumbnailS3Key);
  pushFaceliftKey(keys, ds.splatS3Key);
  pushFaceliftKey(keys, ds.lastSplatUrl);
}

/** Rows handled per account-deletion round; the API route loops until none are left. */
export const ACCOUNT_DELETION_BATCH = 100;

// Account deletion runs files-first, so a failure never leaves S3 objects with
// nothing pointing at them:
//   1. accountDeletionBatch (query) lists the next batch of rows + their S3 keys
//   2. the API route deletes those objects from S3 (and stops if that fails)
//   3. deleteAccountRows (mutation) deletes exactly those rows
// repeating until no rows are left, then deleteCurrentUserData removes the user.
export const accountDeletionBatch = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const token = identity.tokenIdentifier;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", token))
      .unique();

    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_id", (q) => q.eq("userId", token))
      .take(ACCOUNT_DELETION_BATCH);
    const facelifts = await ctx.db
      .query("facelifts")
      .withIndex("by_user_id", (q) => q.eq("userId", token))
      .take(ACCOUNT_DELETION_BATCH);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", token))
      .take(ACCOUNT_DELETION_BATCH);

    const s3Keys = new Set<string>();
    for (const s of sessions) sessionKeys(s3Keys, s);
    for (const f of facelifts) faceliftKeys(s3Keys, f);
    for (const p of projects) projectKeys(s3Keys, p);
    defaultScanKeys(s3Keys, user?.defaultScan);

    return {
      s3Keys: [...s3Keys],
      sessionIds: sessions.map((s) => s._id),
      faceliftIds: facelifts.map((f) => f._id),
      projectIds: projects.map((p) => p._id),
    };
  },
});

export const deleteAccountRows = mutation({
  args: {
    sessionIds: v.array(v.id("sessions")),
    faceliftIds: v.array(v.id("facelifts")),
    projectIds: v.array(v.id("projects")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const token = identity.tokenIdentifier;
    const total = args.sessionIds.length + args.faceliftIds.length + args.projectIds.length;
    if (total > 3 * ACCOUNT_DELETION_BATCH) throw new Error("Too many rows in one deletion batch");

    // Only the caller's own rows; anything else (or already gone) is skipped.
    for (const id of args.sessionIds) {
      const row = await ctx.db.get(id);
      if (row?.userId === token) await ctx.db.delete(id);
    }
    for (const id of args.faceliftIds) {
      const row = await ctx.db.get(id);
      if (row?.userId === token) await ctx.db.delete(id);
    }
    for (const id of args.projectIds) {
      const row = await ctx.db.get(id);
      if (row?.tokenIdentifier !== token) continue;
      if (row.thumbnailStorageId) await ctx.storage.delete(row.thumbnailStorageId).catch(() => {});
      await ctx.db.delete(id);
    }
  },
});

// Final step: deletes the user row once their data rows are gone. If rows are
// still there (created mid-deletion), it deletes a batch of them and returns
// their keys with done=false; the caller removes those files and calls again.
export const deleteCurrentUserData = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const token = identity.tokenIdentifier;

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", token))
      .unique();
    if (!user) throw new Error("User not found");

    const s3Keys = new Set<string>();
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_id", (q) => q.eq("userId", token))
      .take(ACCOUNT_DELETION_BATCH);
    const facelifts = await ctx.db
      .query("facelifts")
      .withIndex("by_user_id", (q) => q.eq("userId", token))
      .take(ACCOUNT_DELETION_BATCH);
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", token))
      .take(ACCOUNT_DELETION_BATCH);
    for (const s of sessions) { sessionKeys(s3Keys, s); await ctx.db.delete(s._id); }
    for (const f of facelifts) { faceliftKeys(s3Keys, f); await ctx.db.delete(f._id); }
    for (const p of projects) {
      projectKeys(s3Keys, p);
      if (p.thumbnailStorageId) await ctx.storage.delete(p.thumbnailStorageId).catch(() => {});
      await ctx.db.delete(p._id);
    }
    if (sessions.length + facelifts.length + projects.length > 0) {
      return { done: false, clerkId: user.clerkId, s3Keys: [...s3Keys] };
    }

    defaultScanKeys(s3Keys, user.defaultScan);
    await ctx.db.insert("accountDeletionRequests", {
      requestId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      requestedAt: Date.now(),
      status: "processing",
    });
    await ctx.db.delete(user._id);

    return {
      done: true,
      clerkId: user.clerkId,
      s3Keys: [...s3Keys],
      warning: "Legacy session rows without userId cannot be safely attributed for automatic deletion.",
    };
  },
});

export const updateSettings = mutation({
  args: {
    theme: v.optional(v.union(v.literal("light"), v.literal("dark"), v.literal("system"))),
    renderQuality: v.optional(v.union(v.literal("performance"), v.literal("balanced"), v.literal("high"))),
    aiTrainingOptOut: v.optional(v.boolean()),
    language: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new Error("User not found");
    const patch: Record<string, unknown> = {};
    if (args.theme !== undefined) patch.theme = args.theme;
    if (args.renderQuality !== undefined) patch.renderQuality = args.renderQuality;
    if (args.aiTrainingOptOut !== undefined) patch.aiTrainingOptOut = args.aiTrainingOptOut;
    if (args.language !== undefined) patch.language = args.language;
    await ctx.db.patch(user._id, patch);
  },
});

// Records the user's latest completed scan as the reusable "default scan".
// Called after a real scan+3D build finishes. Projects copy these keys at
// creation (snapshot), so overwriting this never touches existing projects.
export const setDefaultScan = mutation({
  args: {
    lastImageS3Key: v.optional(v.string()),
    lastImageUrl: v.optional(v.string()),
    thumbnailS3Key: v.optional(v.string()),
    splatS3Key: v.optional(v.string()),
    lastSplatUrl: v.optional(v.string()),
    lastProfile: v.optional(lastProfileValidator),
    lastHairParams: v.optional(hairParamsValidator),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new Error("User not found");
    await ctx.db.patch(user._id, {
      defaultScan: { ...args, updatedAt: Date.now() },
    });
  },
});

export const revokeBiometricConsent = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new Error("User not found");

    // Revoking consent must delete the raw facial scans (the biometric identifier).
    // Generated 3D models are kept. The S3 objects themselves are deleted by the
    // calling API route using the keys returned below (Convex can't reach S3 directly).
    const s3Keys = new Set<string>();
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_user_id", (q) => q.eq("userId", identity.tokenIdentifier))
      .take(200);
    for (const session of sessions) {
      pushKey(s3Keys, session.scanS3Key);
      pushKey(s3Keys, session.imageUrl);
      await ctx.db.delete(session._id);
    }

    // The reusable default scan caches the raw scan image key — drop it (and queue
    // it for S3 deletion) so revocation doesn't leave a biometric pointer behind.
    if (user.defaultScan) {
      pushKey(s3Keys, user.defaultScan.lastImageS3Key);
      pushKey(s3Keys, user.defaultScan.lastImageUrl);
    }

    await ctx.db.patch(user._id, {
      biometricConsentAt: undefined,
      biometricConsentVersion: undefined,
      defaultScan: undefined,
    });

    return { s3Keys: [...s3Keys] };
  },
});

export const addCredits = internalMutation({
  args: { clerkId: v.string(), amount: v.number() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();

    if (user) {
      await ctx.db.patch(user._id, { credits: user.credits + args.amount });
    } else {
      await ctx.db.insert("users", {
        tokenIdentifier: `pending|${args.clerkId}`,
        clerkId: args.clerkId,
        credits: args.amount,
      });
    }
  },
});

/** Returns the higher-ranked of two plan ids (or the defined one). */
function higherPlan(a: PlanId | undefined, b: PlanId | undefined): PlanId | undefined {
  if (!a) return b;
  if (!b) return a;
  return PLAN_RANK.indexOf(a) >= PLAN_RANK.indexOf(b) ? a : b;
}

export const addCreditsForStripeEvent = internalMutation({
  args: {
    eventId: v.string(),
    clerkId: v.string(),
    amount: v.number(),
    plan: v.optional(v.union(v.literal("starter"), v.literal("popular"), v.literal("pro"))),
  },
  handler: async (ctx, args) => {
    if (!Number.isFinite(args.amount) || args.amount <= 0) {
      throw new Error("Invalid credit amount");
    }

    const existingEvent = await ctx.db
      .query("stripeEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", args.eventId))
      .unique();
    if (existingEvent) return { status: "duplicate" };

    await ctx.db.insert("stripeEvents", {
      eventId: args.eventId,
      createdAt: Date.now(),
    });

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerk_id", (q) => q.eq("clerkId", args.clerkId))
      .unique();

    if (user) {
      await ctx.db.patch(user._id, {
        credits: user.credits + args.amount,
        topPlan: higherPlan(user.topPlan, args.plan),
      });
    } else {
      await ctx.db.insert("users", {
        tokenIdentifier: `pending|${args.clerkId}`,
        clerkId: args.clerkId,
        credits: args.amount,
        topPlan: args.plan,
      });
    }

    return { status: "credited" };
  },
});
