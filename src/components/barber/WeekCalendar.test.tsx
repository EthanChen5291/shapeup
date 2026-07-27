// @vitest-environment jsdom

// Hours are edited on the card, so the calendar's only link out is the pencil —
// it lives in the grid's top-left corner cell (above the time gutter).

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@convex/_generated/api', () => ({
  api: { barberBooking: { listMyBookingsRange: 'barberBooking:listMyBookingsRange' } },
}));

let bookings: unknown = [];
vi.mock('convex/react', () => ({ useQuery: () => bookings }));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// The Clock setting (the dashboard's settings gear) drives every time label.
const settings = { language: 'en', clock24: false };
vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => settings,
  clockHour12: (clock24: boolean) => (clock24 ? false : undefined),
}));

import WeekCalendar from './WeekCalendar';

afterEach(() => {
  cleanup();
  bookings = [];
  settings.clock24 = false;
});

describe('WeekCalendar edit-hours pencil', () => {
  test('links to the card with an icon-only pencil, in the grid corner cell', () => {
    const { container } = render(
      <WeekCalendar bookingDays={[{ day: 1, start: '09:00', end: '17:00' }]} bookingEnabled />,
    );

    const edit = screen.getByLabelText('Edit hours');
    expect(edit).toHaveAttribute('href', '/barber/card');
    expect(edit.textContent).toBe(''); // icon only — no "EDIT HOURS →" text
    expect(edit.querySelector('svg')).not.toBeNull();

    // It sits inside the grid's top-left corner, not the paging toolbar.
    const corner = container.querySelector('.bcal-corner');
    expect(corner).not.toBeNull();
    expect(corner?.contains(edit)).toBe(true);
  });
});

describe('WeekCalendar appointment blocks', () => {
  const HOURS = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start: '09:00', end: '17:00' }));

  /** A booking today, `minutes` long, starting at 11:00. */
  function booking(minutes: number, over: Record<string, unknown> = {}) {
    const start = new Date();
    start.setHours(11, 0, 0, 0);
    return {
      id: `b${minutes}`,
      startMs: start.getTime(),
      endMs: start.getTime() + minutes * 60 * 1000,
      clientName: 'Mia Chen',
      service: 'Neck clean-up',
      ...over,
    };
  }

  test('a half-hour booking still names the client — it lays out on one line', () => {
    bookings = [booking(30)];
    const { container } = render(<WeekCalendar bookingDays={HOURS} bookingEnabled />);

    const block = container.querySelector('.bcal-event')!;
    // too short to stack, so it goes compact rather than clipping the name
    expect(block.className).toContain('is-compact');
    expect(block.querySelector('.bcal-event-name')?.textContent).toBe('Mia Chen');
    expect(block.querySelector('.bcal-event-time')?.textContent).toMatch(/11:00/);
  });

  test('a long booking stacks and has room for the service too', () => {
    bookings = [booking(60)];
    const { container } = render(<WeekCalendar bookingDays={HOURS} bookingEnabled />);

    const block = container.querySelector('.bcal-event')!;
    expect(block.className).not.toContain('is-compact');
    expect(block.querySelector('.bcal-event-name')?.textContent).toBe('Mia Chen');
    expect(block.querySelector('.bcal-event-service')?.textContent).toBe('Neck clean-up');
  });

  test('every block carries the full appointment in its tooltip, however short', () => {
    bookings = [booking(30)];
    const { container } = render(<WeekCalendar bookingDays={HOURS} bookingEnabled />);

    const title = container.querySelector('.bcal-event')?.getAttribute('title') ?? '';
    expect(title).toContain('Mia Chen');
    expect(title).toContain('Neck clean-up');
    expect(title).toMatch(/11:00/);
  });
});

describe('WeekCalendar expanded appointment', () => {
  const OPEN_EVERY_DAY = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start: '09:00', end: '17:00' }));

  function seat(over: Record<string, unknown> = {}) {
    const start = new Date();
    start.setHours(11, 0, 0, 0);
    return {
      id: 'bk_1',
      startMs: start.getTime(),
      endMs: start.getTime() + 30 * 60 * 1000,
      clientName: 'Mia Chen',
      clientPhone: '(510) 555-0114',
      service: 'Neck clean-up',
      note: 'a bit shorter on the sides than last time',
      ...over,
    };
  }

  test('clicking a block opens it with everything the grid had to leave out', () => {
    bookings = [seat()];
    const { container } = render(<WeekCalendar bookingDays={OPEN_EVERY_DAY} bookingEnabled />);

    fireEvent.click(container.querySelector('.bcal-event')!);

    const panel = screen.getByRole('dialog');
    expect(panel).toHaveTextContent('Mia Chen');
    expect(panel).toHaveTextContent('Neck clean-up');
    expect(panel).toHaveTextContent(/a bit shorter on the sides/);
    // the full range, not just the start the block could fit
    expect(panel).toHaveTextContent(/11:00\s*AM\s*–\s*11:30\s*AM/);
    // the phone is dialable from the tablet, punctuation stripped
    expect(screen.getByRole('link', { name: '(510) 555-0114' })).toHaveAttribute(
      'href',
      'tel:5105550114',
    );
  });

  test("today's appointment carries the way into the chair", () => {
    bookings = [seat()];
    const { container } = render(<WeekCalendar bookingDays={OPEN_EVERY_DAY} bookingEnabled />);
    fireEvent.click(container.querySelector('.bcal-event')!);

    const chair = screen.getByRole('link', { name: /seat in the chair/i });
    expect(chair.getAttribute('href')).toContain('name=Mia%20Chen');
    expect(chair.getAttribute('href')).toContain('booking=bk_1');
  });

  test('an appointment on another day expands but offers no chair', () => {
    const start = new Date();
    start.setDate(start.getDate() + (start.getDay() === 6 ? -1 : 1));
    start.setHours(11, 0, 0, 0);
    bookings = [seat({ startMs: start.getTime(), endMs: start.getTime() + 30 * 60 * 1000 })];

    const { container } = render(<WeekCalendar bookingDays={OPEN_EVERY_DAY} bookingEnabled />);
    fireEvent.click(container.querySelector('.bcal-event')!);

    expect(screen.getByRole('dialog')).toHaveTextContent('Mia Chen');
    expect(screen.queryByRole('link', { name: /seat in the chair/i })).toBeNull();
  });

  test('Escape closes it', async () => {
    bookings = [seat()];
    const { container } = render(<WeekCalendar bookingDays={OPEN_EVERY_DAY} bookingEnabled />);
    fireEvent.click(container.querySelector('.bcal-event')!);
    expect(screen.getByRole('dialog')).not.toBeNull();

    fireEvent.keyDown(window, { key: 'Escape' });
    // it shrinks back into its block first, so it leaves a beat later
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  test('a block announces that it expands, and marks itself open', () => {
    bookings = [seat()];
    const { container } = render(<WeekCalendar bookingDays={OPEN_EVERY_DAY} bookingEnabled />);
    const block = container.querySelector('.bcal-event')!;

    expect(block.tagName).toBe('BUTTON');
    expect(block).toHaveAttribute('aria-haspopup', 'dialog');
    expect(block).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(block);
    expect(container.querySelector('.bcal-event')).toHaveAttribute('aria-expanded', 'true');
    expect(container.querySelector('.bcal-event')?.className).toContain('is-open');
  });

  // The block grows into the card: the card is born on the block's own rect
  // wearing the block's styles, then lerps out to the centre — no popup
  // arriving from somewhere else with a look of its own.
  describe('growing out of the block', () => {
    /** jsdom measures nothing, so the clicked block is given a rect to sit on. */
    function stubRect(el: HTMLElement, rect: { top: number; left: number; width: number; height: number }) {
      el.getBoundingClientRect = () =>
        ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => rect }) as DOMRect;
    }

    const BLOCK = { top: 140, left: 200, width: 130, height: 32 };

    function openBlock() {
      bookings = [seat()];
      const view = render(<WeekCalendar bookingDays={OPEN_EVERY_DAY} bookingEnabled />);
      const block = view.container.querySelector('.bcal-event') as HTMLElement;
      stubRect(block, BLOCK);
      fireEvent.click(block);
      return view;
    }

    test('the card starts life on the block it came from, with its text still hidden', () => {
      openBlock();

      const panel = screen.getByRole('dialog');
      expect(panel.style.top).toBe(`${BLOCK.top}px`);
      expect(panel.style.left).toBe(`${BLOCK.left}px`);
      expect(panel.style.width).toBe(`${BLOCK.width}px`);
      expect(panel.style.height).toBe(`${BLOCK.height}px`);
      // not grown yet — the stylesheet keeps the block's radius and hides the body
      expect(panel.dataset.grown).toBe('false');
      expect(panel.querySelector('.bcal-detail-body')).not.toBeNull();
    });

    test('then it lerps out to a centred card and lets the text in', async () => {
      openBlock();

      await waitFor(() => expect(screen.getByRole('dialog').dataset.grown).toBe('true'));
      const panel = screen.getByRole('dialog');
      // centred at the card's own width, not the block's
      expect(panel.style.width).toBe('420px');
      expect(panel.style.left).toBe(`${Math.round((window.innerWidth - 420) / 2)}px`);
      // the scrim darkens on the same flip that reveals the body
      expect(document.querySelector('.bcal-detail-scrim')?.getAttribute('data-grown')).toBe('true');
    });

    test('closing shrinks it back onto the block before it leaves', async () => {
      openBlock();
      await waitFor(() => expect(screen.getByRole('dialog').dataset.grown).toBe('true'));

      fireEvent.click(screen.getByRole('button', { name: 'Close' }));

      // still on screen, on its way back down to the block's rect
      const panel = screen.getByRole('dialog');
      expect(panel.dataset.grown).toBe('false');
      expect(panel.style.top).toBe(`${BLOCK.top}px`);
      expect(panel.style.width).toBe(`${BLOCK.width}px`);

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
  });

  test('the ghosted examples are illustrations — they do not expand', () => {
    const { container } = render(<WeekCalendar bookingDays={OPEN_EVERY_DAY} bookingEnabled />);
    const ghost = container.querySelector('.bcal-event.is-sample')!;

    expect(ghost.tagName).toBe('DIV'); // not a button
    fireEvent.click(ghost);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('WeekCalendar overlapping appointments', () => {
  const HOURS = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start: '09:00', end: '17:00' }));

  /** A booking today from `hour:min`, `minutes` long. */
  function at(id: string, hour: number, min: number, minutes: number, name = id) {
    const start = new Date();
    start.setHours(hour, min, 0, 0);
    return {
      id,
      startMs: start.getTime(),
      endMs: start.getTime() + minutes * 60 * 1000,
      clientName: name,
      service: 'Basic Cut',
    };
  }

  /** The blocks of the one day column that has any. */
  function blocks(container: HTMLElement): HTMLElement[] {
    return [...container.querySelectorAll('.bcal-event')] as HTMLElement[];
  }

  test('two bookings at the same time split the column instead of stacking up', () => {
    bookings = [at('a', 10, 0, 60, 'Sarah Cant'), at('b', 10, 30, 60, 'Dana Holt')];
    const { container } = render(<WeekCalendar bookingDays={HOURS} bookingEnabled />);

    const [first, second] = blocks(container);
    // two lanes, one each, so neither draws over the other
    expect(first.dataset.lanes).toBe('2');
    expect(second.dataset.lanes).toBe('2');
    expect([first.dataset.lane, second.dataset.lane]).toEqual(['0', '1']);
    // each is given a width and its own x offset
    expect(first.style.width).not.toBe('');
    expect(second.style.width).toBe(first.style.width);
    expect(second.style.left).not.toBe(first.style.left);
    // the stylesheet pins both edges — a split block has to let go of `right`
    expect(first.style.right).toBe('auto');
    for (const b of [first, second]) expect(b.className).toContain('is-split');

    // both names stay readable rather than one drawing over the other
    expect(screen.getByText('Sarah Cant')).not.toBeNull();
    expect(screen.getByText('Dana Holt')).not.toBeNull();
  });

  test('a booking that overlaps nothing keeps the full column width', () => {
    bookings = [at('a', 10, 0, 60), at('b', 14, 0, 60)];
    const { container } = render(<WeekCalendar bookingDays={HOURS} bookingEnabled />);

    for (const b of blocks(container)) {
      expect(b.dataset.lanes).toBeUndefined();
      expect(b.style.width).toBe('');
      expect(b.style.left).toBe('');
      expect(b.className).not.toContain('is-split');
    }
  });

  test('three-deep overlap splits three ways, and a later pair only two', () => {
    bookings = [
      at('a', 10, 0, 60),
      at('b', 10, 0, 60),
      at('c', 10, 15, 30),
      at('d', 15, 0, 60),
      at('e', 15, 0, 60),
    ];
    const { container } = render(<WeekCalendar bookingDays={HOURS} bookingEnabled />);

    const lanes = blocks(container).map((b) => b.dataset.lanes);
    expect(lanes.filter((n) => n === '3')).toHaveLength(3);
    expect(lanes.filter((n) => n === '2')).toHaveLength(2);
  });

  test('a lane is reused once it is free, so a run stays as narrow as it needs', () => {
    // 10:00–11:00 beside 10:00–10:30, then 10:30–11:00 slots back into lane 1
    bookings = [at('a', 10, 0, 60), at('b', 10, 0, 30), at('c', 10, 30, 30)];
    const { container } = render(<WeekCalendar bookingDays={HOURS} bookingEnabled />);

    // two lanes, not three: 10:30 slots into the lane 10:00–10:30 just freed
    expect(blocks(container).map((b) => b.dataset.lanes)).toEqual(['2', '2', '2']);
  });

  test('a split half-hour block spends its one line on the name, not the clock', () => {
    bookings = [at('a', 10, 0, 30, 'Sarah Cant'), at('b', 10, 0, 30, 'Dana Holt')];
    const { container } = render(<WeekCalendar bookingDays={HOURS} bookingEnabled />);

    for (const b of blocks(container)) {
      expect(b.className).toContain('is-compact');
      expect(b.querySelector('.bcal-event-name')?.textContent).not.toBe('');
      expect(b.querySelector('.bcal-event-time')).toBeNull();
      expect(b.querySelector('.bcal-event-service')).toBeNull(); // no room at half width
      expect(b.getAttribute('title')).toMatch(/10:00/); // the time is still one hover away
    }
  });
});

describe('WeekCalendar hour band', () => {
  /** The gutter labels, e.g. ["7 AM", "8 AM", …]. */
  function gutter(container: HTMLElement): string[] {
    return [...container.querySelectorAll('.bcal-timelabel')].map((el) => el.textContent ?? '');
  }

  test('always runs 7 AM to 9 PM, whatever the card says', () => {
    const { container } = render(
      <WeekCalendar bookingDays={[{ day: 1, start: '10:00', end: '15:00' }]} bookingEnabled />,
    );

    const labels = gutter(container);
    expect(labels).toHaveLength(14); // 7 AM … 8 PM rows, closing at 9 PM
    expect(labels[0]).toMatch(/^7/);
    expect(labels.at(-1)).toMatch(/^8/);

    // every column is the full band tall, not just the barber's window
    for (const col of container.querySelectorAll('.bcal-daycol')) {
      expect((col as HTMLElement).style.height).toBe(`${14 * 64}px`);
    }
  });

  test('a booking outside open hours pins inside the band instead of off-grid', () => {
    const start = new Date();
    start.setHours(5, 30, 0, 0); // before the 7 AM open
    bookings = [
      {
        id: 'early',
        startMs: start.getTime(),
        endMs: start.getTime() + 30 * 60 * 1000,
        clientName: 'Early Bird',
        service: 'Fade',
      },
    ];

    const { container } = render(
      <WeekCalendar bookingDays={[{ day: 1, start: '09:00', end: '17:00' }]} bookingEnabled />,
    );

    const block = container.querySelector('.bcal-event') as HTMLElement;
    expect(block.style.top).toBe('0px');
    expect(parseFloat(block.style.height)).toBeLessThanOrEqual(14 * 64);
  });
});

describe('WeekCalendar example week', () => {
  const HOURS = [1, 2, 3, 4, 5].map((day) => ({ day, start: '09:00', end: '17:00' }));

  test('an empty week fills with ghosted, inert example blocks and says so', () => {
    const { container } = render(<WeekCalendar bookingDays={HOURS} bookingEnabled />);

    const samples = container.querySelectorAll('.bcal-event.is-sample');
    expect(samples.length).toBeGreaterThan(5);

    for (const s of samples) {
      // examples are never seatable — no link into the chair
      expect(s.tagName).toBe('DIV');
      expect(s.querySelector('a')).toBeNull();
      // each carries a time and a name, so the block reads like a real one
      expect(s.querySelector('.bcal-event-time')?.textContent).toMatch(/\d/);
      expect(s.querySelector('.bcal-event-name')?.textContent).not.toBe('');
    }

    expect(screen.getByText('Example week')).not.toBeNull();
    expect(
      screen.getByText(/The faded blocks are an example of how a booked week looks\./),
    ).not.toBeNull();
  });

  test('real appointments push the examples out entirely', () => {
    const start = new Date();
    start.setHours(11, 0, 0, 0);
    bookings = [
      {
        id: 'b1',
        startMs: start.getTime(),
        endMs: start.getTime() + 45 * 60 * 1000,
        clientName: 'Real Client',
        service: 'Fade',
      },
    ];

    const { container } = render(<WeekCalendar bookingDays={HOURS} bookingEnabled />);

    expect(container.querySelectorAll('.bcal-event.is-sample')).toHaveLength(0);
    expect(screen.queryByText('Example week')).toBeNull();
    expect(screen.getByText('Real Client')).not.toBeNull();
  });

  test('shows nothing while the week is still loading', () => {
    bookings = undefined;
    const { container } = render(<WeekCalendar bookingDays={HOURS} bookingEnabled />);
    expect(container.querySelectorAll('.bcal-event')).toHaveLength(0);
  });
});

describe('WeekCalendar day headers', () => {
  test('read as "Mon 27" — weekday name first, then the date on the same line', () => {
    const { container } = render(
      <WeekCalendar bookingDays={[{ day: 1, start: '09:00', end: '17:00' }]} bookingEnabled />,
    );

    const heads = container.querySelectorAll('.bcal-dayhead');
    expect(heads).toHaveLength(7);

    for (const head of heads) {
      const num = head.querySelector('strong');
      expect(num).not.toBeNull();
      // the number is last, so the name reads first
      expect(head.lastElementChild).toBe(num);
      // Montserrat comes from .bcal-dayhead strong — a font-* utility class
      // would win with !important and undo it
      expect(num?.className).toBe('');
      expect(head.textContent).toMatch(/^[^\d]+\d{1,2}$/);
    }
  });
});

describe('WeekCalendar clock setting', () => {
  const HOURS = [{ day: 1, start: '09:00', end: '17:00' }];

  /** Every label in the hour gutter, for whichever clock is set. */
  function gutter(): string[] {
    const { container } = render(<WeekCalendar bookingDays={HOURS} bookingEnabled />);
    return [...container.querySelectorAll('.bcal-timelabel')].map((n) => n.textContent ?? '');
  }

  test('12h is the default and 24h drops the meridiem', () => {
    expect(gutter()).toContain('1 PM');
    cleanup();

    settings.clock24 = true;
    const labels = gutter();
    expect(labels).toContain('13');
    expect(labels.some((l) => /[AP]M/.test(l))).toBe(false);
  });
});
