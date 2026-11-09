import { describe, expect, it } from 'vitest';
import { SENTRY_DATA_COLLECTION } from './sentryPrivacy';

describe('SENTRY_DATA_COLLECTION', () => {
  it('collects no bodies (selfies), cookies, headers, query strings or user info', () => {
    expect(SENTRY_DATA_COLLECTION).toMatchObject({
      userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false,
    });
  });
});
