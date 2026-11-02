/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';
import { BIOMETRIC_CONSENT_VERSION, coversIdentityCheck } from './lib/biometricConsent';

const modules = import.meta.glob('./**/*.ts');
const token = (id: string) => `https://clerk.test|${id}`;

function setup() {
  const t = convexTest(schema, modules);
  const as = (id: string) => t.withIdentity({ subject: id, tokenIdentifier: token(id) });
  return { t, as };
}

describe('coversIdentityCheck', () => {
  test('only notices from the identity-check version onward cover it', () => {
    expect(coversIdentityCheck(BIOMETRIC_CONSENT_VERSION)).toBe(true);
    expect(coversIdentityCheck('biometric-notice-2027-01-15')).toBe(true);
    expect(coversIdentityCheck('biometric-notice-2026-06-08')).toBe(false);
    expect(coversIdentityCheck(undefined)).toBe(false);
    expect(coversIdentityCheck(null)).toBe(false);
  });
});

describe('users.hasIdentityCheckConsent', () => {
  test('false until consent, true once the current notice is accepted', async () => {
    const { as } = setup();
    const user = as('u1');
    expect(await user.query(api.users.hasIdentityCheckConsent, {})).toBe(false);
    await user.mutation(api.users.recordBiometricConsent, {});
    expect(await user.query(api.users.hasIdentityCheckConsent, {})).toBe(true);
  });

  test('an older notice keeps 3D consent but not the identity check', async () => {
    const { t, as } = setup();
    await t.run(async (ctx) => {
      await ctx.db.insert('users', {
        tokenIdentifier: token('old'), clerkId: 'old', credits: 0,
        biometricConsentAt: 1, biometricConsentVersion: 'biometric-notice-2026-06-08',
      });
    });
    const user = as('old');
    expect(await user.query(api.users.hasBiometricConsent, {})).toBe(true);
    expect(await user.query(api.users.hasIdentityCheckConsent, {})).toBe(false);
  });

  test('signed-out callers have no consent', async () => {
    const { t } = setup();
    expect(await t.query(api.users.hasIdentityCheckConsent, {})).toBe(false);
  });
});
