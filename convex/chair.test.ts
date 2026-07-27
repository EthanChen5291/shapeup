/// <reference types="vite/client" />
// @vitest-environment edge-runtime

// Chair mode's backend has two jobs that must not fail quietly: keeping one
// barber's walk-ins invisible to every other barber, and refusing to mint a
// take once the money runs out. Both are tested against real behaviour rather
// than by asserting a guard was called.

import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { TAKE_CLAIM_SECONDS } from "./lib/chair";

const modules = import.meta.glob("./**/*.ts");

function identity(t: ReturnType<typeof convexTest>, clerkId: string) {
  return t.withIdentity({
    subject: clerkId,
    tokenIdentifier: `https://clerk.test|${clerkId}`,
    email: `${clerkId}@example.com`,
    nickname: clerkId,
  });
}

async function barber(t: ReturnType<typeof convexTest>, clerkId: string, slug: string) {
  const who = identity(t, clerkId);
  await who.mutation(api.users.getOrCreate, {});
  await who.mutation(api.barberPages.upsert, {
    slug,
    displayName: clerkId,
    links: [],
    styles: [],
    published: true,
  });
  return who;
}

/** A client who has already tapped consent — the precondition for any take. */
async function consentedClient(who: ReturnType<typeof identity>, name: string) {
  const { clientId } = await who.mutation(api.chair.startVisit, { name });
  await who.mutation(api.chair.recordConsent, { clientId });
  return clientId;
}

beforeEach(() => {
  vi.stubEnv("LUCY_DAILY_TAKES_PER_BARBER", "20");
  vi.stubEnv("LUCY_BUDGET_SECONDS", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("access", () => {
  test("a signed-out visitor sees nothing and can start nothing", async () => {
    const t = convexTest(schema, modules);
    expect(await t.query(api.chair.listClients, {})).toBeNull();
    await expect(t.mutation(api.chair.startVisit, { name: "Walk-in" })).rejects.toThrow(/barber/i);
  });

  test("a signed-in account with no barber card is not a barber", async () => {
    const t = convexTest(schema, modules);
    const nobody = identity(t, "nobody");
    await nobody.mutation(api.users.getOrCreate, {});
    expect(await nobody.query(api.chair.listClients, {})).toBeNull();
    await expect(nobody.mutation(api.chair.startVisit, { name: "Walk-in" })).rejects.toThrow(
      /barber/i,
    );
  });
});

describe("clients", () => {
  test("the same person walking back in reuses their row, however it's typed", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");

    const first = await marcus.mutation(api.chair.startVisit, { name: "Marcus  T." });
    const second = await marcus.mutation(api.chair.startVisit, { name: "  marcus t. " });

    expect(second.clientId).toBe(first.clientId);
    expect(await marcus.query(api.chair.listClients, {})).toHaveLength(1);
  });

  test("a new walk-in needs consent; a returning one does not", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");

    const first = await marcus.mutation(api.chair.startVisit, { name: "Dre" });
    expect(first.needsConsent).toBe(true);

    await marcus.mutation(api.chair.recordConsent, { clientId: first.clientId });
    const second = await marcus.mutation(api.chair.startVisit, { name: "Dre" });
    expect(second.needsConsent).toBe(false);
  });

  test("an unnamed client is refused — the whole point is filing under a name", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    await expect(marcus.mutation(api.chair.startVisit, { name: "   " })).rejects.toThrow(/name/i);
  });

  test("one barber's clients are invisible and untouchable to another", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const rival = await barber(t, "rival", "rival");

    const clientId = await consentedClient(marcus, "Dre");

    expect(await rival.query(api.chair.listClients, {})).toEqual([]);
    expect(await rival.query(api.chair.listTakes, { clientId })).toBeNull();
    await expect(rival.mutation(api.chair.recordConsent, { clientId })).rejects.toThrow(/unknown/i);
    await expect(rival.mutation(api.chair.deleteClient, { clientId })).rejects.toThrow(/unknown/i);
  });
});

describe("takes", () => {
  test("a take can't start before the client has agreed to be filmed", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const { clientId } = await marcus.mutation(api.chair.startVisit, { name: "Dre" });

    await expect(
      marcus.mutation(api.chair.startTake, {
        clientId,
        cutLabel: "low taper",
        prompt: "give this person a low taper",
      }),
    ).rejects.toThrow(/filmed/i);
  });

  test("starting a take claims the full ceiling; finishing refunds the rest", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const clientId = await consentedClient(marcus, "Dre");

    const started = await marcus.mutation(api.chair.startTake, {
      clientId,
      cutLabel: "low taper",
      prompt: "give this person a low taper",
    });
    if (!started.ok) throw new Error("expected the take to start");

    const claimed = await t.run(async (ctx) => {
      const row = await ctx.db.query("chairUsage").first();
      return row?.seconds ?? 0;
    });
    expect(claimed).toBe(TAKE_CLAIM_SECONDS);

    // The take actually ran 12 seconds.
    await marcus.mutation(api.chair.finishTake, { takeId: started.takeId, durationMs: 12_000 });

    const settled = await t.run(async (ctx) => {
      const row = await ctx.db.query("chairUsage").first();
      return row?.seconds ?? 0;
    });
    expect(settled).toBe(12);
  });

  test("a repeated finish can't refund the same take twice", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const clientId = await consentedClient(marcus, "Dre");

    const started = await marcus.mutation(api.chair.startTake, {
      clientId,
      cutLabel: "low taper",
      prompt: "p",
    });
    if (!started.ok) throw new Error("expected the take to start");

    await marcus.mutation(api.chair.finishTake, { takeId: started.takeId, durationMs: 10_000 });
    await marcus.mutation(api.chair.finishTake, { takeId: started.takeId, durationMs: 10_000 });

    const seconds = await t.run(async (ctx) => {
      const row = await ctx.db.query("chairUsage").first();
      return row?.seconds ?? 0;
    });
    expect(seconds).toBe(10);
  });

  test("a take that dies before the first frame reports zero, gets the whole claim back, and is discarded", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const clientId = await consentedClient(marcus, "Dre");

    const started = await marcus.mutation(api.chair.startTake, {
      clientId,
      cutLabel: "low taper",
      prompt: "p",
    });
    if (!started.ok) throw new Error("expected the take to start");

    // The relay closed before any frame arrived — the browser reports honestly.
    await marcus.mutation(api.chair.finishTake, { takeId: started.takeId, durationMs: 0 });

    const { seconds, take } = await t.run(async (ctx) => ({
      seconds: (await ctx.db.query("chairUsage").first())?.seconds ?? 0,
      take: await ctx.db.get(started.takeId),
    }));
    expect(seconds).toBe(0);
    expect(take?.status).toBe("discarded");
  });

  test("a repeated zero report can't refund the same dead take twice", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const clientId = await consentedClient(marcus, "Dre");

    const started = await marcus.mutation(api.chair.startTake, {
      clientId,
      cutLabel: "low taper",
      prompt: "p",
    });
    if (!started.ok) throw new Error("expected the take to start");

    // A second take keeps the day's meter above zero, so a double refund of
    // the first would show up as its seconds being eaten too.
    const second = await marcus.mutation(api.chair.startTake, {
      clientId,
      cutLabel: "low taper",
      prompt: "p",
    });
    if (!second.ok) throw new Error("expected the second take to start");

    await marcus.mutation(api.chair.finishTake, { takeId: started.takeId, durationMs: 0 });
    await marcus.mutation(api.chair.finishTake, { takeId: started.takeId, durationMs: 0 });

    const seconds = await t.run(async (ctx) => {
      return (await ctx.db.query("chairUsage").first())?.seconds ?? 0;
    });
    expect(seconds).toBe(TAKE_CLAIM_SECONDS);
  });

  test("the daily cap refuses rather than throwing — a busy Saturday isn't an error", async () => {
    vi.stubEnv("LUCY_DAILY_TAKES_PER_BARBER", "1");
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const clientId = await consentedClient(marcus, "Dre");

    const first = await marcus.mutation(api.chair.startTake, {
      clientId,
      cutLabel: "low taper",
      prompt: "p",
    });
    expect(first.ok).toBe(true);

    const second = await marcus.mutation(api.chair.startTake, {
      clientId,
      cutLabel: "low taper",
      prompt: "p",
    });
    expect(second).toEqual({ ok: false, reason: "daily_cap", takesLeftToday: 0 });
  });

  test("a third take inside two minutes is paced, with copy fit for the screen", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const clientId = await consentedClient(marcus, "Dre");

    const args = { clientId, cutLabel: "low taper", prompt: "p" };
    expect((await marcus.mutation(api.chair.startTake, args)).ok).toBe(true);
    expect((await marcus.mutation(api.chair.startTake, args)).ok).toBe(true);
    // The refusal is a ConvexError so the message survives production
    // redaction — the person in the chair reads this line verbatim.
    await expect(marcus.mutation(api.chair.startTake, args)).rejects.toThrow(
      /give the mirror a minute/i,
    );
  });

  test("the global monthly ceiling refuses once one more take wouldn't fit", async () => {
    // Room for exactly one full-ceiling claim.
    vi.stubEnv("LUCY_BUDGET_SECONDS", String(TAKE_CLAIM_SECONDS));
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const clientId = await consentedClient(marcus, "Dre");

    expect(
      (await marcus.mutation(api.chair.startTake, { clientId, cutLabel: "a", prompt: "p" })).ok,
    ).toBe(true);

    const second = await marcus.mutation(api.chair.startTake, {
      clientId,
      cutLabel: "a",
      prompt: "p",
    });
    expect(second).toMatchObject({ ok: false, reason: "global_budget" });
  });

  test("approving keeps only recognised angles, deduped and clamped", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const clientId = await consentedClient(marcus, "Dre");
    const started = await marcus.mutation(api.chair.startTake, {
      clientId,
      cutLabel: "low taper",
      prompt: "p",
    });
    if (!started.ok) throw new Error("expected the take to start");

    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob(["frame"])));

    await marcus.mutation(api.chair.approveTake, {
      takeId: started.takeId,
      angles: [
        { key: "front", yawDeg: 2, tMs: 1000, storageId, confidence: 0.9 },
        // Duplicate key — the second must be dropped, not overwrite the first.
        { key: "front", yawDeg: 40, tMs: 9000, storageId, confidence: 0.1 },
        // Not an angle we know about.
        { key: "sideways", yawDeg: 0, tMs: 0, storageId, confidence: 1 },
        // Out-of-range confidence must be clamped, not stored raw.
        { key: "back", yawDeg: 180, tMs: 15_000, storageId, confidence: 4 },
      ],
    });

    const takes = await marcus.query(api.chair.listTakes, { clientId });
    expect(takes).toHaveLength(1);
    expect(takes![0].status).toBe("approved");
    expect(takes![0].angles.map((a) => a.key)).toEqual(["front", "back"]);
    expect(takes![0].angles[0].tMs).toBe(1000);
    expect(takes![0].angles[1].confidence).toBe(1);
  });

  test("a discarded take is kept, not deleted — the near-miss is worth comparing to", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const clientId = await consentedClient(marcus, "Dre");
    const started = await marcus.mutation(api.chair.startTake, {
      clientId,
      cutLabel: "low taper",
      prompt: "p",
    });
    if (!started.ok) throw new Error("expected the take to start");

    await marcus.mutation(api.chair.discardTake, { takeId: started.takeId });

    const takes = await marcus.query(api.chair.listTakes, { clientId });
    expect(takes).toHaveLength(1);
    expect(takes![0].status).toBe("discarded");
  });

  test('"none of these" really deletes: the row and its stored files are gone', async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const clientId = await consentedClient(marcus, "Dre");
    const started = await marcus.mutation(api.chair.startTake, {
      clientId,
      cutLabel: "low taper",
      prompt: "p",
    });
    if (!started.ok) throw new Error("expected the take to start");

    // Give the take a stored clip so the scrap has files to clean up.
    const videoId = await t.run(async (ctx) => await ctx.storage.store(new Blob(["clip"])));
    await t.run(async (ctx) => {
      await ctx.db.patch(started.takeId, { videoStorageId: videoId });
    });

    await marcus.mutation(api.chair.scrapTake, { takeId: started.takeId });

    expect(await marcus.query(api.chair.listTakes, { clientId })).toHaveLength(0);
    const file = await t.run(async (ctx) => await ctx.storage.getUrl(videoId));
    expect(file).toBeNull();
  });

  test("scrapping refuses to touch an approved take — winners are un-filed elsewhere", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const clientId = await consentedClient(marcus, "Dre");
    const started = await marcus.mutation(api.chair.startTake, {
      clientId,
      cutLabel: "low taper",
      prompt: "p",
    });
    if (!started.ok) throw new Error("expected the take to start");

    await marcus.mutation(api.chair.approveTake, { takeId: started.takeId, angles: [] });
    await marcus.mutation(api.chair.scrapTake, { takeId: started.takeId });

    const takes = await marcus.query(api.chair.listTakes, { clientId });
    expect(takes).toHaveLength(1);
    expect(takes![0].status).toBe("approved");
  });
});

describe("visits & decisions", () => {
  /** Backdate this client's only visit (and takes), as if it happened yesterday. */
  async function backdate(t: ReturnType<typeof convexTest>) {
    await t.run(async (ctx) => {
      const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
      const yesterday = new Date(dayAgo).toISOString().slice(0, 10);
      for (const visit of await ctx.db.query("chairVisits").collect()) {
        await ctx.db.patch(visit._id, { dayKey: yesterday, startedAt: dayAgo });
      }
      for (const take of await ctx.db.query("chairTakes").collect()) {
        await ctx.db.patch(take._id, { createdAt: dayAgo, approvedAt: dayAgo });
      }
    });
  }

  test("a day in the chair is one visit row, however many times the client is opened", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    await marcus.mutation(api.chair.startVisit, { name: "Dre" });
    await marcus.mutation(api.chair.startVisit, { name: "Dre" });

    const visits = await t.run(async (ctx) => await ctx.db.query("chairVisits").collect());
    expect(visits).toHaveLength(1);
  });

  test("approving a take pins it as today's chosen reference; a later approval re-pins", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const clientId = await consentedClient(marcus, "Dre");
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob(["frame"])));

    const first = await marcus.mutation(api.chair.startTake, { clientId, cutLabel: "a", prompt: "p" });
    const second = await marcus.mutation(api.chair.startTake, { clientId, cutLabel: "b", prompt: "p" });
    if (!first.ok || !second.ok) throw new Error("expected both takes to start");

    await marcus.mutation(api.chair.approveTake, {
      takeId: first.takeId,
      angles: [{ key: "front", yawDeg: 0, tMs: 0, storageId, confidence: 1 }],
    });
    await marcus.mutation(api.chair.approveTake, {
      takeId: second.takeId,
      angles: [{ key: "front", yawDeg: 0, tMs: 0, storageId, confidence: 1 }],
    });

    const visits = await marcus.query(api.chair.listVisits, { clientId });
    expect(visits).toHaveLength(1);
    expect(visits![0].chosenTake?.id).toBe(second.takeId);
    expect(visits![0].chosenTake?.cutLabel).toBe("b");
  });

  test("the decision stores a trimmed note and capped, deduped chips", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const clientId = await consentedClient(marcus, "Dre");

    await marcus.mutation(api.chair.recordDecision, {
      clientId,
      note: `  went 0.5 lower than usual ${"x".repeat(400)}`,
      chips: ["#2", "#2", " Taper ", "", "#1", "#3", "Beard trim", "Line up", "Scissors", "#4"],
    });

    const visits = await marcus.query(api.chair.listVisits, { clientId });
    expect(visits).toHaveLength(1);
    expect(visits![0].note!.startsWith("went 0.5 lower")).toBe(true);
    expect(visits![0].note!.length).toBeLessThanOrEqual(300);
    // Deduped, blanks dropped, capped at six.
    expect(visits![0].chips).toEqual(["#2", "Taper", "#1", "#3", "Beard trim", "Line up"]);
  });

  test("a decision can't touch another barber's client, or pin another client's take", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const rival = await barber(t, "rival", "rival");
    const clientId = await consentedClient(marcus, "Dre");
    const otherClient = await consentedClient(marcus, "Q");
    const started = await marcus.mutation(api.chair.startTake, {
      clientId: otherClient,
      cutLabel: "a",
      prompt: "p",
    });
    if (!started.ok) throw new Error("expected the take to start");

    await expect(
      rival.mutation(api.chair.recordDecision, { clientId, note: "mine now" }),
    ).rejects.toThrow(/unknown/i);
    await expect(
      marcus.mutation(api.chair.recordDecision, { clientId, takeId: started.takeId }),
    ).rejects.toThrow(/unknown/i);
  });

  test("lastVisitContext shows the previous visit, never today's own", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const clientId = await consentedClient(marcus, "Dre");
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob(["frame"])));
    const started = await marcus.mutation(api.chair.startTake, { clientId, cutLabel: "low taper", prompt: "p" });
    if (!started.ok) throw new Error("expected the take to start");
    await marcus.mutation(api.chair.approveTake, {
      takeId: started.takeId,
      angles: [{ key: "front", yawDeg: 0, tMs: 0, storageId, confidence: 1 }],
    });
    await marcus.mutation(api.chair.recordDecision, { clientId, note: "half up top", chips: ["#2"] });

    // Same day: the visit five minutes ago must not present itself as "last time".
    expect(await marcus.query(api.chair.lastVisitContext, { clientId })).toBeNull();

    await backdate(t);
    const context = await marcus.query(api.chair.lastVisitContext, { clientId });
    expect(context).toMatchObject({ cutLabel: "low taper", note: "half up top", chips: ["#2"] });
    expect(context!.angles).toHaveLength(1);
  });

  test("a client whose history predates visit records still gets a last-time card", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const clientId = await consentedClient(marcus, "Dre");
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob(["frame"])));
    const started = await marcus.mutation(api.chair.startTake, { clientId, cutLabel: "buzz", prompt: "p" });
    if (!started.ok) throw new Error("expected the take to start");
    await marcus.mutation(api.chair.approveTake, {
      takeId: started.takeId,
      angles: [{ key: "front", yawDeg: 0, tMs: 0, storageId, confidence: 1 }],
    });

    await backdate(t);
    // Pre-migration data: the approved take exists but no visit row does.
    await t.run(async (ctx) => {
      for (const visit of await ctx.db.query("chairVisits").collect()) {
        await ctx.db.delete(visit._id);
      }
    });

    const context = await marcus.query(api.chair.lastVisitContext, { clientId });
    expect(context).toMatchObject({ cutLabel: "buzz" });
  });
});

describe("dashboard reads", () => {
  test("getClient is owner-only and null for strangers", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const rival = await barber(t, "rival", "rival");
    const clientId = await consentedClient(marcus, "Dre");

    const mine = await marcus.query(api.chair.getClient, { clientId });
    expect(mine).toMatchObject({ name: "Dre", consented: true, fromCard: false });
    expect(await rival.query(api.chair.getClient, { clientId })).toBeNull();
  });

  test("weekSummary counts takes, approvals, and the tried-vs-chosen gap", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const clientId = await consentedClient(marcus, "Dre");
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob(["frame"])));

    const buzz = await marcus.mutation(api.chair.startTake, {
      clientId,
      cutLabel: "buzz",
      cutSlug: "buzz",
      prompt: "p",
    });
    const taper = await marcus.mutation(api.chair.startTake, {
      clientId,
      cutLabel: "low taper",
      cutSlug: "low-taper",
      prompt: "p",
    });
    if (!buzz.ok || !taper.ok) throw new Error("expected takes to start");
    await marcus.mutation(api.chair.approveTake, {
      takeId: taper.takeId,
      angles: [{ key: "front", yawDeg: 0, tMs: 0, storageId, confidence: 1 }],
    });

    const summary = await marcus.query(api.chair.weekSummary, {});
    expect(summary).toMatchObject({
      visitsThisWeek: 1,
      clientsThisWeek: 1,
      takesThisWeek: 2,
      approvedThisWeek: 1,
    });
    expect(summary!.topTried.map((c) => c.cutSlug).sort()).toEqual(["buzz", "low-taper"]);
    expect(summary!.topChosen.map((c) => c.cutSlug)).toEqual(["low-taper"]);
  });

  test("seating from a booking stamps the visit; a stranger's booking id is dropped", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const rival = await barber(t, "rival", "rival");

    const { marcusBooking, rivalBooking } = await t.run(async (ctx) => {
      const pages = await ctx.db.query("barberPages").collect();
      const users = await ctx.db.query("users").collect();
      const bySlug = (slug: string) => pages.find((p) => p.slug === slug)!;
      const insert = (pageId: (typeof pages)[number]["_id"]) =>
        ctx.db.insert("barberBookings", {
          pageId,
          startMs: Date.now() + 60 * 60 * 1000,
          endMs: Date.now() + 90 * 60 * 1000,
          clientUserId: users[0]._id,
          clientName: "Dre",
          status: "booked" as const,
          createdAt: Date.now(),
        });
      return {
        marcusBooking: await insert(bySlug("marcus")._id),
        rivalBooking: await insert(bySlug("rival")._id),
      };
    });

    await marcus.mutation(api.chair.startVisit, { name: "Dre", bookingId: marcusBooking });
    let visits = await t.run(async (ctx) => await ctx.db.query("chairVisits").collect());
    expect(visits.find((v2) => v2.bookingId === marcusBooking)).toBeTruthy();

    // A rival's booking id must neither fail the visit nor be stamped.
    await marcus.mutation(api.chair.startVisit, { name: "Q", bookingId: rivalBooking });
    visits = await t.run(async (ctx) => await ctx.db.query("chairVisits").collect());
    expect(visits.some((v2) => v2.bookingId === rivalBooking)).toBe(false);
  });
});

describe("dailySeries", () => {
  test("fourteen zero-filled days, with today's work counted on today", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const clientId = await consentedClient(marcus, "Dre");
    const started = await marcus.mutation(api.chair.startTake, {
      clientId,
      cutLabel: "buzz",
      prompt: "p",
    });
    if (!started.ok) throw new Error("expected the take to start");

    const series = await marcus.query(api.chair.dailySeries, {});
    expect(series).toHaveLength(14);
    const today = series![series!.length - 1];
    expect(today).toMatchObject({ visits: 1, takes: 1, approved: 0 });
    // Every earlier day exists and is quiet, not missing.
    expect(series!.slice(0, 13).every((p) => p.visits === 0 && p.takes === 0)).toBe(true);
  });
});

describe("visitPulse", () => {
  test("returns this barber's visit times only, old ones dropped", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const rival = await barber(t, "rival", "rival");
    await marcus.mutation(api.chair.startVisit, { name: "Dre" });
    await rival.mutation(api.chair.startVisit, { name: "Q" });

    // A visit from last spring is outside the four-week window.
    await t.run(async (ctx) => {
      const page = (await ctx.db.query("barberPages").collect()).find((p) => p.slug === "marcus")!;
      const client = (await ctx.db.query("chairClients").collect()).find(
        (c) => c.pageId === page._id,
      )!;
      const old = Date.now() - 200 * 24 * 60 * 60 * 1000;
      await ctx.db.insert("chairVisits", {
        clientId: client._id,
        pageId: page._id,
        dayKey: new Date(old).toISOString().slice(0, 10),
        startedAt: old,
        updatedAt: old,
      });
    });

    const mine = await marcus.query(api.chair.visitPulse, {});
    expect(mine).toHaveLength(1);
    expect(mine![0]).toBeGreaterThan(Date.now() - 60_000);
    // Each barber sees only their own day.
    expect(await rival.query(api.chair.visitPulse, {})).toHaveLength(1);
    expect(await t.query(api.chair.visitPulse, {})).toBeNull();
  });
});

describe("seedDemo", () => {
  test("fills the book once, refuses to double-seed, and stays owner-scoped", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const rival = await barber(t, "rival", "rival");

    const first = await t.mutation(internal.chair.seedDemo, { slug: "marcus" });
    expect(first.seeded).toBe(true);
    expect(first.clients).toBeGreaterThan(10);
    expect(first.visits).toBeGreaterThan(first.clients);
    expect(first.bookings).toBeGreaterThan(5);

    // Idempotent: a second run must not double the roster.
    const second = await t.mutation(internal.chair.seedDemo, { slug: "marcus" });
    expect(second.seeded).toBe(false);

    // The demo lands in Marcus's book and nobody else's.
    const mine = await marcus.query(api.chair.listClients, {});
    expect(mine!.length).toBe(first.clients);
    expect(await rival.query(api.chair.listClients, {})).toEqual([]);

    // And it feeds the dashboard reads: summary, series, calendar range.
    const summary = await marcus.query(api.chair.weekSummary, {});
    expect(summary!.visitsThisWeek).toBeGreaterThan(0);
    const series = await marcus.query(api.chair.dailySeries, {});
    expect(series!.some((p) => p.takes > 0)).toBe(true);
    const week = await marcus.query(api.barberBooking.listMyBookingsRange, {
      fromMs: Date.now() - 24 * 60 * 60 * 1000,
      toMs: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
    expect(week!.length).toBe(first.bookings);
    expect(await rival.query(api.barberBooking.listMyBookingsRange, {
      fromMs: Date.now() - 24 * 60 * 60 * 1000,
      toMs: Date.now() + 7 * 24 * 60 * 60 * 1000,
    })).toEqual([]);
  });
});

describe("deleteClient", () => {
  test("erases the client, their takes, and every stored frame", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const clientId = await consentedClient(marcus, "Dre");
    const started = await marcus.mutation(api.chair.startTake, {
      clientId,
      cutLabel: "low taper",
      prompt: "p",
    });
    if (!started.ok) throw new Error("expected the take to start");

    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob(["frame"])));
    await marcus.mutation(api.chair.approveTake, {
      takeId: started.takeId,
      angles: [{ key: "front", yawDeg: 0, tMs: 0, storageId, confidence: 1 }],
    });

    await marcus.mutation(api.chair.recordDecision, { clientId, note: "for next time" });

    const { done } = await marcus.mutation(api.chair.deleteClient, { clientId });
    expect(done).toBe(true);

    expect(await marcus.query(api.chair.listClients, {})).toEqual([]);
    const leftovers = await t.run(async (ctx) => ({
      takes: await ctx.db.query("chairTakes").collect(),
      visits: await ctx.db.query("chairVisits").collect(),
      frame: await ctx.storage.getUrl(storageId),
    }));
    expect(leftovers.takes).toEqual([]);
    expect(leftovers.visits).toEqual([]);
    expect(leftovers.frame).toBeNull();
  });
});

// ── the card's live mirror ──────────────────────────────────────────────────
// A client running a take on themselves from /b/<slug> is a different caller
// with a different threat model: they are a stranger on a public URL spending
// somebody else's money. These tests are about the three things that keeps
// honest — consent, the shared meter, and one visitor's reach.

describe("the card's live mirror", () => {
  test("a signed-out visitor gets no session and cannot start a take", async () => {
    const t = convexTest(schema, modules);
    await barber(t, "marcus", "marcus");

    expect(await t.query(api.chair.cardSession, { slug: "marcus" })).toBeNull();
    await expect(
      t.mutation(api.chair.startCardTake, { slug: "marcus", cutLabel: "fade", prompt: "p" }),
    ).rejects.toThrow(/sign in/i);
  });

  test("consent gates the camera — no stamp, no take", async () => {
    const t = convexTest(schema, modules);
    await barber(t, "marcus", "marcus");
    const dre = identity(t, "dre");

    expect(await dre.query(api.chair.cardSession, { slug: "marcus" })).toMatchObject({
      clientId: null,
      needsConsent: true,
    });
    await expect(
      dre.mutation(api.chair.startCardTake, { slug: "marcus", cutLabel: "fade", prompt: "p" }),
    ).rejects.toThrow(/agree to be filmed/i);

    await dre.mutation(api.chair.joinCard, { slug: "marcus", name: "Dre" });
    const started = await dre.mutation(api.chair.startCardTake, {
      slug: "marcus",
      cutLabel: "fade",
      prompt: "p",
    });
    expect(started.ok).toBe(true);
  });

  test("joining twice is one row, one consent stamp", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const dre = identity(t, "dre");

    const first = await dre.mutation(api.chair.joinCard, { slug: "marcus", name: "Dre" });
    const second = await dre.mutation(api.chair.joinCard, { slug: "marcus", name: "Dre" });
    expect(second.clientId).toBe(first.clientId);
    expect(await marcus.query(api.chair.listClients, {})).toHaveLength(1);
  });

  test("the visitor lands in the barber's own roster, consented", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const dre = identity(t, "dre");
    await dre.mutation(api.chair.joinCard, { slug: "marcus", name: "Dre" });

    expect(await marcus.query(api.chair.listClients, {})).toMatchObject([
      { name: "Dre", consented: true },
    ]);
  });

  test("a visitor called the same as a walk-in does not collide with them", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    await consentedClient(marcus, "Dre");

    const dre = identity(t, "dre");
    const joined = await dre.mutation(api.chair.joinCard, { slug: "marcus", name: "Dre" });
    expect(joined.name).toBe("Dre (2)");

    // The barber's own lookup still resolves to exactly one row.
    const again = await marcus.mutation(api.chair.startVisit, { name: "Dre" });
    expect(again.name).toBe("Dre");
    expect(await marcus.query(api.chair.listClients, {})).toHaveLength(2);
  });

  test("card takes spend the same daily cap the chair spends", async () => {
    const t = convexTest(schema, modules);
    vi.stubEnv("LUCY_DAILY_TAKES_PER_BARBER", "2");
    const marcus = await barber(t, "marcus", "marcus");
    const walkIn = await consentedClient(marcus, "Walk-in");
    const dre = identity(t, "dre");
    await dre.mutation(api.chair.joinCard, { slug: "marcus", name: "Dre" });

    await marcus.mutation(api.chair.startTake, { clientId: walkIn, cutLabel: "a", prompt: "p" });
    await dre.mutation(api.chair.startCardTake, { slug: "marcus", cutLabel: "b", prompt: "p" });

    // Two spent between the two doors — the third is refused on both.
    expect(await dre.mutation(api.chair.startCardTake, {
      slug: "marcus", cutLabel: "c", prompt: "p",
    })).toMatchObject({ ok: false, reason: "daily_cap" });
    expect(await marcus.mutation(api.chair.startTake, {
      clientId: walkIn, cutLabel: "c", prompt: "p",
    })).toMatchObject({ ok: false, reason: "daily_cap" });
    expect(await dre.query(api.chair.cardSession, { slug: "marcus" })).toMatchObject({
      takesLeftToday: 0,
    });
  });

  test("a card visitor is paced at the same two takes per two minutes", async () => {
    const t = convexTest(schema, modules);
    await barber(t, "marcus", "marcus");
    const dre = identity(t, "dre");
    await dre.mutation(api.chair.joinCard, { slug: "marcus", name: "Dre" });

    const args = { slug: "marcus", cutLabel: "fade", prompt: "p" };
    expect((await dre.mutation(api.chair.startCardTake, args)).ok).toBe(true);
    expect((await dre.mutation(api.chair.startCardTake, args)).ok).toBe(true);
    await expect(dre.mutation(api.chair.startCardTake, args)).rejects.toThrow(
      /give the mirror a minute/i,
    );
  });

  test("the visitor can finish their own take, and the refund lands on the barber", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const dre = identity(t, "dre");
    await dre.mutation(api.chair.joinCard, { slug: "marcus", name: "Dre" });
    const started = await dre.mutation(api.chair.startCardTake, {
      slug: "marcus",
      cutLabel: "fade",
      prompt: "p",
    });
    if (!started.ok) throw new Error("expected the take to start");

    await dre.mutation(api.chair.finishTake, { takeId: started.takeId, durationMs: 8_000 });

    const usage = await t.run(async (ctx) => await ctx.db.query("chairUsage").unique());
    expect(usage?.seconds).toBe(TAKE_CLAIM_SECONDS - (TAKE_CLAIM_SECONDS - 8));
  });

  test("one visitor cannot touch another visitor's take", async () => {
    const t = convexTest(schema, modules);
    await barber(t, "marcus", "marcus");
    const dre = identity(t, "dre");
    const sam = identity(t, "sam");
    await dre.mutation(api.chair.joinCard, { slug: "marcus", name: "Dre" });
    await sam.mutation(api.chair.joinCard, { slug: "marcus", name: "Sam" });

    const started = await dre.mutation(api.chair.startCardTake, {
      slug: "marcus",
      cutLabel: "fade",
      prompt: "p",
    });
    if (!started.ok) throw new Error("expected the take to start");

    await expect(
      sam.mutation(api.chair.finishTake, { takeId: started.takeId, durationMs: 5_000 }),
    ).rejects.toThrow(/unknown take/i);
    await expect(
      sam.mutation(api.chair.shareTake, { takeId: started.takeId }),
    ).rejects.toThrow(/unknown take/i);
  });

  test("sharing pins the take and files what the client asked for", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    const dre = identity(t, "dre");
    const { clientId } = await dre.mutation(api.chair.joinCard, { slug: "marcus", name: "Dre" });
    const started = await dre.mutation(api.chair.startCardTake, {
      slug: "marcus",
      cutLabel: "fade",
      prompt: "p",
    });
    if (!started.ok) throw new Error("expected the take to start");

    const posterStorageId = await t.run(
      async (ctx) => await ctx.storage.store(new Blob(["poster"])),
    );
    const shared = await dre.mutation(api.chair.shareTake, {
      takeId: started.takeId,
      posterStorageId,
      note: "keep the fringe",
      phone: "(415) 555-0134",
    });
    expect(shared.posterUrl).toBeTruthy();

    // The barber sees it as an approved take against a client with a note.
    const takes = await marcus.query(api.chair.listTakes, { clientId });
    expect(takes).toMatchObject([{ status: "approved" }]);
    expect(await marcus.query(api.chair.listClients, {})).toMatchObject([
      { name: "Dre", notes: "keep the fringe", phone: "(415) 555-0134" },
    ]);
  });

  test("an unknown card mints nothing", async () => {
    const t = convexTest(schema, modules);
    const dre = identity(t, "dre");
    expect(await dre.query(api.chair.cardSession, { slug: "nobody" })).toBeNull();
    await expect(
      dre.mutation(api.chair.joinCard, { slug: "nobody", name: "Dre" }),
    ).rejects.toThrow(/doesn’t exist/i);
  });

  test("an unpublished card cannot be made to spend its owner's budget", async () => {
    const t = convexTest(schema, modules);
    const marcus = await barber(t, "marcus", "marcus");
    await marcus.mutation(api.barberPages.upsert, {
      slug: "marcus",
      displayName: "marcus",
      links: [],
      styles: [],
      published: false,
    });

    const dre = identity(t, "dre");
    expect(await dre.query(api.chair.cardSession, { slug: "marcus" })).toBeNull();
    await expect(
      dre.mutation(api.chair.joinCard, { slug: "marcus", name: "Dre" }),
    ).rejects.toThrow(/doesn’t exist/i);
  });
});
