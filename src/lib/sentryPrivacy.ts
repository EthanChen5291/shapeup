// What Sentry may collect. Its defaults attach request bodies, cookies, headers
// and query strings, and /api/facelift's body IS the user's selfie. Errors here
// carry a stack trace, the route, and our own tags (the job id), nothing else.

import type { BrowserOptions } from '@sentry/nextjs';

export const SENTRY_DATA_COLLECTION: NonNullable<BrowserOptions['dataCollection']> = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
};
