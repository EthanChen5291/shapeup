// The day's pulse is the one number a barber checks mid-shift — "is today
// slow, or does it just feel slow" — so the arithmetic behind the two lines is
// tested against real clock times rather than by poking at internals.

import { describe, expect, test } from 'vitest';
import { buildDayPulse, hourLabel } from './pulse';

/** Local-time timestamp: `daysAgo` days back, at `hour` o'clock. */
function at(daysAgo: number, hour: number, nowMs = Date.now()): number {
  const d = new Date(nowMs);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 30, 0, 0);
  return d.getTime();
}

/** Today at 2pm, so "now" is mid-afternoon and the day is half-run. */
function now2pm(): number {
  const d = new Date();
  d.setHours(14, 0, 0, 0);
  return d.getTime();
}

describe('buildDayPulse', () => {
  test('splits today from the prior days and averages only the active ones', () => {
    const now = now2pm();
    const pulse = buildDayPulse(
      [
        at(0, 10, now),
        at(0, 10, now),
        at(0, 13, now),
        // two prior days with visits, plus a silent stretch that must not
        // dilute the average
        at(1, 10, now),
        at(1, 10, now),
        at(3, 10, now),
        at(3, 13, now),
      ],
      now,
    );

    const ten = pulse.points.find((p) => p.hour === 10)!;
    expect(ten.today).toBe(2);
    expect(ten.typical).toBeCloseTo(1.5); // (2 + 1) / 2 active days, not / 28
    expect(pulse.activeDays).toBe(2);
    expect(pulse.todayTotal).toBe(3);
    expect(pulse.typicalToDate).toBeCloseTo(2); // 1.5 at 10a + 0.5 at 1p
  });

  test('a shop with no history yet still charts today alone', () => {
    const now = now2pm();
    const pulse = buildDayPulse([at(0, 11, now), at(0, 12, now)], now);

    expect(pulse.activeDays).toBe(0);
    expect(pulse.typicalToDate).toBe(0);
    expect(pulse.points.every((p) => p.typical === 0)).toBe(true);
    expect(pulse.points.find((p) => p.hour === 11)!.today).toBe(1);
  });

  test('the window stretches to cover early and late visits, and always “now”', () => {
    const now = now2pm();
    const pulse = buildDayPulse([at(1, 7), at(1, 21)], now);
    const hours = pulse.points.map((p) => p.hour);

    expect(hours[0]).toBe(6); // an hour of air either side of the earliest visit
    expect(hours[hours.length - 1]).toBe(22);
    expect(hours).toContain(pulse.currentHour);
    // contiguous, no gaps in the axis
    expect(hours).toEqual(hours.map((_, i) => hours[0] + i));
  });

  test('ignores timestamps in the future — a skewed clock can’t invent traffic', () => {
    const now = now2pm();
    const pulse = buildDayPulse([at(0, 10, now), at(-1, 10, now)], now);
    expect(pulse.todayTotal).toBe(1);
    expect(pulse.activeDays).toBe(0);
  });
});

describe('hourLabel', () => {
  test('reads like a clock at the edges of the day', () => {
    expect(hourLabel(0)).toBe('12a');
    expect(hourLabel(9)).toBe('9a');
    expect(hourLabel(12)).toBe('12p');
    expect(hourLabel(17)).toBe('5p');
  });
});
