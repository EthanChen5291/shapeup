// Build health, computed from the credit-holds ledger, plus alerts.
//
// Every build (first scan or edit) takes a credit hold and settles it with a
// reason (creditHolds.settleReason), so the holds table already is a record of
// every build's outcome and duration:
//   completed  → the user got a head;  settledAt − createdAt = charge-to-head time
//   failed     → upstream failed, identity check refused, or startBuild failed
//   stale      → the reaper caught a build whose after() died
//   superseded → the user started another build (not a failure, ignored here)
//
// Every summary and alert is also sent to Sentry Logs (lib/sentryLog.ts) when
// SENTRY_DSN is set in the Convex environment.
// An hourly cron summarises the last hour and posts to a Discord channel when
// the failure rate (over 10 %, from 5 builds) or the p95 build time (over 25 s,
// from 2 builds) crosses its threshold. The reaper posts
// on its own the moment it reaps anything. With BUILD_ALERTS_WEBHOOK_URL unset
// the summary is only logged, so this is inert until a webhook is configured.

import { v } from "convex/values";
import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { sendSentryLog } from "./lib/sentryLog";

export const WINDOW_MS = 60 * 60 * 1000;
/** Below this many builds in the window a failure rate is noise (1 failure of 2 reads as 50 %). */
export const MIN_BUILDS = 5;
export const FAILURE_RATE_ALERT = 0.1;
/** Slow-build alert: p95 of completed builds over 25 s, from as few as 2 builds in the hour.
 *  With 2 builds the p95 is simply the slower one; a warm build is ~9 s and a cold one ~18 s. */
export const MIN_BUILDS_FOR_P95 = 2;
export const P95_ALERT_MS = 25_000;

export interface SettledHold {
  status: "held" | "committed" | "released";
  settleReason?: "completed" | "failed" | "superseded" | "stale";
  createdAt: number;
  settledAt?: number;
}

export interface BuildHealth {
  completed: number;
  failed: number;
  stale: number;
  superseded: number;
  /** (failed + stale) / (completed + failed + stale); null when there were no builds. */
  failureRate: number | null;
  /** Charge-to-head time of completed builds, ms; null with no completed builds. */
  p50Ms: number | null;
  p95Ms: number | null;
  alerts: string[];
}

/** Nearest-rank percentile of a list (p in 0..100); null for an empty list. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** Pure: the window's counts, rates and which thresholds are breached. Legacy holds without a reason are skipped. */
export function summarizeBuilds(holds: SettledHold[]): BuildHealth {
  const by = { completed: 0, failed: 0, stale: 0, superseded: 0 };
  const durations: number[] = [];
  for (const h of holds) {
    if (!h.settleReason || h.settledAt === undefined) continue;
    by[h.settleReason] += 1;
    if (h.settleReason === "completed") durations.push(h.settledAt - h.createdAt);
  }
  const outcomes = by.completed + by.failed + by.stale;
  const failureRate = outcomes === 0 ? null : (by.failed + by.stale) / outcomes;
  const p95Ms = percentile(durations, 95);
  const alerts: string[] = [];
  if (failureRate !== null && outcomes >= MIN_BUILDS && failureRate > FAILURE_RATE_ALERT) {
    alerts.push(`Failure rate ${(failureRate * 100).toFixed(0)}% (${by.failed} failed, ${by.stale} timed out of ${outcomes} builds; threshold ${FAILURE_RATE_ALERT * 100}%)`);
  }
  if (p95Ms !== null && durations.length >= MIN_BUILDS_FOR_P95 && p95Ms > P95_ALERT_MS) {
    alerts.push(`p95 build time ${(p95Ms / 1000).toFixed(1)} s over ${durations.length} builds (threshold ${P95_ALERT_MS / 1000} s)`);
  }
  return { ...by, failureRate, p50Ms: percentile(durations, 50), p95Ms, alerts };
}

export const settledSince = internalQuery({
  args: { since: v.number() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("creditHolds")
      .withIndex("by_settled_at", (q) => q.gt("settledAt", args.since))
      .take(5000);
    return rows.map(({ status, settleReason, createdAt, settledAt }) => ({ status, settleReason, createdAt, settledAt }));
  },
});

/** Hourly: summarise the last hour, log it, and alert on breached thresholds. */
export const check = internalAction({
  args: {},
  handler: async (ctx) => {
    const holds: SettledHold[] = await ctx.runQuery(internal.buildHealth.settledSince, { since: Date.now() - WINDOW_MS });
    const health = summarizeBuilds(holds);
    console.log(JSON.stringify({ svc: "convex", event: "build.health", windowMin: WINDOW_MS / 60000, ...health }));
    // The same numbers as a Sentry log, so they can be charted next to the traces.
    await sendSentryLog(health.alerts.length > 0 ? "warn" : "info", "build.health", {
      windowMin: WINDOW_MS / 60000,
      completed: health.completed,
      failed: health.failed,
      stale: health.stale,
      superseded: health.superseded,
      failureRate: health.failureRate,
      p50Ms: health.p50Ms,
      p95Ms: health.p95Ms,
      alerts: health.alerts.length,
    });
    if (health.alerts.length > 0) {
      await ctx.runAction(internal.buildHealth.notify, {
        title: "Build health alert (last hour)",
        lines: [
          ...health.alerts,
          `completed ${health.completed} · failed ${health.failed} · timed out ${health.stale} · superseded ${health.superseded}`,
          health.p50Ms !== null ? `p50 ${(health.p50Ms / 1000).toFixed(1)} s · p95 ${((health.p95Ms ?? 0) / 1000).toFixed(1)} s` : "no completed builds",
        ],
      });
    }
    return null;
  },
});

/** Post an alert to the ops Discord channel; logs and skips when no webhook is configured. */
export const notify = internalAction({
  args: { title: v.string(), lines: v.array(v.string()) },
  handler: async (_ctx, args) => {
    const webhookUrl = process.env.BUILD_ALERTS_WEBHOOK_URL;
    console.warn(JSON.stringify({ svc: "convex", event: "alert", title: args.title, lines: args.lines, delivered: Boolean(webhookUrl) }));
    await sendSentryLog("warn", "alert", { title: args.title, detail: args.lines.join(" | ").slice(0, 2000), discord: Boolean(webhookUrl) });
    if (!webhookUrl) return null;
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "ShapeUp Alerts",
        embeds: [{
          title: args.title,
          description: args.lines.join("\n").slice(0, 4000),
          color: 0xe8a33d,
          timestamp: new Date().toISOString(),
        }],
      }),
    });
    if (!res.ok) console.error("[buildHealth] alert webhook failed:", res.status, await res.text().catch(() => ""));
    return null;
  },
});
