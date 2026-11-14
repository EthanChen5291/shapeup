'use client';

// The landing's letter spill. Scrolling to the receipt tips it: its letters roll off, bounce on the
// comparison card and leave the screen, each leaving a grey imprint on the paper. That part plays by
// itself, once, and is never undone. Scrolling on towards the "Describe" step card pulls the letters
// back in from off-screen and into the card; that part follows the scroll (eased a touch, so a
// mouse wheel's steps do not show) and runs backwards if you scroll back, as far as off-screen.
// Every letter that goes in fills the card a bit more: its border draws itself from the top centre
// and is complete with the last letter. The card is then on for good: the "how it works:" heading
// lights up in the same colour, quickly, from its centre outwards, and `onPowered` fires.
//
// The motion is planned in lib/letterSpill; this component measures the page, asks for a plan and
// shows the right moment of it. It finds its parts by marker: .crumpled-note (the letters),
// .compare-card (the card they land on), [data-spill-box] (the card they power, holding a
// <PowerBorder />) and [data-spill-text].
//
// The flying letters are copies in a layer laid over the whole page, positioned in page
// coordinates, so the browser's own scrolling moves them with the page.

import { useEffect, useMemo, useRef, useState } from 'react';
import { crumpleText } from '@/lib/crumpledText';
import {
  arrivedAt, chargeAt, planSpill, poseAt, spillScroll, tipAngle, trembleAt,
  type SpillGeometry, type SpillPlan, type SpillScroll,
} from '@/lib/letterSpill';

/** The fall plays a little faster than its plan, and much faster when the note is off-screen anyway. */
const FALL_RATE = 1.2;
const FALL_RATE_UNSEEN = 5;
/** How quickly the pull catches up with the scroll position (s), the slowest it ever moves
    (progress/s), and the fastest (plan seconds of pull per second): however fast the page is
    scrolled, a letter takes about a second to fly in, so it can be seen going. */
const PULL_EASE = 0.045;
const PULL_MIN_SPEED = 0.2;
const PULL_MAX_RATE = 1.5;
/** How long the heading takes to light up from its centre once the box is on (s). */
const HEADING_TIME = 0.4;
/** The box is on a spring: every letter that goes in knocks it down (px/s, capped when several land
    at once) and it bounces back (rad/s, damping ratio). About 6 px for one letter, 14 at most. */
const KICK = 330;
const KICK_MAX = 820;
const SPRING = 38;
const SPRING_DAMPING = 0.3;
const BUMP_MAX = 14;

/** An element's layout position inside `root`, ignoring transforms (reveal animations, hover lifts). */
function offsetIn(el: HTMLElement, root: HTMLElement): { x: number; y: number } {
  let x = 0, y = 0;
  for (let node: HTMLElement | null = el; node && node !== root; node = node.offsetParent as HTMLElement | null) {
    x += node.offsetLeft; y += node.offsetTop;
  }
  return { x, y };
}

/** The border that draws itself around the powered box. Put it inside the [data-spill-box] element. */
export function PowerBorder() {
  const ref = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState<{ w: number; h: number; r: number } | null>(null);
  useEffect(() => {
    const card = ref.current?.parentElement;
    if (!card || typeof ResizeObserver === 'undefined') return;
    const read = () => {
      const r = parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0;
      setBox({ w: card.clientWidth, h: card.clientHeight, r });
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(card);
    return () => ro.disconnect();
  }, []);

  // A rounded rectangle that starts at the middle of the top edge, so a dash centred on the
  // path's start grows both ways round and meets itself at the bottom.
  let d = '';
  if (box && box.w > 0 && box.h > 0) {
    const o = 1.5, w = box.w - 2 * o, h = box.h - 2 * o, r = Math.max(0, Math.min(box.r - o, w / 2, h / 2));
    d = `M${o + w / 2} ${o}H${o + w - r}A${r} ${r} 0 0 1 ${o + w} ${o + r}V${o + h - r}A${r} ${r} 0 0 1 ${o + w - r} ${o + h}`
      + `H${o + r}A${r} ${r} 0 0 1 ${o} ${o + h - r}V${o + r}A${r} ${r} 0 0 1 ${o + r} ${o}Z`;
  }
  return (
    <svg ref={ref} className="power-border" aria-hidden="true">
      {d && <path className="power-border__glow" d={d} pathLength={1} data-spill-border />}
      {d && <path className="power-border__line" d={d} pathLength={1} data-spill-border />}
    </svg>
  );
}

export default function LetterSpill({ text, onPowered }: { text: string; onPowered?: () => void }) {
  const layerRef = useRef<HTMLDivElement>(null);
  const letters = useMemo(() => crumpleText(text).flat(), [text]);
  const onPoweredRef = useRef(onPowered);
  useEffect(() => { onPoweredRef.current = onPowered; }, [onPowered]);

  useEffect(() => {
    const layer = layerRef.current;
    const root = layer?.parentElement;
    if (!layer || !root) return;
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const note = root.querySelector<HTMLElement>('.crumpled-note');
    const box = root.querySelector<HTMLElement>('[data-spill-box]');
    const heading = root.querySelector<HTMLElement>('[data-spill-text]');
    if (!note || !box) return;
    const copies = [...layer.children] as HTMLElement[];

    let plan: SpillPlan | null = null;
    let scroll: SpillScroll | null = null;
    let sizes: { w: number; h: number }[] = [];
    let table: HTMLElement | null = null;
    let exact = false; // measured from the letters' real positions, not rounded layout offsets

    // Where the story has got to. None of it is undone except `pull`, and that only until `lit`.
    let started = false; // the paper has tipped
    let fall = 0; // plan seconds of the fall played so far
    let pull = 0; // 0..1 of the pull, as shown (eases towards the scroll position)
    let lit = false; // the last letter is in: the box is on, for good
    let glow = 0; // seconds the heading has been lighting up
    let inside = 0; // letters in the box at the last frame
    let bump = 0, bumpSpeed = 0; // the box on its spring (px down, px/s)
    let told = false;
    let first = true;
    let frame = 0;
    let stamp = 0;
    let shown = '';

    const measure = () => {
      plan = null;
      const originals = [...note.querySelectorAll<HTMLElement>('.crumpled-note__letter')];
      if (originals.length !== letters.length || !note.offsetWidth || !box.offsetWidth) return;
      const style = getComputedStyle(note);
      const size = parseFloat(style.fontSize);
      layer.style.fontSize = style.fontSize;
      layer.style.lineHeight = style.lineHeight;

      // The note's own rotation, without whatever tip this component has put on it.
      const tip = parseFloat(note.style.getPropertyValue('--tip')) || 0;
      const m = new DOMMatrixReadOnly(style.transform === 'none' ? undefined : style.transform);
      const restAngle = (Math.atan2(m.b, m.a) * 180) / Math.PI - tip;

      const origin = offsetIn(note, root);
      let pivot = { x: origin.x + note.offsetWidth / 2, y: origin.y + note.offsetHeight / 2 };
      // Layout offsets are whole pixels. Where the note is on screen is exact, and agrees with them
      // unless something is still moving it (its scroll-in reveal): then keep the offsets for now
      // and measure again when the spill starts.
      const rootBox = root.getBoundingClientRect();
      const centreOf = (el: HTMLElement) => { const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2 - rootBox.left, y: b.top + b.height / 2 - rootBox.top }; };
      const seen = centreOf(note);
      exact = Math.hypot(seen.x - pivot.x, seen.y - pivot.y) < 2;
      if (exact) pivot = seen;
      const turn = (-(restAngle + tip) * Math.PI) / 180;
      const paperRight = parseFloat(getComputedStyle(note, '::before').right) || 0; // negative: the paper overhangs the text
      const lip = note.offsetWidth / 2 - paperRight - size * 0.25;
      sizes = originals.map((el) => ({ w: el.offsetWidth, h: el.offsetHeight }));

      // The card under the low end of the tipped paper (side by side: the right one; stacked: the first).
      const lipX = pivot.x + lip;
      let surface: SpillGeometry['table'] = null;
      let landing: HTMLElement | null = null;
      for (const card of root.querySelectorAll<HTMLElement>('.compare-card')) {
        const at = offsetIn(card, root);
        const fits = at.x <= lipX + 40 && at.x + card.offsetWidth >= lipX + 40 && at.y > pivot.y;
        if (fits && (!surface || at.y < surface.top)) { surface = { left: at.x, right: at.x + card.offsetWidth, top: at.y }; landing = card; }
      }
      if (table && table !== landing) { table.removeAttribute('data-spill-table'); table.style.removeProperty('--spill-tremble'); }
      table = landing;
      table?.setAttribute('data-spill-table', '');

      const boxAt = offsetIn(box, root);
      const geo: SpillGeometry = {
        pivot, restAngle, lip, size, table: surface,
        letters: originals.map((el, i) => {
          if (!exact) {
            return {
              s: el.offsetLeft + el.offsetWidth / 2 - note.offsetWidth / 2,
              n: el.offsetTop + el.offsetHeight / 2 - note.offsetHeight / 2 + letters[i].shift * size,
              tilt: letters[i].tilt,
            };
          }
          // Where the letter is, turned back into the paper's own frame.
          const at = centreOf(el), dx = at.x - pivot.x, dy = at.y - pivot.y;
          return { s: dx * Math.cos(turn) - dy * Math.sin(turn), n: dx * Math.sin(turn) + dy * Math.cos(turn), tilt: letters[i].tilt };
        }),
        target: { x: boxAt.x + box.offsetWidth / 2, y: boxAt.y },
        edge: root.clientWidth,
      };
      plan = planSpill(geo);
      scroll = spillScroll({ noteY: pivot.y, boxTop: boxAt.y, viewport: window.innerHeight });
      shown = '';
    };

    const draw = () => {
      if (!plan) return;
      const pullAt = pull * plan.pullTime;
      // How full the box is: every letter that goes in adds its share, the last one fills it.
      const fill = lit ? 1 : chargeAt(plan, pullAt);
      const lighting = Math.min(1, glow / HEADING_TIME);
      const headingFill = lighting * lighting * (3 - 2 * lighting);
      const key = `${started}/${fall.toFixed(3)}/${pull.toFixed(5)}/${lit}/${bump.toFixed(2)}/${glow.toFixed(3)}`;
      if (key === shown) return;
      shown = key;

      layer.toggleAttribute('data-active', started);
      note.toggleAttribute('data-spilled', started);
      if (started) note.style.setProperty('--tip', `${tipAngle(fall).toFixed(2)}deg`);
      else note.style.removeProperty('--tip');
      if (started) {
        copies.forEach((el, i) => {
          const pose = poseAt(plan!, i, fall, pullAt);
          el.style.opacity = pose.opacity.toFixed(3);
          if (pose.opacity <= 0) return;
          el.style.transform = `translate3d(${(pose.x - sizes[i].w / 2).toFixed(2)}px, ${(pose.y - sizes[i].h / 2).toFixed(2)}px, 0) `
            + `rotate(${pose.rot.toFixed(2)}deg) scale(${pose.scale.toFixed(3)})`;
        });
      }
      // The card they land on shakes at its far side; the box bounces under each letter that goes in.
      table?.style.setProperty('--spill-tremble', `${(fall < plan.fallTime ? trembleAt(plan, fall) : 0).toFixed(3)}deg`);
      box.style.setProperty('--spill-bump', `${bump.toFixed(2)}px`);
      // Its border is drawn as far round as the box is full.
      const line = fill;
      for (const path of box.querySelectorAll<SVGPathElement>('[data-spill-border]')) {
        path.style.strokeDasharray = `${line.toFixed(4)} ${(1 - line).toFixed(4)}`;
        path.style.strokeDashoffset = (line / 2).toFixed(4);
        path.style.visibility = line > 0 ? 'visible' : 'hidden';
      }
      box.toggleAttribute('data-powered', lit);
      if (heading) {
        heading.style.setProperty('--power', headingFill.toFixed(4));
        heading.toggleAttribute('data-lighting', lighting > 0 && lighting < 1);
        heading.toggleAttribute('data-powered', lighting >= 1);
      }
    };

    const tick = (now: number) => {
      frame = 0;
      if (!plan || !scroll) return;
      const dt = stamp ? Math.min(0.05, (now - stamp) / 1000) : 0;
      stamp = now;
      // How far the page has scrolled, read off the page itself: on phones it is <body> that
      // scrolls, not the window, so window.scrollY stays 0 there.
      const y = -root.getBoundingClientRect().top;
      const unseen = y > scroll.start + window.innerHeight * 0.45; // the note has scrolled away

      if (!started && y >= scroll.start) {
        if (!exact) { measure(); if (!plan || !scroll) return; } // the note is on screen and settled now
        started = true;
        // Arriving already past it (a reload half way down the page): nothing to watch, so skip ahead.
        if (first && unseen) fall = plan.fallTime;
        if (first && y >= scroll.pullEnd) { pull = 1; lit = true; glow = HEADING_TIME; }
      }
      first = false;
      if (started && fall < plan.fallTime) fall = Math.min(plan.fallTime, fall + dt * (unseen ? FALL_RATE_UNSEEN : FALL_RATE));

      // The pull follows the scroll once every letter is waiting off-screen, and is fixed once lit.
      const want = lit ? 1 : fall >= plan.fallTime ? Math.min(1, Math.max(0, (y - scroll.pullStart) / (scroll.pullEnd - scroll.pullStart))) : 0;
      const gapTo = want - pull;
      if (gapTo) {
        const move = Math.min(
          Math.max(Math.abs(gapTo) * (1 - Math.exp(-dt / PULL_EASE)), PULL_MIN_SPEED * dt),
          (PULL_MAX_RATE / plan.pullTime) * dt,
        );
        pull = Math.abs(gapTo) <= move ? want : pull + Math.sign(gapTo) * move;
      }
      // Each letter that has just gone in knocks the box down; the spring brings it back.
      const nowIn = arrivedAt(plan, pull * plan.pullTime);
      if (nowIn > inside && dt) bumpSpeed = Math.min(KICK_MAX, bumpSpeed + KICK * (nowIn - inside));
      inside = nowIn;
      for (let left = dt; left > 0; left -= 0.004) {
        const h = Math.min(0.004, left);
        bumpSpeed += (-SPRING * SPRING * bump - 2 * SPRING_DAMPING * SPRING * bumpSpeed) * h;
        bump = Math.min(BUMP_MAX, Math.max(-BUMP_MAX, bump + bumpSpeed * h));
      }
      const still = Math.abs(bump) < 0.05 && Math.abs(bumpSpeed) < 2;
      if (still) { bump = 0; bumpSpeed = 0; }

      // On as soon as the last letter is in (the scroll may stop a hair short of the very end).
      if (pull >= 1 || (plan.arrivals.length > 0 && nowIn >= plan.arrivals.length)) lit = true;
      if (lit && glow < HEADING_TIME) glow = Math.min(HEADING_TIME, glow + dt);
      if (lit && !told) { told = true; onPoweredRef.current?.(); }

      draw();
      const busy = (started && fall < plan.fallTime) || want !== pull || !still || (lit && glow < HEADING_TIME);
      if (busy) frame = requestAnimationFrame(tick);
      else stamp = 0;
    };

    const queue = () => { if (!frame) frame = requestAnimationFrame(tick); };
    const remeasure = () => { measure(); queue(); };

    measure();
    queue();
    // Captured on the document: scroll events do not bubble, and the scroller differs by layout.
    document.addEventListener('scroll', queue, { passive: true, capture: true });
    window.addEventListener('resize', remeasure);
    // The page above and below changes height as images and fonts arrive.
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(remeasure);
    ro?.observe(root);
    document.fonts?.ready.then(remeasure).catch(() => {});

    return () => {
      document.removeEventListener('scroll', queue, { capture: true });
      window.removeEventListener('resize', remeasure);
      ro?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      layer.removeAttribute('data-active');
      note.removeAttribute('data-spilled');
      note.style.removeProperty('--tip');
      table?.removeAttribute('data-spill-table');
      table?.style.removeProperty('--spill-tremble');
      box.style.removeProperty('--spill-bump');
      box.removeAttribute('data-powered');
      heading?.style.removeProperty('--power');
      heading?.removeAttribute('data-powered');
      heading?.removeAttribute('data-lighting');
    };
  }, [letters]);

  return (
    <>
      {/* The grit of the imprint the letters leave on the paper (used from globals.css): fine noise
          roughens their edges and wears specks out of the ink, like print on crumpled paper. */}
      <svg className="letter-spill__defs" width="0" height="0" aria-hidden="true" focusable="false">
        <filter id="spill-grit" x="-5%" y="-25%" width="110%" height="150%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="11" result="grain" />
          <feDisplacementMap in="SourceGraphic" in2="grain" scale="1.3" xChannelSelector="R" yChannelSelector="G" result="rough" />
          {/* Opaque where the grain is low, thinning to the odd speck where it is highest. */}
          <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -4 0 0 0 3.3" result="wear" />
          <feComposite in="rough" in2="wear" operator="in" />
        </filter>
      </svg>
      <div ref={layerRef} className="letter-spill" aria-hidden="true">
        {letters.map((letter, i) => (
          <span
            key={i}
            className="crumpled-note__letter letter-spill__letter"
            style={{ '--ink': `linear-gradient(${letter.angle}deg, ${letter.from}, ${letter.to})` } as React.CSSProperties}
          >
            {letter.char}
          </span>
        ))}
      </div>
    </>
  );
}
