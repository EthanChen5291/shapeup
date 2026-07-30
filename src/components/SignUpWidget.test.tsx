// @vitest-environment jsdom

// The sign-up card's two shapes: the default staged flow (email first, Google
// alongside) and the credentials-only card the chair gate uses — email and
// password on one screen, no Google, no staged "Continue with email".

import { afterEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@clerk/nextjs', () => ({ useUser: () => ({ isSignedIn: false }) }));
vi.mock('@clerk/nextjs/legacy', () => ({
  useSignIn: () => ({ signIn: undefined }),
  useSignUp: () => ({ signUp: undefined, setActive: undefined }),
}));
vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/AppUI', () => ({
  BouncyButton: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
}));

import SignUpWidget from './SignUpWidget';

afterEach(cleanup);

test('default card: staged email flow with the Google door', () => {
  const { container } = render(<SignUpWidget onEnter={() => {}} />);

  expect(container.querySelector('input[type="email"]')).not.toBeNull();
  // Password comes on the next step, not this screen.
  expect(container.querySelector('input[type="password"]')).toBeNull();
  expect(screen.getByText(/Continue with Google/)).toBeDefined();
});

test('credentialsOnly: email + password on one screen, no Google', () => {
  const { container } = render(<SignUpWidget onEnter={() => {}} credentialsOnly />);

  expect(container.querySelector('input[type="email"]')).not.toBeNull();
  expect(container.querySelector('input[type="password"]')).not.toBeNull();
  expect(screen.queryByText(/Continue with Google/)).toBeNull();
  expect(screen.queryByText(/Continue with email/)).toBeNull();
});

test('scale zooms the card and compensates its width', () => {
  const { container } = render(<SignUpWidget onEnter={() => {}} scale={1.25} />);

  const card = container.firstElementChild as HTMLElement;
  expect(card.style.zoom).toBe('1.25');
  // jsdom folds calc(100% / 1.25) to calc(80%) — either spelling is the
  // compensated width, just not a bare 100% that would overflow when zoomed.
  expect(card.style.width).toMatch(/calc\((100% \/ 1\.25|80%)\)/);
});
