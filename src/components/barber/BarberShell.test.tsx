// @vitest-environment jsdom

// The shell, tested where it makes decisions: children render only for a
// signed-in barber, the signed-out panel routes into the card builder, and
// the chair stays one tap away. The tab row is gone — the dashboard was
// removed and the chair is the app — so what's left to defend is the gate.
// Convex, Clerk and the settings context are stubbed the same way as
// BarberSettings.test.tsx.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@convex/_generated/api', () => ({
  api: {
    barberPages: {
      getMine: 'barberPages:getMine',
      setPublished: 'barberPages:setPublished',
      setBookingEnabled: 'barberPages:setBookingEnabled',
    },
  },
}));
vi.mock('convex/react', () => ({
  useQuery: () => undefined,
  useMutation: () => vi.fn(async () => null),
}));

let signedIn = true;
vi.mock('@clerk/nextjs', () => ({
  useUser: () => ({ isSignedIn: signedIn, isLoaded: true }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/SignUpWidget', () => ({
  default: () => <div data-testid="signup-widget" />,
}));

vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({
    language: 'en',
    clock24: false,
    aiTrainingOptOut: false,
    updateLanguage: vi.fn(),
    updateClock24: vi.fn(),
    updateAiTrainingOptOut: vi.fn(),
  }),
  clockHour12: () => undefined,
}));

import BarberShell from './BarberShell';

beforeEach(() => {
  signedIn = true;
});
afterEach(cleanup);

describe('BarberShell', () => {
  test('renders the page for a signed-in barber, with the chair one tap away', () => {
    render(<BarberShell>panel</BarberShell>);
    expect(screen.getByText('panel')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open the chair/i })).toHaveAttribute(
      'href',
      '/chair',
    );
  });

  test('signed out, the page never renders — the gate offers the sign-in instead', () => {
    signedIn = false;
    render(<BarberShell>panel</BarberShell>);
    expect(screen.queryByText('panel')).not.toBeInTheDocument();
    expect(screen.getByTestId('signup-widget')).toBeInTheDocument();
    expect(screen.getByText(/your barber card/i)).toBeInTheDocument();
  });

  test('there is no tab row any more — the dashboard is gone', () => {
    render(<BarberShell>panel</BarberShell>);
    expect(screen.queryByRole('link', { name: /^today$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^insights$/i })).not.toBeInTheDocument();
  });
});
