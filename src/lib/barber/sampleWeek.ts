// ============================================================
// Placeholder appointments for an empty calendar week.
//
// A brand-new barber opens /barber/calendar and sees seven empty columns —
// which reads as "broken", not "no bookings yet". So an empty week fills with
// a ghosted example book: real-looking names, services and times laid inside
// the barber's own opening hours, drawn dashed and clearly flagged as an
// example (the calendar never dresses fake rows up as real ones).
//
// Pure and deterministic: the same week + hours always produce the same book,
// so the examples don't reshuffle on every render or week flip back.
// ============================================================

const DAY_MS = 24 * 60 * 60 * 1000;

export interface SampleBookingDay {
  /** JS weekday: 0 = Sunday … 6 = Saturday. */
  day: number;
  /** "HH:MM" local. */
  start: string;
  end: string;
}

export interface SampleEvent {
  id: string;
  startMs: number;
  endMs: number;
  clientName: string;
  /** English source string — run through `t()` at render. */
  service: string;
}

/** Shown when the barber hasn't set hours yet: a plain Mon–Fri 9–5. */
const DEFAULT_DAYS: SampleBookingDay[] = [1, 2, 3, 4, 5].map((day) => ({
  day,
  start: '09:00',
  end: '17:00',
}));

/** The example book's regulars. Services are source strings for `t()`. */
const ROSTER: { name: string; service: string; minutes: number }[] = [
  { name: 'Marcus Bell', service: 'Skin fade + line-up', minutes: 45 },
  { name: 'Dev Patel', service: 'Scissor cut', minutes: 45 },
  { name: 'Tony Alvarez', service: 'Beard trim', minutes: 30 },
  { name: 'Jamal Reed', service: 'Taper + beard', minutes: 60 },
  { name: 'Chris Nguyen', service: 'Buzz cut', minutes: 30 },
  { name: 'Andre Woods', service: 'Mid fade', minutes: 45 },
  { name: 'Sam Okafor', service: 'Kids cut', minutes: 30 },
  { name: 'Luis Romero', service: 'Fade + design', minutes: 60 },
  { name: 'Eli Brooks', service: 'Line-up', minutes: 30 },
  { name: 'Ray Mensah', service: 'Textured crop', minutes: 45 },
  { name: 'Noah Kim', service: 'Hot towel shave', minutes: 60 },
  { name: 'Victor Cruz', service: 'Trim + wash', minutes: 30 },
];

/**
 * Minutes past opening for each day's appointments. Rotating between shapes
 * keeps the week from looking like a printed grid — a packed day next to a
 * quiet one, the way a real book runs.
 */
const SHAPES: number[][] = [
  [0, 90, 210],
  [45, 135, 240, 330],
  [30, 165],
  [0, 60, 180, 300],
  [75, 195, 285],
];

function parseHm(hm: string): number {
  const [h, m] = hm.split(':');
  return parseInt(h, 10) * 60 + parseInt(m ?? '0', 10);
}

/**
 * An example week of appointments starting at `weekStartMs` (local Monday
 * 00:00), placed inside `bookingDays`. Falls back to Mon–Fri 9–5 when the
 * barber hasn't configured hours, so the example renders either way.
 */
export function sampleWeek(
  weekStartMs: number,
  bookingDays: SampleBookingDay[],
): SampleEvent[] {
  const days = bookingDays.length > 0 ? bookingDays : DEFAULT_DAYS;
  // Seeded off the week itself: stable across renders, different week to week.
  const seed = Math.floor(weekStartMs / DAY_MS);
  const events: SampleEvent[] = [];
  let cursor = seed;

  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStartMs + i * DAY_MS);
    date.setHours(0, 0, 0, 0); // re-anchor across a DST boundary
    const hours = days.find((d) => d.day === date.getDay());
    if (!hours) continue; // closed

    const openMin = parseHm(hours.start);
    const closeMin = parseHm(hours.end);
    const shape = SHAPES[(seed + i) % SHAPES.length];

    for (const offset of shape) {
      const person = ROSTER[cursor++ % ROSTER.length];
      const startMin = openMin + offset;
      const endMin = startMin + person.minutes;
      if (endMin > closeMin) continue;
      const startMs = date.getTime() + startMin * 60 * 1000;
      events.push({
        id: `sample-${i}-${offset}`,
        startMs,
        endMs: date.getTime() + endMin * 60 * 1000,
        clientName: person.name,
        service: person.service,
      });
    }
  }

  return events;
}
