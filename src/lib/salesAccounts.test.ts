import { describe, expect, it } from 'vitest';
import { buildAccountPlan, formatPassword, pickNames, SALES_NAME_POOL } from './salesAccounts';

const seq = (n: number) => Uint8Array.from({ length: n }, (_, i) => i * 7 + 3);

describe('formatPassword', () => {
  it('formats 16 chars in dash-separated groups of four', () => {
    const pw = formatPassword(seq(16));
    expect(pw).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    expect(pw).toHaveLength(19);
  });

  it('never emits lookalike characters', () => {
    const all = formatPassword(Uint8Array.from({ length: 16 }, (_, i) => i * 11));
    expect(all).not.toMatch(/[01lIoO]/);
  });

  it('rejects short byte input', () => {
    expect(() => formatPassword(seq(8))).toThrow(/16 random bytes/);
  });
});

describe('pickNames', () => {
  it('returns the requested number of distinct pool words', () => {
    const names = pickNames(10, seq);
    expect(names).toHaveLength(10);
    expect(new Set(names).size).toBe(10);
    for (const n of names) expect(SALES_NAME_POOL).toContain(n);
  });

  it('rejects counts beyond the pool', () => {
    expect(() => pickNames(SALES_NAME_POOL.length + 1, seq)).toThrow(/pool/);
  });
});

describe('buildAccountPlan', () => {
  it('builds word-handle emails on the given domain', () => {
    const plan = buildAccountPlan({ names: ['eagle', 'blossom'], domain: 'shapeup.com', randomBytes: seq });
    expect(plan.map((p) => p.email)).toEqual(['eagle@shapeup.com', 'blossom@shapeup.com']);
    expect(plan[0].username).toBe('eagle');
  });

  it('draws distinct pool names when none are given', () => {
    const plan = buildAccountPlan({ count: 10, domain: 'shapeup.com', randomBytes: seq });
    expect(plan).toHaveLength(10);
    expect(new Set(plan.map((p) => p.username)).size).toBe(10);
  });

  it('uses a fixed password only for a single explicit handle', () => {
    const plan = buildAccountPlan({
      names: ['test'],
      domain: 'shapeup.com',
      password: 'Lumii@315291',
      randomBytes: seq,
    });
    expect(plan).toEqual([
      { username: 'test', email: 'test@shapeup.com', password: 'Lumii@315291' },
    ]);
  });

  it('rejects a fixed password for multiple or drawn handles, or when too short', () => {
    expect(() =>
      buildAccountPlan({ names: ['eagle', 'blossom'], domain: 'shapeup.com', password: 'Lumii@315291', randomBytes: seq }),
    ).toThrow(/exactly one/);
    expect(() =>
      buildAccountPlan({ count: 2, domain: 'shapeup.com', password: 'Lumii@315291', randomBytes: seq }),
    ).toThrow(/exactly one/);
    expect(() =>
      buildAccountPlan({ names: ['test'], domain: 'shapeup.com', password: 'short', randomBytes: seq }),
    ).toThrow(/8 characters/);
  });

  it('rejects duplicates, bad handles, bad counts, and bad domains', () => {
    expect(() => buildAccountPlan({ names: ['eagle', 'eagle'], domain: 'shapeup.com', randomBytes: seq })).toThrow(/duplicate/);
    expect(() => buildAccountPlan({ names: ['Bad Name!'], domain: 'shapeup.com', randomBytes: seq })).toThrow(/handle/);
    expect(() => buildAccountPlan({ count: 0, domain: 'shapeup.com', randomBytes: seq })).toThrow(/count/);
    expect(() => buildAccountPlan({ count: 1, domain: 'not a domain', randomBytes: seq })).toThrow(/domain/);
  });
});
