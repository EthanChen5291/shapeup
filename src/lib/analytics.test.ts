// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted so the vi.mock factory (also hoisted) can safely reference these.
const { captureMock, initMock, state } = vi.hoisted(() => ({
  captureMock: vi.fn(),
  initMock: vi.fn(),
  state: { loaded: false },
}));

vi.mock('posthog-js', () => ({
  default: {
    capture: captureMock,
    init: (...a: unknown[]) => { initMock(...a); state.loaded = true; },
    get __loaded() {
      return state.loaded;
    },
  },
}));

import { track } from './analytics';
import { resetPostHogClientForTests } from './posthogClient';

const flush = () => new Promise(r => setTimeout(r, 0));

describe('track', () => {
  beforeEach(() => {
    captureMock.mockReset();
    initMock.mockReset();
    state.loaded = false;
    resetPostHogClientForTests();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('no-ops when PostHog is not configured (no key)', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    track('project_created');
    await flush();
    expect(initMock).not.toHaveBeenCalled();
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('loads PostHog on demand and captures the event with its props', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    track('purchase_completed', { source: 'dashboard' });
    await vi.waitFor(() => expect(captureMock).toHaveBeenCalledWith('purchase_completed', { source: 'dashboard' }));
    expect(initMock).toHaveBeenCalledTimes(1);
  });

  it('never throws if capture blows up', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    captureMock.mockImplementationOnce(() => {
      throw new Error('network down');
    });
    expect(() => track('refund_requested')).not.toThrow();
    await vi.waitFor(() => expect(captureMock).toHaveBeenCalled());
  });
});
