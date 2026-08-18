/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * This app shares its Convex deployment with the chair build, which wrote a
 * couple of fields we never read. They stay declared (optional) so existing
 * documents keep validating — dropping one fails `convex deploy` against the
 * shared deployment, which takes production down with it.
 */
describe("shared-deployment field compatibility", () => {
  test("accepts a user document carrying the chair build's clock24", async () => {
    const t = convexTest(schema, modules);

    const id = await t.run((ctx) =>
      ctx.db.insert("users", {
        tokenIdentifier: "https://clerk.test|legacy",
        clerkId: "legacy",
        credits: 0,
        clock24: true,
      }),
    );

    const user = await t.run((ctx) => ctx.db.get(id));
    expect(user?.clock24).toBe(true);
  });

  test("accepts a barber card carrying the chair build's theme", async () => {
    const t = convexTest(schema, modules);

    const id = await t.run(async (ctx) => {
      const ownerUserId = await ctx.db.insert("users", {
        tokenIdentifier: "https://clerk.test|barber",
        clerkId: "barber",
        credits: 0,
      });
      return ctx.db.insert("barberPages", {
        slug: "legacy-card",
        ownerUserId,
        displayName: "Marcus",
        links: [],
        styles: [],
        published: true,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        theme: "midnight",
      });
    });

    const page = await t.run((ctx) => ctx.db.get(id));
    expect(page?.theme).toBe("midnight");
  });
});
