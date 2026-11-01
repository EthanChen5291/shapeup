import { describe, it, expect } from 'vitest';
import { filterCuts, nextSelectedChip, resolveApplyPrompt, snapCutListHeight, yieldCutListHeight } from './editPanelChipSelection';

describe('nextSelectedChip', () => {
  it('selects a chip when nothing is selected', () => {
    expect(nextSelectedChip(null, 'buzz cut')).toBe('buzz cut');
  });

  it('switches selection to a different chip', () => {
    expect(nextSelectedChip('buzz cut', 'mullet')).toBe('mullet');
  });

  it('un-selects when the same chip is tapped again', () => {
    expect(nextSelectedChip('buzz cut', 'buzz cut')).toBeNull();
  });
});

describe('resolveApplyPrompt', () => {
  it('applies the selected chip on mobile, ignoring the prompt box', () => {
    expect(resolveApplyPrompt(true, 'mullet', 'typed text')).toBe('mullet');
  });

  it('falls back to the prompt box on mobile when nothing is selected', () => {
    expect(resolveApplyPrompt(true, null, 'typed text')).toBe('typed text');
  });

  it('always uses the prompt box on desktop, even if a chip is selected', () => {
    expect(resolveApplyPrompt(false, 'mullet', 'typed text')).toBe('typed text');
  });
});

describe('filterCuts', () => {
  const cuts = ['caesar cut, textured fringe', 'spiky eboy, mid fade', 'broccoli perm, taper fade', 'mid taper with waves'];
  it('returns everything for an empty query', () => {
    expect(filterCuts(cuts, '   ')).toEqual(cuts);
  });
  it('matches every word in any order, ignoring case', () => {
    expect(filterCuts(cuts, 'FADE')).toEqual(['spiky eboy, mid fade', 'broccoli perm, taper fade']);
    expect(filterCuts(cuts, 'fade mid')).toEqual(['spiky eboy, mid fade']);
    expect(filterCuts(cuts, 'mullet')).toEqual([]);
  });
});

describe('snapCutListHeight', () => {
  it('folds the list shut when dragged (nearly) all the way up', () => {
    expect(snapCutListHeight(0)).toBe(0);
    expect(snapCutListHeight(40)).toBe(0);
  });
  it('keeps an open list at least two rows tall', () => {
    expect(snapCutListHeight(70)).toBe(96);
    expect(snapCutListHeight(240)).toBe(240);
  });
});

describe('yieldCutListHeight', () => {
  it('shortens the list by the room asked for', () => {
    expect(yieldCutListHeight(300, 100)).toBe(200);
    expect(yieldCutListHeight(300, 0)).toBe(300);
  });
  it('folds the list shut rather than leaving a sliver under two rows', () => {
    expect(yieldCutListHeight(150, 100)).toBe(0);
  });
  it('folds shut (rather than refusing) when even folding would not free enough', () => {
    expect(yieldCutListHeight(80, 100)).toBe(0);
  });
});

