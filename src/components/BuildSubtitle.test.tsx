// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { BuildSubtitle, BUILD_PHRASES } from './BuildSubtitle';

// Stub i18n so we don't need provider plumbing
vi.mock('@/lib/i18n', () => ({ useT: () => (s: string) => s }));

afterEach(() => cleanup());

describe('BuildSubtitle', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('renders the first phrase on mount', () => {
    render(<BuildSubtitle />);
    expect(screen.getByText(new RegExp(BUILD_PHRASES[0], 'i'))).toBeInTheDocument();
  });

  it('rotates to the next phrase after 4 s', () => {
    render(<BuildSubtitle />);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.getByText(new RegExp(BUILD_PHRASES[1], 'i'))).toBeInTheDocument();
  });

  it('accepts a custom color and size', () => {
    const { container } = render(<BuildSubtitle color="red" size={20} />);
    const p = container.querySelector('p');
    expect(p?.style.color).toBe('red');
    expect(p?.style.fontSize).toBe('20px');
  });
});
