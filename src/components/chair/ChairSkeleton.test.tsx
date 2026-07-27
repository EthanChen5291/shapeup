// @vitest-environment jsdom

// The chair's waiting screen. Two things matter: it draws the layout that is
// about to arrive (a spinner would have said nothing about where to reach),
// and the grey shapes stay out of the accessibility tree so a screen reader
// hears "Loading…" once rather than a pile of empty boxes.

import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ChairSkeleton from './ChairSkeleton';

afterEach(cleanup);

describe('ChairSkeleton', () => {
  test('draws the home-screen layout, not a spinner', () => {
    const { container } = render(<ChairSkeleton />);

    expect(container.querySelector('.chair-spinner')).toBeNull();
    // The header and the name form's shapes. No client rows — the home screen
    // faces whoever is in the chair, so it never lists other clients.
    expect(container.querySelector('.chair-skel-title')).not.toBeNull();
    expect(container.querySelector('.chair-skel-heading')).not.toBeNull();
    expect(container.querySelectorAll('.chair-skel-input')).toHaveLength(2);
    expect(container.querySelector('.chair-skel-btn')).not.toBeNull();
    expect(container.querySelector('.chair-skel-row')).toBeNull();
  });

  test('marks the page busy and announces the wait once', () => {
    render(<ChairSkeleton />);

    expect(screen.getByRole('main')).toHaveProperty('ariaBusy', 'true');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toBe('Loading…');
  });

  test('hides the placeholder shapes from assistive tech', () => {
    const { container } = render(<ChairSkeleton />);

    // Every skeleton block sits inside something aria-hidden, so the shapes
    // never read as empty content.
    for (const block of container.querySelectorAll('.chair-skel')) {
      expect(block.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });
});
