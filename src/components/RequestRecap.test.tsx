// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import RequestRecap from './RequestRecap';

afterEach(() => cleanup());

const prompts = [
  { prompt: 'low taper fade', at: Date.UTC(2026, 9, 1) },
  { prompt: 'textured crop', at: Date.UTC(2026, 9, 2) },
  { prompt: 'mid fade with a fringe', at: Date.UTC(2026, 9, 3) },
];

describe('RequestRecap', () => {
  it('shows the latest request as this cut and the rest as earlier tries, newest first', () => {
    render(<RequestRecap prompts={prompts} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog', { name: 'Your requests' });
    expect(within(dialog).getByText('mid fade with a fringe')).toHaveClass('recap-current');
    const earlier = within(dialog).getAllByRole('listitem').map((li) => li.firstChild?.textContent);
    expect(earlier).toEqual(['textured crop', 'low taper fade']);
  });

  it('explains the empty state', () => {
    render(<RequestRecap prompts={[]} onClose={() => {}} />);
    expect(screen.getByText(/no requests yet/i)).toBeInTheDocument();
  });

  it('closes on Escape, the close button and the backdrop — not on clicks inside', () => {
    const onClose = vi.fn();
    render(<RequestRecap prompts={prompts} onClose={onClose} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(document.querySelector('.recap-backdrop')!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
