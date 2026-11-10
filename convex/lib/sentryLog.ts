// Send one structured log line to Sentry Logs from a Convex action.
//
// Convex can't run Sentry's SDK, but an action can fetch(), and Sentry ingests
// plain HTTP "envelopes": newline-separated JSON (envelope header, item header,
// item payload). This writes exactly what @sentry/node 11 sends for
// Sentry.logger.info(...) (captured from the SDK), so the hourly build.health
// line and every alert sit in Sentry Logs next to the Vercel and worker lines.
// No-op without SENTRY_DSN. Never throws: monitoring must not break alerting.

export type SentryLogLevel = "info" | "warn" | "error";
export type SentryLogAttributes = Record<string, string | number | boolean | null | undefined>;

const SEVERITY: Record<SentryLogLevel, number> = { info: 9, warn: 13, error: 17 };

/** https://<key>@<host>/<projectId> → the envelope endpoint, or null if the DSN is malformed. */
export function envelopeUrl(dsn: string): string | null {
  const m = dsn.match(/^(https?):\/\/([^@/]+)@([^/]+)\/(\d+)$/);
  if (!m) return null;
  const [, scheme, key, host, project] = m;
  return `${scheme}://${host}/api/${project}/envelope/?sentry_version=7&sentry_key=${key}&sentry_client=shapeup-convex%2F1.0`;
}

function typed(value: string | number | boolean) {
  if (typeof value === "boolean") return { value, type: "boolean" };
  if (typeof value === "number") return { value, type: Number.isInteger(value) ? "integer" : "double" };
  return { value, type: "string" };
}

/** The envelope body for one log line. Pure, for tests. */
export function buildLogEnvelope(
  level: SentryLogLevel,
  body: string,
  attributes: SentryLogAttributes,
  environment: string,
  nowMs: number,
  traceId: string,
): string {
  const attrs: Record<string, { value: string | number | boolean; type: string }> = {};
  for (const [k, v] of Object.entries(attributes)) if (v !== undefined && v !== null) attrs[k] = typed(v);
  attrs["sentry.environment"] = typed(environment);
  const header = { sdk: { name: "shapeup.convex", version: "1.0.0" } };
  const itemHeader = { type: "log", item_count: 1, content_type: "application/vnd.sentry.items.log+json" };
  const payload = {
    version: 2,
    items: [{ timestamp: nowMs / 1000, level, body, trace_id: traceId, severity_number: SEVERITY[level], attributes: attrs }],
  };
  return [JSON.stringify(header), JSON.stringify(itemHeader), JSON.stringify(payload)].join("\n");
}

function randomTraceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Post one log line to Sentry. Returns whether it was delivered. */
export async function sendSentryLog(level: SentryLogLevel, body: string, attributes: SentryLogAttributes): Promise<boolean> {
  const dsn = process.env.SENTRY_DSN;
  const url = dsn ? envelopeUrl(dsn) : null;
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body: buildLogEnvelope(level, body, { svc: "convex", ...attributes }, process.env.SENTRY_ENVIRONMENT ?? "production", Date.now(), randomTraceId()),
    });
    if (!res.ok) console.error("[sentryLog] Sentry rejected the log:", res.status);
    return res.ok;
  } catch (err) {
    console.error("[sentryLog] could not reach Sentry:", err instanceof Error ? err.message : err);
    return false;
  }
}
