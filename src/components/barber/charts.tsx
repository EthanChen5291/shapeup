'use client';

// ============================================================
// The dashboard's two charts, hand-rolled SVG — no chart library.
//
// Palette: three series colors, VALIDATED as a set (dataviz six checks, all
// pairs) against the dark surface #1A1A1C — coral #E8614D + teal #18A5AA +
// violet #9085E9 pass the lightness band, chroma floor, CVD separation (worst
// pair ΔE 9.9 deutan), normal-vision floor (worst 17.8), and contrast. Three is
// the cap: no fourth hue clears all-pairs on this surface — every warm
// candidate (mustard, amber, orange) collides with coral under deuteranopia.
// Hue follows the entity, so a color means one thing per page: coral is what
// the mirror produced, teal is chair traffic, violet is what the client picked.
// Identity is never color-alone: every chart ships a legend, and every mark
// carries a native <title> tooltip plus an sr-only table.
// Text wears text tokens (fills set in globals.css .bviz-*), never series color.
// ============================================================

import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { hourLabel, type DayPulse } from '@/lib/chair/pulse';

export const SERIES_A = '#E8614D'; // coral — takes / tried in the mirror
export const SERIES_B = '#18A5AA'; // teal — chair visits / a normal day
export const SERIES_C = '#9085E9'; // violet — chosen, the client's decision

// ── grouped daily bars: the chair's last 14 days ────────────────────────────

export interface DayPoint {
  dayKey: string; // "YYYY-MM-DD"
  takes: number;
  visits: number;
}

function niceMax(n: number): number {
  if (n <= 4) return 4;
  if (n <= 8) return 8;
  return Math.ceil(n / 4) * 4;
}

function dayLabel(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00`);
  return d.toLocaleDateString(undefined, { day: 'numeric' });
}

export function ActivityBars({ points }: { points: DayPoint[] }) {
  const t = useT();
  // The svg is width:100%, so user units are the density dial: the wider the
  // viewBox, the smaller every mark and label renders in the same column. 985
  // units across the Insights column renders the chart ~35% smaller than the
  // 640 it started at — 14 low bars don't need that much page.
  const W = 985;
  const H = 168;
  // Top pad clears the peak's direct label — at 8 the glyph sat above the
  // viewBox and got cut off. Bottom pad keeps the day axis off the baseline.
  const PAD = { top: 18, right: 6, bottom: 26, left: 24 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const max = niceMax(Math.max(1, ...points.map((p) => Math.max(p.takes, p.visits))));
  const ticks = [0, max / 2, max];
  const group = plotW / points.length;
  const barW = Math.min(10, (group - 8) / 2);
  const peak = Math.max(...points.map((p) => p.takes), 0);

  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const barH = (v: number) => Math.max(v > 0 ? 3 : 0, (v / max) * plotH);

  return (
    <figure className="bviz bviz-activity" role="group" aria-label={t('Chair activity, last 14 days')}>
      <div className="bviz-head">
        <figcaption className="bviz-title font-mono">{t('Last 14 days')}</figcaption>
        <ul className="bviz-legend">
          <li>
            <span className="bviz-swatch" style={{ background: SERIES_A }} aria-hidden />
            {t('Live takes')}
          </li>
          <li>
            <span className="bviz-swatch" style={{ background: SERIES_B }} aria-hidden />
            {t('Chair visits')}
          </li>
        </ul>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden={false}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="bviz-grid" x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} />
            <text className="bviz-axis" x={PAD.left - 6} y={y(tick) + 3} textAnchor="end">
              {tick}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const cx = PAD.left + group * i + group / 2;
          const isPeak = p.takes === peak && peak > 0;
          return (
            <g key={p.dayKey}>
              {/* 2px gap between the pair; 4px rounded data ends on a baseline anchor */}
              <rect
                className="bviz-bar"
                x={cx - barW - 1}
                y={y(p.takes)}
                width={barW}
                height={barH(p.takes)}
                rx={4}
                fill={SERIES_A}
              >
                <title>{`${dayLabel(p.dayKey)} — ${t('Live takes')}: ${p.takes}`}</title>
              </rect>
              <rect
                className="bviz-bar"
                x={cx + 1}
                y={y(p.visits)}
                width={barW}
                height={barH(p.visits)}
                rx={4}
                fill={SERIES_B}
              >
                <title>{`${dayLabel(p.dayKey)} — ${t('Chair visits')}: ${p.visits}`}</title>
              </rect>
              {/* selective direct label: the busiest day only */}
              {isPeak && (
                <text className="bviz-value" x={cx - 1 - barW / 2} y={y(p.takes) - 4} textAnchor="middle">
                  {p.takes}
                </text>
              )}
              {i % 2 === 0 && (
                <text className="bviz-axis" x={cx} y={H - 6} textAnchor="middle">
                  {dayLabel(p.dayKey)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <table className="sr-only">
        <caption>{t('Chair activity, last 14 days')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('Date')}</th>
            <th scope="col">{t('Live takes')}</th>
            <th scope="col">{t('Chair visits')}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.dayKey}>
              <th scope="row">{p.dayKey}</th>
              <td>{p.takes}</td>
              <td>{p.visits}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

// ── two lines: today's traffic against a normal day ─────────────────────────
//
// Same validated pair, re-checked against the dark surface for this chart:
// coral (today) vs teal (normal). Identity is never color-alone — today's line
// is solid with markers, a normal day is dashed and unmarked, both are in the
// legend, and the crosshair names each series in the tooltip.

export function DayPulseLines({ pulse }: { pulse: DayPulse }) {
  const t = useT();
  const [hover, setHover] = useState<number | null>(null);

  const { points, currentHour, activeDays } = pulse;
  // Sized to the dashboard card's column, not to the wide Insights page: at
  // ~640 user units the viewBox scales down by half and the axis type renders
  // at 5px. Keep the box near its rendered width so labels stay legible.
  const W = 360;
  const H = 170;
  const PAD = { top: 10, right: 8, bottom: 20, left: 22 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // A quiet chair peaks at one or two clients an hour; the bar chart's floor of
  // 4 would push that whole shape into the bottom third of the plot.
  const peak = Math.max(1, ...points.map((p) => Math.max(p.today, p.typical)));
  const max = peak <= 2 ? 2 : Math.ceil(peak / 2) * 2;
  const ticks = [0, max / 2, max];
  const step = points.length > 1 ? plotW / (points.length - 1) : 0;
  const x = (i: number) => PAD.left + step * i;
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const line = (pick: (i: number) => number, upTo = points.length - 1) =>
    points
      .slice(0, upTo + 1)
      .map((_, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(pick(i)).toFixed(1)}`)
      .join(' ');

  // Today's line stops at the hour we're in: the rest of the day hasn't
  // happened, and a line running to zero would read as a collapse in traffic.
  const nowIndex = Math.max(0, points.findIndex((p) => p.hour === currentHour));
  const todayPath = line((i) => points[i].today, nowIndex);
  const typicalPath = line((i) => points[i].typical);
  const round1 = (n: number) => Math.round(n * 10) / 10;

  const active = hover === null ? null : points[hover];

  return (
    <figure className="bviz bviz-pulse" role="group" aria-label={t('Today vs a normal day')}>
      <div className="bviz-head">
        <figcaption className="bviz-title font-mono">{t('Today vs a normal day')}</figcaption>
        <ul className="bviz-legend">
          <li>
            <span className="bviz-swatch" style={{ background: SERIES_A }} aria-hidden />
            {t('Today')}
          </li>
          <li>
            <span className="bviz-swatch is-dashed" style={{ borderColor: SERIES_B }} aria-hidden />
            {t('Normal day')}
          </li>
        </ul>
      </div>

      <div className="bviz-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          onPointerLeave={() => setHover(null)}
          role="img"
          aria-label={t('Clients in the chair by hour, today against a normal day')}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line className="bviz-grid" x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} />
              <text className="bviz-axis" x={PAD.left - 6} y={y(tick) + 3} textAnchor="end">
                {round1(tick)}
              </text>
            </g>
          ))}

          <path className="bviz-line is-typical" d={typicalPath} fill="none" stroke={SERIES_B} />
          <path className="bviz-line" d={todayPath} fill="none" stroke={SERIES_A} />

          {points.slice(0, nowIndex + 1).map((p, i) => (
            <circle key={p.hour} className="bviz-dot" cx={x(i)} cy={y(p.today)} r={4} fill={SERIES_A} />
          ))}

          {active && (
            <g>
              <line
                className="bviz-crosshair"
                x1={x(hover!)}
                x2={x(hover!)}
                y1={PAD.top}
                y2={PAD.top + plotH}
              />
              <circle className="bviz-dot is-on" cx={x(hover!)} cy={y(active.typical)} r={5} fill={SERIES_B} />
              {hover! <= nowIndex && (
                <circle className="bviz-dot is-on" cx={x(hover!)} cy={y(active.today)} r={5} fill={SERIES_A} />
              )}
            </g>
          )}

          {points.map((p, i) => (
            <g key={`hit-${p.hour}`}>
              <rect
                className="bviz-hit"
                x={x(i) - step / 2}
                y={PAD.top}
                width={Math.max(step, 8)}
                height={plotH}
                onPointerEnter={() => setHover(i)}
              />
              {i % 2 === 0 && (
                <text className="bviz-axis" x={x(i)} y={H - 6} textAnchor="middle">
                  {hourLabel(p.hour)}
                </text>
              )}
            </g>
          ))}
        </svg>

        {active && (
          <div
            className="bviz-tip font-mono"
            style={{
              left: `${(x(hover!) / W) * 100}%`,
              // Nudge the box inside the card at the ends of the day rather
              // than letting it hang off the edge.
              transform:
                x(hover!) / W < 0.18
                  ? 'translateX(0)'
                  : x(hover!) / W > 0.82
                    ? 'translateX(-100%)'
                    : 'translateX(-50%)',
            }}
            role="presentation"
          >
            <strong>{hourLabel(active.hour)}</strong>
            {hover! <= nowIndex && (
              <span>
                <span className="bviz-tip-swatch" style={{ background: SERIES_A }} aria-hidden />
                {t('Today')}: {active.today}
              </span>
            )}
            <span>
              <span className="bviz-tip-swatch" style={{ background: SERIES_B }} aria-hidden />
              {t('Normal day')}: {round1(active.typical)}
            </span>
          </div>
        )}
      </div>

      <p className="bviz-note font-sans">
        {activeDays > 0
          ? t('{n} in the chair so far — a normal day has {m} by now.', {
              n: pulse.todayTotal,
              m: round1(pulse.typicalToDate),
            })
          : t('{n} in the chair so far. A few more days in the chair and the normal-day line fills in.', {
              n: pulse.todayTotal,
            })}
      </p>

      <table className="sr-only">
        <caption>{t('Clients in the chair by hour, today against a normal day')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('Hour')}</th>
            <th scope="col">{t('Today')}</th>
            <th scope="col">{t('Normal day')}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={p.hour}>
              <th scope="row">{hourLabel(p.hour)}</th>
              <td>{i <= nowIndex ? p.today : '—'}</td>
              <td>{round1(p.typical)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

// ── paired horizontal bars: tried in the mirror vs chosen ───────────────────

export interface CutRow {
  label: string;
  tried: number;
  chosen: number;
}

export function TriedVsChosenBars({ rows }: { rows: CutRow[] }) {
  const t = useT();
  // Same density dial as ActivityBars above, same 985 so the two charts stack
  // on Insights at one type size: labels, bars and row rhythm all render ~35%
  // smaller than the old 640-unit box without changing a single px in CSS.
  const W = 985;
  const ROW_H = 54;
  const PAD = { top: 6, right: 40, bottom: 6, left: 4 };
  const LABEL_H = 18;
  const H = PAD.top + rows.length * ROW_H + PAD.bottom;
  const plotW = W - PAD.left - PAD.right;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.tried, r.chosen)));
  const len = (v: number) => Math.max(v > 0 ? 3 : 0, (v / max) * plotW);

  return (
    <figure className="bviz" role="group" aria-label={t('Tried vs chosen, last 7 days')}>
      <div className="bviz-head">
        <figcaption className="bviz-title font-mono">{t('Tried vs chosen')}</figcaption>
        <ul className="bviz-legend">
          <li>
            <span className="bviz-swatch" style={{ background: SERIES_A }} aria-hidden />
            {t('Tried in the mirror')}
          </li>
          <li>
            <span className="bviz-swatch" style={{ background: SERIES_C }} aria-hidden />
            {t('Chosen')}
          </li>
        </ul>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`}>
        {rows.map((row, i) => {
          const top = PAD.top + i * ROW_H;
          const bar1Y = top + LABEL_H + 2;
          const bar2Y = bar1Y + 10; // 8px bar + 2px surface gap
          return (
            <g key={row.label}>
              <text className="bviz-rowlabel" x={PAD.left} y={top + 11}>
                {t(row.label)}
              </text>
              <rect className="bviz-bar" x={PAD.left} y={bar1Y} width={len(row.tried)} height={8} rx={4} fill={SERIES_A}>
                <title>{`${t(row.label)} — ${t('Tried in the mirror')}: ${row.tried}`}</title>
              </rect>
              {/* small dataset → direct value labels at the data ends */}
              <text className="bviz-value" x={PAD.left + len(row.tried) + 6} y={bar1Y + 8}>
                {row.tried}
              </text>
              <rect className="bviz-bar" x={PAD.left} y={bar2Y} width={len(row.chosen)} height={8} rx={4} fill={SERIES_C}>
                <title>{`${t(row.label)} — ${t('Chosen')}: ${row.chosen}`}</title>
              </rect>
              <text className="bviz-value" x={PAD.left + len(row.chosen) + 6} y={bar2Y + 8}>
                {row.chosen}
              </text>
            </g>
          );
        })}
      </svg>

      <table className="sr-only">
        <caption>{t('Tried vs chosen, last 7 days')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('Cut')}</th>
            <th scope="col">{t('Tried in the mirror')}</th>
            <th scope="col">{t('Chosen')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{t(row.label)}</th>
              <td>{row.tried}</td>
              <td>{row.chosen}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
