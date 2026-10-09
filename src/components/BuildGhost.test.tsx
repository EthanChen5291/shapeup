// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { BuildGhost } from './BuildGhost';

vi.mock('@/lib/i18n', () => ({ useT: () => (s: string) => s }));

afterEach(() => cleanup());

describe('BuildGhost', () => {
  it('renders the eyebrow text in building state', () => {
    render(<BuildGhost state="building" />);
    expect(screen.getByText(/building your 3D model/i)).toBeInTheDocument();
  });

  it('renders the BuildSubtitle in building state', () => {
    render(<BuildGhost state="building" />);
    // The first BUILD_PHRASE is "Building model"
    expect(screen.getByText(/Building model/i)).toBeInTheDocument();
  });

  it('does not render the eyebrow in failed state', () => {
    render(<BuildGhost state="failed" />);
    expect(screen.queryByText(/building your 3D model/i)).toBeNull();
  });

  it('renders children in failed state', () => {
    render(
      <BuildGhost state="failed">
        <div data-testid="error-card">Build failed. Try again.</div>
      </BuildGhost>
    );
    expect(screen.getByTestId('error-card')).toBeInTheDocument();
  });

  it('does not render children in building state', () => {
    render(
      <BuildGhost state="building">
        <div data-testid="error-card">Error</div>
      </BuildGhost>
    );
    expect(screen.queryByTestId('error-card')).toBeNull();
  });

  it('hides label in revealing state (opacity 0)', () => {
    const { container } = render(<BuildGhost state="revealing" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.style.opacity).toBe('0');
  });
});
