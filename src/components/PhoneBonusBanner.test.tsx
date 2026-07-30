// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { clerkError } from './PhoneBonusBanner';

// The one rule of clerkError: only Clerk-authored copy may pass through.
// Anything else — a network TypeError, a bare Error — gets the caller's
// fallback, so a raw JS message never lands in the phone-bonus modal.
describe('clerkError', () => {
  it('prefers a Clerk error’s longMessage', () => {
    const err = { errors: [{ longMessage: 'That phone number is already in use.', message: 'taken' }] };
    expect(clerkError(err, 'fallback')).toBe('That phone number is already in use.');
  });

  it('falls back to a Clerk error’s message when longMessage is missing', () => {
    const err = { errors: [{ message: 'Incorrect code.' }] };
    expect(clerkError(err, 'fallback')).toBe('Incorrect code.');
  });

  it('uses the caller’s fallback for a plain network error, never err.message', () => {
    expect(clerkError(new TypeError('Failed to fetch'), 'Couldn’t send the code. Try again.')).toBe(
      'Couldn’t send the code. Try again.',
    );
  });

  it('uses the fallback for undefined and empty shapes', () => {
    expect(clerkError(undefined, 'fallback')).toBe('fallback');
    expect(clerkError({ errors: [] }, 'fallback')).toBe('fallback');
  });
});
