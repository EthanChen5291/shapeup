import { describe, it, expect, beforeEach } from 'vitest';
import { GENDER_STORAGE_KEY, isGender, loadGender, saveGender } from './editPanelGender';

function makeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
}

describe('loadGender', () => {
  it("defaults to 'mens' when nothing is cached", () => {
    expect(loadGender(makeStorage())).toBe('mens');
  });

  it('returns the cached choice', () => {
    expect(loadGender(makeStorage({ [GENDER_STORAGE_KEY]: 'womens' }))).toBe('womens');
  });

  it("treats unknown cached values as 'mens'", () => {
    expect(loadGender(makeStorage({ [GENDER_STORAGE_KEY]: 'garbage' }))).toBe('mens');
  });

  it('ignores the old per-project keys (the choice is account-wide now)', () => {
    expect(loadGender(makeStorage({ 'shapeup-gender:proj-1': 'womens' }))).toBe('mens');
  });

  it('survives a storage that throws', () => {
    const throwing = { getItem: () => { throw new Error('blocked'); } };
    expect(loadGender(throwing)).toBe('mens');
  });
});

describe('saveGender', () => {
  let store: ReturnType<typeof makeStorage>;
  beforeEach(() => { store = makeStorage(); });

  it('caches under the single account-wide key', () => {
    saveGender('womens', store);
    expect(store._map.get(GENDER_STORAGE_KEY)).toBe('womens');
    expect(store._map.size).toBe(1);
  });

  it('round-trips through loadGender', () => {
    saveGender('womens', store);
    expect(loadGender(store)).toBe('womens');
  });

  it('never throws when storage rejects writes', () => {
    const throwing = { setItem: () => { throw new Error('quota'); } };
    expect(() => saveGender('womens', throwing)).not.toThrow();
  });
});

describe('isGender', () => {
  it('accepts only the two known values', () => {
    expect(isGender('mens')).toBe(true);
    expect(isGender('womens')).toBe(true);
    expect(isGender('other')).toBe(false);
    expect(isGender(undefined)).toBe(false);
  });
});
