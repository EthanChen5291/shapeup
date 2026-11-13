'use client';

// Dev-only capture stage. It fits and merges catalog try-ons onto one buzz-cut base exactly the
// way the studio does (QuickTryOns.mergeAndShow), then lets a script pose it: window.__turntable
// .show(variantId, angle) puts a look on the head at an orbit angle, .png() reads the canvas.

import { Suspense, useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Splat } from '@react-three/drei';
import * as THREE from 'three';
import { HAND_FIT_REF, PRESET_CATEGORIES, catalogFitFor, type PresetVariant } from '@/data/hairPresets';
import { resolvePrebakeTransform } from '@/data/prebakeTransforms';
import { createMergeCore } from '@/lib/prebakeMergeCore';
import { axisFitScale, crownZ, hairlineFit, hairlineZ, headCenterX, headDepthY, headWidthX } from '@/lib/splatFit';
import { parseSplatMeta, viewerTransform, type ViewerTransform } from '@/lib/splatMeta';
import { parseTurntableParams, type TurntableParams } from './turntable';

/** The studio camera's distance from the orbit target (HairScene DEFAULT_CAMERA_POS). */
const CAMERA_DISTANCE = 7.8;

interface Look { id: string; cut: string; color: string }
interface TurntableApi {
  /** Every listed try-on, for picking looks. */
  looks: () => Look[];
  /** Put a look on the head (merging it on first use) and orbit the camera to `angle` radians. */
  show: (variantId: string, angle: number) => Promise<void>;
  /** The canvas as a PNG data URL. */
  png: () => string;
}
declare global { interface Window { __turntable?: TurntableApi } }

function findVariant(id: string): { variant: PresetVariant; cutId: string } | null {
  for (const cat of PRESET_CATEGORIES) {
    for (const cut of cat.cuts) {
      const variant = cut.variants.find((v) => v.id === id);
      if (variant) return { variant, cutId: cut.id };
    }
  }
  return null;
}

function Orbit({ angle, y }: { angle: number; y: number }) {
  useFrame(({ camera }) => {
    camera.position.set(Math.sin(angle) * CAMERA_DISTANCE, y, Math.cos(angle) * CAMERA_DISTANCE);
    camera.lookAt(0, y, 0);
  });
  return null;
}

export default function TurntableLab() {
  // Read the query after mount: the server renders this page without it, and a canvas box that
  // differed at hydration would keep the server's size (the default) whatever ?size= said.
  const [params, setParams] = useState<TurntableParams | null>(null);
  useEffect(() => { setParams(parseTurntableParams(new URLSearchParams(window.location.search))); }, []);
  return params ? <Stage params={params} /> : null;
}

function Stage({ params }: { params: TurntableParams }) {
  const [view, setView] = useState<{ url: string; angle: number } | null>(null);
  const [transform, setTransform] = useState<ViewerTransform | null>(null);
  const [status, setStatus] = useState('loading base…');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const core = createMergeCore();
    const merged = new Map<string, Promise<string>>();
    (async () => {
      const [bytes, meta] = await Promise.all([
        fetch(params.base).then((r) => { if (!r.ok) throw new Error(`${params.base}: ${r.status}`); return r.arrayBuffer(); }),
        params.meta ? fetch(params.meta).then((r) => (r.ok ? r.json() : null)).then(parseSplatMeta).catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled) return;
      const crown = crownZ(bytes);
      const base = { crown, hairline: hairlineZ(bytes, crown), width: headWidthX(bytes), depth: headDepthY(bytes), center: headCenterX(bytes) };
      const vt = viewerTransform(meta);
      core.setBase(bytes);
      setTransform(vt);

      // Same options as QuickTryOns.mergeAndShow: two-point vertical fit, per-axis width/depth, own-extent centring.
      // The one departure is ?alpha=, an extra hair opacity gain for captures (the studio draws catalog hair at 1).
      const merge = async (id: string): Promise<string> => {
        const found = findVariant(id);
        if (!found) throw new Error(`unknown variant ${id}`);
        const tf = resolvePrebakeTransform(found.cutId, id);
        const fit = catalogFitFor(found.cutId);
        const zFit = fit && base.crown !== null ? hairlineFit({ crown: base.crown, hairline: base.hairline }, fit) : undefined;
        const kx = axisFitScale(base.width, fit?.widthX);
        const ky = axisFitScale(base.depth, fit?.depthY);
        const centerX = fit !== HAND_FIT_REF && base.center !== null ? base.center : undefined;
        const res = await core.merge({
          type: 'merge', id: 0, variantId: id, splatUrl: found.variant.splatUrl, preferSpz: true,
          opts: { k: tf.scale / vt.scale, kx, ky, centerX, dx: tf.dx * kx, dy: tf.dy * ky, dz: tf.dz, zFit, alpha: tf.alpha * params.hairAlpha, headAlpha: tf.headAlpha },
        });
        if (res.type === 'error') throw new Error(res.message);
        return URL.createObjectURL(new Blob([res.bytes], { type: 'application/octet-stream' }));
      };

      window.__turntable = {
        looks: () => PRESET_CATEGORIES.flatMap((cat) => cat.cuts.filter((c) => !c.hidden).flatMap((c) => c.variants.map((v) => ({ id: v.id, cut: c.name, color: v.label })))),
        show: async (variantId, angle) => {
          let p = merged.get(variantId);
          if (!p) { p = merge(variantId); merged.set(variantId, p); }
          const url = await p;
          setStatus(`${variantId} @ ${((angle * 180) / Math.PI).toFixed(0)}°`);
          setView({ url, angle });
        },
        png: () => canvasRef.current?.toDataURL('image/png') ?? '',
      };
      setStatus('ready');
    })().catch((err) => { if (!cancelled) setStatus(`failed: ${err instanceof Error ? err.message : String(err)}`); });
    return () => { cancelled = true; delete window.__turntable; };
  }, [params]);

  return (
    <main style={{ minHeight: '100vh', background: '#111', color: '#aaa', font: '12px ui-monospace, monospace', padding: 16 }}>
      <div style={{ width: params.size, height: params.size }}>
        <Canvas
          dpr={1}
          // preserveDrawingBuffer: the script reads the canvas between frames, not inside one.
          gl={{ antialias: true, toneMapping: THREE.NoToneMapping, preserveDrawingBuffer: true }}
          camera={{ position: [0, params.y, CAMERA_DISTANCE], fov: params.fov }}
          onCreated={({ gl }) => { canvasRef.current = gl.domElement; }}
        >
          {/* No scene background for 'transparent': the canvas keeps its alpha and png() carries it. */}
          {params.bg !== 'transparent' && <color attach="background" args={[params.bg]} />}
          <Orbit angle={view?.angle ?? 0} y={params.y} />
          <Suspense fallback={null}>
            {view && transform && (
              <Splat key={view.url} src={view.url} alphaTest={0} scale={transform.scale} position={transform.position} rotation={transform.rotation} />
            )}
          </Suspense>
        </Canvas>
      </div>
      <p data-testid="turntable-status" style={{ marginTop: 8 }}>{status}</p>
    </main>
  );
}
