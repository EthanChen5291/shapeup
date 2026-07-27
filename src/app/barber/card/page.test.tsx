// @vitest-environment jsdom

// The builder's hydration gate: the saved card decides the page's headline and
// every field's value, so nothing may paint until getMine has landed —
// otherwise a barber who already has a card sees "Build your barber card" and
// empty inputs flash first. Convex is stubbed per function reference, same
// approach as BarberDashboard.test.tsx.

import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

vi.mock('@convex/_generated/api', () => ({
  api: {
    barberPages: { getMine: 'barberPages:getMine', upsert: 'barberPages:upsert' },
    barberTryOn: { generateUploadUrl: 'barberTryOn:generateUploadUrl' },
    users: { getReferralStats: 'users:getReferralStats' },
  },
}));

const queryResults: Record<string, unknown> = {};
vi.mock('convex/react', () => ({
  useQuery: (ref: string) => queryResults[ref],
  useMutation: () => vi.fn(async () => null),
  useConvex: () => ({ query: vi.fn(async () => null) }),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/components/barber/BarberShell', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import BarberBuilderPage from './page';

const savedCard = {
  slug: 'dre-cuts',
  displayName: 'Dre',
  shopName: 'Fade Room',
  bio: '',
  location: '',
  hours: '',
  contactEmail: '',
  styles: [],
  published: true,
  links: [],
  services: [],
  avatarUrl: null,
  bannerUrl: null,
};

beforeEach(() => {
  for (const key of Object.keys(queryResults)) delete queryResults[key];
});
afterEach(cleanup);

test('shows nothing but a loading line while the saved card is in flight', () => {
  queryResults['barberPages:getMine'] = undefined; // query still loading
  render(<BarberBuilderPage />);

  expect(screen.getByText('Loading…')).toBeInTheDocument();
  // Neither headline may appear before we know which one is right.
  expect(screen.queryByText('Build your barber card')).not.toBeInTheDocument();
  expect(screen.queryByText('Your barber card')).not.toBeInTheDocument();
});

test('a barber with a saved card only ever sees the saved-card headline', async () => {
  queryResults['barberPages:getMine'] = savedCard;
  await act(async () => {
    render(<BarberBuilderPage />);
  });

  expect(screen.getByText('Your barber card')).toBeInTheDocument();
  expect(screen.queryByText('Build your barber card')).not.toBeInTheDocument();
  expect(screen.getByDisplayValue('Dre')).toBeInTheDocument();
});

test('the profile-photo hint only speaks when there is no photo yet', async () => {
  // Once a photo is in, the thumbnail and the Replace button carry the whole
  // message — the helper line under them is noise and must not come back.
  queryResults['barberPages:getMine'] = { ...savedCard, avatarUrl: 'https://cdn.example/dre.jpg' };
  await act(async () => {
    render(<BarberBuilderPage />);
  });

  expect(screen.queryByText(/Looking sharp/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Clients trust a face/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument();

  cleanup();
  queryResults['barberPages:getMine'] = savedCard; // avatarUrl: null
  await act(async () => {
    render(<BarberBuilderPage />);
  });
  expect(screen.getByText(/Clients trust a face/)).toBeInTheDocument();
});

test('a barber with no card yet gets the first-run headline', async () => {
  queryResults['barberPages:getMine'] = null; // loaded, nothing saved
  await act(async () => {
    render(<BarberBuilderPage />);
  });

  expect(screen.getByText('Build your barber card')).toBeInTheDocument();
});
