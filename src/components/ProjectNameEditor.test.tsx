// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';

// --- Mock convex: useMutation returns our spy; api is a placeholder object. ---
const renameMock = vi.fn(() => Promise.resolve());
vi.mock('convex/react', () => ({
  useMutation: () => renameMock,
}));
vi.mock('@convex/_generated/api', () => ({
  api: { projects: { rename: 'projects:rename' } },
}));

const { default: ProjectNameEditor, outlineSegments } = await import('./ProjectNameEditor');
const projectId = 'proj_1' as unknown as Parameters<typeof ProjectNameEditor>[0]['projectId'];

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

const startEditing = (name = 'Fade Test') => fireEvent.click(screen.getByRole('button', { name }));

describe('outlineSegments', () => {
  it('draws four strokes from the top/bottom centre out to the rounded ends', () => {
    // 100×20 pill at pad 5: centre x 55, ends meet at the mid-height of each side.
    expect(outlineSegments(100, 20, 5)).toEqual([
      'M 55 5 L 15 5 A 10 10 0 0 0 5 15',
      'M 55 25 L 15 25 A 10 10 0 0 1 5 15',
      'M 55 5 L 95 5 A 10 10 0 0 1 105 15',
      'M 55 25 L 95 25 A 10 10 0 0 0 105 15',
    ]);
  });
});

describe('ProjectNameEditor', () => {
  it('shows the project name, falling back when empty', () => {
    const { rerender } = render(<ProjectNameEditor projectId={projectId} name="Fade Test" />);
    expect(screen.getByText('Fade Test')).toBeInTheDocument();

    rerender(<ProjectNameEditor projectId={projectId} name="   " />);
    expect(screen.getByText('Untitled cut')).toBeInTheDocument();
  });

  it('has no pencil toggle — clicking the name itself enters edit mode with the pill outline', () => {
    const { container } = render(<ProjectNameEditor projectId={projectId} name="Fade Test" />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    startEditing();

    const input = screen.getByLabelText('Project name') as HTMLInputElement;
    expect(input.value).toBe('Fade Test');
    expect(document.activeElement).toBe(input);
    expect(container.querySelector('.pne-field--editing')).not.toBeNull();
    expect(container.querySelector('svg.pne-outline')).not.toBeNull();
  });

  it('saves a changed name when the field loses focus', () => {
    render(<ProjectNameEditor projectId={projectId} name="Fade Test" />);
    startEditing();
    const input = screen.getByLabelText('Project name');
    fireEvent.change(input, { target: { value: 'Caesar Cut' } });
    fireEvent.blur(input);
    expect(renameMock).toHaveBeenCalledWith({ projectId, name: 'Caesar Cut' });
  });

  it('commits on Enter and cancels on Escape', () => {
    render(<ProjectNameEditor projectId={projectId} name="Fade Test" />);

    startEditing();
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Buzz' } });
    fireEvent.keyDown(screen.getByLabelText('Project name'), { key: 'Enter' });
    expect(renameMock).toHaveBeenCalledWith({ projectId, name: 'Buzz' });

    renameMock.mockClear();
    startEditing();
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Discarded' } });
    fireEvent.keyDown(screen.getByLabelText('Project name'), { key: 'Escape' });
    expect(renameMock).not.toHaveBeenCalled();
    expect(screen.getByText('Fade Test')).toBeInTheDocument();
  });

  it('does not call rename when the name is unchanged or blank', () => {
    render(<ProjectNameEditor projectId={projectId} name="Fade Test" />);

    startEditing();
    fireEvent.keyDown(screen.getByLabelText('Project name'), { key: 'Enter' });
    expect(renameMock).not.toHaveBeenCalled();

    startEditing();
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: '   ' } });
    fireEvent.keyDown(screen.getByLabelText('Project name'), { key: 'Enter' });
    expect(renameMock).not.toHaveBeenCalled();
  });
});
