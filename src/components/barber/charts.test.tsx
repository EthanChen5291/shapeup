// @vitest-environment jsdom

// The Insights charts are width:100% svgs, so the viewBox is what decides how
// big their labels and bars actually land on the page. These lock the density
// in: both charts share one scale, and neither renders at the old blown-up
// 640-unit size where a row label read bigger than the page's body copy.

import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { ActivityBars, SERIES_A, SERIES_B, SERIES_C, TriedVsChosenBars } from './charts';

// The charts read the app language through useT() → useSettings(); standing up
// the real provider would drag Convex in for one string.
const settings = vi.hoisted(() => ({ language: 'en' }));
vi.mock('@/contexts/SettingsContext', () => ({ useSettings: () => settings }));

const viewBox = (el: HTMLElement) =>
  el
    .querySelector('svg')!
    .getAttribute('viewBox')!
    .split(' ')
    .map(Number);

afterEach(() => {
  cleanup();
  settings.language = 'en';
});

describe('insights chart density', () => {
  const rows = [
    { label: 'low taper fade, textured fringe', tried: 4, chosen: 2 },
    { label: 'butterfly blowout, curtain bangs', tried: 3, chosen: 2 },
  ];
  const points = Array.from({ length: 14 }, (_, i) => ({
    dayKey: `2026-07-${String(i + 1).padStart(2, '0')}`,
    takes: i % 3,
    visits: i % 2,
  }));

  test('both charts scale to the same user-unit width', () => {
    render(<TriedVsChosenBars rows={rows} />);
    render(<ActivityBars points={points} />);

    const [, , triedW] = viewBox(screen.getByRole('group', { name: /tried vs chosen/i }));
    const [, , activityW] = viewBox(screen.getByRole('group', { name: /chair activity/i }));

    expect(triedW).toBe(activityW);
    // Well past 640: at that width the charts rendered ~50% larger than the
    // surrounding dashboard type on the wide Insights column.
    expect(triedW).toBeGreaterThanOrEqual(900);
  });

  test('a row of cuts stays short against its own width', () => {
    render(<TriedVsChosenBars rows={rows} />);
    const [, , w, h] = viewBox(screen.getByRole('group', { name: /tried vs chosen/i }));

    // Each cut — label plus its pair of bars — costs under 6.5% of the chart's
    // width in height; the ratio, not a pixel, is what the render follows. The
    // old 640-unit box put a row at 7.8%. The ceiling moved up from 5.5% when
    // rows were deliberately loosened: at 46 units a row's label sat on the bar
    // above it and consecutive cuts read as one block.
    expect(h / rows.length / w).toBeLessThan(0.065);
    // Values still label their bars: no clipping past the right gutter.
    expect(screen.getAllByText('4')).not.toHaveLength(0);
  });

  test("the busiest day's label clears the top of the activity plot", () => {
    // A day that hits the axis maximum puts its bar flush against the top
    // gridline, which is where the direct label has the least room. It used to
    // be drawn above the viewBox and got cut off by the svg's own edge.
    const topped = points.map((p, i) => (i === 5 ? { ...p, takes: 4 } : p));
    render(<ActivityBars points={topped} />);

    const chart = screen.getByRole('group', { name: /chair activity/i });
    const label = chart.querySelector('text.bviz-value')!;
    const y = Number(label.getAttribute('y'));

    // Baseline sits far enough down that a ~10px glyph's ascender still lands
    // inside the box rather than above y=0.
    expect(y).toBeGreaterThanOrEqual(12);
  });

  test('the activity plot is tall enough to read as a chart, not a strip', () => {
    render(<ActivityBars points={points} />);
    const [, , w, h] = viewBox(screen.getByRole('group', { name: /chair activity/i }));

    // 14 grouped pairs across a very wide box flatten into a rule if the height
    // ratio drops much below this; it was 13.4% when the bars looked squashed.
    expect(h / w).toBeGreaterThan(0.15);
  });

  // One hue means one thing per page: both charts sit on the Insights tab, so
  // "chosen" can't wear the teal that "chair visits" already owns above it.
  test('every series on the Insights tab has its own hue', () => {
    render(<ActivityBars points={points} />);
    render(<TriedVsChosenBars rows={rows} />);

    const fills = (name: RegExp) =>
      [...screen.getByRole('group', { name }).querySelectorAll('rect.bviz-bar')].map((r) =>
        r.getAttribute('fill'),
      );

    expect(new Set(fills(/chair activity/i))).toEqual(new Set([SERIES_A, SERIES_B]));
    expect(new Set(fills(/tried vs chosen/i))).toEqual(new Set([SERIES_A, SERIES_C]));
    expect(new Set([SERIES_A, SERIES_B, SERIES_C]).size).toBe(3);
  });

  // Cut names arrive as data, so they used to sit in English inside an
  // otherwise-Japanese chart — the one thing on the panel a barber reads first.
  test('cut names render in the reader’s language', () => {
    settings.language = 'ja';
    render(<TriedVsChosenBars rows={rows} />);

    expect(screen.getAllByText('ローフェード、束感の前髪')).not.toHaveLength(0);
    expect(screen.queryByText('low taper fade, textured fringe')).toBeNull();
  });

  test('a cut the dictionary has never seen still renders', () => {
    settings.language = 'ja';
    render(<TriedVsChosenBars rows={[{ label: 'freeform request', tried: 1, chosen: 0 }]} />);

    expect(screen.getAllByText('freeform request')).not.toHaveLength(0);
  });
});
