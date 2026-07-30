// @vitest-environment jsdom

// Account deletion is the one flow where a stuck spinner is worse than an
// error: the person can't tell whether their data is gone. These tests pin
// the rule that every outcome — server refusal, network failure, success —
// ends with a message and a button that works again.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@clerk/nextjs', () => ({ useUser: () => ({ isSignedIn: true }) }));

import { DeleteAccountPanel } from './DeleteAccountPanel';

function armThePanel() {
  render(<DeleteAccountPanel />);
  fireEvent.change(screen.getByLabelText('Type DELETE to confirm account deletion'), {
    target: { value: 'DELETE' },
  });
  return screen.getByRole('button', { name: 'Delete my account and data' });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
});

describe('DeleteAccountPanel', () => {
  it('shows the server’s error copy when deletion is refused', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Deletion failed. Please contact support.' }) }),
    );

    const button = armThePanel();
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText('Deletion failed. Please contact support.')).toBeTruthy();
    });
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('never sticks on "Deleting..." when the network drops — says the account was not deleted', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    const button = armThePanel();
    fireEvent.click(button);

    await waitFor(() => {
      expect(
        screen.getByText('Couldn’t reach the server — your account was not deleted. Check your connection and try again.'),
      ).toBeTruthy();
    });
    expect(button.textContent).toBe('Delete my account and data');
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('confirms success in plain language', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    const button = armThePanel();
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByText(/deletion request was processed/i)).toBeTruthy();
    });
  });
});
