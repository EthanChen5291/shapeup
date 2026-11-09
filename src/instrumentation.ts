// Next.js runs register() once per server instance at startup. Error reporting
// is off unless SENTRY_DSN is set, so local dev and previews without a DSN are
// unaffected. Errors only: no performance tracing, no request bodies (selfies),
// no IP addresses.

import * as Sentry from '@sentry/nextjs';
import { SENTRY_DATA_COLLECTION } from '@/lib/sentryPrivacy';

export function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? 'development',
    tracesSampleRate: 0,
    dataCollection: SENTRY_DATA_COLLECTION,
    // Never attach stack-frame locals to errors: they can hold selfie buffers and secrets.
    includeLocalVariables: false,
  });
}

// Reports errors thrown from route handlers, server components and middleware.
export const onRequestError = Sentry.captureRequestError;
