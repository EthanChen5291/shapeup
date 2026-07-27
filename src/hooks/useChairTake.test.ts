// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { refusalMessage, useChairTake } from './useChairTake';
import type { LucySessionOptions } from '@/lib/lucy/session';

const h = vi.hoisted(() => ({
  finishTakeMock: vi.fn(async () => null),
  sessionOptions: { current: null as unknown },
  startTakeRecordingMock: vi.fn(),
}));

vi.mock('convex/react', () => ({
  useMutation: (ref: string) =>
    ref === 'chair:finishTake' ? h.finishTakeMock : vi.fn(async () => null),
}));
vi.mock('@convex/_generated/api', () => ({
  api: { chair: { finishTake: 'chair:finishTake' } },
}));
vi.mock('@/hooks/useConvexUpload', () => ({
  useConvexUpload: () => vi.fn(async () => ({ storageId: 'storage_1', url: 'https://storage.test/x' })),
}));
vi.mock('@/lib/lucy/session', () => ({
  createLucySession: vi.fn((options: unknown) => {
    h.sessionOptions.current = options;
    return { setPrompt: vi.fn(), close: vi.fn(), status: 'connecting' };
  }),
}));
vi.mock('@/lib/lucy/recorder', () => ({
  startTakeRecording: h.startTakeRecordingMock,
}));

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

// The budget claimed at startTake has to come back when the session dies
// before a single frame arrived — and must NOT be reported here once the
// recorder exists, because from that point the recorder path owns the report.
describe('startTake budget reporting', () => {
  const startArgs = { clientId: 'client_1' as never, cutLabel: 'Fade', prompt: 'p' };

  beforeEach(() => {
    h.finishTakeMock.mockClear();
    h.sessionOptions.current = null;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 200,
        json: async () => ({
          ok: true,
          token: 'TOKEN',
          takeId: 'take_1',
          maxSeconds: 30,
          takesLeftToday: 3,
        }),
      })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const sessionOpts = () => h.sessionOptions.current as LucySessionOptions;

  test('a session that dies before the first frame reports zero, refunding the claim', async () => {
    const { result } = renderHook(() => useChairTake());
    let finished: unknown = 'unset';
    await act(async () => {
      const take = result.current.startTake(startArgs);
      await waitFor(() => expect(h.sessionOptions.current).not.toBeNull());
      sessionOpts().onError!('The live connection dropped. Start the take again.');
      finished = await take;
    });
    expect(finished).toBeNull();
    expect(h.finishTakeMock).toHaveBeenCalledWith({ takeId: 'take_1', durationMs: 0 });
    expect(result.current.error).toBe('The live connection dropped. Start the take again.');
  });

  test('an error after the first frame leaves the report to the recorder path', async () => {
    h.startTakeRecordingMock.mockReturnValue({
      elapsedMs: () => 0,
      stop: vi.fn(),
      cancel: vi.fn(),
      result: new Promise(() => {}),
    });
    const { result } = renderHook(() => useChairTake());
    await act(async () => {
      const take = result.current.startTake(startArgs);
      await waitFor(() => expect(h.sessionOptions.current).not.toBeNull());
      sessionOpts().onOutputStream!({} as MediaStream);
      sessionOpts().onError!('mid-take drop');
      await take;
    });
    expect(h.finishTakeMock).not.toHaveBeenCalled();
  });
});
