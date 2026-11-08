// Structured server logs: one JSON object per line, always carrying the build's
// jobId when there is one, so a single search finds a build across Vercel, the
// worker ({"svc":"worker",…}) and Convex ({"svc":"convex",…}).
//
// level 'error' also reports to Sentry (tagged with the jobId). Sentry is a
// no-op until SENTRY_DSN is set (see src/instrumentation.ts), so this is safe
// to call everywhere.

import * as Sentry from '@sentry/nextjs';

export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Record<string, string | number | boolean | null | undefined>;

/** The JSON line for an event; undefined fields are dropped. Pure, for tests. */
export function formatLogLine(event: string, fields: LogFields = {}, now: number = Date.now()): string {
  const clean: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) clean[k] = v;
  return JSON.stringify({ svc: 'vercel', event, ts: now, ...clean });
}

export function logEvent(event: string, fields: LogFields = {}, opts: { level?: LogLevel; error?: unknown } = {}): void {
  const level = opts.level ?? 'info';
  const line = formatLogLine(event, opts.error === undefined ? fields : { ...fields, error: errorMessage(opts.error) });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);

  if (level === 'error') {
    Sentry.withScope((scope) => {
      if (typeof fields.jobId === 'string') scope.setTag('job_id', fields.jobId);
      scope.setTag('event', event);
      scope.setContext('fields', fields);
      if (opts.error instanceof Error) Sentry.captureException(opts.error);
      else Sentry.captureMessage(opts.error === undefined ? event : `${event}: ${errorMessage(opts.error)}`, 'error');
    });
  }
}

function errorMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500);
}
