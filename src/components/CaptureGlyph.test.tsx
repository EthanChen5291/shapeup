// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import CaptureGlyph from './CaptureGlyph';

afterEach(() => cleanup());

describe('CaptureGlyph', () => {
  it('recording: labelled, with the orbiting comet and the sprite mark, no percentage', () => {
    const { container } = render(<CaptureGlyph state="recording" />);
    expect(screen.getByRole('img', { name: /recording the 360° video/i })).toBeInTheDocument();
    expect(container.querySelector('[class*="comet"]')).not.toBeNull();
    expect(container.querySelectorAll('[class*="frame"]').length).toBe(4);
    expect(container.querySelector('[class*="ring"]')).toBeNull();
    expect(container.textContent).not.toMatch(/%/);
  });

  it('encoding: the comet stops and the lens emits rings with a solid core', () => {
    const { container } = render(<CaptureGlyph state="encoding" />);
    expect(screen.getByRole('img', { name: /finishing the 360° video/i })).toBeInTheDocument();
    expect(container.querySelector('[class*="comet"]')).toBeNull();
    expect(container.querySelectorAll('[class*="ring"]').length).toBe(2);
    expect(container.querySelector('[class*="core"]')).not.toBeNull();
  });

  it('accepts a custom label', () => {
    render(<CaptureGlyph state="recording" label="Rendering" />);
    expect(screen.getByRole('img', { name: 'Rendering' })).toBeInTheDocument();
  });
});
