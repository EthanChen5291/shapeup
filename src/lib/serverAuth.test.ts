import { describe, expect, it, vi } from 'vitest';

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }));

import { getConvexToken, type ClerkSession } from './serverAuth';

const session = (getToken: () => Promise<string | null>) => ({ userId: 'user_1', getToken } as unknown as NonNullable<ClerkSession>);

describe('getConvexToken', () => {
  it('returns the token on the happy path', async () => {
    const r = await getConvexToken(session(async () => 'tok'), { delayMs: 0 });
    expect(r).toEqual({ token: 'tok', response: null });
  });

  it('retries once when Clerk’s API fails transiently', async () => {
    const getToken = vi.fn().mockRejectedValueOnce(new Error('api_response_error')).mockResolvedValueOnce('tok');
    const r = await getConvexToken(session(getToken), { delayMs: 0 });
    expect(r.token).toBe('tok');
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('answers 503 with Retry-After when it keeps failing, instead of throwing', async () => {
    const getToken = vi.fn().mockRejectedValue(new Error('api_response_error'));
    const r = await getConvexToken(session(getToken), { delayMs: 0 });
    expect(r.token).toBeNull();
    expect(r.response?.status).toBe(503);
    expect(r.response?.headers.get('Retry-After')).toBe('2');
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('answers 401 when there is no token for the session', async () => {
    const r = await getConvexToken(session(async () => null), { delayMs: 0 });
    expect(r.response?.status).toBe(401);
  });
});
