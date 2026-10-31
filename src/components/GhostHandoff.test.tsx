// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { STUDIO_SIDEBAR, studioTopPad } from '@/lib/studioLayout';
import {
  GhostHandoffProvider,
  HANDOFF_FADE_MS,
  HANDOFF_MAX_HOLD_MS,
  HANDOFF_SETTLE_MS,
  STUDIO_FRAME,
  predictStudioFrame,
  shouldReleaseOnPath,
  useGhostHandoff,
} from './GhostHandoff';

let pathname = '/dashboard';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('@/lib/i18n', () => ({ useT: () => (s: string) => s }));

function Controls() {
  const { beginHandoff, adoptHandoff, releaseHandoff } = useGhostHandoff();
  return (
    <>
      <button onClick={() => beginHandoff()}>begin</button>
      <button onClick={() => beginHandoff('loading')}>begin-loading</button>
      <button onClick={() => adoptHandoff({ top: 96, left: 24, width: 640, height: 480, radius: 24 })}>adopt</button>
      <button onClick={() => adoptHandoff()}>adopt-noframe</button>
      <button onClick={releaseHandoff}>release</button>
    </>
  );
}

function mount() {
  return render(
    <GhostHandoffProvider>
      <Controls />
    </GhostHandoffProvider>,
  );
}
const click = (label: string) => act(() => { screen.getByText(label).click(); });
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

beforeEach(() => { pathname = '/dashboard'; vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('GhostHandoffProvider', () => {
  it('renders nothing until a handoff begins', () => {
    mount();
    expect(screen.queryByTestId('ghost-handoff')).toBeNull();
  });

  it('raises the ghost inside the predicted studio frame on begin — never full-bleed', () => {
    mount();
    click('begin');
    const overlay = screen.getByTestId('ghost-handoff');
    expect(overlay).toBeInTheDocument();
    expect(screen.getByText(/building your 3D model/i)).toBeInTheDocument();
    // jsdom viewport is 1024×768 (desktop): frame = viewport minus sidebar and padding.
    const expected = predictStudioFrame(window.innerWidth, window.innerHeight, false);
    expect(screen.getByTestId('ghost-handoff-frame')).toHaveStyle({
      top: `${expected.top}px`,
      left: `${expected.left}px`,
      width: `${expected.width}px`,
      height: `${expected.height}px`,
      borderRadius: `${STUDIO_FRAME.radius}px`,
    });
  });

  it('opening an existing cut shows the quiet loading shadow, without the building subtitle', () => {
    mount();
    click('begin-loading');
    expect(screen.getByTestId('ghost-handoff')).toBeInTheDocument();
    expect(screen.queryByText(/building your 3D model/i)).toBeNull();
  });

  it('predicts the frame from the edit-panel width this browser last used', () => {
    const store = new Map([[STUDIO_SIDEBAR.key, '500']]);
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: () => {}, removeItem: () => {} });
    try {
      mount();
      click('begin');
      const expected = predictStudioFrame(window.innerWidth, window.innerHeight, false, 500);
      expect(screen.getByTestId('ghost-handoff-frame')).toHaveStyle({ width: `${expected.width}px` });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sits above the scan popup and the dashboard pill', () => {
    mount();
    click('begin');
    expect(screen.getByTestId('ghost-handoff')).toHaveStyle({ zIndex: '10001' });
  });

  it('settles into the studio frame on adopt, then fades out and unmounts', () => {
    mount();
    click('begin');
    click('adopt');
    const frame = screen.getByTestId('ghost-handoff-frame');
    expect(frame).toHaveStyle({ top: '96px', left: '24px', width: '640px', height: '480px', borderRadius: '24px' });
    expect(screen.getByTestId('ghost-handoff')).toHaveAttribute('data-status', 'settle');
    tick(HANDOFF_SETTLE_MS);
    expect(screen.getByTestId('ghost-handoff')).toHaveAttribute('data-status', 'out');
    tick(HANDOFF_FADE_MS);
    expect(screen.queryByTestId('ghost-handoff')).toBeNull();
  });

  it('fades straight out when adopted without a frame', () => {
    mount();
    click('begin');
    click('adopt-noframe');
    expect(screen.getByTestId('ghost-handoff')).toHaveAttribute('data-status', 'out');
    tick(HANDOFF_FADE_MS);
    expect(screen.queryByTestId('ghost-handoff')).toBeNull();
  });

  it('ignores adopt when no handoff is active', () => {
    mount();
    click('adopt');
    expect(screen.queryByTestId('ghost-handoff')).toBeNull();
  });

  it('releases on its own if the studio never adopts', () => {
    mount();
    click('begin');
    tick(HANDOFF_MAX_HOLD_MS);
    expect(screen.getByTestId('ghost-handoff')).toHaveAttribute('data-status', 'out');
    tick(HANDOFF_FADE_MS);
    expect(screen.queryByTestId('ghost-handoff')).toBeNull();
  });

  it('releases when navigation lands somewhere other than the studio', () => {
    const view = mount();
    click('begin');
    pathname = '/';
    view.rerender(
      <GhostHandoffProvider>
        <Controls />
      </GhostHandoffProvider>,
    );
    expect(screen.getByTestId('ghost-handoff')).toHaveAttribute('data-status', 'out');
  });

  it('stays up when navigation lands on the studio', () => {
    const view = mount();
    click('begin');
    pathname = '/studio/abc123';
    view.rerender(
      <GhostHandoffProvider>
        <Controls />
      </GhostHandoffProvider>,
    );
    expect(screen.getByTestId('ghost-handoff')).not.toHaveAttribute('data-status', 'out');
  });
});

describe('predictStudioFrame', () => {
  it('mirrors the desktop studio layout: top pad, 16px left gutter, resizer + edit panel on the right', () => {
    const top = studioTopPad(900);
    expect(predictStudioFrame(1440, 900, false)).toEqual({ top, left: 16, width: 1440 - 370 - 10 - 16 - 24, height: 900 - top - 24, radius: 24 });
    expect(predictStudioFrame(1440, 900, false, 480).width).toBe(1440 - 480 - 10 - 16 - 24);
  });
  it('mirrors the mobile studio layout: 46vh region with p-2 pt-20', () => {
    expect(predictStudioFrame(390, 844, true)).toEqual({ top: 80, left: 8, width: 390 - 16, height: Math.round(844 * 0.46) - 80 - 8, radius: 24 });
  });
  it('never returns negative sizes', () => {
    const f = predictStudioFrame(100, 50, false);
    expect(f.width).toBeGreaterThanOrEqual(0);
    expect(f.height).toBeGreaterThanOrEqual(0);
  });
});

describe('shouldReleaseOnPath', () => {
  it('keeps the ghost for studio routes only', () => {
    expect(shouldReleaseOnPath('/studio/abc')).toBe(false);
    expect(shouldReleaseOnPath('/dashboard')).toBe(true);
    expect(shouldReleaseOnPath('/')).toBe(true);
    expect(shouldReleaseOnPath(null)).toBe(false);
  });
});
