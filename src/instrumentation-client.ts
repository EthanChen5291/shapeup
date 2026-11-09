// Browser error reporting (Next.js loads this before the app starts). Off
// unless NEXT_PUBLIC_SENTRY_DSN is set. Errors only: no tracing, no session
// replay (the studio shows people's faces), no PII.

import * as Sentry from '@sentry/nextjs';
import { SENTRY_DATA_COLLECTION } from '@/lib/sentryPrivacy';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? 'development',
    tracesSampleRate: 0,
    dataCollection: SENTRY_DATA_COLLECTION,
  });
}
