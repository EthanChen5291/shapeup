// @vitest-environment jsdom

// The chair's waiting screen. Two things matter: it draws the layout that is
// about to arrive (a spinner would have said nothing about where to reach),
// and the grey shapes stay out of the accessibility tree so a screen reader
// hears "Loading…" once rather than a list of empty rows.

import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ChairSkeleton, { ChairRosterSkeleton } from './ChairSkeleton';

afterEach(cleanup);

describe('ChairSkeleton', () => {
  test('draws the roster layout, not a spinner', () => {
    const { container } = render(<ChairSkeleton />);

    expect(container.querySelector('.chair-spinner')).toBeNull();
    // The header, the Next-client slab, and rows where clients will land.
    expect(container.querySelector('.chair-skel-title')).not.toBeNull();
    expect(container.querySelector('.chair-skel-next')).not.toBeNull();
    expect(container.querySelectorAll('.chair-skel-row')).toHaveLength(3);
  });

  test('marks the page busy and announces the wait once', () => {
    render(<ChairSkeleton />);

    expect(screen.getByRole('main')).toHaveProperty('ariaBusy', 'true');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe('Loading…');
  });

  test('hides the placeholder shapes from assistive tech', () => {
    const { container } = render(<ChairSkeleton />);

    // Every skeleton block sits inside something aria-hidden, so the rows
    // never read as an empty client list.
    for (const block of container.querySelectorAll('.chair-skel, .chair-skel-row')) {
      expect(block.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  test('roster skeleton renders the asked-for number of rows', () => {
    const { container } = render(<ChairRosterSkeleton rows={5} />);

    expect(container.querySelectorAll('.chair-skel-row')).toHaveLength(5);
    // Staggered, so the rows fade up in sequence rather than as one block.
    const first = container.querySelector<HTMLElement>('.chair-skel-row');
    const last = container.querySelectorAll<HTMLElement>('.chair-skel-row')[4];
    expect(first?.style.animationDelay).toBe('0ms');
    expect(last?.style.animationDelay).toBe('360ms');
  });
});
