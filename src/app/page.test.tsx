// @vitest-environment jsdom

// The front door: / sends everyone to /chair — the chair's own gate shows the
// sign-in panel or Lucy's name form — except when the prod waitlist holds the
// door. Convex and Clerk are stubbed the same way as barber/card/page.test.tsx.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

vi.mock('@convex/_generated/api', () => ({
  api: { users: { getOrCreate: 'users:getOrCreate', getMe: 'users:getMe' } },
}));

vi.mock('convex/react', () => ({
  useQuery: () => undefined,
  useMutation: () => vi.fn(async () => null),
}));

const mockAuth = { isSignedIn: false, isLoaded: true };
vi.mock('@clerk/nextjs', () => ({ useUser: () => mockAuth }));

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
}));

vi.mock('@/components/WaitlistPage', () => ({
  WaitlistPage: () => <div data-testid="waitlist-page" />,
}));

vi.mock('@/lib/referral', () => ({
  captureReferralFromUrl: vi.fn(),
  clearPendingReferralCode: vi.fn(),
  getPendingReferralCode: () => undefined,
}));

import Home from './page';

beforeEach(() => {
  replace.mockClear();
  mockAuth.isSignedIn = false;
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

test('signed-out visitors are sent to the chair, not a pitch page', async () => {
  vi.stubEnv('NEXT_PUBLIC_WAITLIST_MODE', '0');
  const { container } = render(<Home />);
  await act(async () => {});

  expect(replace).toHaveBeenCalledWith('/chair');
  // / renders nothing itself — the chair owns the first paint.
  expect(container.textContent).toBe('');
});

test('signed-in barbers land on the chair too', async () => {
  vi.stubEnv('NEXT_PUBLIC_WAITLIST_MODE', '0');
  mockAuth.isSignedIn = true;
  render(<Home />);
  await act(async () => {});

  expect(replace).toHaveBeenCalledWith('/chair');
});

test('waitlist mode holds the front door instead of redirecting', async () => {
  vi.stubEnv('NEXT_PUBLIC_WAITLIST_MODE', '1');
  // The gate treats development as a target domain, but vitest runs with
  // NODE_ENV=test — stub it so the gate engages like it does under `next dev`.
  vi.stubEnv('NODE_ENV', 'development');
  render(<Home />);
  await act(async () => {});

  expect(screen.getByTestId('waitlist-page')).toBeDefined();
  expect(replace).not.toHaveBeenCalled();
});
