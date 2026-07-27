import { describe, expect, test } from 'vitest';
import { ConvexError } from 'convex/values';
import { convexErrorData, presentableError } from './errors';

describe('presentableError', () => {
  test('surfaces a ConvexError thrown with a bare string', () => {
    const err = new ConvexError('That name is taken.');
    expect(presentableError(err, 'fallback')).toBe('That name is taken.');
  });

  test('surfaces the message of a ConvexError thrown with { code, message }', () => {
    const err = new ConvexError({ code: 'out_of_credits', message: 'You’re out for this month.' });
    expect(presentableError(err, 'fallback')).toBe('You’re out for this month.');
  });

  test('never shows a plain Error message — prod redacts it to junk', () => {
    const err = new Error('[CONVEX M(chair:startTake)] [Request ID: abc123] Server Error');
    expect(presentableError(err, 'Couldn’t start that take.')).toBe('Couldn’t start that take.');
  });

  test('falls back on non-errors and empty messages', () => {
    expect(presentableError('boom', 'fallback')).toBe('fallback');
    expect(presentableError(new ConvexError({ message: '  ' }), 'fallback')).toBe('fallback');
    expect(presentableError(undefined, 'fallback')).toBe('fallback');
  });

  test('convexErrorData exposes code and retryAfterSeconds for typed handling', () => {
    const err = new ConvexError({ code: 'rate_limited', message: 'Slow down.', retryAfterSeconds: 42 });
    expect(convexErrorData(err)).toEqual({ code: 'rate_limited', message: 'Slow down.', retryAfterSeconds: 42 });
    expect(convexErrorData(new Error('x'))).toBeNull();
  });
});
