// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { refusalMessage } from './useChairTake';

// Every refusal the token route can send must land on screen as a sentence a
// client in the chair can act on — never a status code or an API label.
describe('refusalMessage', () => {
  test('the daily cap reads as "done for today", not an error', () => {
    expect(refusalMessage(429, { ok: false, reason: 'daily_cap' })).toMatch(/reset tomorrow/i);
  });

  test('the global budget reads as a pause', () => {
    expect(refusalMessage(429, { ok: false, reason: 'global_budget' })).toMatch(/paused/i);
  });

  test('the take pace limit (2 per 2 minutes) asks for a minute, in plain words', () => {
    const byCode = refusalMessage(429, { ok: false, code: 'rate_limited', retryAfterSeconds: 90 });
    expect(byCode).toBe('Two takes back-to-back — give the mirror a minute, then go again.');
    // A bare 429 with no code (older limiter shape) gets the same copy.
    expect(refusalMessage(429, { ok: false })).toBe(byCode);
  });

  test('an expired session says to sign in again', () => {
    expect(refusalMessage(401, { ok: false, error: 'Unauthenticated' })).toMatch(/sign in/i);
  });

  test('server-supplied copy passes through, and silence gets a fallback', () => {
    expect(refusalMessage(403, { ok: false, error: 'Agree to be filmed before starting a take.' }))
      .toBe('Agree to be filmed before starting a take.');
    expect(refusalMessage(500, { ok: false })).toBe('Couldn’t start that take.');
  });
});
