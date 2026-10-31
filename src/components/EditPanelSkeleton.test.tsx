// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { EditPanelSkeleton } from './EditPanelSkeleton';

afterEach(() => cleanup());

describe('EditPanelSkeleton', () => {
  it('announces itself as a loading region', () => {
    render(<EditPanelSkeleton />);
    expect(screen.getByRole('status', { name: /loading toolbox/i })).toBeInTheDocument();
  });

  it('mirrors the desktop toolbox: four trending rows and pulsing blocks', () => {
    render(<EditPanelSkeleton />);
    expect(screen.getAllByTestId('edit-panel-skeleton-row')).toHaveLength(4);
    expect(document.querySelectorAll('.skel.skel-pulse').length).toBeGreaterThan(8);
  });

  it('keeps the list rows one length and on one left edge (no ragged lines)', () => {
    render(<EditPanelSkeleton />);
    const widths = screen.getAllByTestId('edit-panel-skeleton-row').map(r => (r.firstElementChild as HTMLElement).style.width);
    expect(new Set(widths).size).toBe(1);
  });

  it('includes the show-your-barber card: a title line and its row of buttons', () => {
    render(<EditPanelSkeleton />);
    const card = screen.getByTestId('edit-panel-skeleton-barber');
    expect(card.querySelectorAll('.skel')).toHaveLength(4);
  });

  it('uses the shorter mobile layout', () => {
    render(<EditPanelSkeleton isMobile />);
    expect(screen.getAllByTestId('edit-panel-skeleton-row')).toHaveLength(3);
  });
});
