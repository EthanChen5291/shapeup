// @vitest-environment jsdom

// The shell, tested where it makes decisions about the tab row: which tab a
// URL belongs to (it frames nested pages too, so the answer can't be a prop),
// and that a tap lights the pill immediately instead of waiting for the next
// route — the thing that made switching tabs feel dropped. Convex, Clerk and
// the settings context are stubbed the same way as BarberSettings.test.tsx.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

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

vi.mock('@clerk/nextjs', () => ({
  useUser: () => ({ isSignedIn: true, isLoaded: true }),
  useClerk: () => ({ signOut: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

let pathname = '/barber';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

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

import BarberShell, { tabForPath } from './BarberShell';

const tab = (label: string) => screen.getByRole('link', { name: label });

beforeEach(() => {
  pathname = '/barber';
});
afterEach(cleanup);

describe('tabForPath', () => {
  test('exact routes light their own tab', () => {
    expect(tabForPath('/barber')).toBe('today');
    expect(tabForPath('/barber/calendar')).toBe('calendar');
    expect(tabForPath('/barber/card')).toBe('card');
    expect(tabForPath('/barber/insights')).toBe('insights');
  });

  // The longest match has to win, or every nested page falls back to Today.
  test('a nested client profile still lights Clients', () => {
    expect(tabForPath('/barber/clients/abc123')).toBe('clients');
  });

  test('an unknown path falls back to Today', () => {
    expect(tabForPath('/barber/nowhere')).toBe('today');
    expect(tabForPath(null)).toBe('today');
  });
});

describe('BarberShell tabs', () => {
  test('marks the current route as the page', () => {
    pathname = '/barber/clients/abc123';
    render(<BarberShell>panel</BarberShell>);
    expect(tab('Clients')).toHaveAttribute('aria-current', 'page');
    expect(tab('Today')).not.toHaveAttribute('aria-current');
  });

  test('a tap lights the tapped tab before the route changes', () => {
    render(<BarberShell>panel</BarberShell>);
    fireEvent.click(tab('Insights'), { button: 0 });

    // Pathname hasn't moved — the highlight has.
    expect(tab('Insights').className).toContain('is-on');
    expect(tab('Insights').className).toContain('is-pending');
    expect(tab('Today').className).not.toContain('is-on');
    // ...but "where you actually are" stays honest until it lands.
    expect(tab('Today')).toHaveAttribute('aria-current', 'page');
  });

  test('opening a tab in a new window leaves the highlight alone', () => {
    render(<BarberShell>panel</BarberShell>);
    fireEvent.click(tab('Insights'), { button: 0, metaKey: true });

    expect(tab('Insights').className).not.toContain('is-on');
    expect(tab('Today').className).toContain('is-on');
  });
});
