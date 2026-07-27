// ============================================================
// The day's pulse: how busy the chair is right now, hour by hour, against what
// a normal day looks like for this shop.
//
// The server ships raw visit timestamps (chair.visitPulse) because only the
// browser knows the barber's timezone — a 6pm client in Los Angeles is already
// tomorrow in UTC, and bucketing that server-side would smear the evening into
// the wrong day. Everything here is pure and local-time.
//
// "Normal" is the mean across PRIOR DAYS THAT HAD VISITS, not across the whole
// window: a shop closed Sundays shouldn't have its typical Tuesday dragged down
// by the days its door was locked.
// ============================================================

export interface PulsePoint {
  /** Local hour, 0–23. */
  hour: number;
  today: number;
  /** Mean visits in this hour across prior active days — fractional. */
  typical: number;
}

export interface DayPulse {
  points: PulsePoint[];
  /** Local hour right now; today's line stops here rather than diving to zero. */
  currentHour: number;
  /** Prior days with at least one visit — the denominator behind `typical`. */
  activeDays: number;
  todayTotal: number;
  /** Visits a normal day has by this hour — the honest number to compare against. */
  typicalToDate: number;
}

function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// A quiet shop still gets an axis: mid-morning through early evening is the
// shape of a barber's day, and the window only grows from there.
const DEFAULT_FROM = 9;
const DEFAULT_TO = 18;

export function buildDayPulse(startedAt: number[], nowMs: number): DayPulse {
  const todayKey = localDayKey(nowMs);
  const currentHour = new Date(nowMs).getHours();

  const today = new Array<number>(24).fill(0);
  const priorByDay = new Map<string, number[]>();

  for (const ms of startedAt) {
    if (ms > nowMs) continue; // clock skew — never let the future count
    const key = localDayKey(ms);
    const hour = new Date(ms).getHours();
    if (key === todayKey) {
      today[hour] += 1;
      continue;
    }
    let hours = priorByDay.get(key);
    if (!hours) {
      hours = new Array<number>(24).fill(0);
      priorByDay.set(key, hours);
    }
    hours[hour] += 1;
  }

  const activeDays = priorByDay.size;
  const typical = new Array<number>(24).fill(0);
  if (activeDays > 0) {
    for (const hours of priorByDay.values()) {
      for (let h = 0; h < 24; h++) typical[h] += hours[h];
    }
    for (let h = 0; h < 24; h++) typical[h] /= activeDays;
  }

  // The window is whatever the shop actually does, padded an hour either side,
  // and always wide enough to hold the current hour so "now" is on the chart.
  let from = DEFAULT_FROM;
  let to = DEFAULT_TO;
  const busy: number[] = [];
  for (let h = 0; h < 24; h++) if (today[h] > 0 || typical[h] > 0) busy.push(h);
  if (busy.length > 0) {
    from = Math.min(from, Math.max(0, busy[0] - 1));
    to = Math.max(to, Math.min(23, busy[busy.length - 1] + 1));
  }
  from = Math.min(from, currentHour);
  to = Math.max(to, currentHour);

  const points: PulsePoint[] = [];
  for (let h = from; h <= to; h++) points.push({ hour: h, today: today[h], typical: typical[h] });

  let typicalToDate = 0;
  for (let h = 0; h <= currentHour; h++) typicalToDate += typical[h];

  return {
    points,
    currentHour,
    activeDays,
    todayTotal: today.reduce((sum, n) => sum + n, 0),
    typicalToDate,
  };
}

/** Label an hour the way a clock does — "9a", "12p", "5p". Locale-agnostic. */
export function hourLabel(hour: number): string {
  const suffix = hour < 12 ? 'a' : 'p';
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}${suffix}`;
}
