// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/components/BarberVideoResult', () => ({ default: () => <div data-testid="preview" /> }));

import BarberVideoCard from './BarberVideoCard';

afterEach(() => cleanup());

describe('BarberVideoCard', () => {
  it('idle: the 360° button records', () => {
    const onRequestVideo = vi.fn();
    render(<BarberVideoCard onRequestVideo={onRequestVideo} videoState="idle" />);
    fireEvent.click(screen.getByRole('button', { name: /record a 360° video/i }));
    expect(onRequestVideo).toHaveBeenCalledOnce();
  });

  it('while capturing, the same button shows progress and cancels (no extra layout)', () => {
    const onCancelVideo = vi.fn();
    const onRequestVideo = vi.fn();
    render(<BarberVideoCard onRequestVideo={onRequestVideo} onCancelVideo={onCancelVideo} videoState="recording" videoProgress={0.4} />);
    expect(screen.getByRole('progressbar', { name: /recording the 360° video/i })).toHaveAttribute('aria-valuenow', '40');
    fireEvent.click(screen.getByRole('button', { name: /cancel the 360° video/i }));
    expect(onCancelVideo).toHaveBeenCalledOnce();
    expect(onRequestVideo).not.toHaveBeenCalled();
    expect(document.querySelector('.receipt-stub')).toBeNull();
  });

  it('a finished clip can be hidden and shown again without losing it', () => {
    render(<BarberVideoCard videoState="ready" videoUrl="blob:clip" />);
    expect(screen.getByTestId('preview')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /hide the 360° preview/i }));
    expect(screen.queryByTestId('preview')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /show the 360° preview/i }));
    expect(screen.getByTestId('preview')).toBeInTheDocument();
  });
});
