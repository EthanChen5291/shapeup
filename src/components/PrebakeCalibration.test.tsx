// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PrebakeCalibration, CALIBRATION_FIELDS } from './PrebakeCalibration';
import type { QuickTryOnsState } from './QuickTryOns';
import { PREBAKE_DEFAULT_TRANSFORM } from '@/lib/splatMerge';

afterEach(() => cleanup());

function fakeState(over: Partial<QuickTryOnsState> = {}): QuickTryOnsState {
  const variant = { id: 'middlepart_middlepart_brown', color: 'brown' as const, label: 'Brown', splatUrl: '/prebake/men/middlepart_brown.splat' };
  return {
    phase: 'on', stage: 'edit', progress: 1, errorDetail: null, gender: 'man', setGender: vi.fn(), merging: false,
    toggle: vi.fn(async () => {}), choose: vi.fn(async () => {}), canStart: true,
    calibrate: true, selected: variant,
    selectedCut: { id: 'middlepart', name: 'Middle Part', variants: [variant] },
    transform: { ...PREBAKE_DEFAULT_TRANSFORM },
    setTransform: vi.fn(), commitTransform: vi.fn(), resetTransform: vi.fn(), submitCalibration: vi.fn(async () => {}), calibrationStatus: 'idle',
    rebuildBase: vi.fn(async () => {}), rebuilding: false, styleError: null,
    ...over,
  } as unknown as QuickTryOnsState;
}

describe('PrebakeCalibration', () => {
  it('renders nothing for non-admins or when no style is selected', () => {
    const { container, rerender } = render(<PrebakeCalibration state={fakeState({ calibrate: false })} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<PrebakeCalibration state={fakeState({ selected: null, selectedCut: undefined })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows one slider per field for the selected cut', () => {
    render(<PrebakeCalibration state={fakeState()} />);
    expect(screen.getByTestId('prebake-calibration')).toBeInTheDocument();
    for (const f of CALIBRATION_FIELDS) expect(screen.getByLabelText(f.label)).toBeInTheDocument();
    expect(screen.getByText(/Middle Part · Brown/)).toBeInTheDocument();
  });

  it('maps the "Up / down" slider straight to dz (object +z is up), live while dragging', () => {
    const state = fakeState();
    render(<PrebakeCalibration state={state} />);
    fireEvent.change(screen.getByLabelText('Up / down'), { target: { value: '0.1' } });
    expect(state.setTransform).toHaveBeenCalledWith({ dz: 0.1 }, { merge: false });
    fireEvent.change(screen.getByLabelText('Size'), { target: { value: '2.5' } });
    expect(state.setTransform).toHaveBeenCalledWith({ scale: 2.5 }, { merge: false });
    expect(state.commitTransform).not.toHaveBeenCalled();
  });

  it('re-merges only when a slider is released', () => {
    const state = fakeState();
    render(<PrebakeCalibration state={state} />);
    fireEvent.pointerUp(screen.getByLabelText('Size'));
    fireEvent.keyUp(screen.getByLabelText('Hair density'));
    expect(state.commitTransform).toHaveBeenCalledTimes(2);
  });

  it('offers a base rebuild and reports a failed style load', () => {
    const state = fakeState({ styleError: { variantId: 'middlepart_middlepart_blonde', message: 'prebake 404' } } as Partial<QuickTryOnsState>);
    render(<PrebakeCalibration state={state} />);
    fireEvent.click(screen.getByText('Rebuild buzz-cut base'));
    expect(state.rebuildBase).toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/Couldn't load blonde \(prebake 404\)/);
  });

  it('submits with the note, and resets on request', () => {
    const state = fakeState();
    render(<PrebakeCalibration state={state} />);
    fireEvent.change(screen.getByLabelText('Calibration note'), { target: { value: 'sits right now' } });
    fireEvent.submit(screen.getByTestId('prebake-calibration'));
    expect(state.submitCalibration).toHaveBeenCalledWith('sits right now');
    fireEvent.click(screen.getByText('Reset'));
    expect(state.resetTransform).toHaveBeenCalled();
  });

  it('reflects saving / saved status', () => {
    const { rerender } = render(<PrebakeCalibration state={fakeState({ calibrationStatus: 'saving' })} />);
    expect(screen.getByText('Saving…')).toBeDisabled();
    rerender(<PrebakeCalibration state={fakeState({ calibrationStatus: 'saved' })} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Saved/);
  });
});
