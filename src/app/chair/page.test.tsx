// @vitest-environment jsdom

// The chair's front gate: signed-out visitors get a chair-styled sign-in —
// just the "Sign in" title and the widget, scaled up for the tablet on the
// counter — signed-in barbers get the station, and the skeleton holds the
// layout while Clerk resolves.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const mockAuth = { isSignedIn: false, isLoaded: true };
vi.mock('@clerk/nextjs', () => ({ useUser: () => mockAuth }));

const widgetProps: Array<Record<string, unknown>> = [];
vi.mock('@/components/SignUpWidget', () => ({
  default: (props: Record<string, unknown>) => {
    widgetProps.push(props);
    return <div data-testid="signup-widget" />;
  },
}));
vi.mock('@/components/chair/ChairStation', () => ({
  default: () => <div data-testid="chair-station" />,
}));
vi.mock('@/components/chair/ChairSkeleton', () => ({
  default: () => <div data-testid="chair-skeleton" />,
}));

import ChairPage from './page';

beforeEach(() => {
  widgetProps.length = 0;
  mockAuth.isSignedIn = false;
  mockAuth.isLoaded = true;
});

afterEach(cleanup);

test('signed out: just "Sign in" and the scaled-up widget', () => {
  render(<ChairPage />);

  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sign in');
  // The old explainer sentence is gone — the title carries the whole ask.
  expect(document.body.textContent).not.toContain('barber account');

  expect(screen.getByTestId('signup-widget')).toBeDefined();
  expect(widgetProps[0]).toMatchObject({ scale: 1.25, redirectUrlComplete: '/chair', credentialsOnly: true });

  // The "Set up a barber card first" door is gone — the gate is sign-in only.
  expect(document.querySelector('a[href="/barber/card"]')).toBeNull();
});

test('signed in: the station, no gate', () => {
  mockAuth.isSignedIn = true;
  render(<ChairPage />);

  expect(screen.getByTestId('chair-station')).toBeDefined();
  expect(screen.queryByTestId('signup-widget')).toBeNull();
});

test('while Clerk resolves: the skeleton holds the layout', () => {
  mockAuth.isLoaded = false;
  render(<ChairPage />);

  expect(screen.getByTestId('chair-skeleton')).toBeDefined();
});
