// @vitest-environment jsdom

// The sign-in screen is the first thing a shop monitor shows, so the language
// toggle has to work before anyone is signed in — no settings door in the way.

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const updateLanguageMock = vi.fn();
let currentLanguage = 'ja';

vi.mock('@clerk/nextjs', () => ({
  useUser: () => ({ isSignedIn: false }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock('@/contexts/SettingsContext', () => ({
  useSettings: () => ({ language: currentLanguage, updateLanguage: updateLanguageMock }),
}));
vi.mock('@/lib/i18n', () => ({
  useT: () => (s: string) => s,
}));
vi.mock('@/components/SignUpWidget', () => ({
  default: () => <div data-testid="sign-up-widget" />,
}));

import SignInPage from './page';

beforeEach(() => {
  currentLanguage = 'ja';
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('the sign-in language toggle', () => {
  test('offers English and Japanese, marking the active one', () => {
    render(<SignInPage />);
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '日本語' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('tapping a language switches the whole app, not just this page', () => {
    render(<SignInPage />);
    fireEvent.click(screen.getByRole('button', { name: 'English' }));
    expect(updateLanguageMock).toHaveBeenCalledWith('en');
  });

  test('the sign-in form itself still renders below the toggle', () => {
    render(<SignInPage />);
    expect(screen.getByTestId('sign-up-widget')).toBeInTheDocument();
  });
});
