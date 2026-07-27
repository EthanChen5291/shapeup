// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { HAIRSTYLES } from '@/data/hairstyles';

const recordEventMock = vi.fn(() => Promise.resolve(null));
vi.mock('convex/react', () => ({ useMutation: () => recordEventMock }));
vi.mock('@convex/_generated/api', () => ({
  api: { barberPages: { recordEvent: 'barberPages:recordEvent' } },
}));

const barberTryOnPropsSpy = vi.fn();
vi.mock('@/components/BarberLiveTryOn', () => ({
  default: (props: {
    cut: { label: string };
    barberSlug: string;
    referralCode?: string;
    onCutChange?: (cut: { label: string; slug: string }) => void;
  }) => {
    barberTryOnPropsSpy(props);
    return (
      <div data-testid="barber-tryon-stub">
        {props.cut.label}
        <button
          type="button"
          onClick={() => props.onCutChange?.({ label: 'blowout taper', slug: 'blowout-taper' })}
        >
          steer-to-blowout
        </button>
      </div>
    );
  },
}));

const barberBookingPropsSpy = vi.fn();
vi.mock('@/components/BarberBooking', () => ({
  default: (props: { slug: string; cutLabel?: string; preview?: boolean }) => {
    barberBookingPropsSpy(props);
    return <div data-testid="barber-booking-stub" />;
  },
}));

const { default: BarberCard } = await import('./BarberCard');

const PAGE = {
  slug: 'marcus',
  displayName: 'Marcus Rivera',
  shopName: 'Fade Theory',
  bio: 'Ten years on Telegraph Ave.',
  avatarUrl: 'https://images.example.com/marcus.jpg',
  location: 'Oakland, CA',
  hours: 'Tue–Sat · 10–7',
  services: [
    { name: 'Cut', price: '$45' },
    { name: 'Cut + beard', price: '$65' },
  ],
  referralCode: 'ABC123',
  links: [
    { kind: 'booking', label: 'Book an appointment', url: 'https://booksy.com/marcus' },
    { kind: 'venmo', label: 'Venmo', url: 'https://venmo.com/u/marcus' },
  ],
  styles: ['burst-fade-textured-fringe', 'blowout-taper'],
};

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('BarberCard', () => {
  it('strictly separates barber information from the ShapeUp experience', () => {
    const { container } = render(<BarberCard page={PAGE} />);
    const barberSide = container.querySelector('.bc-side');
    const experienceSide = container.querySelector('.bc-exp');
    expect(barberSide).not.toBeNull();
    expect(experienceSide).not.toBeNull();

    const barber = within(barberSide as HTMLElement);
    const experience = within(experienceSide as HTMLElement);
    expect(barber.getByRole('heading', { level: 1, name: 'Marcus Rivera' })).toBeInTheDocument();
    expect(barber.getByText('Fade Theory')).toBeInTheDocument();
    expect(barber.getByText('Oakland, CA')).toBeInTheDocument();
    expect(barber.getByText('Cut + beard')).toBeInTheDocument();
    expect(barber.getByRole('link', { name: /Book an appointment/ })).toBeInTheDocument();
    expect(barber.queryByTestId('barber-tryon-stub')).not.toBeInTheDocument();

    expect(experience.getByTestId('barber-tryon-stub')).toBeInTheDocument();
    expect(experience.queryByText('Marcus Rivera')).not.toBeInTheDocument();
    expect(experience.queryByText('Cut + beard')).not.toBeInTheDocument();
  });

  it('mounts the live mirror directly — no choice screen, trim branch, or orbit detour', () => {
    render(<BarberCard page={PAGE} />);
    expect(screen.getByTestId('barber-tryon-stub')).toBeInTheDocument();
    expect(screen.queryByText('What are we doing today?')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Just doing a trim.' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show me my best hairstyles' })).not.toBeInTheDocument();
    expect(document.querySelector('.bc-orbit')).toBeNull();
  });

  it('opens on the barber’s first pick and hands the flow both shelves', () => {
    render(<BarberCard page={PAGE} />);
    const props = barberTryOnPropsSpy.mock.calls[0][0] as {
      cut: { slug: string };
      barberPicks: { slug: string }[];
      menuCuts: { slug: string }[];
    };
    expect(props.cut.slug).toBe('burst-fade-textured-fringe');
    // The barber's own picks, in their order — including the one on screen, so
    // the live chips don't renumber themselves when the client steers away.
    expect(props.barberPicks.map((cut) => cut.slug)).toEqual([
      'burst-fade-textured-fringe',
      'blowout-taper',
    ]);
    expect(props.menuCuts.length).toBeGreaterThan(props.barberPicks.length);
    expect(barberTryOnPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        barberSlug: 'marcus',
        barberName: 'Marcus Rivera',
        referralCode: 'ABC123',
        bookingUrl: 'https://booksy.com/marcus',
      }),
    );
  });

  it('drops invalid recommendations and falls back to the menu when none survive', () => {
    render(
      <BarberCard page={{ ...PAGE, styles: ['blowout-taper', 'not-a-real-cut'] }} />,
    );
    let props = barberTryOnPropsSpy.mock.calls[0][0] as { barberPicks: { slug: string }[] };
    expect(props.barberPicks.map((cut) => cut.slug)).toEqual(['blowout-taper']);

    cleanup();
    barberTryOnPropsSpy.mockClear();
    render(<BarberCard page={{ ...PAGE, styles: [] }} />);
    props = barberTryOnPropsSpy.mock.calls[0][0] as {
      barberPicks: { slug: string }[];
      cut: { slug: string };
    };
    expect(props.barberPicks).toEqual([]);
    expect(props.cut.slug).toBe(HAIRSTYLES[0].slug);
  });

  it('contains none of the removed promotional copy, prebaked videos, or legacy assets', () => {
    const { container } = render(<BarberCard page={PAGE} />);
    expect(screen.queryByText(/FREE — NO APP/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Shop your next cut on your own head.')).not.toBeInTheDocument();
    expect(container.querySelector('video')).toBeNull();
    expect(container.innerHTML).not.toContain('landing_face2');
  });

  it('records view, link, and booking events', () => {
    render(<BarberCard page={PAGE} />);
    expect(recordEventMock).toHaveBeenCalledWith({ slug: 'marcus', kind: 'view' });

    fireEvent.click(screen.getByRole('link', { name: /Book an appointment/ }));
    expect(recordEventMock).toHaveBeenCalledWith({ slug: 'marcus', kind: 'linkClick', cutSlug: undefined });
    expect(recordEventMock).toHaveBeenCalledWith({ slug: 'marcus', kind: 'bookingClick', cutSlug: undefined });
  });

  it('renders the native scheduler on the barber side when booking is on', () => {
    const BOOKED_PAGE = {
      ...PAGE,
      booking: {
        timezone: 'America/Los_Angeles',
        slotMinutes: 30,
        days: [{ day: 2, start: '09:00', end: '18:00' }],
      },
    };
    const { container } = render(<BarberCard page={BOOKED_PAGE} />);
    expect(
      container.querySelector('.bc-side [data-testid="barber-booking-stub"]'),
    ).not.toBeNull();
    expect(barberBookingPropsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'marcus', barberName: 'Marcus Rivera', preview: false }),
    );
  });

  it('carries the cut on screen into the native booking', () => {
    const BOOKED_PAGE = {
      ...PAGE,
      booking: {
        timezone: 'America/Los_Angeles',
        slotMinutes: 30,
        days: [{ day: 2, start: '09:00', end: '18:00' }],
      },
    };
    render(<BarberCard page={BOOKED_PAGE} />);
    fireEvent.click(screen.getByRole('button', { name: 'steer-to-blowout' }));
    expect(barberBookingPropsSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ cutLabel: 'blowout taper' }),
    );
  });

  it('hides the scheduler when the barber has not enabled booking', () => {
    render(<BarberCard page={PAGE} />);
    expect(screen.queryByTestId('barber-booking-stub')).not.toBeInTheDocument();
  });

  it('keeps the builder preview inert: a static lookbook, no live flow, no counters', () => {
    const { container } = render(<BarberCard page={PAGE} preview />);
    // The live flow (sign-in, camera) has no business inside the builder frame.
    expect(screen.queryByTestId('barber-tryon-stub')).not.toBeInTheDocument();
    expect(screen.getByText('Barber’s picks')).toBeInTheDocument();
    expect(container.querySelectorAll('.bc-tile')).toHaveLength(2);
    fireEvent.click(screen.getByRole('link', { name: /Venmo/ }));
    expect(recordEventMock).not.toHaveBeenCalled();
    expect(container.querySelector('.bc-root')).toHaveClass('is-embedded');
  });

  it('offers a taste of the menu in the preview when the barber has no picks', () => {
    const { container } = render(<BarberCard page={{ ...PAGE, styles: [] }} preview />);
    expect(screen.getByText('From the menu')).toBeInTheDocument();
    expect(container.querySelectorAll('.bc-tile')).toHaveLength(8);
  });
});
