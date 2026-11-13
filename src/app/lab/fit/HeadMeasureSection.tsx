'use client';

// Section 0 of /lab/fit: how the head is measured. Shows the intermediates of crownZ (the
// per-cell transmittance walk), hairlineZ (the per-column colour step) and the temple-band
// width/depth/centre, reconstructed by headMeasureSteps.ts, next to the production results.

import { useEffect, useMemo, useRef, useState } from 'react';
import { makeMapper, VIEWS, type Mapper, type Points, type View } from './fitLabProjection';
import { CROWN, crownSteps, HAIRLINE, hairlineSteps, TEMPLE, templeSteps, type ColumnSteps, type RGB } from './headMeasureSteps';
import { bad, canvasStyle, code, dim, f3, f4, h3, h4, mathBox, MONO, mono, ok, small, table, td, th, warn } from './labStyles';

export interface LiveMeasured { crown: number | null; hairline: number | null; width: number | null; depth: number | null; center: number | null }

const TOP = VIEWS.find((v) => v.id === 'top') as View;
const FRONT = VIEWS.find((v) => v.id === 'front') as View;
const GREY = (a: number) => `rgba(170,170,180,${0.25 + 0.5 * a})`;
const rgbCss = (c: RGB) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
const rgbTxt = (c: RGB) => `(${c[0].toFixed(3)}, ${c[1].toFixed(3)}, ${c[2].toFixed(3)})`;

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, dash: number[] = [], width = 1.5) {
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.restore();
}
function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, color = '#fff', align: CanvasTextAlign = 'left', px = 13, bold = false) {
  ctx.save(); ctx.fillStyle = color; ctx.font = `${bold ? 'bold ' : ''}${px}px ${MONO}`; ctx.textAlign = align; ctx.fillText(s, x, y); ctx.restore();
}
function dots(ctx: CanvasRenderingContext2D, view: View, m: Mapper, pts: Points, color: (i: number) => string, size: number, keep?: (i: number) => boolean) {
  for (let i = 0; i < pts.x.length; i++) {
    if (keep && !keep(i)) continue;
    const [h, v] = view.project(pts.x[i], pts.y[i], pts.z[i]);
    const [px, py] = m.toPx(h, v);
    ctx.fillStyle = color(i);
    ctx.fillRect(px - size / 2, py - size / 2, size, size);
  }
}
function clear(ctx: CanvasRenderingContext2D, w: number, h: number) { ctx.fillStyle = '#15151c'; ctx.fillRect(0, 0, w, h); }

export default function HeadMeasureSection({ head, headPts, live }: { head: ArrayBuffer; headPts: Points; live: LiveMeasured }) {
  return (
    <>
      <p style={{ ...small, fontSize: 18, marginBottom: 20 }}>
        The app never sees a &quot;head&quot;, only 32-byte Gaussian rows (x, y, z, scale, rgba, quaternion). Each measurement in
        <code style={code}>src/lib/splatFit.ts</code> is a rule over those rows. Below, the same rules are walked step by step on
        {' '}<code style={code}>public/lab/house_male_buzz.splat</code> with every intermediate kept, and the production function&apos;s own return value is printed beside the reconstruction.
      </p>
      <CrownPanel head={head} headPts={headPts} live={live.crown} />
      <HairlinePanel head={head} crown={live.crown} live={live.hairline} />
      <TemplePanel head={head} headPts={headPts} live={live} />
    </>
  );
}

// ─── A. crown: transmittance walk ────────────────────────────────────────────

const CROWN_W = 600, CROWN_H = 760;
const WALK_W = 600, WALK_H = 240;

function CrownPanel({ head, headPts, live }: { head: ArrayBuffer; headPts: Points; live: number | null }) {
  const steps = useMemo(() => crownSteps(head), [head]);
  const [selected, setSelected] = useState<number | null>(null);
  const sel = selected ?? steps.best ?? 0;
  const cell = steps.cells[sel];
  const gridRef = useRef<HTMLCanvasElement>(null);
  const walkRef = useRef<HTMLCanvasElement>(null);
  const { X_EDGES, Y_EDGES, MIN_PER_CELL, TRANSMITTANCE } = CROWN;
  const mapper = useMemo(() => makeMapper([-0.4, 0.4, -0.45, 0.65], CROWN_W, CROWN_H), []);

  useEffect(() => {
    const ctx = gridRef.current?.getContext('2d'); if (!ctx) return;
    clear(ctx, CROWN_W, CROWN_H);
    dots(ctx, TOP, mapper, headPts, (i) => GREY(headPts.a[i]), 1.5, (i) => headPts.z[i] > 0.35);
    for (const c of steps.cells) {
      const [x0, y1] = mapper.toPx(c.x0, c.y1), [x1, y0] = mapper.toPx(c.x1, c.y0);
      const w = x1 - x0, h = y0 - y1;
      ctx.fillStyle = c.skipped ? 'rgba(120,120,130,0.18)' : 'rgba(79,163,255,0.10)';
      ctx.fillRect(x0, y1, w, h);
      const isBest = c.index === steps.best, isSel = c.index === sel;
      ctx.save();
      ctx.strokeStyle = isBest ? '#ffd166' : isSel ? '#4fa3ff' : 'rgba(255,255,255,0.45)';
      ctx.lineWidth = isBest ? 4 : isSel ? 3 : 1;
      ctx.strokeRect(x0 + 1, y1 + 1, w - 2, h - 2);
      ctx.restore();
      const label = c.skipped ? `<${MIN_PER_CELL}` : c.stopZ === null ? 'no stop' : f3(c.stopZ);
      text(ctx, label, x0 + w / 2, y1 + h / 2 - 2, isBest ? '#ffd166' : c.skipped ? '#8a8a98' : '#fff', 'center', 15, isBest);
      text(ctx, `n=${c.count}`, x0 + w / 2, y1 + h / 2 + 16, '#a0a0ae', 'center', 12);
    }
    const [gx0, gy1] = mapper.toPx(X_EDGES[0], Y_EDGES[Y_EDGES.length - 1]);
    const [gx1, gy0] = mapper.toPx(X_EDGES[X_EDGES.length - 1], Y_EDGES[0]);
    text(ctx, `x ${X_EDGES[0]} … ${X_EDGES[X_EDGES.length - 1]} (3 cells of ${CROWN.CELL})`, (gx0 + gx1) / 2, gy1 - 8, '#9ad0ff', 'center', 13);
    ctx.save(); ctx.translate(gx0 - 10, (gy0 + gy1) / 2); ctx.rotate(-Math.PI / 2);
    text(ctx, `y ${Y_EDGES[0]} (front) … ${Y_EDGES[Y_EDGES.length - 1]} (back), 6 cells`, 0, 0, '#9ad0ff', 'center', 13);
    ctx.restore();
    text(ctx, 'top view, Gaussians with z > 0.35 (face at the bottom)', 10, CROWN_H - 12, '#fff', 'left', 15, true);
    text(ctx, `cell label = z where t first drops below ${TRANSMITTANCE}`, 10, 22, '#a0a0ae', 'left', 13);
    text(ctx, 'gold = winner (highest) · blue = shown on the right · click a cell', 10, 40, '#a0a0ae', 'left', 13);
  }, [steps, sel, headPts, mapper, X_EDGES, Y_EDGES, MIN_PER_CELL, TRANSMITTANCE]);

  const shown = useMemo(() => {
    if (!cell || cell.skipped) return [];
    const upto = cell.stop === null ? Math.min(cell.walk.length, 40) : Math.min(cell.walk.length, cell.stop + 5);
    return cell.walk.slice(0, upto);
  }, [cell]);

  useEffect(() => {
    const ctx = walkRef.current?.getContext('2d'); if (!ctx) return;
    clear(ctx, WALK_W, WALK_H);
    const L = 48, R = 16, T = 24, B = 36;
    const w = WALK_W - L - R, h = WALK_H - T - B;
    const n = Math.max(1, shown.length);
    const yOf = (t: number) => T + (1 - t) * h;
    line(ctx, L, T, L, T + h, '#555'); line(ctx, L, T + h, L + w, T + h, '#555');
    for (const tv of [0, 0.5, 1]) { text(ctx, tv.toFixed(1), L - 6, yOf(tv) + 4, '#a0a0ae', 'right', 12); }
    line(ctx, L, yOf(TRANSMITTANCE), L + w, yOf(TRANSMITTANCE), '#ffd166', [6, 4]);
    text(ctx, `TRANSMITTANCE ${TRANSMITTANCE}`, L + w - 4, yOf(TRANSMITTANCE) - 5, '#ffd166', 'right', 13);
    const bw = w / n;
    let prevY = yOf(1);
    text(ctx, 't = 1 at the start of every cell', L + 4, yOf(1) - 6, '#8ef0a8', 'left', 12);
    shown.forEach((r, i) => {
      const x = L + i * bw;
      const y = yOf(r.t);
      line(ctx, x, prevY, x, y, '#4fa3ff', [], 2); line(ctx, x, y, x + bw, y, '#4fa3ff', [], 2);
      prevY = y;
      if (cell && i === cell.stop) {
        ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.arc(x + bw / 2, y, 5, 0, Math.PI * 2); ctx.fill();
        text(ctx, `stop: row ${i}, t = ${r.t.toFixed(3)} → crown z = ${f3(r.z)}`, Math.min(x + bw / 2 + 8, L + w - 330), y + 20, '#ff4d6d', 'left', 13, true);
      }
    });
    text(ctx, 'rows of this cell, highest z first →', L + w / 2, WALK_H - 10, '#a0a0ae', 'center', 13);
    text(ctx, 't', L - 30, T + h / 2, '#a0a0ae', 'center', 13);
  }, [shown, cell, TRANSMITTANCE]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (CROWN_W / rect.width), py = (e.clientY - rect.top) * (CROWN_H / rect.height);
    // invert makeMapper: the window [-0.4, 0.4, -0.45, 0.65] is centred on (h 0, v 0.1)
    const h = (px - CROWN_W / 2) / mapper.pxPerUnit + 0, v = -(py - CROWN_H / 2) / mapper.pxPerUnit + 0.1;
    const ix = Math.floor((h - X_EDGES[0]) / CROWN.CELL), iy = Math.floor((v - Y_EDGES[0]) / CROWN.CELL);
    if (ix < 0 || ix >= steps.nx || iy < 0 || iy >= steps.ny) return;
    setSelected(ix * steps.ny + iy);
  };

  return (
    <div style={{ marginBottom: 36 }}>
      <h3 style={h3}>A · Crown: <code style={code}>crownZ()</code> — the transmittance walk</h3>
      <p style={small}>
        Looking straight down, the top of the head is cut into a 3 × 6 grid of 0.1 × 0.1 cells (X_EDGES {JSON.stringify(X_EDGES)}, Y_EDGES {JSON.stringify(Y_EDGES)}).
        A cell is a <b>column with no height</b>: every Gaussian whose (x, y) lands in it belongs to it, whatever its z. Each cell with at least {MIN_PER_CELL} rows is walked from its
        highest Gaussian down, multiplying t = Π(1 − alpha); the first z where t &lt; {TRANSMITTANCE} is &quot;the skull&quot; for that cell (a buzz cut&apos;s sheer fuzz is walked through).
        The crown is the highest such z over all cells. No alpha filter here: faint rows simply barely move t.
      </p>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <canvas ref={gridRef} width={CROWN_W} height={CROWN_H} style={{ ...canvasStyle, cursor: 'pointer' }} onClick={onClick} />
        <div style={{ flex: '1 1 560px', minWidth: 560 }}>
          {cell && (
            <>
              <div style={{ fontSize: 19, marginBottom: 8 }}>
                Cell (ix {cell.ix}, iy {cell.iy}): x {f3(cell.x0)} … {f3(cell.x1)}, y {f3(cell.y0)} … {f3(cell.y1)} — <b>{cell.count}</b> rows{cell.index === steps.best && <span style={{ ...ok, marginLeft: 8 }}>← winning cell</span>}
              </div>
              {cell.skipped ? (
                <div style={{ ...warn, fontSize: 18 }}>Skipped: fewer than {MIN_PER_CELL} rows, so this cell gets no vote.</div>
              ) : (
                <>
                  <canvas ref={walkRef} width={WALK_W} height={WALK_H} style={canvasStyle} />
                  <table style={{ ...table, marginTop: 10 }}>
                    <thead><tr><th style={th}>#</th><th style={th}>z</th><th style={th}>alpha</th><th style={th}>1 − alpha</th><th style={th}>t = Π(1 − alpha)</th><th style={th}></th></tr></thead>
                    <tbody>
                      {shown.map((r, i) => {
                        const isStop = i === cell.stop;
                        return (
                          <tr key={i} style={isStop ? { background: 'rgba(255,77,109,0.18)' } : i > (cell.stop ?? Infinity) ? { color: '#6a6a78' } : undefined}>
                            <td style={td}>{i}</td><td style={td}>{f3(r.z)}</td><td style={td}>{r.a.toFixed(3)}</td><td style={td}>{(1 - r.a).toFixed(3)}</td>
                            <td style={{ ...td, fontWeight: isStop ? 700 : 400 }}>{r.t.toFixed(4)}{isStop && ` < ${TRANSMITTANCE}`}</td>
                            <td style={{ ...td, color: '#ff4d6d', fontWeight: 700 }}>{isStop ? `crown for this cell = ${f3(r.z)}` : ''}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p style={small}>
                    {cell.walk.length - shown.length > 0 ? `… ${cell.walk.length - shown.length} more rows below (the walk stops at the first t < ${TRANSMITTANCE}; they are never visited).` : 'All rows shown.'}
                    {cell.stop === null && ' This cell never got opaque enough: it has no stop and no vote.'}
                  </p>
                </>
              )}
            </>
          )}
          <div style={{ ...mathBox, marginTop: 12, fontSize: 19, fontFamily: MONO }}>
            crownZ = max over cells of their stop z = <b>{f3(steps.result)}</b>{steps.best !== null && <> (cell ix {steps.cells[steps.best].ix}, iy {steps.cells[steps.best].iy})</>}
            <br />production <code style={code}>crownZ(head)</code> = <b>{f4(live)}</b>{' '}
            <span style={live !== null && steps.result !== null && Math.abs(live - steps.result) < 1e-9 ? ok : bad}>{live !== null && steps.result !== null && Math.abs(live - steps.result) < 1e-9 ? '✓ identical' : '✗ differs'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── B. hairline: colour step per column ─────────────────────────────────────

const TRACE_W = 460, TRACE_H = 360;

function HairlinePanel({ head, crown, live }: { head: ArrayBuffer; crown: number | null; live: number | null }) {
  const steps = useMemo(() => hairlineSteps(head, crown), [head, crown]);
  const H = HAIRLINE;
  const agree = live !== null && steps.result !== null && Math.abs(live - steps.result) < 5e-5;
  return (
    <div style={{ marginBottom: 36 }}>
      <h3 style={h3}>B · Hairline: <code style={code}>hairlineZ()</code> — where the front colour turns from forehead to stubble</h3>
      <p style={small}>
        Three columns down the front of the head at x = {H.X_SAMPLES.join(', ')} (half-width {H.HALF_WIDTH}; front half only, y &lt; 0; z {H.Z_LO} … {H.Z_HI}; alpha ≥ {H.MIN_ALPHA}),
        binned in z every {H.Z_STEP}. A bin&apos;s colour is the per-channel median of its <b>front-most 25 %</b> of rows by y (at least 8); bins with fewer than {H.MIN_PER_BIN} rows are
        &quot;too thin&quot; and carry no colour. The <b>forehead</b> colour is the lowest run of {H.SKIN_REF_BINS} consecutive measurable bins whose pairwise RGB distances are all ≤ {H.MIN_CONTRAST}
        (the bins just above the eye line are often brow shadow and disagree, so the run may start higher). The <b>stubble</b> colour is the median of the top {H.STUBBLE_REF_BINS} measurable bins.
        The hairline is where a bin&apos;s distance from the forehead first exceeds half the forehead → stubble contrast, interpolated between the last bin under and the first bin over.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(480px, 1fr))', gap: 24 }}>
        {steps.columns.map((col) => <ColumnPanel key={col.xc} col={col} />)}
      </div>
      <div style={{ ...mathBox, marginTop: 20, fontSize: 19, fontFamily: MONO, lineHeight: 1.7 }}>
        <div>column hairlines: {steps.columns.map((c) => `x ${c.xc}: ${f4(c.hairline)}`).join('   ·   ')}</div>
        {steps.sorted.length === 3 && (
          <>
            <div>sorted: [{steps.sorted.map(f4).join(', ')}] → spread = {f4(steps.sorted[2])} − {f4(steps.sorted[0])} = <b>{f4(steps.spread)}</b> <span style={steps.spread !== null && steps.spread <= H.MAX_SPREAD ? ok : bad}>{steps.spread !== null && steps.spread <= H.MAX_SPREAD ? `≤ ${H.MAX_SPREAD} ✓` : `> ${H.MAX_SPREAD} ✗ (columns disagree → null)`}</span></div>
            <div>median = middle value = <b>{f4(steps.median)}</b></div>
            <div>bounds: {H.MIN_Z} ≤ median ≤ crown − {H.CROWN_GAP} = {f4(crown)} − {H.CROWN_GAP} = {f4(steps.maxZ)} <span style={steps.result !== null ? ok : bad}>{steps.result !== null ? '✓' : '✗'}</span></div>
          </>
        )}
        {steps.failure && <div style={bad}>→ null: {steps.failure}</div>}
        <div style={{ marginTop: 6 }}>reconstructed hairlineZ = <b>{f4(steps.result)}</b> &nbsp;·&nbsp; production <code style={code}>hairlineZ(head, crown)</code> = <b>{f4(live)}</b> <span style={agree ? ok : bad}>{agree ? '✓ equal to 4 dp' : '✗ differs'}</span></div>
      </div>
    </div>
  );
}

function ColumnPanel({ col }: { col: ColumnSteps }) {
  const H = HAIRLINE;
  const traceRef = useRef<HTMLCanvasElement>(null);
  const skinSet = useMemo(() => new Set(col.skinBins ?? []), [col.skinBins]);
  const stubbleSet = useMemo(() => new Set(col.stubbleBins), [col.stubbleBins]);
  const lowestSkin = col.skinBins ? col.skinBins[0] : -1;

  useEffect(() => {
    const ctx = traceRef.current?.getContext('2d'); if (!ctx) return;
    clear(ctx, TRACE_W, TRACE_H);
    const L = 56, R = 20, T = 28, B = 40;
    const w = TRACE_W - L - R, h = TRACE_H - T - B;
    const dMax = Math.max(0.5, (col.contrast ?? 0.4) * 1.2);
    const xOf = (d: number) => L + (d / dMax) * w;
    const yOf = (z: number) => T + h - (z / H.Z_HI) * h;
    line(ctx, L, T, L, T + h, '#555'); line(ctx, L, T + h, L + w, T + h, '#555');
    for (const z of [0, 0.15, 0.3, 0.45, 0.6]) { text(ctx, z.toFixed(2), L - 6, yOf(z) + 4, '#a0a0ae', 'right', 12); line(ctx, L - 3, yOf(z), L, yOf(z), '#777'); }
    for (const d of [0, 0.2, 0.4]) { if (d <= dMax) { text(ctx, d.toFixed(1), xOf(d), T + h + 16, '#a0a0ae', 'center', 12); } }
    text(ctx, 'd = rgbDist(bin colour, forehead) →', L + w / 2, TRACE_H - 8, '#a0a0ae', 'center', 13);
    text(ctx, 'z', L - 40, T + h / 2, '#a0a0ae', 'center', 13);
    if (col.level !== null) {
      line(ctx, xOf(col.level), T, xOf(col.level), T + h, '#ffd166', [6, 4]);
      text(ctx, `level ${col.level.toFixed(3)}`, xOf(col.level) + 5, T - 8, '#ffd166', 'left', 13, true);
    }
    if (col.trace.length > 1) {
      ctx.save(); ctx.strokeStyle = 'rgba(154,208,255,0.6)'; ctx.lineWidth = 1.5; ctx.beginPath();
      col.trace.forEach((p, i) => { const x = xOf(p.d), y = yOf(p.z); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
      ctx.stroke(); ctx.restore();
    }
    for (const p of col.trace) {
      const c = skinSet.has(p.i) ? '#8ef0a8' : stubbleSet.has(p.i) ? '#ff9fb2' : '#9ad0ff';
      ctx.fillStyle = c; ctx.beginPath(); ctx.arc(xOf(p.d), yOf(p.z), 4, 0, Math.PI * 2); ctx.fill();
    }
    if (col.crossing) {
      const { zA, zB, dA, dB, z } = col.crossing;
      line(ctx, L, yOf(z), L + w, yOf(z), '#ff4d6d');
      text(ctx, `hairline ${f4(z)}`, L + w - 4, yOf(z) - 6, '#ff4d6d', 'right', 13, true);
      ctx.fillStyle = '#fff';
      for (const [d, zz, lbl] of [[dA, zA, 'A'], [dB, zB, 'B']] as Array<[number, number, string]>) {
        ctx.beginPath(); ctx.arc(xOf(d), yOf(zz), 6, 0, Math.PI * 2); ctx.fill();
        text(ctx, lbl, xOf(d) + 9, yOf(zz) + 5, '#fff', 'left', 13, true);
      }
      ctx.fillStyle = '#ff4d6d'; ctx.beginPath(); ctx.arc(xOf(col.level ?? 0), yOf(z), 6, 0, Math.PI * 2); ctx.fill();
    }
    text(ctx, `x = ${col.xc}`, L + 6, T + 14, '#fff', 'left', 14, true);
  }, [col, skinSet, stubbleSet, H.Z_HI]);

  const binsTopDown = [...col.bins].reverse();
  return (
    <div style={{ border: '1px solid #26262f', borderRadius: 10, padding: 14 }}>
      <h4 style={{ ...h4, marginTop: 0 }}>Column x = {col.xc} (|x − {col.xc}| &lt; {H.HALF_WIDTH}, y &lt; 0)</h4>
      <div style={{ fontSize: 15, color: '#a0a0ae', marginBottom: 4 }}>1 · one swatch per {H.Z_STEP} bin, painted with the median RGB of its front quarter (top = high z)</div>
      <table style={{ ...table, fontSize: 14 }}>
        <thead><tr><th style={th}>bin</th><th style={th}>z</th><th style={th}>colour</th><th style={th}>rows / front</th><th style={th}>role</th><th style={th}>d</th></tr></thead>
        <tbody>
          {binsTopDown.map((b) => {
            const role = !b.colour ? <span style={{ color: '#8a8a98' }}>too thin (&lt; {H.MIN_PER_BIN} rows)</span>
              : skinSet.has(b.i) ? <span style={ok}>forehead ref</span>
              : stubbleSet.has(b.i) ? <span style={{ color: '#ff9fb2' }}>stubble ref</span>
              : lowestSkin >= 0 && b.i < lowestSkin ? <span style={warn}>brow shadow: disagrees</span>
              : col.crossing && b.i === col.crossing.j ? <span style={{ color: '#ff4d6d' }}>A: last under level</span>
              : col.crossing && b.i === col.crossing.i ? <span style={{ color: '#ff4d6d' }}>B: first over level</span>
              : null;
            const d = col.trace.find((t) => t.i === b.i)?.d;
            const bg = skinSet.has(b.i) ? 'rgba(142,240,168,0.10)' : stubbleSet.has(b.i) ? 'rgba(255,159,178,0.10)' : (col.crossing && (b.i === col.crossing.i || b.i === col.crossing.j)) ? 'rgba(255,77,109,0.14)' : undefined;
            return (
              <tr key={b.i} style={{ background: bg }}>
                <td style={{ ...td, padding: '2px 8px' }}>{b.i}</td>
                <td style={{ ...td, padding: '2px 8px', whiteSpace: 'nowrap' }}>{b.zLo.toFixed(2)}–{b.zHi.toFixed(2)}</td>
                <td style={{ ...td, padding: '2px 8px' }}>
                  <span style={{ display: 'inline-block', width: 52, height: 18, borderRadius: 3, verticalAlign: 'middle', background: b.colour ? rgbCss(b.colour) : 'repeating-linear-gradient(45deg,#444 0 4px,#2a2a33 4px 8px)', border: '1px solid #3a3a48' }} />
                </td>
                <td style={{ ...td, padding: '2px 8px' }}>{b.count}{b.colour ? ` / ${b.frontCount}` : ''}</td>
                <td style={{ ...td, padding: '2px 8px' }}>{role}</td>
                <td style={{ ...td, padding: '2px 8px' }}>{d === undefined ? '' : d.toFixed(3)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ fontSize: 15, color: '#a0a0ae', margin: '12px 0 4px' }}>2 · forehead window: lowest run of {H.SKIN_REF_BINS} consecutive measurable bins agreeing within {H.MIN_CONTRAST}</div>
      <div style={{ ...mono, fontSize: 15, lineHeight: 1.6 }}>
        {col.runs.map((r, i) => (
          <div key={i} style={r.accepted ? ok : warn}>
            bins [{r.bins.join(', ')}]: {r.consecutive ? `max pairwise distance ${f3(r.spread)} ${r.accepted ? `≤ ${H.MIN_CONTRAST} ✓ accepted` : `> ${H.MIN_CONTRAST} ✗ rejected`}` : 'not consecutive ✗'}
          </div>
        ))}
        {col.skin && <div style={{ marginTop: 4 }}>forehead = median of bins [{col.skinBins?.join(', ')}] = <Sw c={col.skin} /> {rgbTxt(col.skin)}</div>}
      </div>

      {col.stubble && col.skin && col.contrast !== null && (
        <>
          <div style={{ fontSize: 15, color: '#a0a0ae', margin: '12px 0 4px' }}>3 · stubble reference: top {H.STUBBLE_REF_BINS} measurable bins, contrast and level</div>
          <div style={{ ...mono, fontSize: 15, lineHeight: 1.6 }}>
            <div>stubble = median of bins [{col.stubbleBins.join(', ')}] = <Sw c={col.stubble} /> {rgbTxt(col.stubble)}</div>
            <div>contrast = √((r<sub>s</sub>−r<sub>f</sub>)² + (g<sub>s</sub>−g<sub>f</sub>)² + (b<sub>s</sub>−b<sub>f</sub>)²)</div>
            <div>&nbsp;&nbsp;= √(({col.stubble[0].toFixed(3)}−{col.skin[0].toFixed(3)})² + ({col.stubble[1].toFixed(3)}−{col.skin[1].toFixed(3)})² + ({col.stubble[2].toFixed(3)}−{col.skin[2].toFixed(3)})²)</div>
            <div>&nbsp;&nbsp;= √({((col.stubble[0] - col.skin[0]) ** 2).toFixed(4)} + {((col.stubble[1] - col.skin[1]) ** 2).toFixed(4)} + {((col.stubble[2] - col.skin[2]) ** 2).toFixed(4)}) = <b>{col.contrast.toFixed(4)}</b> {col.contrast >= H.MIN_CONTRAST ? <span style={ok}>≥ {H.MIN_CONTRAST} ✓</span> : <span style={bad}>&lt; {H.MIN_CONTRAST} ✗</span>}</div>
            {col.level !== null && <div>level = {H.FRACTION} × contrast = <b>{col.level.toFixed(4)}</b></div>}
          </div>
        </>
      )}

      <div style={{ fontSize: 15, color: '#a0a0ae', margin: '12px 0 4px' }}>4 · trace: d per bin against z; the crossing is interpolated between A and B</div>
      <canvas ref={traceRef} width={TRACE_W} height={TRACE_H} style={{ ...canvasStyle, maxWidth: '100%' }} />
      {col.crossing && col.level !== null && (
        <div style={{ ...mono, fontSize: 15, lineHeight: 1.6, marginTop: 6 }}>
          <div>A = bin {col.crossing.j}: zA = ({col.crossing.j} + 0.5) × {H.Z_STEP} = {f4(col.crossing.zA)}, dA = {col.crossing.dA.toFixed(4)}</div>
          <div>B = bin {col.crossing.i}: zB = ({col.crossing.i} + 0.5) × {H.Z_STEP} = {f4(col.crossing.zB)}, dB = {col.crossing.dB.toFixed(4)}</div>
          <div>t = (level − dA) / (dB − dA) = ({col.level.toFixed(4)} − {col.crossing.dA.toFixed(4)}) / ({col.crossing.dB.toFixed(4)} − {col.crossing.dA.toFixed(4)}) = <b>{col.crossing.t.toFixed(4)}</b> (clamped to 0…1{col.crossing.dB <= col.crossing.dA ? '; dB ≤ dA so t = 1' : ''})</div>
          <div>z = zA + (zB − zA) × t = {f4(col.crossing.zA)} + ({f4(col.crossing.zB)} − {f4(col.crossing.zA)}) × {col.crossing.t.toFixed(4)} = <b>{f4(col.crossing.z)}</b></div>
        </div>
      )}
      <div style={{ fontSize: 20, marginTop: 10 }}>5 · column hairline = <b style={col.hairline === null ? bad : undefined}>{col.hairline === null ? `null (${col.failure})` : f4(col.hairline)}</b></div>
    </div>
  );
}

function Sw({ c }: { c: RGB }) {
  return <span style={{ display: 'inline-block', width: 22, height: 14, background: rgbCss(c), borderRadius: 3, verticalAlign: 'middle', border: '1px solid #3a3a48' }} />;
}

// ─── C. temple band: width, depth, centre ────────────────────────────────────

const TEMPLE_W = 600, TEMPLE_H = 560;
const FRONT_C = '#4fa3ff', BACK_C = '#ffb020';

function TemplePanel({ head, headPts, live }: { head: ArrayBuffer; headPts: Points; live: LiveMeasured }) {
  const steps = useMemo(() => templeSteps(head), [head]);
  const frontRef = useRef<HTMLCanvasElement>(null);
  const topRef = useRef<HTMLCanvasElement>(null);
  const bandPts = useMemo((): Points => ({ x: steps.x, y: steps.y, z: new Float32Array(steps.x.length).fill(0.25), a: new Float32Array(steps.x.length).fill(1), rows: new Int32Array(0) }), [steps]);

  useEffect(() => {
    const ctx = frontRef.current?.getContext('2d'); if (!ctx) return;
    const m = makeMapper([-1, 1, -1.05, 0.95], TEMPLE_W, TEMPLE_H);
    clear(ctx, TEMPLE_W, TEMPLE_H);
    dots(ctx, FRONT, m, headPts, (i) => GREY(headPts.a[i]), 1.5);
    const [, yTop] = m.toPx(0, TEMPLE.Z[1]), [, yBot] = m.toPx(0, TEMPLE.Z[0]);
    ctx.fillStyle = 'rgba(79,163,255,0.22)'; ctx.fillRect(0, yTop, TEMPLE_W, yBot - yTop);
    line(ctx, 0, yTop, TEMPLE_W, yTop, FRONT_C, [6, 4]); line(ctx, 0, yBot, TEMPLE_W, yBot, FRONT_C, [6, 4]);
    text(ctx, `temple band z ${TEMPLE.Z[0]} … ${TEMPLE.Z[1]} (alpha ≥ ${TEMPLE.MIN_ALPHA})`, 10, yTop - 8, FRONT_C, 'left', 14, true);
    const [, yEye] = m.toPx(0, 0);
    line(ctx, 0, yEye, TEMPLE_W, yEye, '#fff', [2, 4], 1);
    text(ctx, 'eye line z = 0', TEMPLE_W - 8, yEye - 6, '#fff', 'right', 13);
    text(ctx, 'front view (x vs z): the band is a horizontal slice', 10, TEMPLE_H - 12, '#fff', 'left', 15, true);
  }, [headPts]);

  useEffect(() => {
    const ctx = topRef.current?.getContext('2d'); if (!ctx) return;
    const m = makeMapper([-0.7, 0.7, -0.75, 0.65], TEMPLE_W, TEMPLE_H);
    clear(ctx, TEMPLE_W, TEMPLE_H);
    dots(ctx, TOP, m, bandPts, (i) => (steps.front[i] ? FRONT_C : BACK_C), 2);
    const [, ySplit] = m.toPx(0, TEMPLE.FRONT_Y);
    line(ctx, 0, ySplit, TEMPLE_W, ySplit, '#fff', [6, 4], 1);
    text(ctx, `y = ${TEMPLE.FRONT_Y} split`, 10, ySplit - 8, '#fff', 'left', 13, true);
    text(ctx, 'blue (front): width + centre · all: depth', 10, ySplit + 16, '#fff', 'left', 13);
    if (steps.x02 && steps.x98 && steps.centre !== null) {
      const [x02] = m.toPx(steps.x02.value, 0), [x98] = m.toPx(steps.x98.value, 0), [xc] = m.toPx(steps.centre, 0);
      line(ctx, x02, 0, x02, TEMPLE_H, '#fff', [], 2); line(ctx, x98, 0, x98, TEMPLE_H, '#fff', [], 2); line(ctx, xc, 0, xc, TEMPLE_H, '#8ef0a8', [6, 4], 1.5);
      text(ctx, `x p02 ${f3(steps.x02.value)}`, x02 - 6, 40, '#fff', 'right', 13, true);
      text(ctx, `x p98 ${f3(steps.x98.value)}`, x98 + 6, 40, '#fff', 'left', 13, true);
      text(ctx, `centre ${f3(steps.centre)}`, xc + 6, 62, '#8ef0a8', 'left', 13, true);
      text(ctx, `width = ${f3(steps.width)}`, (x02 + x98) / 2, 22, '#fff', 'center', 14, true);
    }
    if (steps.y02 && steps.y98) {
      const [, y02] = m.toPx(0, steps.y02.value), [, y98] = m.toPx(0, steps.y98.value);
      line(ctx, 0, y02, TEMPLE_W, y02, BACK_C, [], 2); line(ctx, 0, y98, TEMPLE_W, y98, BACK_C, [], 2);
      text(ctx, `y p02 ${f3(steps.y02.value)} (front)`, TEMPLE_W - 8, y02 + 18, BACK_C, 'right', 13, true);
      text(ctx, `y p98 ${f3(steps.y98.value)} (back)`, TEMPLE_W - 8, y98 - 8, BACK_C, 'right', 13, true);
      text(ctx, `depth = ${f3(steps.depth)}`, TEMPLE_W - 8, (y02 + y98) / 2, BACK_C, 'right', 14, true);
    }
    text(ctx, 'top view of the band rows only (face at the bottom)', 10, TEMPLE_H - 12, '#fff', 'left', 15, true);
  }, [bandPts, steps]);

  const same = (a: number | null, b: number | null) => a !== null && b !== null && Math.abs(a - b) < 1e-9;
  const nFront = steps.xs?.length ?? 0, nAll = steps.ys?.length ?? 0;
  return (
    <div>
      <h3 style={h3}>C · Temple band: <code style={code}>headWidthX()</code>, <code style={code}>headDepthY()</code>, <code style={code}>headCenterX()</code></h3>
      <p style={small}>
        A horizontal slice z {TEMPLE.Z[0]} … {TEMPLE.Z[1]} where a buzz cut is bare skull and the ears do not reach. Width and centre use only the front half (y &lt; {TEMPLE.FRONT_Y}: brow to ear);
        depth uses the whole band. Each is a sorted-percentile extent: value at index floor(p · n) of the sorted list, 2nd and 98th. Needs ≥ {TEMPLE.MIN_ROWS} rows.
      </p>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <canvas ref={frontRef} width={TEMPLE_W} height={TEMPLE_H} style={canvasStyle} />
        <canvas ref={topRef} width={TEMPLE_W} height={TEMPLE_H} style={canvasStyle} />
        <div style={{ ...mathBox, flex: '1 1 420px', fontSize: 17, fontFamily: MONO, lineHeight: 1.8 }}>
          <div style={{ color: FRONT_C }}>front rows (y &lt; {TEMPLE.FRONT_Y}): n = {nFront}, sorted by x</div>
          {steps.x02 && steps.x98 && (
            <>
              <div>p02 = xs[floor(0.02 × {nFront})] = xs[{steps.x02.index}] = {f4(steps.x02.value)}</div>
              <div>p98 = xs[floor(0.98 × {nFront})] = xs[{steps.x98.index}] = {f4(steps.x98.value)}</div>
              <div>width = p98 − p02 = <b>{f4(steps.width)}</b> &nbsp; <code style={code}>headWidthX()</code> = {f4(live.width)} <span style={same(steps.width, live.width) ? ok : bad}>{same(steps.width, live.width) ? '✓' : '✗'}</span></div>
              <div>centre = (p02 + p98) / 2 = <b>{f4(steps.centre)}</b> &nbsp; <code style={code}>headCenterX()</code> = {f4(live.center)} <span style={same(steps.centre, live.center) ? ok : bad}>{same(steps.centre, live.center) ? '✓' : '✗'}</span></div>
              <div style={dim}>(the midpoint of the extent, not the median: one-sided Gaussian density would pull a median off-centre)</div>
            </>
          )}
          <div style={{ color: BACK_C, marginTop: 8 }}>all band rows: n = {nAll}, sorted by y</div>
          {steps.y02 && steps.y98 && (
            <>
              <div>p02 = ys[floor(0.02 × {nAll})] = ys[{steps.y02.index}] = {f4(steps.y02.value)}</div>
              <div>p98 = ys[floor(0.98 × {nAll})] = ys[{steps.y98.index}] = {f4(steps.y98.value)}</div>
              <div>depth = p98 − p02 = <b>{f4(steps.depth)}</b> &nbsp; <code style={code}>headDepthY()</code> = {f4(live.depth)} <span style={same(steps.depth, live.depth) ? ok : bad}>{same(steps.depth, live.depth) ? '✓' : '✗'}</span></div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
