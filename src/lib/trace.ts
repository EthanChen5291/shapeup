// Tracing helper for work that outlives the response (Vercel's after()). By then
// the request's own span has ended, so the build gets a span of its own that
// stays in the same trace. Fetches inside it (the GPU worker, Convex) become its
// children, and the worker continues the trace from the headers it receives.
// A no-op wrapper until Sentry is initialised.

import * as Sentry from '@sentry/nextjs';

export function traced<T>(name: string, attributes: Record<string, string | number | boolean | undefined>, fn: () => Promise<T>): Promise<T> {
  const attrs: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attributes)) if (v !== undefined) attrs[k] = v;
  return Sentry.startSpan({ name, op: name, attributes: attrs, forceTransaction: true }, fn);
}
