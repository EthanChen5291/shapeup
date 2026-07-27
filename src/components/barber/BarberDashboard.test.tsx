// @vitest-environment jsdom

// The dashboard, tested where it makes decisions: the directory's search and
// empty states, Today's "which bookings are actually today" filter and its
// handoff link into the chair, and the profile's visit strip + the two-step
// erase. Convex is stubbed per function reference, same approach as
// ChairStation.test.tsx.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@convex/_generated/api', () => ({
  api: {
    chair: {
      listClients: 'chair:listClients',
      getClient: 'chair:getClient',
      listVisits: 'chair:listVisits',
      listTakes: 'chair:listTakes',
      myCard: 'chair:myCard',
      budgetStatus: 'chair:budgetStatus',
      weekSummary: 'chair:weekSummary',
      dailySeries: 'chair:dailySeries',
      visitPulse: 'chair:visitPulse',
      updateClientNotes: 'chair:updateClientNotes',
      deleteClient: 'chair:deleteClient',
    },
    barberPages: { getMine: 'barberPages:getMine' },
    barberBooking: { listMyBookings: 'barberBooking:listMyBookings' },
  },
}));

const deleteClientMock = vi.fn(async () => ({ done: true }));
const updateNotesMock = vi.fn(async () => null);
const routerPushMock = vi.fn();

const queryResults: Record<string, unknown> = {};
vi.mock('convex/react', () => ({
  useQuery: (ref: string) => queryResults[ref],
  useMutation: (ref: string) =>
    ref === 'chair:deleteClient'
      ? deleteClientMock
      : ref === 'chair:updateClientNotes'
        ? updateNotesMock
        : vi.fn(async () => null),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock, replace: vi.fn() }),
}));

import ClientsDirectory from './ClientsDirectory';
import TodayView from './TodayView';
import ClientProfile from './ClientProfile';
import ChairInsights from './ChairInsights';
import type { Id } from '@convex/_generated/dataModel';

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(queryResults)) delete queryResults[key];
});
afterEach(cleanup);

describe('ClientsDirectory', () => {
  const roster = [
    { id: 'c1', name: 'Dre', phone: '555-0134', consented: true, createdAt: 1, lastVisitAt: Date.now() },
    { id: 'c2', name: 'Marcus T.', consented: true, createdAt: 1, lastVisitAt: Date.now() },
  ];

  test('lists every client with a link to their profile', () => {
    queryResults['chair:listClients'] = roster;
    render(<ClientsDirectory />);
    expect(screen.getByText('Dre').closest('a')).toHaveAttribute('href', '/barber/clients/c1');
    expect(screen.getByText('Marcus T.')).toBeInTheDocument();
  });

  test('search narrows by name or phone', () => {
    queryResults['chair:listClients'] = roster;
    render(<ClientsDirectory />);
    fireEvent.change(screen.getByLabelText(/search clients/i), { target: { value: '0134' } });
    expect(screen.getByText('Dre')).toBeInTheDocument();
    expect(screen.queryByText('Marcus T.')).not.toBeInTheDocument();
  });

  test('an empty book points at the chair, not at a blank table', () => {
    queryResults['chair:listClients'] = [];
    render(<ClientsDirectory />);
    expect(screen.getByText(/nobody in the chair yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open the chair/i })).toHaveAttribute('href', '/chair');
  });
});

describe('TodayView', () => {
  test("shows only today's bookings, each with a seat-in-the-chair handoff", () => {
    const today = Date.now() + 60 * 60 * 1000;
    queryResults['barberPages:getMine'] = {
      booking: { enabled: true, timezone: 'UTC', slotMinutes: 30, days: [] },
    };
    queryResults['barberBooking:listMyBookings'] = [
      { id: 'bk1', startMs: today, endMs: today + 1, clientName: 'Dre', clientPhone: '555-0134' },
      { id: 'bk2', startMs: today + 3 * 24 * 60 * 60 * 1000, endMs: 0, clientName: 'Later Guy' },
    ];
    queryResults['chair:listClients'] = [];
    render(<TodayView />);

    expect(screen.getByText('Dre')).toBeInTheDocument();
    expect(screen.queryByText('Later Guy')).not.toBeInTheDocument();
    const seat = screen.getByRole('link', { name: /seat in the chair/i });
    expect(seat.getAttribute('href')).toContain('name=Dre');
    expect(seat.getAttribute('href')).toContain('booking=bk1');
    // Icon-only — the same arrow-into-chair mark as the header button, so the
    // label lives on aria-label/title rather than in the row.
    expect(seat.querySelector('svg')).not.toBeNull();
    expect(seat.textContent).toBe('');
    expect(seat).toHaveAttribute('title', 'Seat in the chair');
  });

  test('an appointment row leads with the clock alone — no date, since it is today', () => {
    // 2026-07-27T14:30:00Z → 10:30 AM in New York.
    const at = Date.UTC(2026, 6, 27, 14, 30);
    queryResults['barberPages:getMine'] = {
      booking: { enabled: true, timezone: 'America/New_York', slotMinutes: 30, days: [] },
    };
    queryResults['barberBooking:listMyBookings'] = [
      { id: 'bk1', startMs: at, endMs: at + 1, clientName: 'Sofia Marin', service: 'Neck clean-up' },
    ];
    queryResults['chair:listClients'] = [];
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(at);
    render(<TodayView />);

    expect(screen.getByText('10:30')).toBeInTheDocument();
    expect(screen.getByText('AM')).toBeInTheDocument();
    expect(screen.getByText('Neck clean-up')).toBeInTheDocument();
    // Numerals and meridiem share one tile, so the times read as a column.
    const tile = screen.getByText('10:30').closest('.bdash-appt-clock')!;
    expect(tile).not.toBeNull();
    expect(tile.textContent).toBe('10:30AM');
    // The date lives in the page header, never in the row itself.
    expect(screen.getByText('Sofia Marin').closest('li')!.textContent).not.toMatch(/July/);
    vi.useRealTimers();
  });

  test('the page title is the actual date, not the word "Today"', () => {
    // 2026-07-27 is a Monday.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(Date.UTC(2026, 6, 27, 12, 0));
    queryResults['barberPages:getMine'] = { booking: { enabled: false } };
    queryResults['barberBooking:listMyBookings'] = [];
    queryResults['chair:listClients'] = [];
    render(<TodayView />);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Monday, July 27/);
    expect(screen.queryByRole('heading', { name: 'Today' })).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  test("the chair card charts today's traffic against a normal day", () => {
    const now = new Date();
    now.setHours(14, 0, 0, 0);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(now);
    const at = (daysAgo: number, hour: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() - daysAgo);
      d.setHours(hour, 15, 0, 0);
      return d.getTime();
    };
    queryResults['barberPages:getMine'] = { booking: { enabled: false } };
    queryResults['barberBooking:listMyBookings'] = [];
    queryResults['chair:listClients'] = [];
    queryResults['chair:visitPulse'] = [at(0, 10), at(0, 11), at(1, 10), at(2, 10), at(2, 13)];
    render(<TodayView />);

    // Two named series, so identity never rests on color alone.
    const chart = screen.getByRole('group', { name: /today vs a normal day/i });
    expect(chart).toBeInTheDocument();
    expect(screen.getByText(/2 in the chair so far — a normal day has 1.5 by now/i)).toBeInTheDocument();
    // The sr-only table carries the same numbers: at 10a, 1 today vs 1 normally.
    const tenRow = [...chart.querySelectorAll('table tbody tr')].find(
      (row) => row.querySelector('th')!.textContent === '10a',
    )!;
    expect([...tenRow.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['1', '1']);
    // Hovering an hour names both series — the crosshair, not a color guess.
    const hits = chart.querySelectorAll('.bviz-hit');
    fireEvent.pointerEnter(hits[[...chart.querySelectorAll('table tbody tr')].indexOf(tenRow)]);
    expect(screen.getByText(/Today: 1/)).toBeInTheDocument();
    expect(screen.getByText(/Normal day: 1/)).toBeInTheDocument();

    // The chair is still the way in.
    expect(screen.getByRole('link', { name: /open the chair/i })).toHaveAttribute('href', '/chair');
    vi.useRealTimers();
  });

  test('a barber with no card is pointed at setting one up first', () => {
    queryResults['barberPages:getMine'] = null;
    render(<TodayView />);
    expect(screen.getByRole('link', { name: /set up my card/i })).toHaveAttribute(
      'href',
      '/barber/card',
    );
  });
});

describe('ClientProfile', () => {
  const clientId = 'c1' as Id<'chairClients'>;

  function seed() {
    queryResults['chair:getClient'] = {
      id: 'c1',
      name: 'Dre',
      phone: '555-0134',
      consented: true,
      consentAt: Date.now() - 1000,
      fromCard: false,
      createdAt: Date.now() - 90 * 24 * 60 * 60 * 1000,
      lastVisitAt: Date.now() - 1000,
    };
    queryResults['chair:listVisits'] = [
      {
        id: 'v1',
        dayKey: '2026-07-20',
        startedAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
        note: 'went 0.5 lower than usual',
        chips: ['#2', 'Taper'],
        chosenTake: {
          id: 't1',
          cutLabel: 'blowout taper',
          cutSlug: 'blowout-taper',
          posterUrl: 'https://storage.test/p.jpg',
          angles: [{ key: 'front', url: 'https://storage.test/f.jpg' }],
        },
      },
    ];
    queryResults['chair:listTakes'] = [];
    queryResults['chair:myCard'] = { slug: 'marcus', bookingEnabled: true };
  }

  test('a visit shows the decision: cut, chips, note, and the angle strip', () => {
    seed();
    render(<ClientProfile clientId={clientId} />);
    expect(screen.getByText(/blowout taper/i)).toBeInTheDocument();
    expect(screen.getByText('#2')).toBeInTheDocument();
    expect(screen.getByText(/went 0\.5 lower/i)).toBeInTheDocument();
    expect(screen.getByAltText(/front reference for Dre/i)).toBeInTheDocument();
    // Booking is on, so rebooking is one tap from the profile.
    expect(screen.getByRole('link', { name: /book their next visit/i })).toHaveAttribute(
      'href',
      '/b/marcus',
    );
  });

  test('erasing asks first, then drains batches and leaves for the directory', async () => {
    seed();
    render(<ClientProfile clientId={clientId} />);
    fireEvent.click(screen.getByRole('button', { name: /delete this client/i }));
    expect(deleteClientMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /erase everything/i }));
    await waitFor(() => expect(deleteClientMock).toHaveBeenCalledWith({ clientId: 'c1' }));
    await waitFor(() => expect(routerPushMock).toHaveBeenCalledWith('/barber/clients'));
  });

  test('a deleted client renders a way back, not an error', () => {
    queryResults['chair:getClient'] = null;
    render(<ClientProfile clientId={clientId} />);
    expect(screen.getByText(/isn’t in your book any more/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /all clients/i })).toHaveAttribute(
      'href',
      '/barber/clients',
    );
  });
});

describe('ChairInsights stat tiles', () => {
  test('each tile in the row carries its own accent', () => {
    queryResults['chair:weekSummary'] = {
      visitsThisWeek: 12,
      clientsThisWeek: 11,
      returningThisWeek: 8,
      takesThisWeek: 13,
      approvedThisWeek: 7,
      topTried: [],
      topChosen: [],
    };
    render(<ChairInsights />);

    // Four numbers in one row only read apart if they aren't the same color:
    // no two tiles share an accent, and every accent is one the stylesheet
    // actually paints (is-a/b/c from the series palette, or plain ink).
    const accents = [...document.querySelectorAll('.barber-stat')].map(
      (tile) => [...tile.classList].find((c) => c.startsWith('is-')),
    );
    expect(accents).toHaveLength(4);
    expect(new Set(accents).size).toBe(4);
    for (const accent of accents) expect(['is-a', 'is-b', 'is-c', 'is-ink']).toContain(accent);
  });
});
