import { describe, expect, test } from 'vitest';
import { LAB_DEFAULTS, labParamsToSearch, parseLabParams } from './labParams';

describe('parseLabParams', () => {
  test('falls back to the hackathon defaults', () => {
    expect(parseLabParams(new URLSearchParams(''))).toEqual(LAB_DEFAULTS);
  });

  test('reads a fit from the URL and ignores garbage', () => {
    const p = parseLabParams(new URLSearchParams('s=12.5&x=0.1&y=-20&z=abc&color=%23ff0000&w=1.5&head=/lab/other.splat'));
    expect(p.hairScale).toBe(12.5);
    expect(p.hairPos).toEqual([0.1, -20, LAB_DEFAULTS.hairPos[2]]);
    expect(p.hairColor).toBe('#ff0000');
    expect(p.lineWidth).toBe(1.5);
    expect(p.head).toBe('/lab/other.splat');
  });

  test('refuses off-origin asset URLs', () => {
    const p = parseLabParams(new URLSearchParams('head=https://evil.example/x.splat&strands=//evil.example/y.ply'));
    expect(p.head).toBe(LAB_DEFAULTS.head);
    expect(p.strands).toBe(LAB_DEFAULTS.strands);
  });

  test('round-trips through the share link', () => {
    const p = { ...LAB_DEFAULTS, hairScale: 11.25, hairPos: [0.5, -22, 1] as [number, number, number], hairColor: '#334455' };
    expect(parseLabParams(new URLSearchParams(labParamsToSearch(p)))).toEqual(p);
  });
});
