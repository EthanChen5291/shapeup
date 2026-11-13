'use client';

// Control-first lab, laid out exactly like the HackPrinceton "3D STUDIO" screen
// (src/app/page.tsx at 93e3404, Apr 19 2026): tomato page, corner wordmark,
// "THE studio" title, the polaroid, the inset stage with the #001f5b canvas and
// the black layer buttons, the mono caption strip, and the toolbox sidebar on
// the right. The sidebar holds the fit controls instead of the EditPanel.

import { OrbitControls, Splat } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { useSearchParams } from 'next/navigation';
import { Suspense, useMemo, useState, type CSSProperties } from 'react';
import * as THREE from 'three';
import HairStrandMesh, { type PLYBBox } from '@/components/HairStrandMesh';
import { LAB_LAYERS, labParamsToSearch, parseLabParams, type LabParams } from './labParams';

// Same head transform HairScene uses for every FaceLift .splat.
const HEAD_ROTATION: [number, number, number] = [-Math.PI / 2, Math.PI, Math.PI];
const HEAD_SCALE = 2.772;
const HEAD_POSITION: [number, number, number] = [0, -0.07, 0.48];
const YOU_PHOTO = '/lab/you.png';

// The hackathon's warm palette, pinned so html.dark cannot swap it.
const PALETTE = {
  '--tomato': '#d94e3a', '--cream': '#fff8ea', '--butter': '#ffe7b0', '--chalk': '#fffaf0',
  '--char': '#4a3a2e', '--ink': '#2a201a', '--biscuit-lt': '#fcf5e4', '--smoke': '#8a7a6a',
} as CSSProperties;

// HairScene.tsx btnStyle at 93e3404.
const btnStyle: CSSProperties = {
  padding: '4px 10px', fontSize: 12,
  background: '#000', color: '#fff', border: 'none',
  borderRadius: 4, cursor: 'pointer',
};

function Scene({ p, showHead, showHair, onBBox }: { p: LabParams; showHead: boolean; showHair: boolean; onBBox: (b: PLYBBox) => void }) {
  return (
    <>
      <Suspense fallback={null}>
        {showHead && (
          <Splat src={p.head} alphaTest={0.02} scale={HEAD_SCALE} position={HEAD_POSITION} rotation={HEAD_ROTATION} />
        )}
        {showHair && (
          <HairStrandMesh url={p.strands} color={p.hairColor} scale={p.hairScale} position={p.hairPos} lineWidth={p.lineWidth} specular={p.specular} renderQuality="balanced" onBBoxReady={onBBox} />
        )}
      </Suspense>
      <OrbitControls makeDefault />
    </>
  );
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '72px 1fr 64px', gap: 8, alignItems: 'center', fontSize: 11, color: 'var(--char)' }}>
      <span className="font-mono" style={{ textTransform: 'uppercase', letterSpacing: '0.12em', fontSize: 9 }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ accentColor: 'var(--tomato)' }} />
      <input type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: 64, fontSize: 11, boxSizing: 'border-box', padding: '2px 4px', borderRadius: 4, border: '1px solid rgba(42,32,26,0.15)', background: 'var(--chalk)', color: 'var(--char)' }} />
    </label>
  );
}

export default function ControlFirstLab() {
  const search = useSearchParams();
  const initial = useMemo(() => parseLabParams(new URLSearchParams(search.toString())), [search]);
  const [p, setP] = useState<LabParams>(initial);
  const [showHead, setShowHead] = useState(true);
  const [showHair, setShowHair] = useState(true);
  const setPos = (i: 0 | 1 | 2, v: number) => setP((q) => { const hairPos = [...q.hairPos] as [number, number, number]; hairPos[i] = v; return { ...q, hairPos }; });
  // The strand file's origin is not at the hair, so a raw scale change mostly
  // translates it. Scale about the strands' own bbox center instead, folding
  // the compensation into hairPos so the URL stays "scale + position".
  const [bboxCenter, setBboxCenter] = useState<[number, number, number]>([0, 0, 0]);
  const onBBox = (b: PLYBBox) => setBboxCenter([(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2]);
  const setScale = (v: number) => setP((q) => ({
    ...q, hairScale: v,
    hairPos: q.hairPos.map((c, i) => c + (q.hairScale - v) * bboxCenter[i]) as [number, number, number],
  }));
  const shareHref = `?${labParamsToSearch(p)}`;
  const activeLayer = LAB_LAYERS.find((l) => l.url === p.strands);

  return (
    <main className="flex h-screen relative overflow-hidden bg-tomato-shop" style={{ ...PALETTE, background: 'var(--tomato)' }}>
      {/* Corner wordmark */}
      <div className="absolute top-5 left-6 z-20 wordmark-stacked text-[var(--cream)]">
        <span>Shape</span>
        <span>Up</span>
      </div>

      {/* Chonk overlay title */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none text-center">
        <h2 className="type-chonk text-[var(--cream)]" style={{ fontSize: 'clamp(2.2rem, 5vw, 4rem)', opacity: 0.96 }}>
          THE <em style={{ color: 'var(--butter)' }}>studio</em>
        </h2>
      </div>

      <div className="flex-1 relative flex items-center justify-center p-6 pt-24" style={{ minWidth: 0 }}>
        {/* Polaroid thumbnail */}
        <div className="absolute top-24 left-6 z-10 polaroid wonky-l" style={{ width: 100, padding: '6px 6px 22px' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={YOU_PHOTO} alt="scan" className="block w-full h-[82px] object-cover rounded-sm" />
          <div className="absolute bottom-1 inset-x-0 text-center font-display text-[var(--char)] text-sm" style={{ fontStyle: 'italic', fontWeight: 500 }}>
            you
          </div>
        </div>

        {/* 3D stage — inset on the red */}
        <div
          className="relative w-full h-full rounded-3xl overflow-hidden"
          style={{
            background: 'linear-gradient(180deg, #241a14 0%, #17110d 100%)',
            border: '1px solid rgba(255,248,234,0.12)',
            boxShadow: '0 40px 80px -30px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,248,234,0.08)',
          }}
        >
          <div style={{ position: 'relative', width: '100%', height: '100%' }}>
            <Canvas
              gl={{ toneMapping: THREE.NoToneMapping }}
              camera={{ position: [0, 0, 7.8], fov: 45 }}
              style={{ width: '100%', height: '100%', background: '#001f5b' }}
            >
              <Scene p={p} showHead={showHead} showHair={showHair} onBBox={onBBox} />
            </Canvas>
            {/* HairScene's bottom-left layer buttons */}
            <div style={{ position: 'absolute', bottom: 12, left: 12, display: 'flex', gap: 6, flexWrap: 'wrap', maxWidth: '90%', zIndex: 10, pointerEvents: 'auto' }}>
              <input
                type="color" value={p.hairColor} onChange={(e) => setP({ ...p, hairColor: e.target.value })} title="hair color"
                style={{ width: 26, height: 26, border: 'none', borderRadius: 4, padding: 0, background: p.hairColor, cursor: 'pointer' }}
              />
              <button onClick={() => setShowSplat(setShowHead)} style={{ ...btnStyle, opacity: showHead ? 1 : 0.4 }}>gaussians</button>
              <button onClick={() => setShowHair((v) => !v)} style={{ ...btnStyle, opacity: showHair ? 1 : 0.4 }}>{showHair ? 'hide hair' : 'show hair'}</button>
              {LAB_LAYERS.map((l) => {
                const on = activeLayer?.id === l.id;
                return (
                  <button key={l.id} onClick={() => setP({ ...p, strands: l.url, hairColor: l.color })}
                    style={{ ...btnStyle, outline: on ? `2px solid ${l.color}` : 'none', opacity: on ? 1 : 0.4 }}>
                    {l.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Mono caption strip on the stage */}
          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--cream)]/70 pointer-events-none">
            <span>live · 3d sculpt</span>
            <span>no. 03·42</span>
          </div>
        </div>
      </div>

      {/* Sidebar — cream card floating on red */}
      <aside className="w-80 flex-shrink-0 flex flex-col p-4 gap-4 relative overflow-hidden">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--cream)]">
            the toolbox
          </span>
          <a href={shareHref} className="btn-ink" style={{ padding: '6px 12px', fontSize: 10, textDecoration: 'none' }}>
            ✂ Link this fit
          </a>
        </div>

        <div
          className="flex-1 overflow-auto rounded-2xl"
          style={{
            background: 'var(--biscuit-lt)',
            border: '1px solid rgba(42,32,26,0.1)',
            boxShadow: '0 30px 60px -24px rgba(0,0,0,0.45)',
            padding: 16, display: 'flex', flexDirection: 'column', gap: 12,
          }}
        >
          <div className="font-mono" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', color: 'var(--smoke)' }}>hair fit · {activeLayer?.label ?? p.strands}</div>
          <Slider label="scale" value={p.hairScale} min={1} max={30} step={0.01} onChange={setScale} />
          <Slider label="x" value={p.hairPos[0]} min={-5} max={5} step={0.01} onChange={(v) => setPos(0, v)} />
          <Slider label="y" value={p.hairPos[1]} min={-40} max={5} step={0.01} onChange={(v) => setPos(1, v)} />
          <Slider label="z" value={p.hairPos[2]} min={-5} max={5} step={0.01} onChange={(v) => setPos(2, v)} />
          <div className="font-mono" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.22em', color: 'var(--smoke)', marginTop: 8 }}>strand look</div>
          <Slider label="width" value={p.lineWidth} min={0.2} max={3} step={0.05} onChange={(v) => setP({ ...p, lineWidth: v })} />
          <Slider label="shine" value={p.specular} min={0} max={1} step={0.05} onChange={(v) => setP({ ...p, specular: v })} />
          <div style={{ flex: 1 }} />
          <div className="font-serif" style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--smoke)' }}>
            head: {p.head}<br />drag to orbit · scroll to zoom · defaults are the Oct 30 fit
          </div>
        </div>
      </aside>
    </main>
  );
}

// Toggle helper so the "gaussians" button reads like the original.
function setShowSplat(set: (fn: (v: boolean) => boolean) => void) {
  set((v) => !v);
}
