'use client';

// ============================================================
// The appointment calendar: a real week grid, not a list. Seven day columns
// over the shop's open hours (a fixed 7 AM – 9 PM band), booked
// slots as blocks, a now-line on today, and ‹ Today › paging. A block only has
// room for a time and a name, so clicking one grows it — the block itself lerps
// out into a card carrying the phone, the note, and the way into the chair,
// rather than handing off to a dialog with its own look. The calendar is a
// front desk, so its one real action is "this person is here, seat them".
//
// Times render in the DEVICE's timezone (the tablet at the shop), which is
// also the timezone the barber configured on their card in every real case.
// ============================================================

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import Link from 'next/link';
import { useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import { sampleWeek } from '@/lib/barber/sampleWeek';
import { useT } from '@/lib/i18n';
import { clockHour12, useSettings } from '@/contexts/SettingsContext';

const HOUR_PX = 64;
const DAY_MS = 24 * 60 * 60 * 1000;
// The grid always spans the shop's open hours — 7 AM to 9 PM — no matter what
// the card's booking window is. A fixed band means the rows sit in the same
// place every week, so the barber reads the day by position instead of
// re-reading the gutter; anything booked outside it pins to the edge.
const START_HOUR = 7;
const END_HOUR = 21;
const HOURS = END_HOUR - START_HOUR;
// A half-hour booking is only ~32px tall — too short to stack a time above a
// name without the name being clipped away. Short blocks put the two on one
// line instead ("9:00 AM  Mia Chen"); taller ones stack, and the tallest have
// room for the service under it. A block always names who's coming.
const STACK_PX = 46;
const SERVICE_PX = 62;
// Blocks are inset 4px each side by the stylesheet; a split run keeps that
// inset and splits the space between its lanes, with a hairline gap between.
const EDGE_PX = 4;
const LANE_GAP_PX = 3;
// The grown card: how wide it settles, how much air it keeps around it, and how
// long the block takes to lerp out to it. MORPH_MS has to match the geometry
// transition on .bcal-detail — it's also how long the card takes to shrink back
// into its block before it leaves the DOM.
const DETAIL_PX = 420;
const DETAIL_MARGIN_PX = 16;
const MORPH_MS = 340;

/** Monday 00:00 (local) of the week containing `ms`. */
function weekStartOf(ms: number): Date {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  const shift = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - shift);
  return d;
}

// `hour12` comes from the barber's Clock setting (undefined = follow the
// locale) — see clockHour12 in SettingsContext.
function hourLabel(hour: number, hour12: boolean | undefined): string {
  return new Date(2000, 0, 1, hour).toLocaleTimeString(undefined, { hour: 'numeric', hour12 });
}

function timeLabel(ms: number, hour12: boolean | undefined): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12 });
}

function PencilGlyph() {
  // Just the pencil body (no underline stroke), drawn thicker — the link back
  // to the card's hours.
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

interface BookingDay {
  day: number;
  start: string;
  end: string;
}

/** One row of `listMyBookingsRange`. */
interface Booking {
  id: string;
  startMs: number;
  endMs: number;
  clientName: string;
  clientPhone?: string;
  service?: string;
  note?: string;
}

/**
 * Where a block sits in its day column, and how tall it is. Both edges are
 * clamped into the 7 AM–9 PM band so an appointment taken outside open hours
 * still reads as a block at the top or bottom instead of floating off-grid.
 */
function place(event: { startMs: number; endMs: number }): { top: number; height: number } {
  const start = new Date(event.startMs);
  const startAt = start.getHours() + start.getMinutes() / 60;
  const endAt = startAt + (event.endMs - event.startMs) / (60 * 60 * 1000);
  const clamp = (at: number) => (Math.min(END_HOUR, Math.max(START_HOUR, at)) - START_HOUR) * HOUR_PX;
  const top = clamp(startAt);
  const height = Math.max(30, clamp(endAt) - top);
  return { top: Math.min(top, HOURS * HOUR_PX - height), height };
}

/** A block's geometry: where it sits, and which of its column's lanes it's in. */
interface Placed<T> {
  event: T;
  top: number;
  height: number;
  /** 0-based lane within the day column. */
  lane: number;
  /** How many lanes the overlapping run needs — 1 when nothing collides. */
  lanes: number;
}

/**
 * Lays one day's blocks out in lanes. Two appointments at the same time used to
 * draw on top of each other — one unreadable pile of overlapping text — so a
 * run of overlapping blocks splits the column between them, side by side, the
 * way a calendar does. A whole run shares a lane count so its blocks line up
 * as columns rather than stepping in and out.
 *
 * Overlap is measured in pixels, not minutes: a block is never drawn shorter
 * than 30px, so two back-to-back 10-minute bookings collide on screen even
 * though their times don't.
 */
function layOutDay<T extends { startMs: number; endMs: number }>(events: T[]): Placed<T>[] {
  const placed = events
    .map((event) => ({ event, ...place(event), lane: 0, lanes: 1 }))
    .sort((a, b) => a.top - b.top || b.height - a.height);

  const out: Placed<T>[] = [];
  let run: Placed<T>[] = [];
  let laneBottoms: number[] = [];
  let runBottom = -Infinity;

  const closeRun = () => {
    for (const item of run) item.lanes = laneBottoms.length;
    out.push(...run);
    run = [];
    laneBottoms = [];
    runBottom = -Infinity;
  };

  for (const item of placed) {
    if (item.top >= runBottom) closeRun(); // clear of everything before it
    // reuse the first lane that has already finished, else open one beside them
    const free = laneBottoms.findIndex((bottom) => bottom <= item.top);
    item.lane = free === -1 ? laneBottoms.length : free;
    laneBottoms[item.lane] = item.top + item.height;
    runBottom = Math.max(runBottom, item.top + item.height);
    run.push(item);
  }
  closeRun();

  return out;
}

function isCompact(height: number): boolean {
  return height < STACK_PX;
}

function isSplit(lanes: number): boolean {
  return lanes > 1;
}

function eventClass(height: number, lanes: number): string {
  return `bcal-event${isCompact(height) ? ' is-compact' : ''}${isSplit(lanes) ? ' is-split' : ''}`;
}

/**
 * Absolute geometry for a block. A block on its own keeps the CSS's full-width
 * inset; a split run divides that same width into equal lanes, so the column's
 * outer margins don't change when appointments collide.
 */
function eventStyle({ top, height, lane, lanes }: Omit<Placed<unknown>, 'event'>): CSSProperties {
  if (!isSplit(lanes)) return { top, height };
  const width = `(100% - ${EDGE_PX * 2}px) / ${lanes}`;
  return {
    top,
    height,
    left: `calc(${EDGE_PX}px + ${lane} * (${width}))`,
    width: `calc(${width} - ${LANE_GAP_PX}px)`,
    right: 'auto', // the stylesheet pins both edges; lanes drive off left+width
  };
}

/** The lane a split block landed in, on the element — readable in the DOM. */
function laneAttrs({ lane, lanes }: { lane: number; lanes: number }) {
  return isSplit(lanes) ? { 'data-lane': lane, 'data-lanes': lanes } : {};
}

function EventBody({
  startMs,
  clientName,
  service,
  height,
  lanes,
  hour12,
}: {
  startMs: number;
  clientName: string;
  service?: string;
  height: number;
  lanes: number;
  hour12: boolean | undefined;
}) {
  // A compact block has no room for a third line but plenty of width, so the
  // service rides along on the same row and ellipsizes first if the column is
  // narrow. In between — tall enough to stack, too short for three lines —
  // the service drops to the tooltip. A split block has half a column or less,
  // so it gives the service up too and spends what width it has on the name.
  const split = isSplit(lanes);
  const showService =
    Boolean(service) && !split && (isCompact(height) || height >= SERVICE_PX);
  // Squeezed both ways — one line, half a column — the name wins: where the
  // block sits already says when it is, and only the name says who.
  const showTime = !(split && isCompact(height));
  return (
    <>
      {showTime && <span className="bcal-event-time">{timeLabel(startMs, hour12)}</span>}
      <span className="bcal-event-name font-sans">{clientName}</span>
      {showService && <span className="bcal-event-service font-sans">{service}</span>}
    </>
  );
}

export default function WeekCalendar({
  bookingDays,
  bookingEnabled,
}: {
  bookingDays: BookingDay[];
  bookingEnabled: boolean;
}) {
  const t = useT();
  const { clock24 } = useSettings();
  const hour12 = clockHour12(clock24);
  const [weekOffset, setWeekOffset] = useState(0);

  const weekStart = useMemo(
    () => weekStartOf(Date.now() + weekOffset * 7 * DAY_MS),
    [weekOffset],
  );
  const weekEndMs = weekStart.getTime() + 7 * DAY_MS;

  const bookings = useQuery(api.barberBooking.listMyBookingsRange, {
    fromMs: weekStart.getTime(),
    toMs: weekEndMs,
  });

  // An empty week fills with a ghosted example book so the grid shows what a
  // booked week looks like. The moment one real appointment lands in the week,
  // the examples get out of the way — they never sit beside real rows.
  const showSamples = bookings !== undefined && (bookings?.length ?? 0) === 0;
  const samples = useMemo(
    () => (showSamples ? sampleWeek(weekStart.getTime(), bookingDays) : []),
    [showSamples, weekStart, bookingDays],
  );

  // Clicking a block grows it: the grid can only ever show a name and a
  // service, and the barber needs the phone, the note and a way into the chair.
  // Keyed by id rather than the row itself, so a live update flows through and
  // paging to another week closes it on its own. The block's own rect rides
  // along — it's where the grown card starts, and where it goes back to.
  const [openId, setOpenId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<Rect | null>(null);
  const open = useMemo(() => {
    const booking = (bookings ?? []).find((b) => b.id === openId);
    if (!booking) return null;
    return { booking, isToday: isSameDay(new Date(booking.startMs), new Date()) };
  }, [bookings, openId]);

  const openWeekdays = useMemo(() => new Set(bookingDays.map((d) => d.day)), [bookingDays]);

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(weekStart.getTime() + i * DAY_MS);
    return { date, isToday: isSameDay(date, new Date()) };
  });

  const rangeLabel = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(weekEndMs - DAY_MS).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

  const now = new Date();
  const nowY = (now.getHours() + now.getMinutes() / 60 - START_HOUR) * HOUR_PX;

  return (
    <div className="bcal" style={{ ['--bcal-hour-px' as string]: `${HOUR_PX}px` }}>
      <div className="bcal-toolbar">
        <span className="bcal-range">
          {rangeLabel}
          {samples.length > 0 && (
            <span className="bcal-sampleflag font-sans">{t('Example week')}</span>
          )}
        </span>
        <div className="bcal-navbtns">
          <button type="button" className="chip-suggest" onClick={() => setWeekOffset((w) => w - 1)} aria-label={t('Previous week')}>
            ‹
          </button>
          <button type="button" className="chip-suggest" onClick={() => setWeekOffset(0)} disabled={weekOffset === 0}>
            {t('This week##calendar')}
          </button>
          <button type="button" className="chip-suggest" onClick={() => setWeekOffset((w) => w + 1)} aria-label={t('Next week')}>
            ›
          </button>
        </div>
      </div>

      <div className="bcal-scroll">
        <div className="bcal-grid" role="grid" aria-label={t('Appointments, week of {range}', { range: rangeLabel })}>
          {/* editing hours lives on the card — the pencil in the grid corner is the way back to it */}
          <div className="bcal-corner">
            <Link href="/barber/card" className="bcal-edithours" aria-label={t('Edit hours')} title={t('Edit hours')}>
              <PencilGlyph />
            </Link>
          </div>
          {days.map(({ date, isToday }) => {
            const closed = !openWeekdays.has(date.getDay());
            return (
              <div
                key={date.toDateString()}
                className={`bcal-dayhead font-mono${isToday ? ' is-today' : ''}${closed ? ' is-closed' : ''}`}
                role="columnheader"
              >
                {date.toLocaleDateString(undefined, { weekday: 'short' })}
                <strong>{date.getDate()}</strong>
              </div>
            );
          })}

          {/* time gutter */}
          <div className="bcal-timecol" style={{ height: HOURS * HOUR_PX }} aria-hidden>
            {Array.from({ length: HOURS }, (_, i) => (
              <span key={i} className="bcal-timelabel font-mono" style={{ top: i * HOUR_PX }}>
                {hourLabel(START_HOUR + i, hour12)}
              </span>
            ))}
          </div>

          {days.map(({ date, isToday }) => {
            const dayStartMs = date.getTime();
            const inDay = (b: { startMs: number }) =>
              b.startMs >= dayStartMs && b.startMs < dayStartMs + DAY_MS;
            // laid out per day, so a day with overlapping appointments splits
            // its column without narrowing any other day
            const dayEvents = layOutDay((bookings ?? []).filter(inDay));
            const daySamples = layOutDay(samples.filter(inDay));
            const closed = !openWeekdays.has(date.getDay());
            return (
              <div
                key={date.toDateString()}
                className={`bcal-daycol${closed ? ' is-closed' : ''}`}
                style={{ height: HOURS * HOUR_PX }}
                role="gridcell"
              >
                {dayEvents.map(({ event: b, ...box }) => {
                  const summary = `${timeLabel(b.startMs, hour12)} · ${b.clientName}${b.service ? ` · ${b.service}` : ''}`;
                  return (
                    <button
                      key={b.id}
                      type="button"
                      className={`${eventClass(box.height, box.lanes)}${open?.booking.id === b.id ? ' is-open' : ''}`}
                      style={eventStyle(box)}
                      {...laneAttrs(box)}
                      title={summary}
                      aria-label={summary}
                      aria-haspopup="dialog"
                      aria-expanded={open?.booking.id === b.id}
                      onClick={(e) => {
                        setOrigin(rectOf(e.currentTarget));
                        setOpenId(b.id);
                      }}
                    >
                      <EventBody
                        startMs={b.startMs}
                        clientName={b.clientName}
                        service={b.service}
                        height={box.height}
                        lanes={box.lanes}
                        hour12={hour12}
                      />
                    </button>
                  );
                })}
                {/* ghosted examples — inert, and never mixed with real rows */}
                {daySamples.map(({ event: s, ...box }) => (
                  <div
                    key={s.id}
                    className={`${eventClass(box.height, box.lanes)} is-sample`}
                    style={eventStyle(box)}
                    {...laneAttrs(box)}
                    title={`${timeLabel(s.startMs, hour12)} · ${s.clientName} · ${t(s.service)}`}
                  >
                    <EventBody
                      startMs={s.startMs}
                      clientName={s.clientName}
                      service={t(s.service)}
                      height={box.height}
                      lanes={box.lanes}
                      hour12={hour12}
                    />
                  </div>
                ))}
                {isToday && nowY >= 0 && nowY <= HOURS * HOUR_PX && (
                  <div className="bcal-nowline" style={{ top: nowY }} aria-hidden />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {bookings && bookings.length === 0 && (
        <p className="bcal-empty-note font-sans">
          {(bookingEnabled
            ? t('No appointments this week — slots are live on your card.')
            : t('Booking is off. Turn it on in your card to take appointments here.')) +
            ' ' +
            t('The faded blocks are an example of how a booked week looks.')}
        </p>
      )}

      {open && origin && (
        <EventDetail
          booking={open.booking}
          isToday={open.isToday}
          hour12={hour12}
          origin={origin}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

/** Where something sits on screen — the geometry the card grows out of. */
interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function rectOf(el: HTMLElement): Rect {
  const { top, left, width, height } = el.getBoundingClientRect();
  return { top, left, width, height };
}

/**
 * Stops the card and its text animating while a style change is made, and hands
 * back the release. The measuring pass below forces both elements' styles to
 * resolve, and whatever resolves there is the state a later transition animates
 * away from — without this, the text is measured at full opacity and so starts
 * the grow already visible instead of arriving at the end of it.
 */
function freezeTransitions(el: HTMLElement): () => void {
  const body = el.querySelector<HTMLElement>('.bcal-detail-body');
  el.style.transition = 'none';
  if (body) body.style.transition = 'none';
  return () => {
    el.style.transition = '';
    if (body) body.style.transition = '';
  };
}

/**
 * Where the grown card wants to sit: centred, 420px at most, never taller than
 * the viewport. Its height has to be measured — an appointment with a note is
 * taller than one without — so the panel is briefly dressed in its grown styles
 * at the target width, read, and put back at `restore` before anything paints.
 * Transitions must already be frozen; this only ever reads.
 */
function measureTarget(el: HTMLElement, restore: Rect): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(DETAIL_PX, Math.max(0, vw - DETAIL_MARGIN_PX * 2));
  const wasGrown = el.dataset.grown ?? 'false';

  el.dataset.grown = 'true';
  el.style.width = `${width}px`;
  el.style.height = 'auto';
  const height = Math.min(el.offsetHeight, Math.max(0, vh - DETAIL_MARGIN_PX * 2));
  el.dataset.grown = wasGrown;
  el.style.width = `${restore.width}px`;
  el.style.height = `${restore.height}px`;
  // Commit the reading's undo. Without this the last state the browser
  // resolved is the grown one, so the change a frame later is no change at all
  // and the card simply appears at full size — measured, but never animated.
  void el.offsetHeight;

  return {
    width,
    height,
    left: Math.round((vw - width) / 2),
    top: Math.round(Math.max(DETAIL_MARGIN_PX, (vh - height) / 2)),
  };
}

function prefersReducedMotion(): boolean {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/**
 * The grown appointment: everything the grid had to leave out — the full time
 * range, the phone, the note the client left — and the one action that matters,
 * seating them. Escape or the scrim closes it.
 *
 * It isn't a popup: it mounts on the block's own rect wearing the block's
 * colours, then lerps out to a centred card, and the text only fades in once
 * the box has nearly arrived (see .bcal-detail in the stylesheet). Closing
 * plays that backwards, so the card visibly returns to the block it came from.
 */
function EventDetail({
  booking,
  isToday,
  hour12,
  origin,
  onClose,
}: {
  booking: Booking;
  isToday: boolean;
  hour12: boolean | undefined;
  origin: Rect;
  onClose: () => void;
}) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Rect>(origin);
  const [grown, setGrown] = useState(false);
  // Only a card that has finished growing may scroll: a long note is taller
  // than the block-sized box it starts in, and letting it scroll on the way
  // out would flash a scrollbar across the whole lerp.
  const [settled, setSettled] = useState(false);
  const boxRef = useRef<Rect>(origin);
  const closingRef = useRef(false);
  const timerRef = useRef(0);

  const putBox = useCallback((next: Rect) => {
    boxRef.current = next;
    setBox(next);
  }, []);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  // Take the reading with transitions off, then hand the target over one frame
  // later so the browser has an origin to animate away from.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const release = freezeTransitions(el);
    const target = measureTarget(el, origin);
    const frame = requestAnimationFrame(() => {
      release();
      putBox(target);
      setGrown(true);
      timerRef.current = window.setTimeout(() => setSettled(true), MORPH_MS);
    });
    return () => cancelAnimationFrame(frame);
  }, [origin, putBox]);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    window.clearTimeout(timerRef.current);
    setGrown(false);
    setSettled(false);
    putBox(origin);
    if (prefersReducedMotion()) onClose();
    else timerRef.current = window.setTimeout(onClose, MORPH_MS);
  }, [origin, onClose, putBox]);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  // A tablet turned on its side would leave the card off-centre: re-centre it
  // where it stands, without animating the jump.
  useEffect(() => {
    const onResize = () => {
      const el = panelRef.current;
      if (!el || closingRef.current) return;
      const release = freezeTransitions(el);
      putBox(measureTarget(el, boxRef.current));
      requestAnimationFrame(release);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [putBox]);

  const day = new Date(booking.startMs).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
  const range = `${timeLabel(booking.startMs, hour12)} – ${timeLabel(booking.endMs, hour12)}`;

  return (
    <div className="bcal-detail-scrim" data-grown={grown} onClick={close}>
      <div
        ref={panelRef}
        className="bcal-detail"
        data-grown={grown}
        data-settled={settled}
        style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
        role="dialog"
        aria-modal="true"
        aria-label={t('Appointment details')}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bcal-detail-body">
          <p className="bcal-detail-when font-mono">
            {day} · {range}
          </p>
          <h2 className="bcal-detail-name">{booking.clientName}</h2>
          {booking.service && <p className="bcal-detail-service font-sans">{booking.service}</p>}

          <dl className="bcal-detail-facts font-sans">
            {booking.clientPhone && (
              <div>
                <dt>{t('Phone')}</dt>
                <dd>
                  <a href={`tel:${booking.clientPhone.replace(/[^\d+]/g, '')}`}>
                    {booking.clientPhone}
                  </a>
                </dd>
              </div>
            )}
            {booking.note && (
              <div>
                <dt>{t('What they asked for')}</dt>
                <dd>{booking.note}</dd>
              </div>
            )}
          </dl>

          <div className="bcal-detail-actions">
            {isToday && (
              <Link
                className="chip-suggest bcal-detail-seat"
                href={`/chair?name=${encodeURIComponent(booking.clientName)}${booking.clientPhone ? `&phone=${encodeURIComponent(booking.clientPhone)}` : ''}&booking=${booking.id}`}
              >
                {t('Seat in the chair')}
              </Link>
            )}
            <button type="button" className="chip-suggest" onClick={close}>
              {t('Close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}
