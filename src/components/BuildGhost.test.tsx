// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BuildGhost, GHOST_VB_H, ghostGeometry } from './BuildGhost';

vi.mock('@/lib/i18n', () => ({ useT: () => (s: string) => s }));

afterEach(() => cleanup());

describe('BuildGhost', () => {
  it('renders the eyebrow text in building state', () => {
    render(<BuildGhost state="building" />);
    expect(screen.getByText(/building your 3D model/i)).toBeInTheDocument();
  });

  it('renders the BuildSubtitle in building state', () => {
    render(<BuildGhost state="building" />);
    expect(screen.getByText(/Building model/i)).toBeInTheDocument();
  });

  it('does not render the eyebrow in failed state', () => {
    render(<BuildGhost state="failed" />);
    expect(screen.queryByText(/building your 3D model/i)).toBeNull();
  });

  it('renders children in failed state only', () => {
    render(
      <BuildGhost state="failed">
        <div data-testid="error-card">Build failed. Try again.</div>
      </BuildGhost>
    );
    expect(screen.getByTestId('error-card')).toBeInTheDocument();
    cleanup();
    render(
      <BuildGhost state="building">
        <div data-testid="error-card">Error</div>
      </BuildGhost>
    );
    expect(screen.queryByTestId('error-card')).toBeNull();
  });

  it('pulses the silhouette while building and not when failed', () => {
    const { container } = render(<BuildGhost state="building" />);
    const sil = container.querySelector('.build-ghost__silhouette');
    expect(sil).not.toBeNull();
    expect(sil?.classList.contains('build-ghost__svg--failed')).toBe(false);
    cleanup();
    const failed = render(<BuildGhost state="failed" />).container.querySelector('.build-ghost__silhouette');
    expect(failed?.classList.contains('build-ghost__svg--failed')).toBe(true);
  });

  it('fades out in revealing state', () => {
    const { container } = render(<BuildGhost state="revealing" />);
    expect((container.firstElementChild as HTMLElement).style.opacity).toBe('0');
  });

  it('draws the bust as one blurred outline plus a hair cap, in an aspect-matched viewBox', () => {
    const { container } = render(<BuildGhost state="building" />);
    const svgs = container.querySelectorAll('svg');
    expect(svgs).toHaveLength(1);
    const svg = screen.getByTestId('ghost-svg');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
    expect(svg.getAttribute('viewBox')).toMatch(new RegExp(`^0 0 \\d+ ${GHOST_VB_H}$`));

    const blur = container.querySelector('filter[id^="build-ghost-blur-"] feGaussianBlur');
    expect(blur).not.toBeNull();
    const body = screen.getByTestId('ghost-body');
    const hair = screen.getByTestId('ghost-hair');
    // Both live in the same blurred group → one shape, no seam.
    expect(body.parentElement).toBe(hair.parentElement);
    expect(body.parentElement?.getAttribute('filter')).toMatch(/^url\(#build-ghost-blur-/);
  });
});

describe('BuildGhost ids', () => {
  it('gives each instance its own SVG defs', () => {
    const { container } = render(<><BuildGhost state="building" /><BuildGhost state="building" /></>);
    const ids = Array.from(container.querySelectorAll('filter[id^="build-ghost-blur-"]')).map(f => f.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe('ghostGeometry', () => {
  it('keeps head proportions fixed while the shoulders reach past both edges', () => {
    for (const aspect of [0.56, 1, 1.27, 1.78]) {
      const { vbW, outline } = ghostGeometry(aspect);
      expect(vbW).toBe(Math.round(GHOST_VB_H * aspect));
      // Shoulders over-extend the viewBox on both sides and the bottom.
      expect(outline).toContain(`L ${vbW + 60} ${GHOST_VB_H + 60}`);
      expect(outline).toContain(`L -60 ${GHOST_VB_H + 60}`);
      // Head is centred and its width is aspect-independent (hair widest = cx ± 218).
      const cx = vbW / 2;
      expect(outline).toContain(`${(cx + 218).toFixed(1)} 536`);
      expect(outline).toContain(`${(cx - 218).toFixed(1)} 536`);
      expect(outline.startsWith(`M ${cx} 324`)).toBe(true);
    }
  });

  it('clamps absurd aspect ratios', () => {
    expect(ghostGeometry(0.01).vbW).toBe(300);
    expect(ghostGeometry(50).vbW).toBe(4000);
  });
});
