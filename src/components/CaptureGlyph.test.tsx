// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import CaptureGlyph from './CaptureGlyph';

afterEach(() => cleanup());

describe('CaptureGlyph', () => {
  it('recording: labelled, floating (bob + tilt), with a sweeping glint and breathing rec dot', () => {
    const { container } = render(<CaptureGlyph state="recording" />);
    expect(screen.getByRole('img', { name: /recording the 360° video/i })).toBeInTheDocument();
    expect(container.querySelector('[class*="bob"] [class*="tilt"]')).not.toBeNull();
    expect(container.querySelector('[class*="glint"]')).not.toBeNull();
    expect(container.querySelector('[class*="glintFast"]')).toBeNull();
    expect(container.querySelector('[class*="rec"]:not([class*="recDone"])')).not.toBeNull();
    expect(container.textContent).not.toMatch(/%/); // the overlay shows the percentage, not the glyph
  });

  it('encoding: the glint quickens and the lens core eases into focus', () => {
    const { container } = render(<CaptureGlyph state="encoding" />);
    expect(screen.getByRole('img', { name: /finishing the 360° video/i })).toBeInTheDocument();
    expect(container.querySelector('[class*="glintFast"]')).not.toBeNull();
    expect(container.querySelector('[class*="coreFocus"]')).not.toBeNull();
    expect(container.querySelector('[class*="recDone"]')).not.toBeNull();
  });

  it('has no stepped sprite frames', () => {
    const { container } = render(<CaptureGlyph state="recording" />);
    expect(container.querySelectorAll('[class*="frame"]').length).toBe(0);
  });

  it('accepts a custom label', () => {
    render(<CaptureGlyph state="recording" label="Rendering" />);
    expect(screen.getByRole('img', { name: 'Rendering' })).toBeInTheDocument();
  });
});
