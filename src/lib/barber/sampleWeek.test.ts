import { describe, expect, test } from 'vitest';
import { sampleWeek, type SampleBookingDay } from './sampleWeek';

/** Local Monday 00:00 for a fixed week, so the tests don't drift with the clock. */
function monday(): number {
  return new Date(2026, 6, 27, 0, 0, 0, 0).getTime(); // Mon 27 Jul 2026
}

const MON_FRI: SampleBookingDay[] = [1, 2, 3, 4, 5].map((day) => ({
  day,
  start: '10:00',
  end: '18:00',
}));

describe('sampleWeek', () => {
  test('is deterministic for the same week', () => {
    expect(sampleWeek(monday(), MON_FRI)).toEqual(sampleWeek(monday(), MON_FRI));
  });

  test('only fills days the barber is open, and only inside opening hours', () => {
    const events = sampleWeek(monday(), MON_FRI);
    expect(events.length).toBeGreaterThan(5);

    for (const e of events) {
      const start = new Date(e.startMs);
      const end = new Date(e.endMs);
      expect([1, 2, 3, 4, 5]).toContain(start.getDay());
      expect(start.getHours() + start.getMinutes() / 60).toBeGreaterThanOrEqual(10);
      expect(end.getHours() + end.getMinutes() / 60).toBeLessThanOrEqual(18);
      expect(e.endMs).toBeGreaterThan(e.startMs);
      expect(e.clientName).not.toBe('');
      expect(e.service).not.toBe('');
    }
  });

  test('appointments within a day never overlap', () => {
    const byDay = new Map<number, { startMs: number; endMs: number }[]>();
    for (const e of sampleWeek(monday(), MON_FRI)) {
      const key = new Date(e.startMs).getDay();
      byDay.set(key, [...(byDay.get(key) ?? []), e]);
    }
    for (const day of byDay.values()) {
      const sorted = [...day].sort((a, b) => a.startMs - b.startMs);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].startMs).toBeGreaterThanOrEqual(sorted[i - 1].endMs);
      }
    }
  });

  test('falls back to a Mon–Fri book when no hours are configured', () => {
    const events = sampleWeek(monday(), []);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(new Date(e.startMs).getDay()).toBeGreaterThanOrEqual(1);
      expect(new Date(e.startMs).getDay()).toBeLessThanOrEqual(5);
    }
  });

  test('ids are unique so React keys are stable', () => {
    const ids = sampleWeek(monday(), MON_FRI).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
