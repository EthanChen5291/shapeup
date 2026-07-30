// ============================================================
// Chair Mode's backend — the barber's station, not the client's funnel.
//
// The unit of work here is a WALK-IN, not a user. Nobody in the chair signs up:
// the barber types a name, taps once, and the camera is live. So every row in
// chairClients / chairTakes is owned by a barberPages row, and the only
// identity this file ever authenticates is the BARBER's.
//
// That has two consequences worth stating out loud:
//
//  1. Authorization is a single compare. `pageId` is denormalized onto every
//     take so no listing or mutation has to walk up to the parent to find out
//     who owns it — see requireOwnedTake(). No caller-supplied id is trusted;
//     the page always comes from ctx.auth.
//
//  2. Consent can't live on a users doc. convex/users.ts stamps
//     biometricConsentAt on the account that gave it, but a walk-in has no
//     account — so the stamp lives on chairClients, captured as a one-tap
//     acknowledgement on the barber's tablet before the first take. Same
//     shape (timestamp + notice version), different owner.
//
// Money: the realtime model bills per second of wall clock, so a take is
// debited its full 30-second ceiling BEFORE a fal token is minted and refunded
// the unused remainder when the browser reports back. A take that never
// reports (closed tab, dead battery) simply stays fully charged. See
// convex/lib/chair.ts for why that direction is the safe one.
// ============================================================

import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { buildReferenceEmail } from "./lib/referenceEmail";
import { enforceMutationRateLimit } from "./lib/rateLimit";
import { requireConvexAdmin } from "./lib/adminAuth";
import {
  ANGLE_KEYS,
  CARD_CONSENT_VERSION,
  CHAIR_CONSENT_VERSION,
  DEFAULT_DAILY_TAKES,
  MAX_CLIENT_NAME_LENGTH,
  MAX_CLIENT_NOTE_LENGTH,
  MAX_PROMPT_LENGTH,
  MAX_SERVICE_NAME_LENGTH,
  MAX_TAKE_SECONDS,
  MAX_TAKE_SNAPSHOTS,
  MAX_VISIT_CHIPS,
  MAX_VISIT_CHIP_LENGTH,
  MAX_VISIT_NOTE_LENGTH,
  TAKE_CLAIM_SECONDS,
  dayBucket,
  isAngleKey,
  lucyMonthBucket,
  normalizeClientName,
} from "./lib/chair";

/** How many clients / takes a single read ever pulls back. */
const CLIENT_PAGE_SIZE = 60;
const TAKE_PAGE_SIZE = 40;

// ── ownership ───────────────────────────────────────────────────────────────

/**
 * The caller's barber page, or null. Chair mode is barber-only: a signed-in
 * account with no barberPages row has nothing to see here.
 */
async function getCallerPage(ctx: QueryCtx): Promise<Doc<"barberPages"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) return null;
  return await ctx.db
    .query("barberPages")
    .withIndex("by_owner", (q) => q.eq("ownerUserId", user._id))
    .first();
}

// User-facing refusals are ConvexError, never plain Error: production Convex
// redacts a plain Error's message to "Server Error", so copy thrown that way
// would never actually reach the person it was written for.

async function requireCallerPage(ctx: QueryCtx): Promise<Doc<"barberPages">> {
  const page = await getCallerPage(ctx);
  if (!page) throw new ConvexError("Chair mode is for barbers — set up your card first.");
  return page;
}

// Chair mode used to refuse accounts without a barber card. Walk-in demo
// stations sign in with shared accounts that never met /barber, so the card is
// now provisioned silently on first use instead — the tenancy model is
// unchanged, only the setup screen is gone. The row is unpublished and carries
// no public content until the barber edits it.
export const ensureCard = mutation({
  args: {},
  handler: async (ctx): Promise<Id<"barberPages">> => {
    const existing = await getCallerPage(ctx);
    if (existing) return existing._id;

    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in first.");
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    // users.getOrCreate runs before this on chair mount; a missing row here
    // means that call failed, and retrying beats guessing at its grant logic.
    if (!user) throw new ConvexError("Sign in first.");

    const seed = (user.username || user.email?.split("@")[0] || "chair")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24);
    const base = seed.length >= 3 ? seed : `chair-${seed}`.slice(0, 24).replace(/-+$/g, "");
    let slug = base;
    for (let n = 2; ; n++) {
      const taken = await ctx.db
        .query("barberPages")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .first();
      if (!taken) break;
      slug = `${base}-${n}`;
    }

    const now = Date.now();
    return await ctx.db.insert("barberPages", {
      slug,
      ownerUserId: user._id,
      displayName: user.username || user.email?.split("@")[0] || "Barber",
      links: [],
      styles: [],
      published: false,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** A client row the caller actually owns. Throws rather than leaking existence. */
async function requireOwnedClient(
  ctx: QueryCtx,
  pageId: Id<"barberPages">,
  clientId: Id<"chairClients">,
): Promise<Doc<"chairClients">> {
  const client = await ctx.db.get(clientId);
  if (!client || client.pageId !== pageId) throw new ConvexError("Unknown client");
  return client;
}

async function requireOwnedTake(
  ctx: QueryCtx,
  pageId: Id<"barberPages">,
  takeId: Id<"chairTakes">,
): Promise<Doc<"chairTakes">> {
  const take = await ctx.db.get(takeId);
  if (!take || take.pageId !== pageId) throw new ConvexError("Unknown take");
  return take;
}

/**
 * A take the caller may write to: the barber who owns it, OR the card visitor
 * who is the subject of it.
 *
 * The second case exists because a take started from /b/<slug> runs on the
 * CLIENT's phone — they're the only one who can report how long it actually ran
 * or hand back the recording. Refusing them would leave every card take charged
 * at the full 30-second ceiling forever.
 *
 * Note this grants no reach beyond their own row: the visitor match is on the
 * Clerk tokenIdentifier stamped when they consented, so one visitor can never
 * touch another's take, and neither can touch a walk-in's.
 */
async function requireTakeAccess(
  ctx: QueryCtx,
  takeId: Id<"chairTakes">,
): Promise<Doc<"chairTakes">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError("Unknown take");

  const take = await ctx.db.get(takeId);
  if (!take) throw new ConvexError("Unknown take");

  const page = await getCallerPage(ctx);
  if (page && take.pageId === page._id) return take;

  const client = await ctx.db.get(take.clientId);
  if (client?.visitorTokenIdentifier === identity.tokenIdentifier) return take;

  throw new ConvexError("Unknown take");
}

// ── budget ──────────────────────────────────────────────────────────────────

function dailyTakeCap(): number {
  const raw = process.env.LUCY_DAILY_TAKES_PER_BARBER;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DAILY_TAKES;
}

/** Global monthly ceiling in seconds. 0 (or unset) disables the guard. */
function globalBudgetSeconds(): number {
  const raw = process.env.LUCY_BUDGET_SECONDS;
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function readGlobalSeconds(ctx: QueryCtx, nowMs: number): Promise<number> {
  const row = await ctx.db
    .query("gpuUsage")
    .withIndex("by_bucket", (q) => q.eq("bucket", lucyMonthBucket(nowMs)))
    .unique();
  return row?.seconds ?? 0;
}

async function addGlobalSeconds(ctx: MutationCtx, nowMs: number, delta: number): Promise<void> {
  if (delta === 0) return;
  const bucket = lucyMonthBucket(nowMs);
  const row = await ctx.db
    .query("gpuUsage")
    .withIndex("by_bucket", (q) => q.eq("bucket", bucket))
    .unique();
  if (row) {
    await ctx.db.patch(row._id, { seconds: Math.max(0, row.seconds + delta) });
  } else if (delta > 0) {
    await ctx.db.insert("gpuUsage", { bucket, seconds: delta });
  }
}

async function readDailyUsage(
  ctx: QueryCtx,
  pageId: Id<"barberPages">,
  nowMs: number,
): Promise<Doc<"chairUsage"> | null> {
  const bucket = dayBucket(nowMs);
  return await ctx.db
    .query("chairUsage")
    .withIndex("by_page_and_bucket", (q) => q.eq("pageId", pageId).eq("bucket", bucket))
    .unique();
}

// ── clients ─────────────────────────────────────────────────────────────────

export interface ChairClientSummary {
  id: Id<"chairClients">;
  name: string;
  phone?: string;
  notes?: string;
  consented: boolean;
  createdAt: number;
  lastVisitAt: number;
}

/**
 * The roster: who has sat in this barber's chair, most recent first. This is
 * both the chair's landing screen and the dashboard panel — one query, because
 * they want exactly the same rows in exactly the same order.
 */
export const listClients = query({
  args: {},
  handler: async (ctx): Promise<ChairClientSummary[] | null> => {
    const page = await getCallerPage(ctx);
    if (!page) return null;
    const clients = await ctx.db
      .query("chairClients")
      .withIndex("by_page_and_visit", (q) => q.eq("pageId", page._id))
      .order("desc")
      .take(CLIENT_PAGE_SIZE);
    return clients.map((c) => ({
      id: c._id,
      name: c.name,
      phone: c.phone,
      notes: c.notes,
      consented: Boolean(c.consentAt),
      createdAt: c.createdAt,
      lastVisitAt: c.lastVisitAt,
    }));
  },
});

export interface ChairClientDetail extends ChairClientSummary {
  consentAt?: number;
  /** True when this row came in through the public card, not the chair. */
  fromCard: boolean;
}

/** One client's header for the profile page. Null rather than throwing — a
 * stale link (deleted client) should render "not found", not an error. */
export const getClient = query({
  args: { clientId: v.id("chairClients") },
  handler: async (ctx, args): Promise<ChairClientDetail | null> => {
    const page = await getCallerPage(ctx);
    if (!page) return null;
    const client = await ctx.db.get(args.clientId);
    if (!client || client.pageId !== page._id) return null;
    return {
      id: client._id,
      name: client.name,
      phone: client.phone,
      notes: client.notes,
      consented: Boolean(client.consentAt),
      consentAt: client.consentAt,
      fromCard: Boolean(client.visitorTokenIdentifier),
      createdAt: client.createdAt,
      lastVisitAt: client.lastVisitAt,
    };
  },
});

/**
 * "Next client" — find the walk-in by name or create them, and mark this as a
 * visit. Idempotent on the normalized name so a regular doesn't accumulate a
 * row per haircut.
 */
export const startVisit = mutation({
  args: {
    name: v.string(),
    phone: v.optional(v.string()),
    // Set when the client was seated from a booking on the Today view — the
    // bridge that makes an appointment and a walk-in the same record.
    bookingId: v.optional(v.id("barberBookings")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ clientId: Id<"chairClients">; name: string; needsConsent: boolean }> => {
    const page = await requireCallerPage(ctx);
    await enforceMutationRateLimit(ctx, `chair:visit:${page._id}`, 60, 60_000);

    const check = normalizeClientName(args.name);
    if (!check.ok) {
      throw new ConvexError(
        check.reason === "empty"
          ? "Give this client a name so the cut files under it."
          : `Keep the name under ${MAX_CLIENT_NAME_LENGTH} characters.`,
      );
    }

    // A booking id is caller input; silently drop one that isn't this
    // barber's rather than failing the visit over a stale link.
    let bookingId: Id<"barberBookings"> | undefined;
    if (args.bookingId) {
      const booking = await ctx.db.get(args.bookingId);
      if (booking && booking.pageId === page._id) bookingId = booking._id;
    }

    const phone = args.phone?.trim().slice(0, 40) || undefined;
    const now = Date.now();

    const existing = await ctx.db
      .query("chairClients")
      .withIndex("by_page_and_name", (q) => q.eq("pageId", page._id).eq("nameKey", check.nameKey))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastVisitAt: now,
        // A name retyped with different capitalization shouldn't churn the row,
        // but a newly supplied phone number is worth keeping.
        ...(phone ? { phone } : {}),
      });
      await upsertTodayVisit(ctx, page._id, existing._id, bookingId ? { bookingId } : {});
      return {
        clientId: existing._id,
        name: existing.name,
        needsConsent: !existing.consentAt,
      };
    }

    const clientId = await ctx.db.insert("chairClients", {
      pageId: page._id,
      name: check.name,
      nameKey: check.nameKey,
      phone,
      createdAt: now,
      lastVisitAt: now,
    });
    await upsertTodayVisit(ctx, page._id, clientId, bookingId ? { bookingId } : {});
    return { clientId, name: check.name, needsConsent: true };
  },
});

/**
 * The in-chair consent tap. A walk-in isn't a ShapeUp account, so this is the
 * only record that they agreed to being filmed and stored — it gates the first
 * take in the UI and it's what a deletion request is answered against.
 */
export const recordConsent = mutation({
  args: { clientId: v.id("chairClients") },
  handler: async (ctx, args): Promise<null> => {
    const page = await requireCallerPage(ctx);
    const client = await requireOwnedClient(ctx, page._id, args.clientId);
    if (client.consentAt) return null; // already on file — never re-stamp
    await ctx.db.patch(client._id, {
      consentAt: Date.now(),
      consentVersion: CHAIR_CONSENT_VERSION,
    });
    return null;
  },
});

export const updateClientNotes = mutation({
  args: { clientId: v.id("chairClients"), notes: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const page = await requireCallerPage(ctx);
    const client = await requireOwnedClient(ctx, page._id, args.clientId);
    const notes = args.notes.trim().slice(0, MAX_CLIENT_NOTE_LENGTH);
    await ctx.db.patch(client._id, { notes: notes || undefined });
    return null;
  },
});

// ── visits ──────────────────────────────────────────────────────────────────
//
// A visit is one client × one UTC day: the record today's decision hangs off.
// Takes are footage; the visit is what the barber and client agreed on — the
// chosen take, the "for next time" note, and the tapped facts (guard lengths,
// treatments). Everything here is barber-only: a card visitor's takes never
// create visits, because "tried a cut at home" isn't "sat in the chair".

type VisitPatch = Partial<
  Pick<Doc<"chairVisits">, "chosenTakeId" | "note" | "chips" | "serviceName" | "bookingId">
>;

/** Today's visit row for this client, created on first touch. */
async function upsertTodayVisit(
  ctx: MutationCtx,
  pageId: Id<"barberPages">,
  clientId: Id<"chairClients">,
  patch: VisitPatch = {},
): Promise<Id<"chairVisits">> {
  const now = Date.now();
  const dayKey = dayBucket(now);
  const existing = await ctx.db
    .query("chairVisits")
    .withIndex("by_client_and_day", (q) => q.eq("clientId", clientId).eq("dayKey", dayKey))
    .unique();
  if (existing) {
    await ctx.db.patch(existing._id, { ...patch, updatedAt: now });
    return existing._id;
  }
  return await ctx.db.insert("chairVisits", {
    clientId,
    pageId,
    dayKey,
    startedAt: now,
    updatedAt: now,
    ...patch,
  });
}

/**
 * The optional ten seconds after a sheet is saved: what we actually did, for
 * next time. Every field overwrites independently so the barber can add the
 * note now and the chips later (or from the dashboard days after).
 *
 * The chosen take is normally set by approveTake; the optional `takeId` here
 * exists so the dashboard can re-pin a different take as the reference.
 */
export const recordDecision = mutation({
  args: {
    clientId: v.id("chairClients"),
    takeId: v.optional(v.id("chairTakes")),
    note: v.optional(v.string()),
    chips: v.optional(v.array(v.string())),
    serviceName: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<null> => {
    const page = await requireCallerPage(ctx);
    const client = await requireOwnedClient(ctx, page._id, args.clientId);
    await enforceMutationRateLimit(ctx, `chair:decision:${page._id}`, 60, 60_000);

    const patch: VisitPatch = {};
    if (args.takeId !== undefined) {
      const take = await requireOwnedTake(ctx, page._id, args.takeId);
      if (take.clientId !== client._id) throw new ConvexError("Unknown take");
      patch.chosenTakeId = take._id;
    }
    if (args.note !== undefined) {
      const note = args.note.trim().slice(0, MAX_VISIT_NOTE_LENGTH);
      patch.note = note || undefined;
    }
    if (args.chips !== undefined) {
      const seen = new Set<string>();
      const chips: string[] = [];
      for (const raw of args.chips) {
        const chip = raw.trim().slice(0, MAX_VISIT_CHIP_LENGTH);
        if (!chip || seen.has(chip)) continue;
        seen.add(chip);
        chips.push(chip);
        if (chips.length >= MAX_VISIT_CHIPS) break;
      }
      patch.chips = chips.length ? chips : undefined;
    }
    if (args.serviceName !== undefined) {
      const name = args.serviceName.trim().slice(0, MAX_SERVICE_NAME_LENGTH);
      patch.serviceName = name || undefined;
    }

    await upsertTodayVisit(ctx, page._id, client._id, patch);
    return null;
  },
});

async function resolveAngleUrls(
  ctx: QueryCtx,
  take: Doc<"chairTakes"> | null,
): Promise<{ key: string; url: string | null }[]> {
  if (!take?.angles) return [];
  return await Promise.all(
    take.angles.map(async (a) => ({ key: a.key, url: await ctx.storage.getUrl(a.storageId) })),
  );
}

export interface LastVisitContext {
  when: number;
  cutLabel: string | null;
  cutSlug?: string;
  note?: string;
  chips?: string[];
  serviceName?: string;
  posterUrl: string | null;
  angles: { key: string; url: string | null }[];
}

/**
 * "Like last time" — the card the barber glances at before picking a cut: the
 * previous visit's chosen reference, note, and chips. Today's own visit is
 * skipped so the card doesn't show the take from five minutes ago.
 *
 * Clients whose history predates chairVisits fall back to their latest
 * approved take from an earlier day — a regular must not lose their "last
 * time" because the schema grew a table.
 */
export const lastVisitContext = query({
  args: { clientId: v.id("chairClients") },
  handler: async (ctx, args): Promise<LastVisitContext | null> => {
    const page = await getCallerPage(ctx);
    if (!page) return null;
    const client = await ctx.db.get(args.clientId);
    if (!client || client.pageId !== page._id) return null;

    const today = dayBucket(Date.now());
    const visits = await ctx.db
      .query("chairVisits")
      .withIndex("by_client_and_day", (q) => q.eq("clientId", client._id))
      .order("desc")
      .take(8);
    const prior = visits.find(
      (visit) =>
        visit.dayKey < today &&
        Boolean(visit.chosenTakeId || visit.note || visit.chips?.length || visit.serviceName),
    );
    if (prior) {
      const take = prior.chosenTakeId ? await ctx.db.get(prior.chosenTakeId) : null;
      return {
        when: prior.startedAt,
        cutLabel: take?.cutLabel ?? null,
        cutSlug: take?.cutSlug,
        note: prior.note,
        chips: prior.chips,
        serviceName: prior.serviceName,
        posterUrl: take?.posterStorageId ? await ctx.storage.getUrl(take.posterStorageId) : null,
        angles: await resolveAngleUrls(ctx, take),
      };
    }

    const takes = await ctx.db
      .query("chairTakes")
      .withIndex("by_client_and_created", (q) => q.eq("clientId", client._id))
      .order("desc")
      .take(TAKE_PAGE_SIZE);
    const startOfToday = Date.parse(`${today}T00:00:00.000Z`);
    const last = takes.find((t) => t.status === "approved" && t.createdAt < startOfToday);
    if (!last) return null;
    return {
      when: last.approvedAt ?? last.createdAt,
      cutLabel: last.cutLabel,
      cutSlug: last.cutSlug,
      posterUrl: last.posterStorageId ? await ctx.storage.getUrl(last.posterStorageId) : null,
      angles: await resolveAngleUrls(ctx, last),
    };
  },
});

export interface ChairVisitView {
  id: Id<"chairVisits">;
  dayKey: string;
  startedAt: number;
  note?: string;
  chips?: string[];
  serviceName?: string;
  chosenTake: {
    id: Id<"chairTakes">;
    cutLabel: string;
    cutSlug?: string;
    posterUrl: string | null;
    angles: { key: string; url: string | null }[];
  } | null;
}

const VISIT_PAGE_SIZE = 30;

/**
 * One client's visit history, newest first — the profile page's reference
 * strip. Media is resolved to signed URLs here for the same one-round-trip
 * reason as listTakes.
 */
export const listVisits = query({
  args: { clientId: v.id("chairClients") },
  handler: async (ctx, args): Promise<ChairVisitView[] | null> => {
    const page = await getCallerPage(ctx);
    if (!page) return null;
    const client = await ctx.db.get(args.clientId);
    if (!client || client.pageId !== page._id) return null;

    const visits = await ctx.db
      .query("chairVisits")
      .withIndex("by_client_and_day", (q) => q.eq("clientId", client._id))
      .order("desc")
      .take(VISIT_PAGE_SIZE);

    return await Promise.all(
      visits.map(async (visit) => {
        const take = visit.chosenTakeId ? await ctx.db.get(visit.chosenTakeId) : null;
        return {
          id: visit._id,
          dayKey: visit.dayKey,
          startedAt: visit.startedAt,
          note: visit.note,
          chips: visit.chips,
          serviceName: visit.serviceName,
          chosenTake: take
            ? {
                id: take._id,
                cutLabel: take.cutLabel,
                cutSlug: take.cutSlug,
                posterUrl: take.posterStorageId
                  ? await ctx.storage.getUrl(take.posterStorageId)
                  : null,
                angles: await resolveAngleUrls(ctx, take),
              }
            : null,
        };
      }),
    );
  },
});

export interface CutCount {
  cutSlug?: string;
  cutLabel: string;
  count: number;
}

export interface ChairWeekSummary {
  visitsThisWeek: number;
  clientsThisWeek: number;
  returningThisWeek: number;
  takesThisWeek: number;
  approvedThisWeek: number;
  /** Every cut that hit the mirror this week vs the ones that got chosen —
   * the gap between the two is what no booking app can see. */
  topTried: CutCount[];
  topChosen: CutCount[];
}

const WEEK_SCAN_LIMIT = 400;

function tally(rows: { cutSlug?: string; cutLabel: string }[]): CutCount[] {
  const byKey = new Map<string, CutCount>();
  for (const row of rows) {
    const key = row.cutSlug ?? row.cutLabel.toLowerCase();
    const entry = byKey.get(key);
    if (entry) entry.count += 1;
    else byKey.set(key, { cutSlug: row.cutSlug, cutLabel: row.cutLabel, count: 1 });
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count).slice(0, 5);
}

/**
 * The chair's last seven days, aggregated for the Insights tab. Bounded scans
 * (WEEK_SCAN_LIMIT) — a shop doing more takes than that in a week has
 * outgrown a single-query summary and this simply reports the cap.
 */
export const weekSummary = query({
  args: {},
  handler: async (ctx): Promise<ChairWeekSummary | null> => {
    const page = await getCallerPage(ctx);
    if (!page) return null;

    const now = Date.now();
    const weekAgoMs = now - 7 * 24 * 60 * 60 * 1000;
    const weekAgoDay = dayBucket(weekAgoMs);

    const visits = await ctx.db
      .query("chairVisits")
      .withIndex("by_page_and_day", (q) => q.eq("pageId", page._id).gte("dayKey", weekAgoDay))
      .take(WEEK_SCAN_LIMIT);

    // Returning = the client already existed before this week started.
    const clientIds = [...new Set(visits.map((visit) => visit.clientId))];
    let returning = 0;
    for (const clientId of clientIds) {
      const client = await ctx.db.get(clientId);
      if (client && client.createdAt < weekAgoMs) returning += 1;
    }

    const takes = await ctx.db
      .query("chairTakes")
      .withIndex("by_page_and_created", (q) => q.eq("pageId", page._id).gte("createdAt", weekAgoMs))
      .take(WEEK_SCAN_LIMIT);

    return {
      visitsThisWeek: visits.length,
      clientsThisWeek: clientIds.length,
      returningThisWeek: returning,
      takesThisWeek: takes.length,
      approvedThisWeek: takes.filter((t) => t.status === "approved").length,
      topTried: tally(takes),
      topChosen: tally(takes.filter((t) => t.status === "approved")),
    };
  },
});

export interface ChairDayPoint {
  dayKey: string;
  visits: number;
  takes: number;
  approved: number;
}

const SERIES_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The chair's last fourteen days as a daily series — the Insights activity
 * chart. Zero-filled so quiet days render as gaps in the data, not gaps in
 * the axis.
 */
export const dailySeries = query({
  args: {},
  handler: async (ctx): Promise<ChairDayPoint[] | null> => {
    const page = await getCallerPage(ctx);
    if (!page) return null;

    const now = Date.now();
    const fromMs = now - (SERIES_DAYS - 1) * DAY_MS;
    const points: ChairDayPoint[] = [];
    const byDay = new Map<string, ChairDayPoint>();
    for (let i = 0; i < SERIES_DAYS; i++) {
      const point = { dayKey: dayBucket(fromMs + i * DAY_MS), visits: 0, takes: 0, approved: 0 };
      points.push(point);
      byDay.set(point.dayKey, point);
    }

    const visits = await ctx.db
      .query("chairVisits")
      .withIndex("by_page_and_day", (q) =>
        q.eq("pageId", page._id).gte("dayKey", points[0].dayKey),
      )
      .take(WEEK_SCAN_LIMIT);
    for (const visit of visits) {
      const point = byDay.get(visit.dayKey);
      if (point) point.visits += 1;
    }

    const takes = await ctx.db
      .query("chairTakes")
      .withIndex("by_page_and_created", (q) => q.eq("pageId", page._id).gte("createdAt", fromMs))
      .take(WEEK_SCAN_LIMIT);
    for (const take of takes) {
      const point = byDay.get(dayBucket(take.createdAt));
      if (!point) continue;
      point.takes += 1;
      if (take.status === "approved") point.approved += 1;
    }

    return points;
  },
});

const PULSE_DAYS = 28;
const PULSE_SCAN_LIMIT = 600;

/**
 * Raw visit start times for the last four weeks plus today — the Today tab's
 * "how's the day going" line chart.
 *
 * Deliberately NOT bucketed here. `dayKey` is a UTC bucket (see dayBucket), but
 * "which hour of the shop's day was this" is only meaningful in the barber's
 * own timezone, and the browser is the only place that knows it. So the server
 * ships timestamps and the client splits today from the prior days and buckets
 * both by local hour.
 */
export const visitPulse = query({
  args: {},
  handler: async (ctx): Promise<number[] | null> => {
    const page = await getCallerPage(ctx);
    if (!page) return null;

    // One extra day back: a barber whose evening is the next UTC day still gets
    // their whole local today inside the window.
    const fromDay = dayBucket(Date.now() - (PULSE_DAYS + 1) * DAY_MS);
    const visits = await ctx.db
      .query("chairVisits")
      .withIndex("by_page_and_day", (q) => q.eq("pageId", page._id).gte("dayKey", fromDay))
      .take(PULSE_SCAN_LIMIT);

    return visits.map((visit) => visit.startedAt);
  },
});

// ── takes ───────────────────────────────────────────────────────────────────

// Takes are metered at 10 per 2 minutes per subject (the barber's page on the
// chair door, the visitor on the card door). Loose on purpose — a walk-in
// demo retries back-to-back and should never read a refusal — so this exists
// to stop scripts, not people. The token route enforces the same pace durably
// per signed-in user BEFORE these mutations run, so this is the backstop that
// holds when someone calls the mutation directly — the two must agree with
// RATE_LIMITS.lucyTokenUser in src/lib/rateLimit.ts.
const TAKE_RATE_LIMIT = 10;
const TAKE_RATE_WINDOW_MS = 2 * 60_000;
const TAKE_RATE_MESSAGE =
  "That’s a lot of takes at once — give the mirror a minute, then go again.";

export type StartTakeResult =
  | { ok: true; takeId: Id<"chairTakes">; maxSeconds: number; takesLeftToday: number }
  | { ok: false; reason: "daily_cap" | "global_budget"; takesLeftToday: number };

interface TakeRequest {
  cutLabel: string;
  cutSlug?: string;
  prompt: string;
}

/**
 * Debit the meter and open a take row.
 *
 * Shared by both doors into the live model — the barber's tablet (`startTake`)
 * and a client's own phone on the public card (`startCardTake`) — because they
 * spend the SAME money out of the SAME barber's day. Two counters would mean a
 * barber whose card went semi-viral could blow through the daily cap twice over
 * without either path noticing.
 *
 * Authorization is the caller's job, not this function's: by the time we get
 * here the client row is already known to belong to `page`, and consent is
 * already on file.
 */
async function claimTake(
  ctx: MutationCtx,
  page: Doc<"barberPages">,
  client: Doc<"chairClients">,
  args: TakeRequest,
): Promise<StartTakeResult> {
  const now = Date.now();
  const cap = dailyTakeCap();
  const usage = await readDailyUsage(ctx, page._id, now);
  const usedToday = usage?.takes ?? 0;
  const takesLeftToday = Math.max(0, cap - usedToday);

  if (usedToday >= cap) {
    return { ok: false, reason: "daily_cap", takesLeftToday: 0 };
  }

  const budget = globalBudgetSeconds();
  if (budget > 0) {
    const spent = await readGlobalSeconds(ctx, now);
    if (spent + TAKE_CLAIM_SECONDS > budget) {
      return { ok: false, reason: "global_budget", takesLeftToday };
    }
  }

  // Debit the full ceiling up front; finishTake refunds the remainder.
  if (usage) {
    await ctx.db.patch(usage._id, {
      takes: usage.takes + 1,
      seconds: usage.seconds + TAKE_CLAIM_SECONDS,
    });
  } else {
    await ctx.db.insert("chairUsage", {
      pageId: page._id,
      bucket: dayBucket(now),
      takes: 1,
      seconds: TAKE_CLAIM_SECONDS,
    });
  }
  await addGlobalSeconds(ctx, now, TAKE_CLAIM_SECONDS);

  const takeId = await ctx.db.insert("chairTakes", {
    clientId: client._id,
    pageId: page._id,
    cutLabel: args.cutLabel.trim().slice(0, 120) || "Custom",
    cutSlug: args.cutSlug,
    prompt: args.prompt.slice(0, MAX_PROMPT_LENGTH),
    durationMs: 0,
    status: "recorded",
    createdAt: now,
  });

  await ctx.db.patch(client._id, { lastVisitAt: now });

  return {
    ok: true,
    takeId,
    maxSeconds: MAX_TAKE_SECONDS,
    takesLeftToday: takesLeftToday - 1,
  };
}

/**
 * Claim budget and open a take. Called from /api/fal/realtime-token BEFORE a
 * token is minted — a refusal here means no token exists to spend, which is the
 * only guard that actually holds when the browser is hostile.
 *
 * Returns a result rather than throwing on refusal: "you're out of takes today"
 * is a normal thing for a busy Saturday to say, not an exception.
 */
export const startTake = mutation({
  args: {
    clientId: v.id("chairClients"),
    cutLabel: v.string(),
    cutSlug: v.optional(v.string()),
    prompt: v.string(),
  },
  handler: async (ctx, args): Promise<StartTakeResult> => {
    const page = await requireCallerPage(ctx);
    const client = await requireOwnedClient(ctx, page._id, args.clientId);
    await enforceMutationRateLimit(
      ctx,
      `chair:take:${page._id}`,
      TAKE_RATE_LIMIT,
      TAKE_RATE_WINDOW_MS,
      TAKE_RATE_MESSAGE,
    );

    if (!client.consentAt) {
      throw new ConvexError("This client hasn’t agreed to be filmed yet.");
    }

    return await claimTake(ctx, page, client, args);
  },
});

/**
 * The take ended: attach the recording and refund the seconds it didn't use.
 * A zero duration is an honest report too — the session died before the first
 * frame (the relay closing mid-handshake, most often), so the whole claim
 * comes back and the take is discarded rather than left looking recorded.
 * Safe to call twice — the refund only ever applies to a take that hasn't
 * reported yet (durationMs still 0 and status still "recorded"; a zero report
 * flips the status, a real one flips the duration), so a retried network call
 * can't credit the barber twice.
 */
export const finishTake = mutation({
  args: {
    takeId: v.id("chairTakes"),
    durationMs: v.number(),
    videoStorageId: v.optional(v.id("_storage")),
    posterStorageId: v.optional(v.id("_storage")),
    // The instruction the model ended on (re-steers replace the opening
    // `prompt` without a reconnect) and when the last re-steer landed, ms into
    // the recording. See the schema note on chairTakes.
    finalPrompt: v.optional(v.string()),
    lastPromptTMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<null> => {
    // Either end of the wire may report a take finished — the barber's tablet
    // or the card visitor's own phone. See requireTakeAccess().
    const take = await requireTakeAccess(ctx, args.takeId);

    const durationMs = Math.max(
      0,
      Math.min(MAX_TAKE_SECONDS * 1000, Math.round(args.durationMs) || 0),
    );

    const firstReport = take.durationMs === 0 && take.status === "recorded";
    if (firstReport) {
      const usedSeconds = Math.ceil(durationMs / 1000);
      const refund = Math.max(0, TAKE_CLAIM_SECONDS - usedSeconds);
      if (refund > 0) {
        // Refund against the bucket the take was CHARGED to, not the one it
        // happened to finish in. A take started at 23:59:50 UTC otherwise
        // credits tomorrow's row (or none at all) while yesterday's stays
        // charged for the full ceiling.
        const now = take.createdAt;
        const usage = await readDailyUsage(ctx, take.pageId, now);
        if (usage) {
          await ctx.db.patch(usage._id, { seconds: Math.max(0, usage.seconds - refund) });
        }
        await addGlobalSeconds(ctx, now, -refund);
      }
    }

    await ctx.db.patch(take._id, {
      durationMs,
      ...(firstReport && durationMs === 0 ? { status: "discarded" as const } : {}),
      ...(args.videoStorageId ? { videoStorageId: args.videoStorageId } : {}),
      ...(args.posterStorageId ? { posterStorageId: args.posterStorageId } : {}),
      ...(args.finalPrompt ? { finalPrompt: args.finalPrompt.slice(0, MAX_PROMPT_LENGTH) } : {}),
      ...(args.lastPromptTMs !== undefined
        ? { lastPromptTMs: Math.max(0, Math.round(args.lastPromptTMs) || 0) }
        : {}),
    });
    return null;
  },
});

/**
 * File the debug snapshots — the low-res stills of what the camera saw over
 * the course of the take — against their take. The client uploads them in one
 * batch after the take settles, so this is normally called once; a retried
 * call merges rather than duplicates (dedupe by storage id), and anything past
 * the MAX_TAKE_SNAPSHOTS cap is deleted rather than left orphaned in storage.
 *
 * Best-effort by design (the client fires and forgets it): it shares
 * requireTakeAccess with finishTake because the same two hands ever hold a
 * take — the barber's tablet or the card visitor's own phone.
 */
export const attachTakeSnapshots = mutation({
  args: {
    takeId: v.id("chairTakes"),
    snapshots: v.array(v.object({ tMs: v.number(), storageId: v.id("_storage") })),
  },
  handler: async (ctx, args): Promise<null> => {
    const take = await requireTakeAccess(ctx, args.takeId);

    const seen = new Set((take.snapshots ?? []).map((s) => s.storageId));
    const merged = [...(take.snapshots ?? [])];
    for (const s of args.snapshots) {
      if (seen.has(s.storageId)) continue;
      seen.add(s.storageId);
      merged.push(s);
    }
    merged.sort((a, b) => a.tMs - b.tMs);

    const kept = merged.slice(0, MAX_TAKE_SNAPSHOTS);
    const keptIds = new Set(kept.map((s) => s.storageId));
    for (const s of merged.slice(MAX_TAKE_SNAPSHOTS)) {
      if (!keptIds.has(s.storageId)) await ctx.storage.delete(s.storageId).catch(() => {});
    }

    await ctx.db.patch(take._id, { snapshots: kept });
    return null;
  },
});

const angleValidator = v.object({
  key: v.string(),
  yawDeg: v.number(),
  tMs: v.number(),
  storageId: v.id("_storage"),
  confidence: v.number(),
});

/**
 * "Yes, that's the one." Pins the take and files the reference sheet extracted
 * from it. Angles are re-validated here — the client picked the frames, so the
 * keys are caller input, and an unrecognized key would render as a blank tile
 * in the dashboard forever.
 */
export const approveTake = mutation({
  args: {
    takeId: v.id("chairTakes"),
    angles: v.array(angleValidator),
  },
  handler: async (ctx, args): Promise<null> => {
    const page = await requireCallerPage(ctx);
    const take = await requireOwnedTake(ctx, page._id, args.takeId);

    const seen = new Set<string>();
    const angles: Doc<"chairTakes">["angles"] = [];
    for (const a of args.angles) {
      if (!isAngleKey(a.key) || seen.has(a.key)) continue;
      seen.add(a.key);
      angles.push({
        key: a.key,
        yawDeg: Number.isFinite(a.yawDeg) ? a.yawDeg : 0,
        tMs: Math.max(0, Math.round(a.tMs) || 0),
        storageId: a.storageId,
        confidence: Math.min(1, Math.max(0, Number.isFinite(a.confidence) ? a.confidence : 0)),
      });
      if (angles.length >= ANGLE_KEYS.length) break;
    }

    await ctx.db.patch(take._id, {
      status: "approved",
      approvedAt: Date.now(),
      angles,
    });
    await ctx.db.patch(take.clientId, { lastVisitAt: Date.now() });
    // The approved take IS today's decision until the barber says otherwise —
    // approving a later take the same day simply re-pins the reference.
    await upsertTodayVisit(ctx, page._id, take.clientId, { chosenTakeId: take._id });
    // The shop's reference-sheet email rides on approval: best-effort and
    // async, so a Resend outage can never make "That's the one" fail.
    if (angles.length > 0 && page.contactEmail && !take.referenceEmailedAt) {
      await ctx.scheduler.runAfter(0, internal.chair.sendReferenceEmail, { takeId: take._id });
    }
    return null;
  },
});

// ── the reference-sheet email ───────────────────────────────────────────────
// Everything the email needs, read in one query so the action holds no db
// handle. Null means "nothing to send" — already emailed, no destination, or
// the angles vanished — and the action treats it as a clean no-op.
export const referenceEmailContext = internalQuery({
  args: { takeId: v.id("chairTakes") },
  handler: async (ctx, args) => {
    const take = await ctx.db.get(args.takeId);
    if (!take || take.referenceEmailedAt || !take.angles?.length) return null;
    const page = await ctx.db.get(take.pageId);
    if (!page?.contactEmail) return null;
    const client = await ctx.db.get(take.clientId);

    const shots: { key: string; url: string }[] = [];
    for (const angle of take.angles) {
      const url = await ctx.storage.getUrl(angle.storageId);
      if (url) shots.push({ key: angle.key, url });
    }
    if (shots.length === 0) return null;

    const videoUrl = take.videoStorageId
      ? (await ctx.storage.getUrl(take.videoStorageId)) ?? undefined
      : undefined;

    return {
      to: page.contactEmail,
      displayName: page.displayName,
      clientName: client?.name ?? "A client",
      cutLabel: take.cutLabel,
      finalPrompt: take.finalPrompt ?? take.prompt,
      shots,
      videoUrl,
    };
  },
});

export const markReferenceEmailed = internalMutation({
  args: { takeId: v.id("chairTakes") },
  handler: async (ctx, args): Promise<null> => {
    await ctx.db.patch(args.takeId, { referenceEmailedAt: Date.now() });
    return null;
  },
});

/**
 * Mail the approved reference shots to the shop's export address. Scheduled
 * from approveTake; a missing RESEND_API_KEY or a Resend failure just logs —
 * the shots are already filed on the take either way.
 */
export const sendReferenceEmail = internalAction({
  args: { takeId: v.id("chairTakes") },
  handler: async (ctx, args): Promise<null> => {
    const context = await ctx.runQuery(internal.chair.referenceEmailContext, {
      takeId: args.takeId,
    });
    if (!context) return null;

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn("[chair] No RESEND_API_KEY set — reference email skipped");
      return null;
    }

    const { subject, html } = buildReferenceEmail(context);
    const from = process.env.RESEND_FROM_EMAIL ?? "ShapeUp <notifications@tryshapeup.cc>";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: context.to, subject, html }),
    });
    if (!res.ok) {
      console.error("[chair] Resend reference email failed:", res.status, await res.text().catch(() => ""));
      return null;
    }

    await ctx.runMutation(internal.chair.markReferenceEmailed, { takeId: args.takeId });
    return null;
  },
});

/**
 * A take the client didn't like. Marked, not deleted — "all the videos are
 * remembered" is the point of chair mode, and the near-miss is often what the
 * barber wants to compare the winner against.
 */
export const discardTake = mutation({
  args: { takeId: v.id("chairTakes") },
  handler: async (ctx, args): Promise<null> => {
    // "Try another" is tapped from both surfaces, so both may discard.
    const take = await requireTakeAccess(ctx, args.takeId);
    if (take.status === "approved") return null; // never demote a winner by accident
    await ctx.db.patch(take._id, { status: "discarded" });
    return null;
  },
});

/**
 * "None of these" — the client walked and wants nothing on file. Unlike
 * discardTake this really deletes: the row, the clip, the poster, any frames.
 * A person who declined every cut never agreed to be a record, so the
 * keep-the-near-miss rule doesn't apply — there is no winner to compare
 * against. Approved takes are refused; un-filing a winner goes through the
 * dashboard's delete, not a scrap tap.
 */
export const scrapTake = mutation({
  args: { takeId: v.id("chairTakes") },
  handler: async (ctx, args): Promise<null> => {
    const take = await requireTakeAccess(ctx, args.takeId);
    if (take.status === "approved") return null;
    const stored: Id<"_storage">[] = [
      ...(take.videoStorageId ? [take.videoStorageId] : []),
      ...(take.posterStorageId ? [take.posterStorageId] : []),
      ...(take.angles ?? []).map((a) => a.storageId),
    ];
    for (const id of stored) {
      // A file that's already gone must not strand the rest of the scrap.
      await ctx.storage.delete(id).catch(() => {});
    }
    await ctx.db.delete(take._id);
    return null;
  },
});

export interface ChairTakeView {
  id: Id<"chairTakes">;
  cutLabel: string;
  cutSlug?: string;
  prompt: string;
  durationMs: number;
  status: "recorded" | "approved" | "discarded";
  videoUrl: string | null;
  posterUrl: string | null;
  angles: { key: string; yawDeg: number; tMs: number; confidence: number; url: string | null }[];
  createdAt: number;
  approvedAt?: number;
}

/**
 * One client's history, newest first, with storage ids already resolved to
 * signed URLs so the dashboard renders in a single round trip.
 */
export const listTakes = query({
  args: { clientId: v.id("chairClients") },
  handler: async (ctx, args): Promise<ChairTakeView[] | null> => {
    const page = await getCallerPage(ctx);
    if (!page) return null;
    const client = await ctx.db.get(args.clientId);
    if (!client || client.pageId !== page._id) return null;

    const takes = await ctx.db
      .query("chairTakes")
      .withIndex("by_client_and_created", (q) => q.eq("clientId", client._id))
      .order("desc")
      .take(TAKE_PAGE_SIZE);

    return await Promise.all(
      takes.map(async (t) => ({
        id: t._id,
        cutLabel: t.cutLabel,
        cutSlug: t.cutSlug,
        prompt: t.prompt,
        durationMs: t.durationMs,
        status: t.status,
        videoUrl: t.videoStorageId ? await ctx.storage.getUrl(t.videoStorageId) : null,
        posterUrl: t.posterStorageId ? await ctx.storage.getUrl(t.posterStorageId) : null,
        angles: await Promise.all(
          (t.angles ?? []).map(async (a) => ({
            key: a.key,
            yawDeg: a.yawDeg,
            tMs: a.tMs,
            confidence: a.confidence,
            url: await ctx.storage.getUrl(a.storageId),
          })),
        ),
        createdAt: t.createdAt,
        approvedAt: t.approvedAt,
      })),
    );
  },
});

/**
 * The debug feed behind /admin/takes: recent takes across EVERY barber, each
 * with the verbatim prompt and the camera stills captured over the take next
 * to the footage it produced. Answers "why did the mirror do THAT" after the
 * fact, which the live TakeDebugPanel can't — its state dies with the session.
 *
 * Admin-only (defense-in-depth alongside the /api/admin-takes allowlist):
 * this crosses the one line the rest of the file never does, reading takes
 * that belong to other barbers' pages.
 */
export const debugTakes = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireConvexAdmin(ctx);
    const limit = Math.min(Math.max(1, Math.round(args.limit ?? 100)), 200);
    const takes = await ctx.db.query("chairTakes").order("desc").take(limit);

    // Slugs resolve through a memo: a busy Saturday is many takes on few pages.
    const slugs = new Map<Id<"barberPages">, string | null>();
    return await Promise.all(
      takes.map(async (t) => {
        if (!slugs.has(t.pageId)) {
          slugs.set(t.pageId, (await ctx.db.get(t.pageId))?.slug ?? null);
        }
        return {
          id: t._id,
          barberSlug: slugs.get(t.pageId) ?? null,
          cutLabel: t.cutLabel,
          prompt: t.prompt,
          status: t.status,
          durationMs: t.durationMs,
          snapshots: await Promise.all(
            (t.snapshots ?? []).map(async (s) => ({
              tMs: s.tMs,
              url: await ctx.storage.getUrl(s.storageId),
            })),
          ),
          videoUrl: t.videoStorageId ? await ctx.storage.getUrl(t.videoStorageId) : null,
          posterUrl: t.posterStorageId ? await ctx.storage.getUrl(t.posterStorageId) : null,
          createdAt: t.createdAt,
        };
      }),
    );
  },
});

/**
 * The caller's own card, light: just what dashboard surfaces need for links
 * (rebook opens /b/<slug>'s scheduler). getMine computes week-over-week
 * insights on every read, which is far too heavy for a link.
 */
export const myCard = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ slug: string; bookingEnabled: boolean; exportEmail: string | null } | null> => {
    const page = await getCallerPage(ctx);
    if (!page) return null;
    return {
      slug: page.slug,
      bookingEnabled: Boolean(page.booking?.enabled),
      exportEmail: page.contactEmail ?? null,
    };
  },
});

// Mirrors convex/barberPages.ts's CONTACT_EMAIL_RE — kept local for the same
// reason stated there: duplicating one regex beats a new shared module.
const EXPORT_EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/;

/**
 * Where the chair's reference-sheet emails go — set once per shop, from the
 * chair itself. Lands on barberPages.contactEmail, the same inbox the card's
 * try-on handoffs already use, so a shop has ONE notification address however
 * it was set.
 */
export const setExportEmail = mutation({
  args: { email: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const page = await requireCallerPage(ctx);
    const email = args.email.trim().toLowerCase().slice(0, 254);
    if (!EXPORT_EMAIL_RE.test(email)) {
      throw new ConvexError("That doesn’t look like an email address.");
    }
    await ctx.db.patch(page._id, { contactEmail: email, updatedAt: Date.now() });
    return null;
  },
});

/** Today's remaining headroom, so the chair can warn before it refuses. */
export const budgetStatus = query({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ takesLeftToday: number; dailyCap: number; globalExhausted: boolean } | null> => {
    const page = await getCallerPage(ctx);
    if (!page) return null;
    const now = Date.now();
    const cap = dailyTakeCap();
    const usage = await readDailyUsage(ctx, page._id, now);
    const budget = globalBudgetSeconds();
    const globalExhausted =
      budget > 0 ? (await readGlobalSeconds(ctx, now)) + TAKE_CLAIM_SECONDS > budget : false;
    return {
      takesLeftToday: Math.max(0, cap - (usage?.takes ?? 0)),
      dailyCap: cap,
      globalExhausted,
    };
  },
});

// ── the card's live mirror ──────────────────────────────────────────────────
//
// Same live model, same meter, different hand holding the phone. On /b/<slug> a
// CLIENT runs a take on themselves, so the barber isn't there to type a name or
// pass the tablet over for consent — the client does both, once, before the
// camera opens.
//
// What that changes, and nothing else:
//
//  * Identity is the visitor's Clerk token, stamped on the chairClients row.
//    That row is otherwise an ordinary walk-in — it lands in the same roster,
//    under the same barber, and a take from the card is indistinguishable from
//    one shot in the chair when the barber opens it later. That's the point:
//    someone who tried a cut at home should already be in the book when they
//    sit down.
//  * The meter is the BARBER's day. A card visitor spends the same daily cap
//    the barber's own chair spends (see claimTake), so a card that gets passed
//    around can slow the barber's own takes but can never invent new spend.
//
// Consent is refused by omission, not by an error: no stamp, no take. The
// startCardTake path checks it again rather than trusting that the UI showed
// the screen.

/**
 * The public card behind a slug, or null. No auth — the page is public.
 *
 * An unpublished card is treated as absent, the same way barberPages.getBySlug
 * treats it: a draft that can't be rendered must not be able to spend its
 * owner's live-take budget either.
 */
async function pageBySlug(ctx: QueryCtx, slug: string): Promise<Doc<"barberPages"> | null> {
  const page = await ctx.db
    .query("barberPages")
    .withIndex("by_slug", (q) => q.eq("slug", slug.trim().toLowerCase()))
    .unique();
  return page?.published ? page : null;
}

async function getVisitorClient(
  ctx: QueryCtx,
  pageId: Id<"barberPages">,
  tokenIdentifier: string,
): Promise<Doc<"chairClients"> | null> {
  return await ctx.db
    .query("chairClients")
    .withIndex("by_page_and_visitor", (q) =>
      q.eq("pageId", pageId).eq("visitorTokenIdentifier", tokenIdentifier),
    )
    .unique();
}

/**
 * A name that won't collide with someone already in this barber's roster.
 *
 * `nameKey` has to stay unique per page or startVisit's `.unique()` lookup
 * starts throwing for the barber — a card visitor called "Mike" must not break
 * the chair for the Mike who has been coming in for years. Two Mikes get
 * "Mike" and "Mike (2)", which is also exactly what the barber needs to see.
 */
async function uniqueClientName(
  ctx: QueryCtx,
  pageId: Id<"barberPages">,
  base: string,
): Promise<{ name: string; nameKey: string }> {
  for (let attempt = 1; attempt <= 9; attempt++) {
    const name = attempt === 1 ? base : `${base} (${attempt})`;
    const check = normalizeClientName(name);
    if (!check.ok) break;
    const taken = await ctx.db
      .query("chairClients")
      .withIndex("by_page_and_name", (q) => q.eq("pageId", pageId).eq("nameKey", check.nameKey))
      .first();
    if (!taken) return { name: check.name, nameKey: check.nameKey };
  }
  // Ten same-named clients on one card is a rounding error, but a collision
  // here would corrupt the barber's roster — so fall back to something that
  // cannot collide rather than giving up.
  const suffix = Math.random().toString(36).slice(2, 6);
  const name = `${base.slice(0, MAX_CLIENT_NAME_LENGTH - 8)} (${suffix})`;
  const check = normalizeClientName(name);
  return check.ok ? { name: check.name, nameKey: check.nameKey } : { name, nameKey: name };
}

export interface CardSession {
  clientId: Id<"chairClients"> | null;
  name: string | null;
  needsConsent: boolean;
  takesLeftToday: number;
}

/**
 * What the card's try-on needs before it can open the camera: whether this
 * visitor has already agreed to be filmed by this barber, and whether the
 * barber's day has any takes left in it.
 *
 * Null for a signed-out visitor or an unknown slug — the panel shows sign-in
 * either way, so the two don't need telling apart.
 */
export const cardSession = query({
  args: { slug: v.string() },
  handler: async (ctx, args): Promise<CardSession | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const page = await pageBySlug(ctx, args.slug);
    if (!page) return null;

    const client = await getVisitorClient(ctx, page._id, identity.tokenIdentifier);
    const now = Date.now();
    const usage = await readDailyUsage(ctx, page._id, now);
    const budget = globalBudgetSeconds();
    const globalExhausted =
      budget > 0 ? (await readGlobalSeconds(ctx, now)) + TAKE_CLAIM_SECONDS > budget : false;

    return {
      clientId: client?._id ?? null,
      name: client?.name ?? null,
      needsConsent: !client?.consentAt,
      takesLeftToday: globalExhausted ? 0 : Math.max(0, dailyTakeCap() - (usage?.takes ?? 0)),
    };
  },
});

/**
 * The client's one tap before the camera: their name, and their agreement to
 * being filmed. Creates (or re-finds) their row in the barber's roster.
 *
 * Idempotent — a visitor who reloads the card mid-flow lands back on the same
 * row with the same consent stamp rather than accumulating a duplicate.
 */
export const joinCard = mutation({
  args: { slug: v.string(), name: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ clientId: Id<"chairClients">; name: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in first.");
    const page = await pageBySlug(ctx, args.slug);
    if (!page) throw new ConvexError("That barber card doesn’t exist.");

    await enforceMutationRateLimit(ctx, `card:join:${identity.tokenIdentifier}`, 20, 60_000);

    const check = normalizeClientName(args.name);
    if (!check.ok) {
      throw new ConvexError(
        check.reason === "empty"
          ? "Give your barber a name to file this under."
          : `Keep the name under ${MAX_CLIENT_NAME_LENGTH} characters.`,
      );
    }

    const now = Date.now();
    const existing = await getVisitorClient(ctx, page._id, identity.tokenIdentifier);
    if (existing) {
      await ctx.db.patch(existing._id, {
        lastVisitAt: now,
        ...(existing.consentAt
          ? {}
          : { consentAt: now, consentVersion: CARD_CONSENT_VERSION }),
      });
      return { clientId: existing._id, name: existing.name };
    }

    const { name, nameKey } = await uniqueClientName(ctx, page._id, check.name);
    const clientId = await ctx.db.insert("chairClients", {
      pageId: page._id,
      name,
      nameKey,
      visitorTokenIdentifier: identity.tokenIdentifier,
      consentAt: now,
      consentVersion: CARD_CONSENT_VERSION,
      createdAt: now,
      lastVisitAt: now,
    });
    return { clientId, name };
  },
});

/**
 * The card's equivalent of `startTake`: claim the barber's budget and open a
 * take for a client filming themselves. Called from /api/fal/realtime-token
 * before a token exists, for the same reason.
 */
export const startCardTake = mutation({
  args: {
    slug: v.string(),
    cutLabel: v.string(),
    cutSlug: v.optional(v.string()),
    prompt: v.string(),
  },
  handler: async (ctx, args): Promise<StartTakeResult> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Sign in first.");
    const page = await pageBySlug(ctx, args.slug);
    if (!page) throw new ConvexError("That barber card doesn’t exist.");

    // Keyed per visitor rather than per page, so one eager client slows only
    // themselves and never the barber's own chair.
    await enforceMutationRateLimit(
      ctx,
      `card:take:${identity.tokenIdentifier}`,
      TAKE_RATE_LIMIT,
      TAKE_RATE_WINDOW_MS,
      TAKE_RATE_MESSAGE,
    );

    const client = await getVisitorClient(ctx, page._id, identity.tokenIdentifier);
    if (!client?.consentAt) {
      throw new ConvexError("Agree to be filmed before starting a take.");
    }

    return await claimTake(ctx, page, client, args);
  },
});

export interface SharedTake {
  videoUrl: string | null;
  posterUrl: string | null;
}

/**
 * "Send it to my barber." Pins the take the client liked and files what they
 * asked for alongside it.
 *
 * The take is ALREADY in the barber's roster by this point — it was created
 * under their page the moment the camera opened. So this doesn't move anything;
 * it marks which of the visitor's takes is the one they actually want cut, and
 * hands back durable URLs so the caller can put them in the barber's inbox
 * (see barberTryOn.sendToBarber).
 */
export const shareTake = mutation({
  args: {
    takeId: v.id("chairTakes"),
    posterStorageId: v.optional(v.id("_storage")),
    note: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<SharedTake> => {
    const take = await requireTakeAccess(ctx, args.takeId);

    await ctx.db.patch(take._id, {
      status: "approved",
      approvedAt: Date.now(),
      ...(args.posterStorageId ? { posterStorageId: args.posterStorageId } : {}),
    });

    const note = args.note?.trim().slice(0, MAX_CLIENT_NOTE_LENGTH);
    const phone = args.phone?.trim().slice(0, 40);
    if (note || phone) {
      await ctx.db.patch(take.clientId, {
        ...(note ? { notes: note } : {}),
        ...(phone ? { phone } : {}),
      });
    }

    const posterStorageId = args.posterStorageId ?? take.posterStorageId;
    return {
      videoUrl: take.videoStorageId ? await ctx.storage.getUrl(take.videoStorageId) : null,
      posterUrl: posterStorageId ? await ctx.storage.getUrl(posterStorageId) : null,
    };
  },
});

/**
 * Erase a walk-in: their takes, every stored frame and clip, then the row
 * itself. This is the other half of the consent stamp — a client who asks to be
 * forgotten has to actually be forgettable, and the barber must be able to do
 * it from the chair without filing a ticket.
 *
 * Bounded by TAKE_PAGE_SIZE per call and re-entrant: the caller repeats until
 * `done`, keeping each transaction well inside Convex's write limits.
 */
export const deleteClient = mutation({
  args: { clientId: v.id("chairClients") },
  handler: async (ctx, args): Promise<{ done: boolean }> => {
    const page = await requireCallerPage(ctx);
    const client = await requireOwnedClient(ctx, page._id, args.clientId);

    const takes = await ctx.db
      .query("chairTakes")
      .withIndex("by_client_and_created", (q) => q.eq("clientId", client._id))
      .take(TAKE_PAGE_SIZE);

    for (const take of takes) {
      const stored: Id<"_storage">[] = [
        ...(take.videoStorageId ? [take.videoStorageId] : []),
        ...(take.posterStorageId ? [take.posterStorageId] : []),
        ...(take.angles ?? []).map((a) => a.storageId),
      ];
      for (const id of stored) {
        // A file that's already gone must not strand the rest of the erase.
        await ctx.storage.delete(id).catch(() => {});
      }
      await ctx.db.delete(take._id);
    }

    if (takes.length === TAKE_PAGE_SIZE) return { done: false };

    // Visit records go with the takes — a forgotten client keeps no history
    // anywhere, notes and chosen references included.
    const visits = await ctx.db
      .query("chairVisits")
      .withIndex("by_client_and_day", (q) => q.eq("clientId", client._id))
      .take(TAKE_PAGE_SIZE);
    for (const visit of visits) {
      await ctx.db.delete(visit._id);
    }
    if (visits.length === TAKE_PAGE_SIZE) return { done: false };

    await ctx.db.delete(client._id);
    return { done: true };
  },
});

// ── demo seed (internal — CLI only) ─────────────────────────────────────────
//
// Fills a barber's book with plausible walk-ins, visit history, takes (no
// media), and a week of bookings so the dashboard can be evaluated with real
// shapes in it. Internal on purpose: it can only be run by the deployment
// owner via `npx convex run chair:seedDemo '{"slug":"<your-slug>"}'`, never
// from a browser. Idempotent — a second run is refused rather than doubling
// the roster.

const DEMO_CLIENTS: {
  name: string;
  phone?: string;
  notes?: string;
  weeksAround: number; // roughly how long they've been coming, in weeks
  cut: { label: string; slug: string };
  chips?: string[];
  visitNote?: string;
  service?: string;
}[] = [
  { name: "Marcus Reed", phone: "(510) 555-0114", notes: "Prefers scissors over clippers.", weeksAround: 20, cut: { label: "blowout taper", slug: "blowout-taper" }, chips: ["#2", "Taper"], visitNote: "Went 0.5 lower on the sides than usual.", service: "Basic Cut" },
  { name: "Dre Holloway", phone: "(510) 555-0132", weeksAround: 16, cut: { label: "textured crop, skin fade", slug: "textured-crop-skin-fade" }, chips: ["#1", "Skin fade", "Line up"], service: "Basic Cut" },
  { name: "Jaylen Brooks", phone: "(415) 555-0187", notes: "Sensitive around the ears.", weeksAround: 12, cut: { label: "low taper fade, textured fringe", slug: "low-taper-fade-textured-fringe" }, chips: ["#2", "Taper"], visitNote: "Left the fringe alone — he's growing it.", service: "Basic Cut" },
  { name: "Sofia Marin", phone: "(510) 555-0141", weeksAround: 10, cut: { label: "italian bob, blunt ends", slug: "italian-bob-blunt-ends" }, chips: ["Scissors"], visitNote: "Kept it at jaw length.", service: "Neck clean-up" },
  { name: "Tommy Nguyen", weeksAround: 9, cut: { label: "edgar cut, high fade", slug: "edgar-cut-high-fade" }, chips: ["#0", "Line up"], service: "Basic Cut" },
  { name: "Isaiah Carter", phone: "(510) 555-0163", weeksAround: 8, cut: { label: "modern mullet, faded sides", slug: "modern-mullet-faded-sides" }, chips: ["#1", "Beard trim"], visitNote: "Beard shaped square, not rounded.", service: "Basic Cut" },
  { name: "Luis Alvarez", phone: "(408) 555-0122", weeksAround: 7, cut: { label: "blowout taper", slug: "blowout-taper" }, chips: ["#2"], service: "Basic Cut" },
  { name: "Kevin O'Neal", weeksAround: 6, notes: "Always running late — book him last.", cut: { label: "wolf cut, light layers", slug: "wolf-cut-light-layers" }, chips: ["Scissors"], service: "Basic Cut" },
  { name: "Darnell Price", phone: "(510) 555-0177", weeksAround: 5, cut: { label: "textured crop, skin fade", slug: "textured-crop-skin-fade" }, chips: ["#1", "Skin fade"], visitNote: "Tighter on the crown this time.", service: "Basic Cut" },
  { name: "Andre Silva", phone: "(650) 555-0155", weeksAround: 4, cut: { label: "low taper fade, textured fringe", slug: "low-taper-fade-textured-fringe" }, chips: ["#2", "Line up"], service: "Basic Cut" },
  { name: "Mia Chen", weeksAround: 3, cut: { label: "butterfly blowout, curtain bangs", slug: "butterfly-blowout-curtain-bangs" }, chips: ["Scissors"], visitNote: "Face-framing layers only — no length off the back.", service: "Neck clean-up" },
  { name: "Jordan Blake", phone: "(510) 555-0190", weeksAround: 2, cut: { label: "edgar cut, high fade", slug: "edgar-cut-high-fade" }, chips: ["#0"], service: "Basic Cut" },
  { name: "Sam Whitfield", weeksAround: 1, cut: { label: "blowout taper", slug: "blowout-taper" }, service: "Basic Cut" },
  { name: "Victor Osei", phone: "(510) 555-0106", weeksAround: 1, cut: { label: "modern mullet, faded sides", slug: "modern-mullet-faded-sides" }, chips: ["#1"], service: "Basic Cut" },
];

export const seedDemo = internalMutation({
  args: { slug: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ seeded: boolean; clients: number; visits: number; takes: number; bookings: number }> => {
    const page = await ctx.db
      .query("barberPages")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug.trim().toLowerCase()))
      .unique();
    if (!page) throw new Error(`No barber page with slug "${args.slug}"`);

    // Refuse a double-seed: the first demo client already being in the book
    // means this ran before.
    const probe = normalizeClientName(DEMO_CLIENTS[0].name);
    if (probe.ok) {
      const existing = await ctx.db
        .query("chairClients")
        .withIndex("by_page_and_name", (q) => q.eq("pageId", page._id).eq("nameKey", probe.nameKey))
        .unique();
      if (existing) return { seeded: false, clients: 0, visits: 0, takes: 0, bookings: 0 };
    }

    const now = Date.now();
    let visitCount = 0;
    let takeCount = 0;

    for (const demo of DEMO_CLIENTS) {
      const check = normalizeClientName(demo.name);
      if (!check.ok) continue;

      // Their visit days: every ~3 weeks back through their history, plus a
      // spread of recent days so the 14-day chart has something to say.
      const visitDays: number[] = [];
      for (let ago = demo.weeksAround * 7; ago > 0; ago -= 18 + (demo.name.length % 7)) {
        visitDays.push(ago);
      }
      if (!visitDays.includes(0) && demo.weeksAround % 3 === 0) visitDays.push(demo.weeksAround % 12);
      visitDays.sort((a, b) => b - a);
      const firstVisitMs = now - (visitDays[0] ?? 0) * DAY_MS;
      const lastVisitMs = now - (visitDays[visitDays.length - 1] ?? 0) * DAY_MS;

      const clientId = await ctx.db.insert("chairClients", {
        pageId: page._id,
        name: check.name,
        nameKey: check.nameKey,
        phone: demo.phone,
        notes: demo.notes,
        consentAt: firstVisitMs,
        consentVersion: CHAIR_CONSENT_VERSION,
        createdAt: firstVisitMs,
        lastVisitAt: lastVisitMs,
      });

      for (const [i, ago] of visitDays.entries()) {
        const startedAt = now - ago * DAY_MS - ((demo.name.length * 37) % 6) * 60 * 60 * 1000;
        const isLatest = i === visitDays.length - 1;

        // A take row (no media — the demo has no footage to store): one
        // approved "chosen" take per visit, and sometimes a near-miss first.
        let chosenTakeId: Id<"chairTakes"> | undefined;
        if (ago <= 45) {
          if ((i + demo.name.length) % 2 === 0) {
            await ctx.db.insert("chairTakes", {
              clientId,
              pageId: page._id,
              cutLabel: demo.cut.label,
              cutSlug: demo.cut.slug,
              prompt: `demo: ${demo.cut.label}`,
              durationMs: 22_000,
              status: "discarded",
              createdAt: startedAt - 4 * 60 * 1000,
            });
            takeCount += 1;
          }
          chosenTakeId = await ctx.db.insert("chairTakes", {
            clientId,
            pageId: page._id,
            cutLabel: demo.cut.label,
            cutSlug: demo.cut.slug,
            prompt: `demo: ${demo.cut.label}`,
            durationMs: 28_000,
            status: "approved",
            createdAt: startedAt,
            approvedAt: startedAt + 60 * 1000,
          });
          takeCount += 1;
        }

        await ctx.db.insert("chairVisits", {
          clientId,
          pageId: page._id,
          dayKey: dayBucket(startedAt),
          startedAt,
          updatedAt: startedAt,
          chosenTakeId,
          chips: demo.chips,
          note: isLatest ? demo.visitNote : undefined,
          serviceName: demo.service,
        });
        visitCount += 1;
      }
    }

    // A working week of bookings so the calendar has real blocks in it.
    let bookingCount = 0;
    const slots: { dayOffset: number; hour: number; minute: number; who: number }[] = [
      { dayOffset: 0, hour: 10, minute: 0, who: 0 },
      { dayOffset: 0, hour: 14, minute: 30, who: 3 },
      { dayOffset: 1, hour: 9, minute: 30, who: 1 },
      { dayOffset: 1, hour: 11, minute: 0, who: 5 },
      { dayOffset: 1, hour: 16, minute: 0, who: 8 },
      { dayOffset: 2, hour: 13, minute: 0, who: 2 },
      { dayOffset: 3, hour: 10, minute: 30, who: 6 },
      { dayOffset: 3, hour: 15, minute: 0, who: 9 },
      { dayOffset: 4, hour: 9, minute: 0, who: 4 },
      { dayOffset: 4, hour: 17, minute: 0, who: 11 },
      { dayOffset: 5, hour: 12, minute: 30, who: 10 },
    ];
    const slotMs = (page.booking?.slotMinutes ?? 30) * 60 * 1000;
    for (const slot of slots) {
      const demo = DEMO_CLIENTS[slot.who % DEMO_CLIENTS.length];
      const start = new Date(now + slot.dayOffset * DAY_MS);
      start.setHours(slot.hour, slot.minute, 0, 0);
      if (start.getTime() < now) continue; // today's already-past slots
      await ctx.db.insert("barberBookings", {
        pageId: page._id,
        startMs: start.getTime(),
        endMs: start.getTime() + slotMs,
        clientUserId: page.ownerUserId,
        clientName: demo.name,
        clientPhone: demo.phone,
        service: demo.service,
        status: "booked",
        createdAt: now,
      });
      bookingCount += 1;
    }

    return {
      seeded: true,
      clients: DEMO_CLIENTS.length,
      visits: visitCount,
      takes: takeCount,
      bookings: bookingCount,
    };
  },
});
