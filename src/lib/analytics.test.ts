// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted so the vi.mock factory (also hoisted) can safely reference these.
const { captureMock, state } = vi.hoisted(() => ({
  captureMock: vi.fn(),
  state: { loaded: false },
}));

vi.mock('posthog-js', () => ({
  default: {
    capture: captureMock,
    get __loaded() {
      return state.loaded;
    },
  },
}));

import { track } from './analytics';

describe('track', () => {
  beforeEach(() => {
    captureMock.mockReset();
    state.loaded = false;
  });

  it('no-ops when PostHog is not initialized', () => {
    track('take_started');
    expect(captureMock).not.toHaveBeenCalled();
  });

  it('captures the event with props once PostHog is loaded', () => {
    state.loaded = true;
    track('take_completed', { surface: 'chair', resteerCount: 2 });
    expect(captureMock).toHaveBeenCalledWith('take_completed', { surface: 'chair', resteerCount: 2 });
  });

  it('never throws if capture blows up', () => {
    state.loaded = true;
    captureMock.mockImplementationOnce(() => {
      throw new Error('network down');
    });
    expect(() => track('take_refused')).not.toThrow();
  });
});
