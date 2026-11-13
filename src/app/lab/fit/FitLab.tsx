'use client';

// Dev-only explainer for the per-head catalog fit: how a cut built on the house head is
// reshaped onto a wearer. It runs the REAL functions on REAL bytes — lib/splatFit for the
// numbers (hairlineFit, axisFitScale, the head measurements), lib/prebakeMergeCore.centerShift
// for dx, and lib/splatMerge.mergeSplatBuffersWith for the "after" positions, with the same
// MergeOptions QuickTryOns.tsx builds — and only draws what comes back. Data lives in
// public/lab/ (gitignored): the house male buzz head and one catalog cut.

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { resolvePrebakeTransform } from '@/data/prebakeTransforms';
import { centerShift } from '@/lib/prebakeMergeCore';
import { axisFitScale, crownZ, HAIRLINE_OVERLAP, hairlineFit, hairlineZ, headCenterX, headDepthY, headWidthX, type ZFit } from '@/lib/splatFit';
import { mergeSplatBuffersWith, SPLAT_ROW, type MergeOptions } from '@/lib/splatMerge';
import { DEFAULT_VIEWER_TRANSFORM } from '@/lib/splatMeta';
import { BAND_LABEL, bandFor, makeMapper, samplePoints, spreadPick, VIEWS, type Band, type Mapper, type Points, type View } from './fitLabProjection';
import HeadMeasureSection from './HeadMeasureSection';
import { btn, btnActive, canvasStyle, card, code, dim, f3, h2, h3, mathBox, MONO, page, small, table, td, th } from './labStyles';
import { CUT_ID, HAIR_URL, HEAD_URL, HOUSE_CENTER_X, HOUSE_FIT, PRESETS, type Wearer } from './wearerPresets';

const STRIDE = 4;      // plot every 4th row
const MIN_ALPHA = 0.1; // skip the sheer ones
const CANVAS_W = 600, CANVAS_H = 560;

const BAND_COLOR: Record<Band, string> = { below: '#4fa3ff', fringe: '#ffb020', above: '#ff4d6d' };
const BAND_NAME: Record<Band, string> = { below: 'below eye line', fringe: 'eye line → house hairline', above: 'above house hairline' };
const BANDS: Band[] = ['below', 'fringe', 'above'];

const sgn = (n: number) => (n < 0 ? `(${f3(n)})` : f3(n));
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

interface Loaded { head: ArrayBuffer; hair: ArrayBuffer }

/** Per-asset facts: house-head measurements, the catalog transform, the plotted samples. */
interface Fixed {
  measured: { crown: number | null; hairline: number | null; width: number | null; depth: number | null; center: number | null };
  hairCenter: number | null;
  tf: ReturnType<typeof resolvePrebakeTransform>;
  headScale: number;
  k: number;
  headPts: Points;
  hairPts: Points;
  /** head rows: the merged buffer's hair rows start here */
  hn: number;
}

/** Per-wearer results: the fit numbers, the merge opts, and the hair before/after the real merge. */
interface Fit {
  zFit: ZFit;
  kx: number;
  ky: number;
  shift: number;
  opts: MergeOptions;
  before: Points;
  after: Points;
  /** index into BANDS per plotted hair point */
  bands: Uint8Array;
  target: number;
  rawBelow: number | null;
  rawAbove: number;
  rawKx: number | null;
  rawKy: number | null;
  hairRows: number;
}

export default function FitLab() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wearer, setWearer] = useState<Wearer>(PRESETS[1].w);

  useEffect(() => {
    let alive = true;
    Promise.all([HEAD_URL, HAIR_URL].map(async (u) => {
      const r = await fetch(u);
      if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
      return r.arrayBuffer();
    })).then(([head, hair]) => { if (alive) setData({ head, hair }); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, []);

  // Fixed per asset: measurements of the house head and the hair, the catalog transform, the plot samples.
  const fixed = useMemo((): Fixed | null => {
    if (!data) return null;
    const crown = crownZ(data.head);
    const measured = {
      crown,
      hairline: hairlineZ(data.head, crown),
      width: headWidthX(data.head),
      depth: headDepthY(data.head),
      center: headCenterX(data.head),
    };
    const hairCenter = headCenterX(data.hair);
    const tf = resolvePrebakeTransform(CUT_ID);
    // The house head has no sidecar, so the viewer scale is the default (what QuickTryOns falls back to).
    const headScale = DEFAULT_VIEWER_TRANSFORM.scale;
    const k = tf.scale / headScale;
    const headPts = samplePoints(data.head, { stride: STRIDE, minAlpha: MIN_ALPHA });
    const hairPts = samplePoints(data.hair, { stride: STRIDE, minAlpha: MIN_ALPHA });
    const hn = Math.floor(data.head.byteLength / SPLAT_ROW);
    return { measured, hairCenter, tf, headScale, k, headPts, hairPts, hn };
  }, [data]);

  // Per wearer: the fit numbers, the real merge, and the hair's "after" positions read back from it.
  const fit = useMemo((): Fit | null => {
    if (!data || !fixed) return null;
    const { tf, k, hairPts, hn } = fixed;
    const zFit: ZFit = hairlineFit({ crown: wearer.crown, hairline: wearer.hairline }, HOUSE_FIT);
    const kx = axisFitScale(wearer.widthX, HOUSE_FIT.widthX);
    const ky = axisFitScale(wearer.depthY, HOUSE_FIT.depthY);
    // QuickTryOns passes centerX and the merge core turns it into dx with centerShift; done inline here.
    const shift = centerShift(data.hair, wearer.centerX, k, kx);
    const opts: MergeOptions = {
      k, kx, ky, dx: tf.dx * kx + shift, dy: tf.dy * ky, dz: tf.dz, zFit, alpha: tf.alpha, headAlpha: tf.headAlpha,
      headAlphaAbove: undefined, // STUBBLE_GAIN is 1 in QuickTryOns
    };
    const merged = mergeSplatBuffersWith(data.head, data.hair, opts);
    const mf = new Float32Array(merged.buffer, merged.byteOffset, merged.byteLength / 4);
    const n = hairPts.rows.length;
    const after: Points = { x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), a: hairPts.a, rows: hairPts.rows };
    const before: Points = { x: new Float32Array(n), y: new Float32Array(n), z: new Float32Array(n), a: hairPts.a, rows: hairPts.rows };
    const bands = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      // "before" = the cut as baked, ×k (k = 1 for catalog cuts: hair and house head share one object space).
      before.x[i] = hairPts.x[i] * k; before.y[i] = hairPts.y[i] * k; before.z[i] = hairPts.z[i] * k;
      const r = (hn + hairPts.rows[i]) * (SPLAT_ROW / 4);
      after.x[i] = mf[r]; after.y[i] = mf[r + 1]; after.z[i] = mf[r + 2];
      bands[i] = BANDS.indexOf(bandFor(before.z[i], zFit));
    }
    // Raw (unclamped) values, only to show when a clamp bit. The function outputs are what is used.
    const hl = zFit.hairline;
    const target = wearer.hairline - HAIRLINE_OVERLAP;
    const rawBelow = hl ? (target - zFit.anchor) / (hl.house - zFit.anchor) : null;
    const rawAbove = hl ? (wearer.crown - hl.wearer) / (HOUSE_FIT.crownZ - hl.house) : (wearer.crown - zFit.anchor) / (HOUSE_FIT.crownZ - zFit.anchor);
    const rawKx = HOUSE_FIT.widthX ? wearer.widthX / HOUSE_FIT.widthX : null;
    const rawKy = HOUSE_FIT.depthY ? wearer.depthY / HOUSE_FIT.depthY : null;
    return { zFit, kx, ky, shift, opts, before, after, bands, target, rawBelow, rawAbove, rawKx, rawKy, hairRows: Math.floor(data.hair.byteLength / SPLAT_ROW) };
  }, [data, fixed, wearer]);

  const set = (patch: Partial<Wearer>) => setWearer((w) => ({ ...w, ...patch }));

  return (
    <main style={page}>
      <h1 style={{ fontSize: 40, margin: '0 0 8px', lineHeight: 1.1 }}>How a catalog cut is fitted to a head</h1>
      <p style={{ fontSize: 17, margin: '0 0 12px' }}><Link href="/lab/fit/anim" style={{ color: '#9ad0ff' }}>→ animated 3D version: /lab/fit/anim</Link>{' · '}<Link href="/lab/fit/axes" style={{ color: '#9ad0ff' }}>→ why the head renders upright: /lab/fit/axes</Link></p>
      <p style={{ fontSize: 20, margin: '0 0 28px', color: '#b9b9c6', maxWidth: 1100 }}>
        Cut <code style={code}>{CUT_ID}</code> (sidefringe, dark brown) on the men&apos;s house head. Every number below is the output of
        <code style={code}>hairlineFit</code>, <code style={code}>axisFitScale</code>, <code style={code}>centerShift</code> and the head measurements in
        <code style={code}>src/lib/splatFit.ts</code>; every &quot;after&quot; dot is a row read back out of <code style={code}>mergeSplatBuffersWith(head, hair, opts)</code>
        with the opts <code style={code}>QuickTryOns.tsx</code> builds. Object frame: x right, y back (face at −y), z up, eye line z = 0.
      </p>

      {error && <p style={{ color: '#ff6b6b', fontSize: 20 }}>Could not load data: {error}. Expected {HEAD_URL} and {HAIR_URL} under public/lab/.</p>}
      {!data && !error && <p style={{ fontSize: 20 }}>Loading {HEAD_URL} and {HAIR_URL}…</p>}

      {fixed && fit && (
        <>
          {/* 0. How the head is measured */}
          <section style={card}>
            <h2 style={h2}>0 · How the head is measured</h2>
            <HeadMeasureSection head={data!.head} headPts={fixed.headPts} live={fixed.measured} />
          </section>

          {/* 1. Inputs */}
          <section style={card}>
            <h2 style={h2}>1 · Inputs</h2>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
              {PRESETS.map((p) => {
                const active = (Object.keys(p.w) as Array<keyof Wearer>).every((k) => near(p.w[k], wearer[k]));
                return (
                  <button key={p.id} type="button" onClick={() => setWearer(p.w)} style={{ ...btn, ...(active ? btnActive : {}) }}>{p.label}</button>
                );
              })}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 24 }}>
              <div>
                <h3 style={h3}>Wearer (editable)</h3>
                <RangeRow label="crown z" value={wearer.crown} min={0.45} max={0.8} onChange={(v) => set({ crown: v })} />
                <RangeRow label="hairline z" value={wearer.hairline} min={0.2} max={0.5} onChange={(v) => set({ hairline: v })} />
                <RangeRow label="width x" value={wearer.widthX} min={0.6} max={1.0} onChange={(v) => set({ widthX: v })} />
                <RangeRow label="depth y" value={wearer.depthY} min={0.7} max={1.15} onChange={(v) => set({ depthY: v })} />
                <RangeRow label="centre x" value={wearer.centerX} min={-0.1} max={0.1} onChange={(v) => set({ centerX: v })} />
              </div>
              <div>
                <h3 style={h3}>House head (catalog) vs measured live here</h3>
                <table style={table}>
                  <thead><tr><th style={th}></th><th style={th}>catalog fit</th><th style={th}>measured now</th><th style={th}>Δ</th></tr></thead>
                  <tbody>
                    <MeasureRow name="anchor z (eye line)" cat={HOUSE_FIT.anchorZ} live={0} fixed />
                    <MeasureRow name="crownZ()" cat={HOUSE_FIT.crownZ} live={fixed.measured.crown} />
                    <MeasureRow name="hairlineZ()" cat={HOUSE_FIT.hairlineZ ?? null} live={fixed.measured.hairline} />
                    <MeasureRow name="headWidthX()" cat={HOUSE_FIT.widthX ?? null} live={fixed.measured.width} />
                    <MeasureRow name="headDepthY()" cat={HOUSE_FIT.depthY ?? null} live={fixed.measured.depth} />
                    <MeasureRow name="headCenterX()" cat={HOUSE_CENTER_X} live={fixed.measured.center} />
                  </tbody>
                </table>
                <p style={small}>
                  Measured on {HEAD_URL} ({fixed.hn.toLocaleString()} rows) with the same functions the app runs on a wearer&apos;s buzz-cut base.
                  The catalog values were measured by scripts/prebake-pipeline/fit.py; the two should agree to a few thousandths.
                  Hair: {HAIR_URL} ({fit.hairRows.toLocaleString()} rows); its own temple-band centre headCenterX(hair) = {f3(fixed.hairCenter)}.
                </p>
              </div>
            </div>

            <h3 style={{ ...h3, marginTop: 24 }}>Derived fit (live)</h3>
            <LiveMath fixed={fixed} fit={fit} wearer={wearer} />
          </section>

          {/* 2. Projections */}
          <section style={card}>
            <h2 style={h2}>2 · Before and after, three views</h2>
            <p style={small}>
              Grey = the house head (the wearer&apos;s own base is not on disk, so the head does not change; the labelled lines are the wearer&apos;s targets).
              Hair dots are coloured by the rule that moved them.
              {' '}<Swatch c={BAND_COLOR.below} /> {BAND_NAME.below} (z unchanged)
              {' '}<Swatch c={BAND_COLOR.fringe} /> {BAND_NAME.fringe} (×scaleBelow about z = 0)
              {' '}<Swatch c={BAND_COLOR.above} /> {BAND_NAME.above} (re-anchored at the landed hairline, ×scaleAbove).
              Every {STRIDE}th row with alpha ≥ {MIN_ALPHA}.
            </p>
            {VIEWS.map((view) => (
              <ViewPair key={view.id} view={view} fixed={fixed} fit={fit} wearer={wearer} />
            ))}
          </section>

          {/* 3. Per-band table */}
          <section style={card}>
            <h2 style={h2}>3 · Each band, with three real Gaussians</h2>
            <BandTable fit={fit} />
          </section>

          {/* 4. Summary */}
          <section style={card}>
            <h2 style={h2}>4 · What changed, per axis</h2>
            <Summary fixed={fixed} fit={fit} wearer={wearer} />
          </section>
        </>
      )}
    </main>
  );
}

// ─── live math ───────────────────────────────────────────────────────────────

function Clamp({ raw, used, range }: { raw: number | null; used: number; range: string }) {
  if (raw === null || near(raw, used)) return null;
  return <span style={{ color: '#ffd166', marginLeft: 10 }}>⚠ clamped to {range}: raw {f3(raw)} → {f3(used)}</span>;
}

function LiveMath({ fixed, fit, wearer }: { fixed: Fixed; fit: Fit; wearer: Wearer }) {
  const { zFit, kx, ky, shift, opts, target, rawBelow, rawAbove, rawKx, rawKy } = fit;
  const hl = zFit.hairline;
  const a = zFit.anchor;
  return (
    <div style={mathBox}>
      <Line k="k">transform.scale / headScale = {f3(fixed.tf.scale)} / {f3(fixed.headScale)} = <b>{f3(fixed.k)}</b> <span style={dim}>(catalog cuts share the head&apos;s object space)</span></Line>
      <Line k="anchor">eye line z = <b>{f3(a)}</b> <span style={dim}>(everything at or below it keeps its z)</span></Line>
      {hl ? (
        <>
          <Line k="target">hairline<sub>wearer</sub> − HAIRLINE_OVERLAP = {f3(wearer.hairline)} − {HAIRLINE_OVERLAP} = <b>{f3(target)}</b> <span style={dim}>(hair overlaps the skin edge a little, or it reads as floating)</span></Line>
          <Line k="scaleBelow">(target − anchor) / (hairline<sub>house</sub> − anchor) = ({f3(target)} − {f3(a)}) / ({f3(hl.house)} − {f3(a)}) = <b>{f3(hl.scaleBelow)}</b><Clamp raw={rawBelow} used={hl.scaleBelow} range="0.6…1.4" /></Line>
          <Line k="landed">anchor + (hairline<sub>house</sub> − anchor) × scaleBelow = {f3(a)} + {f3(hl.house - a)} × {f3(hl.scaleBelow)} = <b>{f3(hl.wearer)}</b> <span style={dim}>(where the house hairline actually lands = zFit.hairline.wearer)</span></Line>
          <Line k="scaleAbove">(crown<sub>wearer</sub> − landed) / (crown<sub>house</sub> − hairline<sub>house</sub>) = ({f3(wearer.crown)} − {f3(hl.wearer)}) / ({f3(HOUSE_FIT.crownZ)} − {f3(hl.house)}) = <b>{f3(zFit.scale)}</b><Clamp raw={rawAbove} used={zFit.scale} range="0.7…1.25" /></Line>
        </>
      ) : (
        <Line k="scale (one-point)">(crown<sub>wearer</sub> − anchor) / (crown<sub>house</sub> − anchor) = ({f3(wearer.crown)} − {f3(a)}) / ({f3(HOUSE_FIT.crownZ)} − {f3(a)}) = <b>{f3(zFit.scale)}</b><Clamp raw={rawAbove} used={zFit.scale} range="0.7…1.0" /> <span style={dim}>(no hairline: crown-only fallback)</span></Line>
      )}
      <Line k="kx">widthX<sub>wearer</sub> / widthX<sub>house</sub> = {f3(wearer.widthX)} / {f3(HOUSE_FIT.widthX)} = <b>{f3(kx)}</b><Clamp raw={rawKx} used={kx} range="0.85…1.2" /></Line>
      <Line k="ky">depthY<sub>wearer</sub> / depthY<sub>house</sub> = {f3(wearer.depthY)} / {f3(HOUSE_FIT.depthY)} = <b>{f3(ky)}</b><Clamp raw={rawKy} used={ky} range="0.85…1.2" /></Line>
      <Line k="dx">centerX<sub>wearer</sub> − headCenterX(hair) × k × kx = {sgn(wearer.centerX)} − {sgn(fixed.hairCenter ?? 0)} × {f3(fixed.k)} × {f3(kx)} = <b>{f3(shift)}</b>{fixed.tf.dx !== 0 && <> (+ calibrated dx {f3(fixed.tf.dx)} × kx = <b>{f3(opts.dx ?? 0)}</b>)</>} <span style={dim}>(centerShift in prebakeMergeCore)</span></Line>
      <Line k="dy, dz">{f3(opts.dy ?? 0)}, {f3(opts.dz ?? 0)} <span style={dim}>(the catalog transform&apos;s offsets ×ky, as-is)</span></Line>
      <Line k="opts">
        <code style={{ ...code, fontSize: 16 }}>
          {`{ k: ${f3(opts.k)}, kx: ${f3(opts.kx ?? 1)}, ky: ${f3(opts.ky ?? 1)}, dx: ${f3(opts.dx ?? 0)}, dy: ${f3(opts.dy ?? 0)}, dz: ${f3(opts.dz ?? 0)}, zFit: { anchor: ${f3(zFit.anchor)}, scale: ${f3(zFit.scale)}${hl ? `, hairline: { house: ${f3(hl.house)}, wearer: ${f3(hl.wearer)}, scaleBelow: ${f3(hl.scaleBelow)} }` : ''} }, alpha: ${opts.alpha}, headAlpha: ${opts.headAlpha} }`}
        </code>
      </Line>
    </div>
  );
}

function Line({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 12, padding: '6px 0', borderBottom: '1px solid #2a2a35', fontSize: 18, lineHeight: 1.5 }}>
      <span style={{ color: '#9ad0ff', fontFamily: 'ui-monospace, Menlo, monospace' }}>{k}</span>
      <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{children}</span>
    </div>
  );
}

// ─── drawing ─────────────────────────────────────────────────────────────────

function viewRange(view: View, pts: Points): [number, number, number, number] {
  let hMin = Infinity, hMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  for (let i = 0; i < pts.x.length; i++) {
    const [h, v] = view.project(pts.x[i], pts.y[i], pts.z[i]);
    if (h < hMin) hMin = h; if (h > hMax) hMax = h; if (v < vMin) vMin = v; if (v > vMax) vMax = v;
  }
  const pad = 0.1;
  return [hMin - pad, hMax + pad, vMin - pad, vMax + pad];
}

function drawPoints(ctx: CanvasRenderingContext2D, view: View, m: Mapper, pts: Points, color: (i: number) => string, size: number) {
  for (let i = 0; i < pts.x.length; i++) {
    const [h, v] = view.project(pts.x[i], pts.y[i], pts.z[i]);
    const [px, py] = m.toPx(h, v);
    ctx.fillStyle = color(i);
    ctx.fillRect(px - size / 2, py - size / 2, size, size);
  }
}

interface Guide { kind: 'z' | 'x' | 'y'; at: number; label: string; color: string; dash?: boolean }

/** Whether a guide is drawn in this view (z and y lines are horizontal where that axis is vertical; x and y lines vertical where it is horizontal). */
function guideVisible(view: View, g: Guide): 'h' | 'v' | null {
  if ((g.kind === 'z' && view.vAxis === 'z') || (g.kind === 'y' && view.vAxis === 'y')) return 'h';
  if ((g.kind === 'x' && view.hAxis === 'x') || (g.kind === 'y' && view.hAxis === 'y')) return 'v';
  return null;
}

// Lines only; the labels live in the legend column beside the canvases (several hairline
// guides sit 0.025 apart, which is a few pixels, so on-canvas labels overlapped).
function drawGuide(ctx: CanvasRenderingContext2D, view: View, m: Mapper, g: Guide) {
  const dir = guideVisible(view, g);
  if (!dir) return;
  ctx.save();
  ctx.strokeStyle = g.color; ctx.lineWidth = 1.5;
  ctx.setLineDash(g.dash ? [6, 4] : []);
  if (dir === 'h') {
    const [, py] = m.toPx(0, g.at);
    ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(m.width, py); ctx.stroke();
  } else {
    const [px] = m.toPx(g.at, 0);
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, m.height); ctx.stroke();
  }
  ctx.restore();
}

function ViewPair({ view, fixed, fit, wearer }: { view: View; fixed: Fixed; fit: Fit; wearer: Wearer }) {
  const beforeRef = useRef<HTMLCanvasElement>(null);
  const afterRef = useRef<HTMLCanvasElement>(null);
  const mapper = useMemo(() => makeMapper(viewRange(view, fixed.headPts), CANVAS_W, CANVAS_H), [view, fixed.headPts]);
  // The head layer never changes with the wearer: draw it once per view into an offscreen canvas.
  const headLayer = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas'); c.width = CANVAS_W; c.height = CANVAS_H;
    const ctx = c.getContext('2d'); if (!ctx) return null;
    ctx.fillStyle = '#15151c'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    drawPoints(ctx, view, mapper, fixed.headPts, (i) => `rgba(170,170,180,${0.25 + 0.5 * fixed.headPts.a[i]})`, 1.5);
    return c;
  }, [view, mapper, fixed.headPts]);

  const guides = useMemo((): Guide[] => {
    const hl = fit.zFit.hairline;
    const houseHalf = (HOUSE_FIT.widthX ?? 0) / 2, wearerHalf = wearer.widthX / 2;
    return [
      { kind: 'z', at: 0, label: 'eye line z = 0 (anchor)', color: '#ffffff', dash: true },
      { kind: 'z', at: HOUSE_FIT.hairlineZ ?? 0, label: `house hairline ${f3(HOUSE_FIT.hairlineZ)}`, color: BAND_COLOR.fringe, dash: true },
      { kind: 'z', at: wearer.hairline, label: `wearer hairline ${f3(wearer.hairline)}`, color: '#ff9fb2', dash: true },
      ...(hl ? [{ kind: 'z', at: hl.wearer, label: `landed hairline ${f3(hl.wearer)} (= wearer − ${HAIRLINE_OVERLAP})`, color: BAND_COLOR.above } as Guide] : []),
      { kind: 'z', at: HOUSE_FIT.crownZ, label: `house crown ${f3(HOUSE_FIT.crownZ)}`, color: '#aaaaaa', dash: true },
      { kind: 'z', at: wearer.crown, label: `wearer crown ${f3(wearer.crown)}`, color: '#ffffff' },
      // width / centre (front + top views): house extent vs wearer extent at the temple band
      { kind: 'x', at: HOUSE_CENTER_X - houseHalf, label: `house temple extent: centre ${f3(HOUSE_CENTER_X)} ± width ${f3(HOUSE_FIT.widthX)} / 2 (left edge)`, color: '#aaaaaa', dash: true },
      { kind: 'x', at: HOUSE_CENTER_X + houseHalf, label: `house temple extent (right edge)`, color: '#aaaaaa', dash: true },
      { kind: 'x', at: wearer.centerX - wearerHalf, label: `wearer temple extent: centre ${f3(wearer.centerX)} ± width ${f3(wearer.widthX)} / 2 (left edge) — ×kx ${f3(fit.kx)}, dx ${f3(fit.opts.dx ?? 0)}`, color: '#ffffff' },
      { kind: 'x', at: wearer.centerX + wearerHalf, label: `wearer temple extent (right edge)`, color: '#ffffff' },
      // depth pivot (top view): ky scales y about y = 0
      { kind: 'y', at: 0, label: `y = 0: depth pivot (×ky ${f3(fit.ky)}: house depth ${f3(HOUSE_FIT.depthY)} → wearer ${f3(wearer.depthY)})`, color: '#9ad0ff', dash: true },
    ];
  }, [fit, wearer]);

  useEffect(() => {
    const paint = (canvas: HTMLCanvasElement | null, pts: Points, title: string) => {
      const ctx = canvas?.getContext('2d'); if (!canvas || !ctx) return;
      if (headLayer) ctx.drawImage(headLayer, 0, 0); else { ctx.fillStyle = '#15151c'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H); }
      drawPoints(ctx, view, mapper, pts, (i) => BAND_COLOR[BANDS[fit.bands[i]]], 2);
      for (const g of guides) drawGuide(ctx, view, mapper, g);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px system-ui, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(title, 10, CANVAS_H - 12);
    };
    paint(beforeRef.current, fit.before, 'BEFORE (as baked on the house head)');
    paint(afterRef.current, fit.after, 'AFTER (rows read from the merged buffer)');
  }, [view, mapper, headLayer, fit, guides]);

  const legend = guides.filter((g) => guideVisible(view, g));
  return (
    <div style={{ marginBottom: 28 }}>
      <h3 style={h3}>{view.label}</h3>
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <canvas ref={beforeRef} width={CANVAS_W} height={CANVAS_H} style={canvasStyle} />
        <canvas ref={afterRef} width={CANVAS_W} height={CANVAS_H} style={canvasStyle} />
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, flex: '1 1 300px', minWidth: 300, fontSize: 15, fontFamily: MONO, lineHeight: 1.5 }}>
          {legend.map((g) => (
            <li key={g.label} style={{ display: 'grid', gridTemplateColumns: '36px 1fr', gap: 8, alignItems: 'center', padding: '4px 0', borderBottom: '1px solid #26262f' }}>
              <span style={{ height: 0, borderTop: `2px ${g.dash ? 'dashed' : 'solid'} ${g.color}`, display: 'block' }} />
              <span>{g.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── band table + summary ────────────────────────────────────────────────────

function BandTable({ fit }: { fit: Fit }) {
  const { zFit, before, after, bands, opts } = fit;
  const hl = zFit.hairline;
  const dz = opts.dz ?? 0;
  const rows = BANDS.map((band, bi) => {
    const idx: number[] = [];
    for (let i = 0; i < bands.length; i++) if (bands[i] === bi) idx.push(i);
    idx.sort((p, q) => before.z[p] - before.z[q]);
    const picks = spreadPick(idx.length).map((j) => idx[j]);
    const formula = band === 'below' ? 'z (unchanged)'
      : band === 'fringe' ? (hl ? `anchor + (z − anchor) × scaleBelow` : `anchor + (z − anchor) × scale`)
      : `landed + (z − hairline_house) × scaleAbove`;
    const expected = (z: number) => band === 'below' ? z
      : band === 'fringe' ? zFit.anchor + (z - zFit.anchor) * (hl ? hl.scaleBelow : zFit.scale)
      : zFit.anchor + (hl ? (hl.wearer - zFit.anchor) + (z - hl.house) * zFit.scale : (z - zFit.anchor) * zFit.scale);
    const sub = (z: number) => band === 'below' ? `${f3(z)}`
      : band === 'fringe' ? `${f3(zFit.anchor)} + (${f3(z)} − ${f3(zFit.anchor)}) × ${f3(hl ? hl.scaleBelow : zFit.scale)}`
      : hl ? `${f3(hl.wearer)} + (${f3(z)} − ${f3(hl.house)}) × ${f3(zFit.scale)}` : `${f3(zFit.anchor)} + (${f3(z)} − ${f3(zFit.anchor)}) × ${f3(zFit.scale)}`;
    return { band, count: idx.length, formula, picks, expected, sub };
  });
  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {rows.map(({ band, count, formula, picks, expected, sub }) => (
        <div key={band} style={{ borderLeft: `6px solid ${BAND_COLOR[band]}`, paddingLeft: 16 }}>
          <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}><Swatch c={BAND_COLOR[band]} /> {BAND_NAME[band]} <span style={{ ...dim, fontWeight: 400, fontSize: 18 }}>— {count.toLocaleString()} of the plotted hair rows</span></div>
          <div style={{ fontSize: 18, color: '#c8c8d4', marginBottom: 8 }}>{BAND_LABEL[band]}. z′ = {formula}{dz !== 0 ? ` + dz` : ''}</div>
          {picks.length === 0 ? <div style={small}>no rows in this band</div> : (
            <table style={table}>
              <thead><tr><th style={th}>row</th><th style={th}>z before</th><th style={th}>formula with the numbers</th><th style={th}>expected</th><th style={th}>z after (merged bytes)</th></tr></thead>
              <tbody>
                {picks.map((i) => {
                  const zb = before.z[i], za = after.z[i], exp = expected(zb) + dz;
                  return (
                    <tr key={i}>
                      <td style={td}>#{before.rows[i]}</td>
                      <td style={td}>{f3(zb)}</td>
                      <td style={td}>{sub(zb)}{dz !== 0 ? ` + ${f3(dz)}` : ''}</td>
                      <td style={td}>{f3(exp)}</td>
                      <td style={{ ...td, color: near(exp, za) || Math.abs(exp - za) < 1e-4 ? '#8ef0a8' : '#ff6b6b' }}>{f3(za)} {Math.abs(exp - za) < 1e-4 ? '✓' : '✗'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  );
}

function Summary({ fixed, fit, wearer }: { fixed: Fixed; fit: Fit; wearer: Wearer }) {
  const { zFit, kx, ky, opts, shift } = fit;
  const hl = zFit.hairline;
  const items: Array<[string, React.ReactNode]> = [
    ['z (height)', hl
      ? <>two-point fit about the eye line: house hairline {f3(hl.house)} → landed {f3(hl.wearer)} (fringe band ×{f3(hl.scaleBelow)}), house crown {f3(HOUSE_FIT.crownZ)} → wearer crown {f3(wearer.crown)} (upper band ×{f3(zFit.scale)}); z ≤ 0 untouched{(opts.dz ?? 0) !== 0 && <>; then dz {f3(opts.dz)}</>}.</>
      : <>one-point crown fit about the eye line: every z above 0 ×{f3(zFit.scale)}; z ≤ 0 untouched.</>],
    ['x (width)', <>×kx = {f3(kx)} about x = 0, positions and Gaussian x-extent (house temple width {f3(HOUSE_FIT.widthX)} → wearer {f3(wearer.widthX)}).</>],
    ['y (depth)', <>×ky = {f3(ky)} about y = 0, positions and Gaussian y-extent (house temple depth {f3(HOUSE_FIT.depthY)} → wearer {f3(wearer.depthY)}).</>],
    ['x (centre)', <>shift dx = {f3(opts.dx ?? 0)}: the hair&apos;s own temple-band centre {f3(fixed.hairCenter)} × k × kx lands on the wearer&apos;s centre {f3(wearer.centerX)} (centerShift = {f3(shift)}).</>],
    ['alpha', <>hair ×{opts.alpha}, head ×{opts.headAlpha} (catalog cuts ship at full density; headAlphaAbove off).</>],
  ];
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {items.map(([k, v]) => (
        <div key={k} style={{ display: 'grid', gridTemplateColumns: '150px 1fr', gap: 12, fontSize: 19, lineHeight: 1.5 }}>
          <b style={{ color: '#9ad0ff' }}>{k}</b><span>{v}</span>
        </div>
      ))}
    </div>
  );
}

// ─── small pieces ────────────────────────────────────────────────────────────

function RangeRow({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '110px 1fr 100px', gap: 12, alignItems: 'center', fontSize: 18, padding: '6px 0' }}>
      <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>{label}</span>
      <input type="range" min={min} max={max} step={0.001} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ accentColor: '#ff4d6d', width: '100%' }} />
      <input type="number" step={0.001} value={value} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(v); }}
        style={{ fontSize: 18, padding: '4px 8px', borderRadius: 6, border: '1px solid #3a3a48', background: '#0f0f14', color: '#fff', width: 100, boxSizing: 'border-box' }} />
    </label>
  );
}

function MeasureRow({ name, cat, live, fixed }: { name: string; cat: number | null; live: number | null; fixed?: boolean }) {
  const delta = cat !== null && live !== null ? live - cat : null;
  return (
    <tr>
      <td style={{ ...td, fontFamily: 'ui-monospace, Menlo, monospace' }}>{name}</td>
      <td style={td}>{f3(cat)}</td>
      <td style={td}>{fixed ? <span style={dim}>by definition</span> : live === null ? <span style={{ color: '#ffd166' }}>null (unmeasurable)</span> : f3(live)}</td>
      <td style={{ ...td, color: delta === null || fixed ? '#777' : Math.abs(delta) < 0.01 ? '#8ef0a8' : '#ffd166' }}>{fixed || delta === null ? '—' : (delta >= 0 ? '+' : '') + delta.toFixed(3)}</td>
    </tr>
  );
}

function Swatch({ c }: { c: string }) {
  return <span style={{ display: 'inline-block', width: 14, height: 14, background: c, borderRadius: 3, verticalAlign: 'middle', marginRight: 4 }} />;
}
