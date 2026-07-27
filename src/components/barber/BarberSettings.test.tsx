// @vitest-environment jsdom

// The settings gear, tested where it makes decisions: what the panel writes
// (and to which mutation), what it refuses to write when the card isn't ready
// for it, and that the popover closes the way a popover has to. Convex, Clerk
// and the settings context are stubbed the same way as BarberDashboard.test.tsx.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConvexError } from 'convex/values';

vi.mock('@convex/_generated/api', () => ({
  api: {
    barberPages: {
      getMine: 'barberPages:getMine',
      setPublished: 'barberPages:setPublished',
      setBookingEnabled: 'barberPages:setBookingEnabled',
    },
  },
}));

const setPublishedMock = vi.fn(async () => null);
const setBookingEnabledMock = vi.fn(async () => null);
const queryResults: Record<string, unknown> = {};

vi.mock('convex/react', () => ({
  useQuery: (ref: string) => queryResults[ref],
  useMutation: (ref: string) =>
    ref === 'barberPages:setPublished'
      ? setPublishedMock
      : ref === 'barberPages:setBookingEnabled'
        ? setBookingEnabledMock
        : vi.fn(async () => null),
}));

const signOutMock = vi.fn();
vi.mock('@clerk/nextjs', () => ({ useClerk: () => ({ signOut: signOutMock }) }));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const updateLanguageMock = vi.fn();
const updateClock24Mock = vi.fn();
const updateAiTrainingOptOutMock = vi.fn();
const settings = { language: 'en', clock24: false, aiTrainingOptOut: false };
vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({
    ...settings,
    updateLanguage: updateLanguageMock,
    updateClock24: updateClock24Mock,
    updateAiTrainingOptOut: updateAiTrainingOptOutMock,
  }),
  clockHour12: (clock24: boolean) => (clock24 ? false : undefined),
}));

import BarberSettings from './BarberSettings';

/** A saved, published card with hours on it. */
const CARD = {
  slug: 'marcus',
  published: true,
  booking: { enabled: true, timezone: 'America/Los_Angeles', slotMinutes: 30, days: [{ day: 1, start: '09:00', end: '17:00' }] },
};

function openPanel() {
  render(<BarberSettings />);
  fireEvent.click(screen.getByLabelText('Settings'));
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(queryResults)) delete queryResults[key];
  settings.language = 'en';
  settings.clock24 = false;
  settings.aiTrainingOptOut = false;
});
afterEach(cleanup);

describe('the gear', () => {
  test('opens and closes the panel, and Escape closes it', () => {
    queryResults['barberPages:getMine'] = CARD;
    render(<BarberSettings />);
    const gear = screen.getByLabelText('Settings');

    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(gear);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(gear);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('is drawn as a cog, not a sun', () => {
    queryResults['barberPages:getMine'] = CARD;
    render(<BarberSettings />);
    const paths = screen.getByLabelText('Settings').querySelectorAll('path');
    expect(paths).toHaveLength(1);
    // A sun is a hub plus eight straight rays; the cog body is one closed,
    // curved outline. Straight-line-only means the sun came back.
    const d = paths[0].getAttribute('d') ?? '';
    expect(d).toMatch(/[aA]/);
  });
});

describe('language and clock', () => {
  test('a language chip writes the language', () => {
    queryResults['barberPages:getMine'] = CARD;
    openPanel();
    fireEvent.click(screen.getByText('ES'));
    expect(updateLanguageMock).toHaveBeenCalledWith('es');
  });

  test('the clock segment writes 24h and back', () => {
    queryResults['barberPages:getMine'] = CARD;
    openPanel();
    fireEvent.click(screen.getByText('24h'));
    expect(updateClock24Mock).toHaveBeenCalledWith(true);

    fireEvent.click(screen.getByText('12h'));
    expect(updateClock24Mock).toHaveBeenCalledWith(false);
  });

  test('the active choice is the pressed one', () => {
    queryResults['barberPages:getMine'] = CARD;
    settings.clock24 = true;
    openPanel();
    expect(screen.getByText('24h')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('12h')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('the card switches', () => {
  test('live reflects the card and flips it the other way', () => {
    queryResults['barberPages:getMine'] = CARD;
    openPanel();
    const live = screen.getByRole('switch', { name: 'Card is live' });
    expect(live).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(live);
    expect(setPublishedMock).toHaveBeenCalledWith({ published: false });
  });

  test('appointments flips only the enabled flag', () => {
    queryResults['barberPages:getMine'] = CARD;
    openPanel();
    fireEvent.click(screen.getByRole('switch', { name: 'Taking appointments' }));
    expect(setBookingEnabledMock).toHaveBeenCalledWith({ enabled: false });
  });

  test('with no hours configured, appointments is disabled and says why', () => {
    queryResults['barberPages:getMine'] = { slug: 'marcus', published: true, booking: undefined };
    openPanel();
    const booking = screen.getByRole('switch', { name: 'Taking appointments' });
    expect(booking).toBeDisabled();
    expect(screen.getByText('Set working hours on your card first')).toBeInTheDocument();

    fireEvent.click(booking);
    expect(setBookingEnabledMock).not.toHaveBeenCalled();
  });

  test('with no card at all, both card switches are disabled', () => {
    queryResults['barberPages:getMine'] = null;
    openPanel();
    expect(screen.getByRole('switch', { name: 'Card is live' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Taking appointments' })).toBeDisabled();
    // The model opt-out is an account setting, so it works with no card.
    expect(screen.getByRole('switch', { name: 'Improve the model' })).not.toBeDisabled();
  });

  test('a rejected write surfaces the server’s reason in place', async () => {
    queryResults['barberPages:getMine'] = CARD;
    setPublishedMock.mockRejectedValueOnce(new ConvexError('That card is gone.'));
    openPanel();
    fireEvent.click(screen.getByRole('switch', { name: 'Card is live' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('That card is gone.'));
    // The panel stays open so the barber can see what happened.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('the model opt-out', () => {
  test('reads as on when the barber has NOT opted out, and toggling opts out', () => {
    queryResults['barberPages:getMine'] = CARD;
    openPanel();
    const improve = screen.getByRole('switch', { name: 'Improve the model' });
    expect(improve).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(improve);
    expect(updateAiTrainingOptOutMock).toHaveBeenCalledWith(true);
  });
});

describe('leaving', () => {
  test('sign out is available (shop tablets are shared)', () => {
    queryResults['barberPages:getMine'] = CARD;
    openPanel();
    fireEvent.click(screen.getByText('Sign out'));
    expect(signOutMock).toHaveBeenCalled();
  });
});
