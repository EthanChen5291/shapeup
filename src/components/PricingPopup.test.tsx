// @vitest-environment jsdom

// A buy click that fails must say so in the popup — before this test existed,
// a failed checkout just stopped the spinner and left the person staring at
// the same three cards.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { startCheckoutMock } = vi.hoisted(() => ({ startCheckoutMock: vi.fn() }));
vi.mock('@/lib/checkout', () => ({ startCheckout: startCheckoutMock }));

import { PricingPopup } from './PricingPopup';

beforeEach(() => {
  startCheckoutMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('PricingPopup buy errors', () => {
  it('shows the checkout error inline when the buy fails', async () => {
    startCheckoutMock.mockResolvedValue({
      ok: false,
      error: 'Couldn’t open checkout. Check your connection and try again.',
    });

    render(<PricingPopup onDismiss={() => {}} />);
    fireEvent.click(screen.getByText('Get 50 looks'));

    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toBe(
        'Couldn’t open checkout. Check your connection and try again.',
      );
    });
  });

  it('clears a previous error when a new buy starts', async () => {
    startCheckoutMock.mockResolvedValueOnce({ ok: false, error: 'Couldn’t open checkout. Check your connection and try again.' });

    render(<PricingPopup onDismiss={() => {}} />);
    fireEvent.click(screen.getByText('Get 50 looks'));
    await waitFor(() => {
      expect(screen.queryByRole('alert')).not.toBeNull();
    });

    // The retry resolves to a navigation; the stale error must be gone.
    startCheckoutMock.mockResolvedValueOnce({ ok: true, url: 'https://stripe.test/s' });
    fireEvent.click(screen.getByText('Get 50 looks'));
    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });
});
