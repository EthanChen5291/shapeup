import { describe, expect, test } from 'vitest';
import { BUILD_BUSY_ERROR, userFacingError } from './userFacingError';

describe('userFacingError', () => {
  test('passes through user-written 4xx messages', () => {
    expect(userFacingError(422, 'Blocked by content filters.', BUILD_BUSY_ERROR)).toBe('Blocked by content filters.');
    expect(userFacingError(429, 'Slow down.', BUILD_BUSY_ERROR)).toBe('Slow down.');
  });

  test('hides 5xx internals, timeouts, and network failures', () => {
    expect(userFacingError(502, 'FaceLift server unavailable (primary: HTTP 404: <html>)', BUILD_BUSY_ERROR)).toBe(BUILD_BUSY_ERROR);
    expect(userFacingError(504, 'An error occurred with your deployment FUNCTION_INVOCATION_TIMEOUT', BUILD_BUSY_ERROR)).toBe(BUILD_BUSY_ERROR);
    expect(userFacingError(null, 'Failed to fetch', BUILD_BUSY_ERROR)).toBe(BUILD_BUSY_ERROR);
  });

  test('falls back when a 4xx has no usable message or is an auth failure', () => {
    expect(userFacingError(400, undefined, BUILD_BUSY_ERROR)).toBe(BUILD_BUSY_ERROR);
    expect(userFacingError(400, '   ', BUILD_BUSY_ERROR)).toBe(BUILD_BUSY_ERROR);
    expect(userFacingError(401, 'Convex auth token unavailable', BUILD_BUSY_ERROR)).toBe(BUILD_BUSY_ERROR);
  });
});
