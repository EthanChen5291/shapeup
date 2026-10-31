// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ARRIVE_ATOM_CLASS, ARRIVE_ATOM_LAG_MS, ARRIVE_DELAY_VAR, ARRIVE_SPAN_MS, ARRIVE_SURFACE_CLASS,
  isAtom, planArrive, stageArrive,
} from './toolboxArrive';

function el(tag: string, top: number, kids: Array<HTMLElement | string> = [], height = 10) {
  const e = document.createElement(tag);
  e.getBoundingClientRect = () => ({ top, bottom: top + height, left: 0, right: 100, width: 100, height, x: 0, y: top, toJSON() {} }) as DOMRect;
  for (const k of kids) e.append(typeof k === 'string' ? document.createTextNode(k) : k);
  return e;
}

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('isAtom', () => {
  it('treats text, controls and media as atoms, plain wrappers as not', () => {
    expect(isAtom(el('button', 0))).toBe(true);
    expect(isAtom(el('span', 0, ['Toolbox']))).toBe(true);
    expect(isAtom(el('div', 0, [el('span', 0, ['x'])]))).toBe(false);
    expect(isAtom(el('div', 0, ['  ']))).toBe(false);
  });
});

describe('planArrive', () => {
  it('sweeps top → bottom by position: surfaces first, their text/buttons just after', () => {
    const title = el('h2', 40, ['Toolbox']);
    const apply = el('button', 400, ['Apply']);
    const card = el('div', 30, [title, el('div', 120, [apply])]);
    const root = el('div', 0, [card]);
    document.body.append(root);

    const plan = planArrive([root], [], 800);
    const by = new Map(plan.map((p) => [p.el, p]));
    expect(by.get(card)).toMatchObject({ kind: 'surface', delayMs: 0 });
    expect(by.get(title)).toMatchObject({ kind: 'atom', delayMs: Math.round((10 / 800) * ARRIVE_SPAN_MS + ARRIVE_ATOM_LAG_MS) });
    expect(by.get(apply)!.delayMs).toBe(Math.round((370 / 800) * ARRIVE_SPAN_MS + ARRIVE_ATOM_LAG_MS));
    // atoms are never descended into
    expect(plan.map((p) => p.el)).not.toContain(apply.firstChild);
  });

  it('includes a standalone block (the docked card) and orders it by where it sits', () => {
    const panelRow = el('div', 300, ['row']);
    const root = el('div', 0, [panelRow]);
    const badge = el('span', 110, ['NEW']);
    const docked = el('div', 100, [badge]);
    const plan = planArrive([root], [docked], 800);
    expect(plan.map((p) => p.el)).toEqual([docked, badge, panelRow]);
    expect(plan[0]).toMatchObject({ kind: 'surface', delayMs: 0 });
  });

  it('skips elements that are not laid out (display: none)', () => {
    const hidden = el('button', 0, ['x'], 0);
    hidden.getBoundingClientRect = () => ({ top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} }) as DOMRect;
    const root = el('div', 0, [hidden, el('button', 20, ['y'])]);
    expect(planArrive([root]).map((p) => p.el)).not.toContain(hidden);
  });
});

describe('stageArrive', () => {
  it('tags each target with its class and delay, then removes every tag', () => {
    vi.useFakeTimers();
    const btn = el('button', 200, ['Go']);
    const card = el('div', 0, [btn]);
    const root = el('div', 0, [card]);
    document.body.append(root);
    const cleanup = stageArrive([root]);
    expect(card.classList.contains(ARRIVE_SURFACE_CLASS)).toBe(true);
    expect(btn.classList.contains(ARRIVE_ATOM_CLASS)).toBe(true);
    expect(btn.style.getPropertyValue(ARRIVE_DELAY_VAR)).toMatch(/^\d+ms$/);
    vi.runAllTimers();
    expect(card.classList.contains(ARRIVE_SURFACE_CLASS)).toBe(false);
    expect(btn.style.getPropertyValue(ARRIVE_DELAY_VAR)).toBe('');
    cleanup();
  });

  it('ignores missing roots', () => {
    expect(() => stageArrive([null, undefined], [null])()).not.toThrow();
  });
});
