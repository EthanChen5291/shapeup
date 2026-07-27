// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import TakeDebugPanel from './TakeDebugPanel';

afterEach(cleanup);

describe('TakeDebugPanel', () => {
  it('renders nothing before any take has started', () => {
    const { container } = render(<TakeDebugPanel info={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the exact prompt verbatim', () => {
    const prompt = 'Change ONLY the hair on the head. Give this person a low taper fade.';
    render(<TakeDebugPanel info={{ prompt, snapshotUrl: null }} />);
    expect(screen.getByText(prompt)).toBeInTheDocument();
    expect(screen.getByText('no snapshot')).toBeInTheDocument();
  });

  it('shows the camera snapshot once it has been captured', () => {
    const snapshotUrl = 'data:image/jpeg;base64,AAAA';
    render(<TakeDebugPanel info={{ prompt: 'buzz it', snapshotUrl }} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', snapshotUrl);
  });
});
