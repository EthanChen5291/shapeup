// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import AdminTakesPage from './page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stubTakes(takes: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ json: async () => ({ takes }) })),
  );
}

describe('AdminTakesPage', () => {
  it('shows the verbatim prompt next to every snapshot the take captured', async () => {
    const prompt = 'Change ONLY the hair on the head. Give this person a low taper fade.';
    stubTakes([
      {
        id: 't1',
        barberSlug: 'marcus',
        cutLabel: 'Low taper',
        prompt,
        status: 'approved',
        durationMs: 12_300,
        snapshots: [
          { tMs: 0, url: 'https://convex.test/snap-0' },
          { tMs: 3_000, url: 'https://convex.test/snap-3' },
        ],
        videoUrl: 'https://convex.test/video',
        posterUrl: null,
        createdAt: Date.now(),
      },
    ]);

    render(<AdminTakesPage />);
    expect(await screen.findByText(prompt)).toBeInTheDocument();
    expect(screen.getByAltText('Camera at 0.0s into the take')).toHaveAttribute(
      'src',
      'https://convex.test/snap-0',
    );
    expect(screen.getByAltText('Camera at 3.0s into the take')).toHaveAttribute(
      'src',
      'https://convex.test/snap-3',
    );
    // 'approved' is both a filter button and this row's status chip.
    expect(screen.getAllByText('approved')).toHaveLength(2);
    expect(screen.getByText('/b/marcus')).toBeInTheDocument();
    expect(screen.getByText('12.3s')).toBeInTheDocument();
  });

  it('says so when a take has no snapshots or footage', async () => {
    stubTakes([
      {
        id: 't2',
        barberSlug: null,
        cutLabel: 'Buzz',
        prompt: 'buzz it',
        status: 'discarded',
        durationMs: 0,
        snapshots: [],
        videoUrl: null,
        posterUrl: null,
        createdAt: Date.now(),
      },
    ]);

    render(<AdminTakesPage />);
    expect(await screen.findByText('no snapshots')).toBeInTheDocument();
    expect(screen.getByText('no video')).toBeInTheDocument();
  });

  it('surfaces the API error instead of an empty list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ json: async () => ({ error: 'Forbidden' }) })),
    );
    render(<AdminTakesPage />);
    expect(await screen.findByText(/Forbidden/)).toBeInTheDocument();
  });
});
