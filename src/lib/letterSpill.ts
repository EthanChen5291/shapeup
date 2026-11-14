// The landing's letter spill, as a plan. It has two parts:
//
//   the fall  The note tips, its letters roll off the low end, drop onto the comparison card,
//             bounce off to the right and leave the screen, where each slows to a wait point.
//             Simulated once (gravity, a rolling drag, a bounce with restitution and spin) and
//             stored as samples over time: the page plays it on a clock, once.
//   the pull  From their wait points the letters are drawn into the "Describe" step card as if by
//             a magnet, one after another, faster and faster. A function of a progress the page
//             ties to scrolling, so it can run forwards and backwards.
//
// Nothing here knows about the clock, the DOM, or scrolling.
// Units: px in the page's layout space (y down), seconds of plan time, degrees clockwise.

export interface Vec { x: number; y: number }

export interface SpillLetter {
  /** Where the letter rests, from the note's centre: along the paper and across it (px). */
  s: number;
  n: number;
  /** Its resting tilt relative to the paper (deg). */
  tilt: number;
}

export interface SpillGeometry {
  /** Centre of the note; the paper tips about it. */
  pivot: Vec;
  /** The note's resting rotation (deg). */
  restAngle: number;
  /** Distance from the pivot along the paper to the end the letters pour off. */
  lip: number;
  /** Font size of the letters (px): sets how big they are as bodies. */
  size: number;
  letters: SpillLetter[];
  /** Top surface of the card the letters land on, or null when there is nothing under the lip. */
  table: { left: number; right: number; top: number } | null;
  /** Where the letters enter the box: the middle of its top edge. */
  target: Vec;
  /** x of the right edge of the screen: the letters pass beyond it before they are pulled back. */
  edge: number;
}

export interface SpillBounce { t: number; x: number; y: number }

interface Pull {
  /** Where the letter waits off-screen, and its rotation there. */
  wait: Vec; rot: number;
  /** The curve it is pulled along (cubic Bézier from wait to into) and how many turns it spins. */
  c1: Vec; c2: Vec; into: Vec; turns: number;
  /** When, in pull time, it starts to move and when it enters the box. */
  start: number; end: number;
}

export interface SpillPlan {
  /** Seconds between samples of the fall. */
  step: number;
  /** Seconds from the first tip until the last letter is waiting off-screen. */
  fallTime: number;
  /** One track per letter: x, y, rotation (deg) for every sample of the fall. */
  tracks: Float32Array[];
  /** When each letter leaves the paper, and every time it lands on the card. */
  exits: number[];
  bounces: SpillBounce[][];
  /** When the last letter has left the paper. */
  spillEnd: number;
  /** Length of the pull, in its own seconds (the page maps scroll progress 0..1 onto 0..pullTime). */
  pullTime: number;
  /** When, in pull time, each letter enters the box. The last is a beat before pullTime. */
  arrivals: number[];
  pulls: Pull[];
}

export interface SpillPose { x: number; y: number; rot: number; scale: number; opacity: number }

const STEP = 1 / 120;
const SUBSTEPS = 2;
const FIELDS = 3;

const GRAVITY = 2400;
/** Pull along the tipped paper, and the friction that holds a letter until the paper is steep enough. */
const SLOPE_PULL = 14000;
const SLIDE_FRICTION = 0.05;
/** The letters let go in a wave from the low end back (px/s), like a queue starting to move. */
const RELEASE_WAVE = 1800;
/** How far the paper tips (deg). Shallow on purpose: the low end stays well above the card, so
    the letters have a real fall. */
export const TIP_DEG = 11;
/** The low end drops like a dropped thing, not at a steady rate: slowly at first and faster and
    faster (this long to come down, s), lands, and bounces a little before it lies still (each
    rebound keeps this share of the speed). */
const TIP_FALL_TIME = 0.5;
const TIP_BOUNCE = 0.4;
const TIP_BOUNCES = 3;

/** Seconds over which the letters enter the box one after another, and how long each is pulled in. */
const ARRIVE_SPAN = 1.6;
const PULL_TIME = 1.5;
/** How sharply the pull accelerates: the letter covers most of the way in the last moments. */
const PULL_CURVE = 2.2;
/** A beat after the last letter is in before the pull ends: browsers round scroll positions to
    whole pixels, so the end of the scroll range can land a hair short of the pull's last moment. */
const TAIL = 0.05;

/** Seconds of pull time, ending at its arrival, over which a letter adds its share to the box's charge. */
const CHARGE_RAMP = 0.12;
/** The card the letters land on trembles at its far side: degrees per landing, its ring (Hz), how
    fast it dies (s), and the most it ever turns. About 2 px at the edge of a 600 px card. */
const TREMBLE_DEG = 0.09;
const TREMBLE_HZ = 17;
const TREMBLE_FADE = 0.09;
const TREMBLE_MAX = 0.2;

const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (a: number, b: number, v: number) => { const k = clamp((v - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
/** A steady pseudo-random number in [0, 1) per letter: the plan must be the same on every build. */
const rand = (i: number, salt: number) => { const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453; return x - Math.floor(x); };

/** How far the paper has tipped (deg) at a moment: let go at t = 0, it falls under a steady pull, lands and bounces to rest. */
export function tipAngle(t: number): number {
  if (t <= 0) return 0;
  const pull = (2 * TIP_DEG) / (TIP_FALL_TIME * TIP_FALL_TIME);
  if (t < TIP_FALL_TIME) return 0.5 * pull * t * t;
  let at = t - TIP_FALL_TIME, speed = pull * TIP_FALL_TIME;
  for (let k = 0; k < TIP_BOUNCES; k++) {
    speed *= TIP_BOUNCE;
    const air = (2 * speed) / pull;
    if (at < air) return TIP_DEG - (speed * at - 0.5 * pull * at * at);
    at -= air;
  }
  return TIP_DEG;
}

interface Flight {
  xs: number[]; ys: number[]; rots: number[];
  exit: number; end: number;
  p: Vec; v: Vec; rot: number; spin: number;
  bounces: SpillBounce[];
}

/** One letter from rest on the paper until it is past the screen edge (or has fallen far enough). */
function fly(geo: SpillGeometry, i: number, table: SpillGeometry['table'], drag: number, offX: number, capY: number): Flight {
  const L = geo.letters[i];
  const r = geo.size * 0.3; // the letter as a body: where its underside meets the card
  const roll = geo.size * (0.75 + 0.5 * rand(i, 5)); // px travelled per radian turned: a tumble, not a blur
  const dt = STEP / SUBSTEPS;
  const grip = Math.tan(rad(3 + 2.5 * rand(i, 1)));
  const letGo = Math.max(0, geo.lip - L.s) / RELEASE_WAVE;
  const letterDrag = drag * (0.9 + 0.2 * rand(i, 2));
  const out: Flight = { xs: [], ys: [], rots: [], exit: 0, end: 0, p: { x: 0, y: 0 }, v: { x: 0, y: 0 }, rot: 0, spin: 0, bounces: [] };

  const onPaper = (s: number, t: number): Vec => {
    const a = rad(geo.restAngle + tipAngle(t));
    return { x: geo.pivot.x + s * Math.cos(a) - L.n * Math.sin(a), y: geo.pivot.y + s * Math.sin(a) + L.n * Math.cos(a) };
  };

  let phase: 'paper' | 'air' | 'table' = 'paper';
  let s = L.s, v = 0, turned = 0, released = false;
  let x = 0, y = 0, vx = 0, vy = 0, rot = 0, spin = 0; // spin in rad/s once airborne
  for (let k = 0; ; k++) {
    const t = k * dt;
    if (phase === 'paper') {
      ({ x, y } = onPaper(s, t));
      rot = geo.restAngle + tipAngle(t) + L.tilt + deg(turned);
    }
    if (k % SUBSTEPS === 0) { out.xs.push(x); out.ys.push(y); out.rots.push(rot); }

    if (phase === 'paper') {
      const a = rad(geo.restAngle + tipAngle(t));
      if (!released && t >= letGo && Math.tan(a) > grip) released = true;
      if (released) {
        v = Math.max(0, v + (SLOPE_PULL * (Math.sin(a) - SLIDE_FRICTION * Math.cos(a)) - letterDrag * v) * dt);
        s += v * dt;
        turned += (v / roll) * dt;
      }
      if (s >= geo.lip || t > 8) {
        const next = onPaper(Math.max(s, geo.lip), t + dt);
        vx = (next.x - x) / dt; vy = (next.y - y) / dt;
        x = next.x; y = next.y;
        rot = geo.restAngle + tipAngle(t + dt) + L.tilt + deg(turned);
        spin = v / roll;
        phase = 'air';
        out.exit = t + dt;
      }
      continue;
    }

    if (phase === 'table' && table) {
      // Too little bounce left: it rolls along the card to its edge and drops off.
      vx = Math.max(90, vx * (1 - 0.5 * dt));
      x += vx * dt;
      spin = vx / roll;
      if (x > table.right + r * 0.3) phase = 'air';
    } else {
      const before = y;
      vy += GRAVITY * dt;
      x += vx * dt; y += vy * dt;
      const lands = table && vy > 0 && before + r <= table.top + 0.5 && y + r >= table.top && x >= table.left - r && x <= table.right + r * 0.5;
      if (lands && table) {
        y = table.top - r;
        vy = -vy * (0.56 + 0.12 * rand(i, 3 + out.bounces.length));
        vx *= 0.88 + 0.08 * rand(i, 7 + out.bounces.length);
        // The card grips the underside: the spin is dragged towards rolling, plus a knock from the hit.
        spin = spin * 0.35 + (vx / roll) * 0.65 + (rand(i, 11 + out.bounces.length) - 0.5) * 6;
        out.bounces.push({ t: t + dt, x, y });
        if (-vy < 110) { vy = 0; phase = 'table'; }
      }
    }
    rot += deg(spin) * dt;

    if (phase === 'air' && (x >= offX || y >= capY || t - out.exit > 2.4)) {
      out.end = t + dt; out.p = { x, y }; out.v = { x: vx, y: vy }; out.rot = rot; out.spin = deg(spin);
      return out;
    }
  }
}

/** The whole spill for a layout. Pure and repeatable: the same geometry gives the same plan. */
export function planSpill(geo: SpillGeometry): SpillPlan {
  const n = geo.letters.length;
  if (!n) return { step: STEP, fallTime: 0, tracks: [], exits: [], bounces: [], spillEnd: 0, pullTime: 1, arrivals: [], pulls: [] };
  const r = geo.size * 0.3;
  const tipped = rad(geo.restAngle + TIP_DEG);
  const lip: Vec = { x: geo.pivot.x + geo.lip * Math.cos(tipped), y: geo.pivot.y + geo.lip * Math.sin(tipped) };

  // The letters leave the lip no faster than lands them on the card, about half way to its far
  // edge: one clear bounce, and the next arc carries them off it.
  let table = geo.table;
  let topSpeed = 480;
  if (table) {
    const drop = table.top - r - lip.y;
    if (drop > 20 && table.right > lip.x + 40) {
      const fall = Math.sqrt((2 * drop) / GRAVITY) * 0.85;
      topSpeed = clamp(clamp(0.55 * (table.right - lip.x), 40, 190) / fall / Math.cos(tipped), 240, 620);
    } else table = null;
  }
  const drag = (SLOPE_PULL * (Math.sin(tipped) - SLIDE_FRICTION * Math.cos(tipped))) / topSpeed;

  const offX = geo.edge + r + 50;
  const surface = table ? table.top : lip.y;
  const capY = Math.min(geo.target.y - 180, surface + 0.55 * (geo.target.y - surface));
  const flights = geo.letters.map((_, i) => fly(geo, i, table, drag, offX, capY));

  // Past the edge each letter slows to a wait point: the end of the fall.
  const parks = flights.map((f, i) => {
    const wait: Vec = {
      x: Math.max(offX, f.p.x) + 30 + 90 * rand(i, 21),
      y: Math.max(geo.target.y - (240 + 180 * rand(i, 22)), f.p.y + 60),
    };
    const slow = clamp((2 * Math.hypot(wait.x - f.p.x, wait.y - f.p.y)) / Math.max(Math.hypot(f.v.x, f.v.y), 1), 0.3, 0.9);
    return { wait, slow, rot: f.rot + (f.spin * (1 - Math.exp(-2.5 * slow))) / 2.5 };
  });
  // Ends on a sample, so the fall's last pose is exactly the wait point the pull starts from.
  const fallTime = Math.ceil(Math.max(...flights.map((f, i) => f.end + parks[i].slow)) / STEP) * STEP;
  const samples = Math.ceil(fallTime / STEP) + 1;
  const tracks = flights.map((f, i) => {
    const park = parks[i];
    const track = new Float32Array(samples * FIELDS);
    for (let j = 0; j < samples; j++) {
      const t = j * STEP;
      let x: number, y: number, rot: number;
      if (j < f.xs.length && t <= f.end) {
        x = f.xs[j]; y = f.ys[j]; rot = f.rots[j];
      } else if (t < f.end + park.slow) {
        // A Hermite curve that leaves with the flight's own velocity and all but stops at the wait point.
        const k = (t - f.end) / park.slow, k2 = k * k, k3 = k2 * k;
        const h00 = 2 * k3 - 3 * k2 + 1, h10 = k3 - 2 * k2 + k, h01 = -2 * k3 + 3 * k2;
        x = h00 * f.p.x + h10 * f.v.x * park.slow + h01 * park.wait.x;
        y = h00 * f.p.y + h10 * f.v.y * park.slow + h01 * park.wait.y;
        rot = f.rot + (f.spin * (1 - Math.exp(-2.5 * (t - f.end)))) / 2.5;
      } else {
        x = park.wait.x; y = park.wait.y; rot = park.rot;
      }
      track.set([x, y, rot], j * FIELDS);
    }
    return track;
  });

  // The pull: the letters go in one after another, in the order they left the paper.
  const order = flights.map((_, i) => i).sort((a, b) => flights[a].exit - flights[b].exit);
  const rank: number[] = [];
  order.forEach((i, k) => { rank[i] = k; });
  const gap = n > 1 ? ARRIVE_SPAN / (n - 1) : 0;
  const lengths = flights.map((_, i) => PULL_TIME * (0.9 + 0.2 * rand(i, 23)));
  const lastIn = Math.max(...lengths.map((len, i) => len + (n - 1 - rank[i]) * gap));
  const pulls: Pull[] = parks.map((park, i) => {
    const into: Vec = { x: geo.target.x + (rand(i, 24) - 0.5) * geo.size * 1.2, y: geo.target.y + geo.size * 0.2 };
    const dx = into.x - park.wait.x, dy = into.y - park.wait.y;
    const end = lastIn - (n - 1 - rank[i]) * gap;
    return {
      wait: park.wait, rot: park.rot, into, end, start: end - lengths[i],
      // It sweeps in from the right and comes down to the top of the box at a shallow angle, under
      // whatever sits above the box (the heading) instead of through it.
      c1: { x: park.wait.x + dx * 0.42, y: park.wait.y - dy * (0.05 + 0.2 * rand(i, 25)) },
      c2: { x: into.x + Math.abs(dx) * (0.24 + 0.12 * rand(i, 26)), y: into.y - geo.size * (0.9 + 1 * rand(i, 27)) },
      turns: (1.5 + 1.5 * rand(i, 28)) * (rand(i, 29) < 0.5 ? -1 : 1),
    };
  });

  return {
    step: STEP, fallTime, tracks, pulls,
    exits: flights.map((f) => f.exit),
    bounces: flights.map((f) => f.bounces),
    spillEnd: Math.max(...flights.map((f) => f.exit)),
    pullTime: lastIn + TAIL,
    arrivals: pulls.map((p) => p.end),
  };
}

/** Where a letter is at a moment of the fall (it holds its wait point once the fall is over). */
export function fallPose(plan: SpillPlan, i: number, t: number): { x: number; y: number; rot: number } {
  const track = plan.tracks[i];
  const last = track.length / FIELDS - 1;
  const at = clamp(t / plan.step, 0, last);
  const a = Math.floor(at) * FIELDS, b = Math.min(last, Math.floor(at) + 1) * FIELDS, k = at - Math.floor(at);
  const mix = (f: number) => track[a + f] + (track[b + f] - track[a + f]) * k;
  return { x: mix(0), y: mix(1), rot: mix(2) };
}

/** Where a letter is at a moment of the pull: slow at first, then faster and faster, spinning as it goes, shrinking as it enters. */
export function pullPose(plan: SpillPlan, i: number, t: number): SpillPose {
  const p = plan.pulls[i];
  const k = clamp((t - p.start) / (p.end - p.start), 0, 1);
  const u = (Math.exp(PULL_CURVE * k) - 1) / (Math.exp(PULL_CURVE) - 1);
  const w = 1 - u;
  return {
    x: w * w * w * p.wait.x + 3 * w * w * u * p.c1.x + 3 * w * u * u * p.c2.x + u * u * u * p.into.x,
    y: w * w * w * p.wait.y + 3 * w * w * u * p.c1.y + 3 * w * u * u * p.c2.y + u * u * u * p.into.y,
    rot: p.rot + p.turns * 360 * u,
    scale: 1 - 0.6 * smooth(0.86, 1, u),
    opacity: 1 - smooth(0.965, 1, u),
  };
}

/** Where a letter is, given how far the fall has played (s) and how far the pull has gone (pull time, s). */
export function poseAt(plan: SpillPlan, i: number, fall: number, pull: number): SpillPose {
  if (fall >= plan.fallTime) return pullPose(plan, i, pull);
  return { ...fallPose(plan, i, fall), scale: 1, opacity: 1 };
}

/** How far the landing card's far side is shaken (deg about its near edge) at a moment of the fall: a short ring for every landing. */
export function trembleAt(plan: SpillPlan, t: number): number {
  let sum = 0;
  for (const letter of plan.bounces) {
    for (const hit of letter) {
      const u = t - hit.t;
      if (u > 0 && u < TREMBLE_FADE * 6) sum += TREMBLE_DEG * Math.sin(2 * Math.PI * TREMBLE_HZ * u) * Math.exp(-u / TREMBLE_FADE);
    }
  }
  return clamp(sum, -TREMBLE_MAX, TREMBLE_MAX);
}

/** How many letters have gone into the box by a moment of the pull. */
export function arrivedAt(plan: SpillPlan, t: number): number {
  return plan.arrivals.filter((a) => a <= t).length;
}

/** How full the box is at a moment of the pull (0 to 1): each letter counts in gradually as it
    shrinks into the box, so the level rises smoothly and the last letter makes it full. */
export function chargeAt(plan: SpillPlan, t: number): number {
  if (!plan.arrivals.length) return 0;
  let sum = 0;
  for (const a of plan.arrivals) sum += clamp((t - (a - CHARGE_RAMP)) / CHARGE_RAMP, 0, 1);
  return sum / plan.arrivals.length;
}

/** Where on the screen (as a share of its height) the note is when it tips, and the box's top when the last letter goes in. */
export const START_NOTE_AT = 0.19;
export const END_BOX_AT = 0.76;

export interface SpillScroll {
  /** Scroll position at which the paper tips (the fall then plays by itself). */
  start: number;
  /** The stretch of scrolling the pull is tied to: letters start to come back at one end, the last is in at the other. */
  pullStart: number;
  pullEnd: number;
}

/** The scroll positions the spill hangs on. Inputs are distances from the top of the page. */
export function spillScroll(m: { noteY: number; boxTop: number; viewport: number }): SpillScroll {
  const start = Math.max(0, m.noteY - START_NOTE_AT * m.viewport);
  const pullEnd = Math.max(start + 60 + 260, m.boxTop - END_BOX_AT * m.viewport);
  // The pull gets as much scrolling as there is between the tip and the end, up to a little over
  // half a screen: the longer the stretch, the slower the letters come in.
  const span = Math.min(clamp(0.55 * m.viewport, 300, 560), pullEnd - start - 60);
  return { start, pullStart: pullEnd - span, pullEnd };
}
