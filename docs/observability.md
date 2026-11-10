# Observability

Three pieces, all inert until their keys are set.

## 1. Error tracking (Sentry)

- **Next.js server:** `src/instrumentation.ts` starts Sentry when `SENTRY_DSN` is set and reports errors thrown from routes, server components and middleware (`onRequestError`).
- **Browser:** `src/instrumentation-client.ts` starts it when `NEXT_PUBLIC_SENTRY_DSN` is set.
- **GPU worker:** `server/modal_facelift.py` (`init_sentry`) starts it when `SENTRY_DSN` is in the container's environment; FastAPI 5xx responses are reported, tagged `job_id`.
- **Privacy:** no session replay; tracing on the server and worker only (the browser sends errors only). Request bodies (the selfie), cookies, headers, query strings and user info are never sent: `src/lib/sentryPrivacy.ts` for Next.js, `send_default_pii=False` + `max_request_body_size="never"` for Python.

Setup:
1. Create a Sentry project (platform: Next.js) and copy its DSN.
2. Vercel → Settings → Environment Variables: `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` (same value), Production (and Preview if wanted).
3. Modal: a dedicated `shapeup-sentry` secret holds `SENTRY_DSN` and `SENTRY_ENVIRONMENT` (`modal secret create shapeup-sentry SENTRY_DSN=<dsn> SENTRY_ENVIRONMENT=production`; already created) and is attached to `FaceLiftServer`, so the other secrets never need replacing to change it. Then `modal deploy server/modal_facelift.py`. The deploy rebuilds only the last image layer (`sentry-sdk`), but it does replace the memory snapshot, so the first few requests are cold.

Source maps are not uploaded (no `withSentryConfig` wrapper), so browser stack traces are minified; server traces are readable.

## 2. Structured logs, keyed on the job id

Every lifecycle event is one JSON line with a `jobId` / `job_id`:

| Source | `svc` | Events |
|---|---|---|
| Vercel route (`src/lib/log.ts`) | `vercel` | `build.accepted`, `upstream.attempt` (ms, ok, reason), `build.done` (ms, gpuS), `build.failed`, `build.crashed`, `hold.*_failed` |
| Worker (`log_event`) | `worker` | `job.started`, `job.done` (elapsed_s, gaussians, splat_bytes), `job.failed`, `job.cancelled` |
| Convex | `convex` | `hold.settled` (outcome, reason, ms), `build.health` (hourly), `alert` |

Once Sentry is on, the Vercel and worker events are also sent as **Sentry structured logs** (`Sentry.logger` in `src/lib/log.ts`; `enable_logs=True` + `sentry_sdk.logger` in the worker), so Sentry → Explore → Logs, filtered on `jobId:J1` or `job_id:J1`, shows both sides of a build in one place with no log drain. `logEvent(..., { level: 'error' })` is additionally reported as a Sentry error tagged `job_id`.

Convex lines stay in the Convex dashboard: the Convex runtime has no Sentry SDK, and its own log streaming is a Convex Pro feature. Sentry's free Developer plan includes 5 GB of logs a month (about 3 KB per build here) but only one user.

## 3. Alerts (Convex)

Every build settles its credit hold with a reason (`creditHolds.settleReason`: completed, failed, stale, superseded), so the holds table is the build ledger. `convex/buildHealth.ts`:

- **Hourly cron** summarises the last hour: failure rate = (failed + stale) / (completed + failed + stale), superseded excluded; p50/p95 of charge-to-head time for completed builds. Alerts when the failure rate is over 10 % (needs at least 5 builds in the hour) or p95 is over 25 s (needs at least 2 completed builds).
- **Reaper:** any reaped build posts immediately (every reap means an `after()` died).
- Alerts go to `BUILD_ALERTS_WEBHOOK_URL` (a Discord webhook). Unset → logged as `{"event":"alert","delivered":false}` only.

Setup: create a Discord webhook in an ops channel, then `npx convex env set BUILD_ALERTS_WEBHOOK_URL <url>` (add `--prod` for production). The schema change (an optional field and an index) deploys with the next Convex push. Holds settled before this change have no reason and are ignored.

## 4. Tracing (one build = one trace)

- **Vercel:** `tracesSampleRate: 1` and `tracePropagationTargets` (`src/lib/sentryTracing.ts`: `*.modal.run` only) in `src/instrumentation.ts`. Sentry auto-traces each request and every outgoing `fetch`. The work inside `after()` runs in its own span (`traced('facelift.build', …)` in `src/lib/trace.ts`), because the request's span has already ended by then.
- **Propagation:** the fetch to the worker carries `sentry-trace: <trace id>-<span id>-<sampled>` and `baggage` (verified locally; S3/Convex/Clerk URLs get neither).
- **Worker:** `traces_sample_rate=1.0`; Sentry's FastAPI integration continues the trace from those headers, and `record_stage_spans` adds one span per stage (`prepare`, `gpu_queue`, `identity_check`, `inference`, `convert`, `upload`) from the timings the worker already measures.
- **Where to look:** sentry.io → Explore → Traces, or open any issue/log with a trace id. Live after the next Vercel deploy and `modal deploy server/modal_facelift.py`.

## 5. Convex numbers in Sentry

The hourly `build.health` summary (completed, failed, stale, superseded, failure rate, p50, p95, alert count) and every alert are also sent to Sentry Logs from Convex (`convex/lib/sentryLog.ts`), as `svc: convex`. Convex can't run Sentry's SDK, so this posts the same HTTP "envelope" the SDK sends. Needs `SENTRY_DSN` (and `SENTRY_ENVIRONMENT`) in the Convex environment: set on dev (`development`) and prod (`production`). In Sentry → Logs, search `build.health` and chart `p95Ms` or `failureRate` over time.

A demo dataset (environment `demo`, 24 builds, 124 log lines, 3 issues) was sent on 2026-11-09 for exploring the UI; filter it out with `!environment:demo`. Generator: the session scratchpad's `sentry-demo.mjs`.
