'use client';

// Dev-only animated 3D explainer of the per-head catalog fit (companion to /lab/fit).
// Part 1 is a primer on "scaling about a point"; Part 2 walks the real hair on the real
// house head through the production merge one option at a time. All fit numbers come
// from lib/splatFit, all "after" positions from lib/splatMerge.mergeSplatBuffersWith.

import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import * as THREE from 'three';
import { resolvePrebakeTransform } from '@/data/prebakeTransforms';
import { centerShift } from '@/lib/prebakeMergeCore';
import { axisFitScale, hairlineFit, type ZFit } from '@/lib/splatFit';
import { mergeSplatBuffersWith, SPLAT_ROW, type MergeOptions } from '@/lib/splatMerge';
import { DEFAULT_VIEWER_TRANSFORM } from '@/lib/splatMeta';
import { samplePoints, type Points } from '../fitLabProjection';
import { btn, btnActive, card, dim, f3, h2, h3, mathBox, MONO, mono, ok, page, small, table, td, th, warn } from '../labStyles';
import { CUT_ID, HAIR_URL, HEAD_URL, HOUSE_FIT, PRESETS, type Wearer } from '../wearerPresets';
import { bandOf, countMoved, objToThree, pickSample, reshapeHeadZ, rowColors, rowsToThree, ruler, scaleAbout, STEP_TITLE, stepMovesRow, stepOpts, twoBandZ, type Band, type StepId } from './animMath';
import { Arrows, FpsMeter, Label, Plane, TweenCloud, TWEEN_SECONDS } from './three';

const BLUE = '#4fa3ff', AMBER = '#ffb020', PINK = '#ff4d6d', WHITE = '#ffffff', GREY = '#9a9aa8', MINT = '#8ef0a8';
const BAND_COLOR: Record<Band, string> = { below: BLUE, fringe: AMBER, above: PINK };
const HOUSE_HC = { hairline: HOUSE_FIT.hairlineZ ?? 0.35, crown: HOUSE_FIT.crownZ };

export default function FitAnim() {
  return (
    <main style={page}>
      <h1 style={{ fontSize: 40, margin: '0 0 8px', lineHeight: 1.1 }}>The fit, animated</h1>
      <p style={{ fontSize: 19, color: '#b9b9c6', maxWidth: 1100, margin: '0 0 6px' }}>
        Drag to orbit, scroll to zoom. Object frame: z up (the eye line is z = 0), the face toward you. Companion to <Link href="/lab/fit" style={{ color: '#9ad0ff' }}>/lab/fit</Link>.
      </p>
      <section style={card}>
        <h2 style={h2}>Part 1 · Scaling about a point</h2>
        <ScaleAboutWidget />
        <TwoBandWidget />
      </section>
      <section style={card}>
        <h2 style={h2}>Part 2 · The real head, one option at a time</h2>
        <HeadSteps />
      </section>
    </main>
  );
}

// ─── Part 1A: z′ = P + (z − P) × s ───────────────────────────────────────────

const RULER = ruler(-0.3, 0.7, 41);
const RULER_X = 0.12; // before column at −x, after column at +x

/** Spheres that ease from where they are to `targets` (object z), hoverable. */
function RulerDots({ targets, x, colors, onHover, hovered, radius = 0.011 }: { targets: number[]; x: number; colors: string[]; onHover: (i: number | null) => void; hovered: number | null; radius?: number }) {
  const refs = useRef<Array<THREE.Mesh | null>>([]);
  const tw = useRef({ from: targets.slice(), to: targets.slice(), start: 0, shown: targets.slice() });
  useEffect(() => { const t = tw.current; t.from = t.shown.slice(); t.to = targets.slice(); t.start = performance.now(); }, [targets]);
  useFrame(() => {
    const t = tw.current;
    const u = (performance.now() - t.start) / (TWEEN_SECONDS * 1000);
    const e = u >= 1 ? 1 : u * u * (3 - 2 * u);
    for (let i = 0; i < t.to.length; i++) {
      t.shown[i] = t.from[i] + (t.to[i] - t.from[i]) * e;
      refs.current[i]?.position.set(x, t.shown[i], 0);
    }
  });
  return (
    <group>
      {targets.map((_, i) => (
        <mesh key={i} ref={(m) => { refs.current[i] = m; }} onPointerOver={(e) => { e.stopPropagation(); onHover(i); }} onPointerOut={() => onHover(null)}>
          <sphereGeometry args={[hovered === i ? radius * 1.8 : radius, 12, 12]} />
          <meshBasicMaterial color={hovered === i ? '#ffffff' : colors[i]} />
        </mesh>
      ))}
    </group>
  );
}

/** Line segments from (−x, z) to (+x, z′), easing with the dots. */
function RulerArrows({ before, after, colors }: { before: number[]; after: number[]; colors: string[] }) {
  const geom = useMemo(() => new THREE.BufferGeometry(), []);
  const tw = useRef({ from: after.slice(), to: after.slice(), start: 0, shown: after.slice() });
  useEffect(() => { const t = tw.current; t.from = t.shown.slice(); t.to = after.slice(); t.start = performance.now(); }, [after]);
  useEffect(() => {
    const n = before.length;
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3));
    const c = new Float32Array(n * 6);
    before.forEach((_, i) => { const col = new THREE.Color(colors[i]); c.set([col.r, col.g, col.b, col.r, col.g, col.b], i * 6); });
    geom.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }, [geom, before, colors]);
  useFrame(() => {
    const pos = geom.getAttribute('position') as THREE.BufferAttribute | undefined; if (!pos) return;
    const t = tw.current;
    const u = (performance.now() - t.start) / (TWEEN_SECONDS * 1000);
    const e = u >= 1 ? 1 : u * u * (3 - 2 * u);
    const a = pos.array as Float32Array;
    for (let i = 0; i < before.length; i++) {
      t.shown[i] = t.from[i] + (t.to[i] - t.from[i]) * e;
      a[i * 6] = -RULER_X; a[i * 6 + 1] = before[i]; a[i * 6 + 2] = 0;
      a[i * 6 + 3] = RULER_X; a[i * 6 + 4] = t.shown[i]; a[i * 6 + 5] = 0;
    }
    pos.needsUpdate = true;
  });
  return <lineSegments geometry={geom} frustumCulled={false}><lineBasicMaterial vertexColors transparent opacity={0.8} /></lineSegments>;
}

function ScaleAboutWidget() {
  const [P, setP] = useState(0.35);
  const [s, setS] = useState(0.823);
  const [arrows, setArrows] = useState(true);
  const [hovered, setHovered] = useState<number | null>(null);
  const after = useMemo(() => RULER.map((z) => scaleAbout(z, P, s)), [P, s]);
  const colors = useMemo(() => RULER.map((z) => {
    const d = Math.min(1, Math.abs(z - P) / 0.4); // further from P = warmer
    return new THREE.Color().setHSL(0.6 - 0.6 * d, 0.9, 0.6).getStyle();
  }), [P]);
  const i = hovered ?? RULER.findIndex((z) => Math.abs(z - 0.5) < 1e-9);
  const z = RULER[i], zp = after[i];
  return (
    <div style={{ marginBottom: 30 }}>
      <h3 style={h3}>A · One pivot: z′ = P + (z − P) × s</h3>
      <p style={small}>A ruler of 41 points from z = −0.3 to 0.7. The grey column is where they start; the coloured column is where the rule puts them. The point AT the pivot never moves; a point moves by (z − P) × (s − 1), so the further from P, the more it moves. Hover a point for its arithmetic.</p>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ width: 560, height: 520, borderRadius: 10, border: '1px solid #26262f', background: '#0f0f14', overflow: 'hidden' }}>
          <Canvas camera={{ position: [0.9, 0.55, 1.35], fov: 40 }} dpr={[1, 2]}>
            <RulerDots targets={RULER} x={-RULER_X} colors={RULER.map(() => '#6a6a78')} onHover={setHovered} hovered={hovered} radius={0.008} />
            <RulerDots targets={after} x={RULER_X} colors={colors} onHover={setHovered} hovered={hovered} />
            {arrows && <RulerArrows before={RULER} after={after} colors={colors} />}
            <Plane axis="z" at={P} color={WHITE} size={0.7} centre={[0, 0, 0]} opacity={0.22} label={<>pivot P = {f3(P)}</>} labelAt={[0.5, -0.5]} />
            <gridHelper args={[1.2, 12, '#2a2a35', '#1d1d26']} position={[0, -0.3, 0]} />
            <OrbitControls makeDefault target={[0, 0.2, 0]} />
          </Canvas>
        </div>
        <div style={{ flex: '1 1 420px', minWidth: 380 }}>
          <Slider label="pivot P" value={P} min={-0.3} max={0.7} onChange={setP} />
          <Slider label="scale s" value={s} min={0.5} max={1.5} onChange={setS} />
          <label style={{ fontSize: 18, display: 'block', margin: '8px 0 14px' }}><input type="checkbox" checked={arrows} onChange={(e) => setArrows(e.target.checked)} /> show arrows (before → after)</label>
          <div style={{ ...mathBox, fontFamily: MONO, fontSize: 19, lineHeight: 1.7 }}>
            <div style={dim}>{hovered === null ? 'hover a point — showing z = 0.500' : 'hovered point'}</div>
            <div>z = {f3(z)}: z′ = {f3(P)} + ({f3(z)} − {f3(P)}) × {f3(s)} = <b>{f3(zp)}</b></div>
            <div>moved by (z − P)(s − 1) = ({f3(z - P)})({f3(s - 1)}) = <b>{(zp - z) >= 0 ? '+' : ''}{f3(zp - z)}</b></div>
            <div style={{ marginTop: 6 }}>at z = P = {f3(P)}: z′ = {f3(P)} + 0 × {f3(s)} = <b>{f3(P)}</b> <span style={dim}>(does not move)</span></div>
            <div>at z = 0.7 (far): moved {f3(scaleAbout(0.7, P, s) - 0.7)} · at z = {f3(P + 0.1)} (near): moved {f3(scaleAbout(P + 0.1, P, s) - (P + 0.1))}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Part 1B: two bands, two pivots ─────────────────────────────────────────

function TwoBandWidget() {
  const [crown, setCrown] = useState(0.569);
  const [hairline, setHairline] = useState(0.357);
  const [tear, setTear] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);
  const zFit = useMemo(() => hairlineFit({ crown, hairline }, HOUSE_FIT), [crown, hairline]);
  const hl = zFit.hairline;
  const after = useMemo(() => RULER.map((z) => twoBandZ(z, zFit, tear)), [zFit, tear]);
  const colors = useMemo(() => RULER.map((z) => BAND_COLOR[bandOf(z, zFit)]), [zFit]);
  const joint = HOUSE_HC.hairline;
  const jointBelow = hl ? scaleAbout(joint, zFit.anchor, hl.scaleBelow) : joint;
  const jointAbove = hl ? (tear ? scaleAbout(joint, zFit.anchor, zFit.scale) : hl.wearer + (joint - hl.house) * zFit.scale) : joint;
  const i = hovered ?? RULER.findIndex((z) => Math.abs(z - 0.5) < 1e-9);
  const z = RULER[i], band = bandOf(z, zFit), zp = after[i];
  const formula = band === 'below' ? `z ≤ 0: z′ = z = ${f3(z)}`
    : band === 'fringe' ? `0 < z < ${f3(joint)}: z′ = 0 + (${f3(z)} − 0) × ${f3(hl?.scaleBelow ?? zFit.scale)} = ${f3(zp)}`
    : tear ? `z ≥ ${f3(joint)} (TORN): z′ = 0 + (${f3(z)} − 0) × ${f3(zFit.scale)} = ${f3(zp)}`
    : `z ≥ ${f3(joint)}: z′ = ${f3(hl?.wearer)} + (${f3(z)} − ${f3(joint)}) × ${f3(zFit.scale)} = ${f3(zp)}`;
  return (
    <div>
      <h3 style={h3}>B · Two bands, two pivots (the real rule)</h3>
      <p style={small}>
        <span style={{ color: BLUE }}>■ z ≤ 0</span> untouched · <span style={{ color: AMBER }}>■ 0 &lt; z &lt; 0.35</span> scaled about the eye line by scaleBelow · <span style={{ color: PINK }}>■ z ≥ 0.35</span> re-anchored: landed + (z − 0.35) × scaleAbove.
        The two pivots are the eye line (z = 0) and the house hairline (z = 0.35): the upper band is measured from 0.35 and placed from where 0.35 landed, so the bands stay joined.
      </p>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ width: 560, height: 520, borderRadius: 10, border: '1px solid #26262f', background: '#0f0f14', overflow: 'hidden' }}>
          <Canvas camera={{ position: [0.9, 0.55, 1.35], fov: 40 }} dpr={[1, 2]}>
            <RulerDots targets={RULER} x={-RULER_X} colors={RULER.map(() => '#6a6a78')} onHover={setHovered} hovered={hovered} radius={0.008} />
            <RulerDots targets={after} x={RULER_X} colors={colors} onHover={setHovered} hovered={hovered} />
            <RulerArrows before={RULER} after={after} colors={colors} />
            <mesh position={[RULER_X, jointAbove, 0]}><sphereGeometry args={[0.022, 16, 16]} /><meshBasicMaterial color={tear ? '#ff2244' : MINT} wireframe /></mesh>
            {tear && <mesh position={[RULER_X, jointBelow, 0]}><sphereGeometry args={[0.022, 16, 16]} /><meshBasicMaterial color={AMBER} wireframe /></mesh>}
            <Plane axis="z" at={0} color={WHITE} size={0.7} centre={[0, 0, 0]} opacity={0.14} label="eye line 0 (pivot 1)" labelAt={[0.5, -0.5]} />
            <Plane axis="z" at={joint} color={AMBER} size={0.7} centre={[0, 0, 0]} opacity={0.14} label={`house hairline ${f3(joint)} (pivot 2, before)`} labelAt={[0.1, -0.5]} />
            {hl && <Plane axis="z" at={hl.wearer} color={PINK} size={0.7} centre={[0, 0, 0]} opacity={0.14} label={`landed ${f3(hl.wearer)} (pivot 2, after)`} labelAt={[-0.5, 0.5]} />}
            <Plane axis="z" at={crown} color={WHITE} size={0.7} centre={[0, 0, 0]} opacity={0.08} label={`wearer crown ${f3(crown)}`} labelAt={[0.5, -0.5]} />
            <gridHelper args={[1.2, 12, '#2a2a35', '#1d1d26']} position={[0, -0.3, 0]} />
            <OrbitControls makeDefault target={[0, 0.2, 0]} />
          </Canvas>
        </div>
        <div style={{ flex: '1 1 420px', minWidth: 380 }}>
          <Slider label="wearer crown" value={crown} min={0.45} max={0.8} onChange={setCrown} />
          <Slider label="wearer hairline" value={hairline} min={0.2} max={0.5} onChange={setHairline} />
          <label style={{ fontSize: 18, display: 'block', margin: '8px 0 14px', color: tear ? '#ff6b6b' : undefined }}>
            <input type="checkbox" checked={tear} onChange={(e) => setTear(e.target.checked)} /> tear it: pivot the upper band about 0 instead of the hairline <span style={dim}>(what happens if you forget the subtract/add)</span>
          </label>
          <div style={{ ...mathBox, fontFamily: MONO, fontSize: 18, lineHeight: 1.7 }}>
            {hl ? (
              <>
                <div>scaleBelow = ({f3(hairline)} − 0.025) / {f3(joint)} = <b>{f3(hl.scaleBelow)}</b> · landed = {f3(joint)} × {f3(hl.scaleBelow)} = <b>{f3(hl.wearer)}</b></div>
                <div>scaleAbove = ({f3(crown)} − {f3(hl.wearer)}) / ({f3(HOUSE_HC.crown)} − {f3(joint)}) = <b>{f3(zFit.scale)}</b></div>
              </>
            ) : <div style={warn}>one-point fallback (no hairline)</div>}
            <div style={{ marginTop: 8, color: colors[i] }}>{hovered === null ? 'hover a point — showing z = 0.500' : 'hovered point'}: {formula}</div>
            <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: tear ? 'rgba(255,77,109,0.15)' : 'rgba(142,240,168,0.12)' }}>
              <div style={{ color: tear ? '#ff6b6b' : MINT, fontWeight: 700 }}>the joint at z = {f3(joint)}</div>
              <div>band 2 (from below): 0 + ({f3(joint)} − 0) × {f3(hl?.scaleBelow ?? 1)} = <b>{f3(jointBelow)}</b></div>
              <div>band 3 (from above): {tear ? `0 + (${f3(joint)} − 0) × ${f3(zFit.scale)}` : `${f3(hl?.wearer)} + (${f3(joint)} − ${f3(joint)}) × ${f3(zFit.scale)}`} = <b>{f3(jointAbove)}</b></div>
              <div>{Math.abs(jointAbove - jointBelow) < 1e-6 ? <span style={ok}>same number → the bands stay joined</span> : <span style={{ color: '#ff6b6b' }}>differ by {f3(jointAbove - jointBelow)} → a gap opens at 0.35 (the fringe and the top no longer touch)</span>}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Part 2: the real head ───────────────────────────────────────────────────

interface Loaded { head: ArrayBuffer; hair: ArrayBuffer }
interface StepState { opts: MergeOptions; pos: Float32Array; bright: Float32Array; moved: number }
interface Precomputed {
  hairPts: Points; headPts: Points;
  headHouse: Float32Array; headReshaped: Float32Array; headColors: Float32Array; headBright: Float32Array;
  hairColors: Float32Array;
  zFit: ZFit; uniform: ZFit; kx: number; ky: number; shift: number; full: MergeOptions; k: number;
  states: StepState[];
  samples: number[];
  ms: number;
}

const STEPS: StepId[] = [0, 1, 2, 3, 4, 5, 6, 7];
// Sample Gaussians: one per band region. The front midline has no hair below the eye line
// (that is forehead), so the first one is taken from anywhere (nape / sideburn).
const SAMPLE_Z: Array<{ z: number; xMax?: number; yMax?: number }> = [{ z: -0.15, xMax: 1, yMax: 1 }, { z: 0.15 }, { z: 0.3 }, { z: 0.45 }, { z: 0.62 }];

function precompute(data: Loaded, wearer: Wearer): Precomputed {
  const t0 = performance.now();
  const hairPts = samplePoints(data.hair, { stride: 2, minAlpha: 0.1 });
  const headPts = samplePoints(data.head, { stride: 2, minAlpha: 0.1 });
  const hn = Math.floor(data.head.byteLength / SPLAT_ROW);
  const headHouse = rowsToThree(data.head, headPts.rows);
  const headReshaped = rowsToThree(data.head, headPts.rows, 0, (z) => reshapeHeadZ(z, wearer, HOUSE_HC));
  const headColors = rowColors(data.head, headPts.rows, true);
  const headBright = new Float32Array(headPts.rows.length).fill(0.55);
  const hairColors = rowColors(data.hair, hairPts.rows);
  // The numbers, exactly as QuickTryOns builds them (see /lab/fit).
  const tf = resolvePrebakeTransform(CUT_ID);
  const k = tf.scale / DEFAULT_VIEWER_TRANSFORM.scale;
  const zFit = hairlineFit({ crown: wearer.crown, hairline: wearer.hairline }, HOUSE_FIT);
  const uniform = hairlineFit({ crown: wearer.crown, hairline: null }, HOUSE_FIT);
  const kx = axisFitScale(wearer.widthX, HOUSE_FIT.widthX);
  const ky = axisFitScale(wearer.depthY, HOUSE_FIT.depthY);
  const shift = centerShift(data.hair, wearer.centerX, k, kx);
  const full: MergeOptions = { k, kx, ky, dx: tf.dx * kx + shift, dy: tf.dy * ky, dz: tf.dz, zFit, alpha: tf.alpha, headAlpha: tf.headAlpha };
  const states: StepState[] = [];
  for (const step of STEPS) {
    const opts = stepOpts(step, full, uniform);
    const merged = mergeSplatBuffersWith(data.head, data.hair, opts);
    const pos = rowsToThree(merged, hairPts.rows, hn);
    const bright = new Float32Array(hairPts.rows.length);
    for (let i = 0; i < bright.length; i++) bright[i] = stepMovesRow(step, hairPts.z[i] * k, zFit) ? 1 : 0.15;
    const prev = step === 0 ? pos : step === 7 ? states[6].pos : states[step - 1].pos;
    states.push({ opts, pos, bright, moved: countMoved(pos, prev) });
  }
  const samples = SAMPLE_Z.map((s) => pickSample(hairPts.x, hairPts.y, hairPts.z, s.z, s.xMax, s.yMax)).filter((i) => i >= 0);
  return { hairPts, headPts, headHouse, headReshaped, headColors, headBright, hairColors, zFit, uniform, kx, ky, shift, full, k, states, samples, ms: performance.now() - t0 };
}

/** object coords of sample i in a three.js flat array */
const objAt = (arr: Float32Array, i: number): [number, number, number] => [arr[i * 3], -arr[i * 3 + 2], arr[i * 3 + 1]];

function HeadSteps() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [presetId, setPresetId] = useState('ethan');
  const [step, setStep] = useState<StepId>(0);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(0);
  const wearer = PRESETS.find((p) => p.id === presetId)!.w;

  useEffect(() => {
    let alive = true;
    Promise.all([HEAD_URL, HAIR_URL].map(async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); return r.arrayBuffer(); }))
      .then(([head, hair]) => { if (alive) setData({ head, hair }); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, []);

  const pre = useMemo(() => (data ? precompute(data, wearer) : null), [data, wearer]);

  // Play all: 0 → 6, each step after its tween (step 5 has the plane drop first).
  const timer = useRef<number | null>(null);
  const stopPlay = useCallback(() => { if (timer.current) window.clearTimeout(timer.current); timer.current = null; setPlaying(false); }, []);
  const playAll = useCallback(() => {
    stopPlay(); setPlaying(true); setStep(0);
    let s: StepId = 0;
    const next = () => {
      if (s >= 6) { setPlaying(false); timer.current = null; return; }
      s = (s + 1) as StepId; setStep(s);
      timer.current = window.setTimeout(next, (s === 5 ? 2 * TWEEN_SECONDS : TWEEN_SECONDS) * 1000 + 700);
    };
    timer.current = window.setTimeout(next, 1200);
  }, [stopPlay]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  if (error) return <p style={{ color: '#ff6b6b', fontSize: 20 }}>Could not load data: {error}</p>;
  if (!pre) return <p style={{ fontSize: 20 }}>Loading {HEAD_URL} and {HAIR_URL}…</p>;

  const { zFit, states, samples, hairPts, k } = pre;
  const hl = zFit.hairline;
  const landed = hl?.wearer ?? HOUSE_HC.hairline;
  const cur = states[step];
  const prevIdx: StepId = step === 0 ? 0 : step === 7 ? 6 : ((step - 1) as StepId);
  const prev = states[prevIdx];
  const headTarget = step >= 1 ? pre.headReshaped : pre.headHouse;
  const delay = step === 5 ? TWEEN_SECONDS : 0;
  // sample arrows: from the previous state to this one (three.js coords)
  const arrowFrom = new Float32Array(samples.length * 3), arrowTo = new Float32Array(samples.length * 3);
  samples.forEach((si, j) => { arrowFrom.set(prev.pos.subarray(si * 3, si * 3 + 3), j * 3); arrowTo.set(cur.pos.subarray(si * 3, si * 3 + 3), j * 3); });

  // Reference planes label at the front-left corner, the step's pivot plane at the front-right.
  const PS = 1.25, REF: [number, number] = [-0.5, -0.5], PIV: [number, number] = [0.05, -0.5];
  const pivotPlane = (() => {
    switch (step) {
      case 2: return <Plane axis="x" at={0} color={MINT} opacity={0.2} size={PS} label="pivot plane x = 0 (width scales about it)" labelAt={[0, -0.5]} />;
      case 3: return <Plane axis="y" at={0} color={MINT} opacity={0.2} size={PS} label="pivot plane y = 0 (depth scales about it)" labelAt={[0, -0.5]} />;
      case 4: return <Plane axis="z" at={0} color={MINT} opacity={0.22} size={PS} label="pivot: eye line z = 0" labelAt={PIV} />;
      case 5: return <Plane axis="z" initial={HOUSE_HC.hairline} at={landed} color={MINT} opacity={0.22} size={PS} label={`pivot: house hairline ${f3(HOUSE_HC.hairline)} → landed ${f3(landed)}`} labelAt={PIV} />;
      case 7: return <Plane axis="z" at={0} color={MINT} opacity={0.22} size={PS} label="pivot: eye line z = 0 (the only one)" labelAt={PIV} />;
      default: return null;
    }
  })();

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 17, color: '#a0a0ae' }}>wearer:</span>
        {PRESETS.map((p) => <button key={p.id} type="button" style={{ ...btn, ...(p.id === presetId ? btnActive : {}) }} onClick={() => { stopPlay(); setPresetId(p.id); }}>{p.label}</button>)}
        <span style={{ ...dim, fontSize: 15, marginLeft: 8 }}>8 merges precomputed in {pre.ms.toFixed(0)} ms · {hairPts.rows.length.toLocaleString()} hair rows, {pre.headPts.rows.length.toLocaleString()} head rows shown · {fps} fps</span>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {STEPS.map((s) => (
          <button key={s} type="button" style={{ ...btn, fontSize: 16, padding: '6px 12px', ...(s === step ? btnActive : {}) }} onClick={() => { stopPlay(); setStep(s); }}>
            {s === 7 ? 'vs · uniform squash' : `${s} · ${STEP_TITLE[s].split(':')[0]}`}
          </button>
        ))}
        <button type="button" style={{ ...btn, fontSize: 16, padding: '6px 12px', background: playing ? '#3a3a48' : '#1d4d2a', border: `1px solid ${MINT}` }} onClick={playing ? stopPlay : playAll}>{playing ? '■ stop' : '▶ play all 0 → 6'}</button>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{step === 7 ? 'vs' : step} · {STEP_TITLE[step]}</div>

      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ width: 900, maxWidth: '100%', height: 700, borderRadius: 10, border: '1px solid #26262f', background: '#0f0f14', overflow: 'hidden' }}>
          <Canvas camera={{ position: [1.5, 0.8, 2.6], fov: 36 }} dpr={[1, 2]}>
            <FpsMeter onFps={setFps} />
            <TweenCloud target={headTarget} colors={pre.headColors} bright={pre.headBright} size={2.2} />
            <TweenCloud target={cur.pos} colors={pre.hairColors} bright={cur.bright} size={3} delay={delay} />
            {step >= 2 && step !== 7 && <Arrows from={arrowFrom} to={arrowTo} color={WHITE} delay={delay} labels={samples.map((_, j) => String(j + 1))} />}
            {step === 7 && <Arrows from={arrowFrom} to={arrowTo} color={WHITE} labels={samples.map((_, j) => String(j + 1))} />}
            {/* reference planes */}
            <Plane axis="z" at={0} color={WHITE} opacity={0.08} size={PS} label="eye line z = 0" labelAt={REF} />
            {step <= 1 && <Plane axis="z" at={HOUSE_HC.hairline} color={AMBER} opacity={0.1} size={PS} label={`house hairline ${f3(HOUSE_HC.hairline)}`} labelAt={REF} />}
            {step <= 1 && <Plane axis="z" at={HOUSE_HC.crown} color={GREY} opacity={0.1} size={PS} label={`house crown ${f3(HOUSE_HC.crown)}`} labelAt={REF} />}
            {step >= 1 && <Plane axis="z" at={wearer.hairline} color={PINK} opacity={0.1} size={PS} label={`wearer hairline ${f3(wearer.hairline)}`} labelAt={step <= 1 ? [-0.5, 0.5] : REF} />}
            {step >= 1 && <Plane axis="z" at={wearer.crown} color={WHITE} opacity={0.1} size={PS} label={`wearer crown ${f3(wearer.crown)}`} labelAt={step <= 1 ? [-0.5, 0.5] : REF} />}
            {step === 1 && (
              <>
                <Label at={[0.05, -0.3, (HOUSE_HC.crown + wearer.crown) / 2]} color={AMBER}>crown gap {f3(HOUSE_HC.crown - wearer.crown)}: hair top {f3(HOUSE_HC.crown)} vs wearer crown {f3(wearer.crown)}</Label>
                <Label at={[0.05, -0.55, HOUSE_HC.hairline + 0.01]} color={PINK}>fringe edge {f3(HOUSE_HC.hairline)} sits ON the wearer hairline {f3(wearer.hairline)} — no overlap</Label>
              </>
            )}
            {pivotPlane}
            <OrbitControls makeDefault target={[0, 0.15, 0]} />
          </Canvas>
        </div>
        <div style={{ flex: '1 1 420px', minWidth: 380 }}>
          <StepText step={step} pre={pre} wearer={wearer} />
          <h4 style={{ fontSize: 18, margin: '14px 0 6px', color: '#dcdce6' }}>Sample Gaussians (numbered in the scene)</h4>
          <div style={{ ...mathBox, fontFamily: MONO, fontSize: 15, lineHeight: 1.6 }}>
            {samples.map((si, j) => {
              const b = objAt(prev.pos, si), a = objAt(cur.pos, si);
              const z0 = hairPts.z[si] * k;
              return <div key={si} style={{ padding: '3px 0', borderBottom: '1px solid #26262f' }}><b style={{ color: WHITE }}>#{j + 1}</b> {sampleFormula(step, b, a, z0, pre)}</div>;
            })}
          </div>
        </div>
      </div>

      <h4 style={{ fontSize: 18, margin: '16px 0 6px', color: '#dcdce6' }}>Every step is the production merge with later options off</h4>
      <table style={{ ...table, fontSize: 15 }}>
        <thead><tr><th style={th}>step</th><th style={th}>which rows</th><th style={th}>pivot</th><th style={th}>factor / offset</th><th style={th}>rows moved (of {hairPts.rows.length.toLocaleString()} shown)</th><th style={th}>opts passed to mergeSplatBuffersWith</th></tr></thead>
        <tbody>
          {STEPS.map((s) => {
            const st = states[s];
            const row = stepRow(s, pre);
            return (
              <tr key={s} style={s === step ? { background: 'rgba(255,77,109,0.14)' } : undefined}>
                <td style={td}>{s === 7 ? 'vs' : s}</td><td style={td}>{row.rows}</td><td style={td}>{row.pivot}</td><td style={td}>{row.factor}</td><td style={td}>{st.moved.toLocaleString()}</td>
                <td style={{ ...td, fontSize: 13 }}>{optsText(st.opts)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StepText({ step, pre, wearer }: { step: StepId; pre: Precomputed; wearer: Wearer }) {
  const { zFit, kx, ky, full, uniform, shift } = pre;
  const hl = zFit.hairline;
  const box: CSSProperties = { ...mathBox, fontSize: 17, lineHeight: 1.6 };
  switch (step) {
    case 0: return <div style={box}>The cut as it was baked, on the house head it was fitted to. Bright = every hair row. Planes: eye line 0, house hairline {f3(HOUSE_HC.hairline)}, house crown {f3(HOUSE_HC.crown)}.</div>;
    case 1: return <div style={box}>The house head fades into a stand-in for the wearer: <b>the house head reshaped to the wearer&apos;s two numbers</b> (hairline {f3(wearer.hairline)}, crown {f3(wearer.crown)}; his real base is not on disk). The hair has not moved: its top still sits at {f3(HOUSE_HC.crown)}, <b>{f3(HOUSE_HC.crown - wearer.crown)} above</b> the wearer crown, and its fringe edge at {f3(HOUSE_HC.hairline)} sits right on the wearer hairline {f3(wearer.hairline)} with no overlap. Hair rows are dimmed: this step moves none of them.</div>;
    case 2: return <div style={box}>Every hair row&apos;s x and x-radius × kx = {f3(wearer.widthX)} / {f3(HOUSE_FIT.widthX)} = <b>{f3(kx)}</b>, about the plane x = 0 (rows on the plane stay; rows at the sides move most).</div>;
    case 3: return <div style={box}>Every hair row&apos;s y and y-radius × ky = {f3(wearer.depthY)} / {f3(HOUSE_FIT.depthY)} = <b>{f3(ky)}</b>, about the plane y = 0 (front and back move toward it).</div>;
    case 4: return hl ? (
      <div style={box}>
        Rows with 0 &lt; z &lt; {f3(hl.house)} (amber): z′ = 0 + (z − 0) × scaleBelow, scaleBelow = ({f3(wearer.hairline)} − 0.025) / {f3(hl.house)} = <b>{f3(hl.scaleBelow)}</b>. The front edge of the fringe lands at {f3(hl.house)} × {f3(hl.scaleBelow)} = <b>{f3(hl.wearer)}</b>, 0.025 below the wearer hairline (so it overlaps the skin edge instead of floating). The row nearest z = 0 moves by almost nothing (0.01 × {f3(hl.scaleBelow - 1)} = {f3(0.01 * (hl.scaleBelow - 1))}) and stays joined to the blue rows below it, which do not move.
        <div style={{ ...ok, marginTop: 6 }}>Hair rows at or below z = 0 (nape, sideburns) are never changed by the fit.</div>
      </div>
    ) : <div style={box}>No hairline: one-point fit, nothing to do in this step.</div>;
    case 5: return hl ? <div style={box}>Rows with z ≥ {f3(hl.house)} (pink). First the pivot plane drops from the house hairline {f3(hl.house)} to where it landed, <b>{f3(hl.wearer)}</b>; then z′ = {f3(hl.wearer)} + (z − {f3(hl.house)}) × scaleAbove, scaleAbove = ({f3(wearer.crown)} − {f3(hl.wearer)}) / ({f3(HOUSE_HC.crown)} − {f3(hl.house)}) = <b>{f3(zFit.scale)}</b>. The top of the hair (z = {f3(HOUSE_HC.crown)}) lands on the wearer crown plane: {f3(hl.wearer)} + ({f3(HOUSE_HC.crown)} − {f3(hl.house)}) × {f3(zFit.scale)} = <b>{f3(hl.wearer + (HOUSE_HC.crown - hl.house) * zFit.scale)}</b>.</div> : <div style={box}>One-point fit: every row above the eye line × {f3(zFit.scale)}.</div>;
    case 6: return <div style={box}>Every row: x += dx = centerX<sub>wearer</sub> − headCenterX(hair) × k × kx = <b>{f3(full.dx ?? 0)}</b> (centerShift {f3(shift)}). This is the full QuickTryOns merge.</div>;
    case 7: return <div style={box}>What a single factor would do instead: every row above the eye line × ({f3(wearer.crown)} / {f3(HOUSE_HC.crown)}) = <b>{f3(uniform.scale)}</b> about z = 0, with no hairline band. The crown lands, but the fringe edge at {f3(HOUSE_HC.hairline)} goes to {f3(HOUSE_HC.hairline * uniform.scale)} — <b>{f3(wearer.hairline - HOUSE_HC.hairline * uniform.scale)} above</b> where the two-point fit put it ({f3(zFit.hairline?.wearer)}): the fringe rides up the forehead and a band of stubble shows. Compare with step 6 (press 6).</div>;
  }
}

function sampleFormula(step: StepId, b: [number, number, number], a: [number, number, number], z0: number, pre: Precomputed): string {
  const { zFit, kx, ky, full, uniform } = pre;
  const hl = zFit.hairline;
  const band = bandOf(z0, zFit);
  switch (step) {
    case 0: return `at x ${f3(a[0])}, y ${f3(a[1])}, z ${f3(a[2])} (as baked)`;
    case 1: return `z ${f3(a[2])}: unchanged (only the head moved)`;
    case 2: return `x ${f3(b[0])} → ${f3(b[0])} × ${f3(kx)} = ${f3(a[0])}`;
    case 3: return `y ${f3(b[1])} → ${f3(b[1])} × ${f3(ky)} = ${f3(a[1])}`;
    case 4: return band === 'fringe' && hl ? `z ${f3(b[2])} → 0 + (${f3(b[2])} − 0) × ${f3(hl.scaleBelow)} = ${f3(a[2])}` : band === 'below' ? `z ${f3(b[2])} ≤ 0: never changed` : `z ${f3(b[2])} ≥ ${f3(hl?.house)}: not this band, waits for step 5`;
    case 5: return band === 'above' && hl ? `z ${f3(b[2])} → ${f3(hl.wearer)} + (${f3(b[2])} − ${f3(hl.house)}) × ${f3(zFit.scale)} = ${f3(a[2])}` : `z ${f3(b[2])}: not this band, unchanged`;
    case 6: return `x ${f3(b[0])} → ${f3(b[0])} + (${f3(full.dx ?? 0)}) = ${f3(a[0])}`;
    case 7: return band === 'below' ? `z ${f3(z0)} ≤ 0: unchanged either way` : `from baked z ${f3(z0)} → 0 + (${f3(z0)} − 0) × ${f3(uniform.scale)} = ${f3(a[2])} (two-point fit gave ${f3(b[2])})`;
  }
}

function stepRow(s: StepId, pre: Precomputed): { rows: string; pivot: string; factor: string } {
  const { zFit, kx, ky, full, uniform } = pre;
  const hl = zFit.hairline;
  switch (s) {
    case 0: return { rows: 'none (as baked)', pivot: '—', factor: `k = ${f3(full.k)}` };
    case 1: return { rows: 'none (the head changes)', pivot: '—', factor: '—' };
    case 2: return { rows: 'all hair rows', pivot: 'plane x = 0', factor: `kx = ${f3(kx)}` };
    case 3: return { rows: 'all hair rows', pivot: 'plane y = 0', factor: `ky = ${f3(ky)}` };
    case 4: return { rows: `0 < z < ${f3(hl?.house)}`, pivot: 'eye line z = 0', factor: `scaleBelow = ${f3(hl?.scaleBelow ?? zFit.scale)}` };
    case 5: return { rows: `z ≥ ${f3(hl?.house)}`, pivot: `${f3(hl?.house)} → landed ${f3(hl?.wearer)}`, factor: `scaleAbove = ${f3(zFit.scale)}` };
    case 6: return { rows: 'all hair rows', pivot: '— (shift)', factor: `dx = ${f3(full.dx ?? 0)}` };
    case 7: return { rows: 'z > 0 (one band)', pivot: 'eye line z = 0', factor: `scale = ${f3(uniform.scale)} (vs step 6)` };
  }
}

function optsText(o: MergeOptions): string {
  const z = o.zFit;
  const zf = z ? `{ anchor ${f3(z.anchor)}, scale ${f3(z.scale)}${z.hairline ? `, hairline { house ${f3(z.hairline.house)}, wearer ${f3(z.hairline.wearer)}, scaleBelow ${f3(z.hairline.scaleBelow)} }` : ''} }` : 'undefined';
  return `k ${f3(o.k)}, kx ${f3(o.kx ?? 1)}, ky ${f3(o.ky ?? 1)}, dx ${f3(o.dx ?? 0)}, dy ${f3(o.dy ?? 0)}, dz ${f3(o.dz ?? 0)}, zFit ${zf}`;
}

function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '130px 1fr 96px', gap: 12, alignItems: 'center', fontSize: 17, padding: '5px 0' }}>
      <span style={mono}>{label}</span>
      <input type="range" min={min} max={max} step={0.001} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ accentColor: PINK, width: '100%' }} />
      <input type="number" step={0.001} value={value} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v); }}
        style={{ fontSize: 16, padding: '4px 8px', borderRadius: 6, border: '1px solid #3a3a48', background: '#0f0f14', color: '#fff', width: 96, boxSizing: 'border-box' }} />
    </label>
  );
}
