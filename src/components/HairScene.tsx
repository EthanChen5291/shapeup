// ============================================================
// HairScene — COCO's domain
//
// Three.js scene via react-three-fiber.
// Currently uses placeholder geometry (sphere = head, boxes = hair zones).
// Replace the geometry with loaded .glb meshes once assets are ready.
//
// Props:
//   params   — HairParams driving mesh scale
//   colorRGB — hex string for hair material
//   profile  — optional UserHeadProfile; when provided, hair zones are
//              positioned dynamically from headProportions + anchors.
//              Falls back to hardcoded positions when absent.
// ============================================================

'use client';

import * as THREE from 'three';

import { HairMeasurementBBox, HairParams, UserHeadProfile } from '@/types';
import { viewerTransform, type SplatMeta, type ViewerTransform } from '@/lib/splatMeta';
import { OrbitControls, Splat, useGLTF } from '@react-three/drei';
import { adaptWipeDpr, canvasDpr, loadWipeDpr, saveWipeDpr } from '@/lib/wipeDpr';
import React, { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSplatLoaded } from '@/hooks/useSplatLoaded';
import { cssBackgroundUrl, useImageReady } from '@/hooks/useImageReady';
import { isBlankFrame, nextViewCaptureDelay, shouldAttemptCapture, THUMBNAIL_MAX_FRAMES, viewChangedEnough, type ViewPose } from '@/lib/thumbnailFrame';
import { applySplatReveal, isSplatMaterial, nextOutgoingSrc, revealEase } from '@/lib/splatReveal';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import HairStrandMesh from './HairStrandMesh';
import SplatVideoCapture from './SplatVideoCapture';
import { buildCurrentProfilePayload } from '@/lib/llmPayload';

// ── Polycam head ─────────────────────────────────────────────
function PolycamHeadGLB() {
  const { scene } = useGLTF('/models/bruno_polycam.glb');

  const { scale, centerOffset, heightInScene } = useMemo(() => {
    scene.updateWorldMatrix(true, true);
    const box    = new THREE.Box3().setFromObject(scene);
    const size   = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const s = (1.6 / Math.max(size.x, 0.001)) * 5 * 0.7 * 1.2;
    return { scale: s, centerOffset: center, heightInScene: size.y * s };
  }, [scene]);

  return (
    <group
      scale={scale}
      rotation={[3 * Math.PI / 180, 35 * Math.PI / 180, -6 * Math.PI / 180]}
      position={[
        -centerOffset.x * scale - heightInScene * 0.045,
        -centerOffset.y * scale - heightInScene * 0.3,
        -centerOffset.z * scale + heightInScene * 0.10,
      ]}
    >
      <primitive object={scene} castShadow receiveShadow />
    </group>
  );
}

function PolycamHead() {
  return (
    <Suspense fallback={null}>
      <PolycamHeadGLB />
    </Suspense>
  );
}

// ── Scene content ───────────────────────────────────────────

// Fallback hair transform used before a measured PLY bbox is available.
// Derived by manually aligning brunohair.ply to the reference Polycam head.
const HAIR_PLY_SCALE_DEFAULT   = 13.109;
const HAIR_PLY_POS_DEFAULT: [number, number, number] = [0, -23.149, 0.7];

const ORBIT_SPEEDS = [0.25, 0.5, 1.0, 1.5, 2.5, 4.0];

// Default orbit camera framing — matches the <Canvas camera> below and the
// orbit target. The 360° capture resets to this so a zoomed-in/elevated live
// view doesn't produce a bad clip.
const DEFAULT_CAMERA_POS: [number, number, number] = [0, 0, 7.8];
const DEFAULT_ORBIT_TARGET: [number, number, number] = [0, 0, 0];

// Dev: all known hair layers. Toggle multiple simultaneously to identify pairs.
// Colors are fixed per layer so you can distinguish overlapping sets visually.
type HairLayer = { id: string; label: string; url: string; color: string; lineWidth: number; renderOrder: number; yOffset?: number };
const S3_HAIR = 'https://shape-up-s3.s3.us-east-1.amazonaws.com/hair';

const HAIR_LAYERS: HairLayer[] = [
  { id: 'pretty interesting', label: 'Modified',    url: `${S3_HAIR}/hair_modified.ply`, color: '#dca850', lineWidth: 0.8, renderOrder: 0 },
  { id: 'pretty thick',    label: 'Strands 1',   url: `${S3_HAIR}/strands_1.ply`,   color: '#3b1f0a', lineWidth: 0.8, renderOrder: 0 },
  { id: 'medium bob',     label: 'Preset A',    url: `${S3_HAIR}/preset_a.ply`,    color: '#c8a050', lineWidth: 0.8, renderOrder: 0 },
  { id: 'medium long',        label: 'Guest',       url: `${S3_HAIR}/guest.ply`,       color: '#c0b090', lineWidth: 0.8, renderOrder: 0 },
  { id: 'brunohair',    label: 'Bruno',       url: `${S3_HAIR}/brunohair.ply`,   color: '#0f0d0c', lineWidth: 0.8, renderOrder: 0 },
  { id: 'top_hair',     label: 'Top Hair',    url: `${S3_HAIR}/top_hair.ply`,    color: '#3b1f0a', lineWidth: 0.8, renderOrder: 0, yOffset: -0.3 },
];

type RawHairBBox = Omit<HairMeasurementBBox, 'width' | 'height' | 'depth'>;

// ── Keyboard camera controller ──────────────────────────────
const CAM_ROTATE_SPEED = 0.4;
const CAM_PAN_SPEED    = 1.2;
const CAM_SMOOTH       = 8;
const CAM_PHI_MIN      = 0.01;
const CAM_PHI_MAX      = Math.PI / 2 + (10 * Math.PI / 180);

function isTyping(): boolean {
  const tag = (document.activeElement as HTMLElement | null)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

function KeyboardCameraController({ orbitRef }: { orbitRef: React.RefObject<any> }) {
  const { camera, invalidate } = useThree();
  const keys    = useRef(new Set<string>());
  const velRot  = useRef({ theta: 0, phi: 0 });
  const velMove = useRef(new THREE.Vector3());

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (isTyping()) return;
      keys.current.add(e.code);
      invalidate(); // kick the demand-mode loop on first keydown
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code))
        e.preventDefault();
    };
    const onUp   = (e: KeyboardEvent) => keys.current.delete(e.code);
    const onBlur = () => keys.current.clear();
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [invalidate]);

  useFrame((_, delta) => {
    const controls = orbitRef.current;
    if (!controls) return;

    const dt   = Math.min(delta, 0.1);
    const t    = Math.min(1, CAM_SMOOTH * dt);
    const k    = keys.current;
    const busy = isTyping();

    const tTheta = busy ? 0 : (k.has('KeyD') ? CAM_ROTATE_SPEED : 0) - (k.has('KeyA') ? CAM_ROTATE_SPEED : 0);
    const tPhi   = busy ? 0 : (k.has('KeyS') ? CAM_ROTATE_SPEED : 0) - (k.has('KeyW') ? CAM_ROTATE_SPEED : 0);
    velRot.current.theta += (tTheta - velRot.current.theta) * t;
    velRot.current.phi   += (tPhi   - velRot.current.phi)   * t;

    const fwdRaw = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0);
    const fwd    = fwdRaw.lengthSq() > 1e-6 ? fwdRaw.normalize() : new THREE.Vector3(0, 0, -1);
    const right  = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const tMove  = new THREE.Vector3();
    if (!busy) {
      if (k.has('ArrowUp'))                              tMove.addScaledVector(fwd,    CAM_PAN_SPEED);
      if (k.has('ArrowDown'))                            tMove.addScaledVector(fwd,   -CAM_PAN_SPEED);
      if (k.has('ArrowRight'))                           tMove.addScaledVector(right,   CAM_PAN_SPEED);
      if (k.has('ArrowLeft'))                            tMove.addScaledVector(right,  -CAM_PAN_SPEED);
      if (k.has('Space'))                                tMove.y += CAM_PAN_SPEED;
      if (k.has('ShiftLeft') || k.has('ShiftRight'))     tMove.y -= CAM_PAN_SPEED;
    }
    velMove.current.lerp(tMove, t);

    // At rest (no keys, easing decayed): leave the camera alone. Re-deriving its
    // position through spherical coordinates every frame adds float noise, which
    // reads as motion and would keep the demand loop drawing forever.
    const REST = 1e-4;
    if (k.size === 0 && Math.abs(velRot.current.theta) < REST && Math.abs(velRot.current.phi) < REST && velMove.current.lengthSq() < REST * REST) {
      velRot.current.theta = 0; velRot.current.phi = 0; velMove.current.set(0, 0, 0);
      return;
    }

    const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
    const sph    = new THREE.Spherical().setFromVector3(offset);
    sph.theta += velRot.current.theta * dt;
    sph.phi    = Math.max(CAM_PHI_MIN, Math.min(CAM_PHI_MAX, sph.phi + velRot.current.phi * dt));
    sph.makeSafe();
    camera.position.setFromSpherical(sph).add(controls.target);

    const move = velMove.current.clone().multiplyScalar(dt);
    camera.position.add(move);
    controls.target.add(move);

    controls.update();
    // Demand mode: keep drawing while keys are held and while the motion eases out.
    invalidate();
  });

  return null;
}


interface SceneProps {
  showPolycam?: boolean;
  showSplat?: boolean;
  visibleLayers: Set<string>;
  hairScale: number;
  hairPos: [number, number, number];
  splatScale: number;
  splatPosY: number;
  // From the sidecar meta.json when the head has one; otherwise the constants below apply.
  splatTransform?: ViewerTransform;
  splatSrc: string;
  hairstepPlyUrl?: string;
  hairstepPlyUrls?: string[];
  hairColor?: string;
  orbitRotateSpeed?: number;
  disableKeyboardControls?: boolean;
  background?: string;
  captureKey?: number;
  renderQuality?: 'performance' | 'balanced' | 'high';
  videoCaptureKey?: number;
  /** Bump to cancel an in-progress 360° capture. */
  videoCancelKey?: number;
  captureBackground?: string;
  onVideoProgress?: (p: number) => void;
  onVideoReady?: (blob: Blob, ext: string) => void;
  onVideoError?: (err: unknown) => void;
  onPrimaryHairBBoxReady?: (bbox: RawHairBBox) => void;
  onThumbnailReady?: (dataUrl: string) => void;
  /** Capture right away (no / stale thumbnail). Otherwise only re-capture once the view settles. */
  thumbnailInitialCapture?: boolean;
  /** Fires once per splat src when the file has fully streamed in (see useSplatLoaded). */
  onSplatLoaded?: () => void;
  /** Bottom→top reveal progress for the splat only (0 hidden … 1 shown); null/absent = render normally.
   *  A ref, not state, so the per-frame animation never re-renders React. */
  splatRevealRef?: { current: number | null };
  /** On a source change, keep the old cloud up and wipe the new one over it bottom to top. */
  replaceWipe?: boolean;
  /** A replace wipe started (true) or finished (false): the Canvas renders at the wipe level meanwhile. */
  onWipeActive?: (active: boolean) => void;
  /** How the wipe went: its mean frame time and frame count, so the next one can adapt (lib/wipeDpr). */
  onWipeMeasured?: (meanFrameMs: number, frames: number) => void;
}

// Sets scene.background from the CSS-style background string passed to HairScene.
// url(...) → TextureLoader; #hex / rgb(...) → THREE.Color; anything else → no-op.
function SceneBackground({ background }: { background: string }) {
  const { scene, invalidate } = useThree();
  useEffect(() => {
    if (background.startsWith('url(')) {
      const path = background.match(/url\(([^)]+)\)/)?.[1] ?? '/preview_bg.jpg';
      // The canvas renders on demand: draw once the image has actually arrived.
      const tex = new THREE.TextureLoader().load(path, () => invalidate());
      scene.background = tex;
      return () => { tex.dispose(); scene.background = null; };
    }
    if (background.startsWith('#') || background.startsWith('rgb')) {
      scene.background = new THREE.Color(background);
      invalidate();
      return () => { scene.background = null; };
    }
  }, [background, scene, invalidate]);
  return null;
}

// Captures the current canvas view as a square 512×512 PNG thumbnail with a
// TRANSPARENT backdrop: the scene background is hidden for one off-screen
// render so the dashboard card can paint the current theme's backdrop behind
// it (a baked-in backdrop would go stale the moment the theme changes).
// Center-crops gl.domElement to a square (handles any panel aspect ratio),
// then downsamples to 512×512. No camera movement — captures the user's
// current view angle.
//
// The canvas is transparent until the splat renders, and JPEG turns
// transparent into solid black — so the capture only counts frames once the
// splat has fully streamed in (`splatLoaded`) and the shadow-load reveal is
// not hiding it (`revealRef` null), and it rejects blank frames and retries
// on a cadence instead of trusting a fixed delay (see src/lib/thumbnailFrame).
// TODO: generate thumbnail server-side during facelift instead of capturing client canvas.
function ThumbnailCapture({ onCapture, splatLoaded, revealRef }: {
  onCapture: (dataUrl: string) => void;
  splatLoaded: boolean;
  revealRef?: { current: number | null };
}) {
  const { gl, scene, camera, invalidate } = useThree();
  const doneRef = useRef(false);
  const frameRef = useRef(0);
  const thumbRef = useRef<HTMLCanvasElement | null>(null);
  // Demand rendering: kick a frame when capture becomes possible, then keep
  // asking (below) until a usable frame has been taken.
  useEffect(() => { if (splatLoaded) invalidate(); }, [splatLoaded, invalidate]);

  useFrame(() => {
    if (doneRef.current) return;
    if (!splatLoaded) return;
    invalidate();
    // Reveal in progress (0..1) → the splat shader is dropping fragments; wait for null.
    if (revealRef && revealRef.current !== null) return;
    frameRef.current += 1;
    if (frameRef.current > THUMBNAIL_MAX_FRAMES) {
      doneRef.current = true;
      console.warn('[thumbnail] gave up: frame stayed blank');
      return;
    }
    if (!shouldAttemptCapture(frameRef.current)) return;

    const SIZE = 512;
    const cw = gl.domElement.width;
    const ch = gl.domElement.height;
    const side = Math.min(cw, ch);
    if (side === 0) return;
    const sx = (cw - side) / 2;
    const sy = (ch - side) / 2;
    const thumb = thumbRef.current ?? (thumbRef.current = document.createElement('canvas'));
    thumb.width = SIZE;
    thumb.height = SIZE;
    const ctx = thumb.getContext('2d')!;
    ctx.clearRect(0, 0, SIZE, SIZE);
    // Render once without the scene background (alpha canvas → transparent
    // clear), grab it, then restore. R3F's own render for this frame runs
    // after useFrame, so the on-screen frame is unaffected.
    const prevBackground = scene.background;
    scene.background = null;
    try {
      gl.render(scene, camera);
      ctx.drawImage(gl.domElement, sx, sy, side, side, 0, 0, SIZE, SIZE);
    } finally {
      scene.background = prevBackground;
    }
    if (isBlankFrame(ctx.getImageData(0, 0, SIZE, SIZE).data)) return; // retry on a later frame
    doneRef.current = true;
    onCapture(thumb.toDataURL('image/png'));
  });

  return null;
}

/* Applies the screen-space bottom→top reveal to the splat material every frame
   (see src/lib/splatReveal.ts). Only the splat is affected — the scene background
   and lights render normally — which is why this isn't a CSS mask on the canvas. */
/** Duration of the bottom-to-top replace when a new cloud swaps in. */
const REPLACE_WIPE_MS = 1200;

function SplatRevealController({ revealRef, wipeRef, outgoingSrcRef }: {
  revealRef?: { current: number | null };
  wipeRef?: { current: number | null };
  outgoingSrcRef?: { current: string | null };
}) {
  const lastApplied = useRef<number | null | undefined>(undefined);
  useFrame(({ scene, invalidate }) => {
    const wipe = wipeRef?.current ?? null;
    // A replace wipe takes precedence over the page's ghost reveal.
    const progress = wipe ?? revealRef?.current ?? null;

    // Idle fast-path: nothing hidden, nothing to restore.
    if (progress === null && lastApplied.current == null) return;
    // The reveal is driven from a ref, which can't wake a demand loop: keep
    // drawing until it has finished and the material is restored.
    invalidate();
    const outgoing = outgoingSrcRef?.current ?? null;
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const mat = mesh.material;
      if (!isSplatMaterial(mat)) return;
      // The outgoing cloud shows above the edge; everything else below it.
      const above = outgoing !== null && mesh.userData.splatSrc === outgoing;
      applySplatReveal(mat, above ? wipe : progress, above);
    });
    lastApplied.current = progress;
  });
  return null;
}

/* The canvas renders on demand for every quality setting: a still head costs
   nothing. Most motion asks for its own frames (OrbitControls while dragging and
   damping, the keyboard camera, React prop changes, the 360 recorder). Two
   things can't, so this asks for them: the splat while it streams in (rows land
   in textures between frames), and a short settle after the camera stops,
   because drei's depth sort comes back from its worker a frame or two later
   without requesting a frame, and that final order still has to be drawn. */
const DEMAND_SETTLE_MS = 500;
/** A real camera move, not float noise (exact equality never settles). */
function viewMoved(a: THREE.Matrix4, b: THREE.Matrix4): boolean {
  for (let i = 0; i < 16; i++) if (Math.abs(a.elements[i] - b.elements[i]) > 1e-6) return true;
  return false;
}
function DemandFrames({ busy }: { busy: boolean }) {
  const { camera, invalidate } = useThree();
  const lastView = useRef(new THREE.Matrix4());
  const settleUntil = useRef(0);
  useEffect(() => {
    settleUntil.current = performance.now() + 1000; // first second: let everything settle in
    invalidate();
  }, [invalidate]);
  useEffect(() => {
    // Busy → idle (the head just finished streaming): settle for a second so the
    // last uploaded rows and their first sort are drawn.
    if (!busy) settleUntil.current = Math.max(settleUntil.current, performance.now() + 1000);
    invalidate();
  }, [busy, invalidate]);
  useFrame(() => {
    const now = performance.now();
    if (viewMoved(camera.matrixWorld, lastView.current)) {
      lastView.current.copy(camera.matrixWorld);
      settleUntil.current = now + DEMAND_SETTLE_MS;
    }
    if (busy || now < settleUntil.current) invalidate();
  });
  return null;
}

function Scene({ showPolycam = false, showSplat = true, visibleLayers, hairScale, hairPos, splatScale, splatPosY, splatTransform, splatSrc, hairstepPlyUrl, hairstepPlyUrls, hairColor, orbitRotateSpeed = 1, disableKeyboardControls = false, background, captureKey, renderQuality = 'balanced', videoCaptureKey, videoCancelKey, captureBackground, onVideoProgress, onVideoReady, onVideoError, onPrimaryHairBBoxReady, onThumbnailReady, thumbnailInitialCapture = true, onSplatLoaded, splatRevealRef, replaceWipe = false, onWipeActive, onWipeMeasured }: SceneProps) {
  const orbitRef = useRef<any>(null);
  const { camera } = useThree();

  // View-settled re-capture (see src/lib/thumbnailFrame). `viewSeq` re-keys the
  // ThumbnailCapture so a settled, meaningfully different pose is snapped again.
  const [viewSeq, setViewSeq] = useState(0);
  const lastCapturedPose = useRef<ViewPose | null>({ position: [...DEFAULT_CAMERA_POS] as [number, number, number], target: [...DEFAULT_ORBIT_TARGET] as [number, number, number] });
  const lastCaptureAt = useRef(0);
  const viewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPose = useCallback((): ViewPose | null => {
    const t = orbitRef.current?.target as THREE.Vector3 | undefined;
    if (!t) return null;
    return { position: [camera.position.x, camera.position.y, camera.position.z], target: [t.x, t.y, t.z] };
  }, [camera]);
  const handleOrbitChange = useCallback(() => {
    if (!onThumbnailReady) return;
    if (viewTimer.current) clearTimeout(viewTimer.current);
    const arm = () => {
      viewTimer.current = setTimeout(() => {
        viewTimer.current = null;
        const pose = currentPose();
        if (!pose || !viewChangedEnough(lastCapturedPose.current, pose)) return;
        setViewSeq((n) => n + 1);
      }, nextViewCaptureDelay(Date.now(), lastCaptureAt.current));
    };
    arm();
  }, [onThumbnailReady, currentPose]);
  useEffect(() => () => { if (viewTimer.current) clearTimeout(viewTimer.current); }, []);
  const handleThumbnailCaptured = useCallback((dataUrl: string) => {
    lastCapturedPose.current = currentPose() ?? lastCapturedPose.current;
    lastCaptureAt.current = Date.now();
    onThumbnailReady?.(dataUrl);
  }, [currentPose, onThumbnailReady]);
  // Fire onSplatLoaded once the splat file has fully streamed in.
  const activeSplatSrc = showSplat && splatSrc ? splatSrc : null;
  // Which src has fully streamed in — gates the thumbnail capture below.
  const [loadedSplatSrc, setLoadedSplatSrc] = useState<string | null>(null);
  const handleSplatLoaded = useCallback(() => {
    setLoadedSplatSrc(activeSplatSrc);
    onSplatLoaded?.();
  }, [activeSplatSrc, onSplatLoaded]);
  useSplatLoaded(activeSplatSrc, handleSplatLoaded);
  const splatLoaded = !!activeSplatSrc && loadedSplatSrc === activeSplatSrc;

  // Replace wipe: keep the previous cloud while the next one streams, then sweep
  // the new one up over it. wipeRef drives the shader (0 = newcomer hidden, old
  // cloud fully shown); null = no wipe in flight.
  const invalidateFrame = useThree((st) => st.invalidate);
  // Adjusted during render (React's "derived state" pattern) rather than in an effect, so
  // the committed tree already holds both clouds when the source changes: an effect would
  // commit one frame with the old cloud unmounted, and it would blink.
  const [swap, setSwap] = useState<{ cur: string | null; prev: string | null }>({ cur: activeSplatSrc, prev: null });
  if (swap.cur !== activeSplatSrc) {
    setSwap({ cur: activeSplatSrc, prev: nextOutgoingSrc(swap.cur, activeSplatSrc, replaceWipe) });
  }
  const outgoingSrc = swap.cur === activeSplatSrc ? swap.prev : null;
  const outgoingSrcRef = useRef<string | null>(null);
  const wipeRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    // Before the first paint of the new tree: newcomer hidden, old cloud fully visible.
    outgoingSrcRef.current = outgoingSrc;
    wipeRef.current = outgoingSrc ? 0 : null;
  }, [outgoingSrc]);
  // Two clouds on screen cost two full-screen splat draws: the Canvas paints at 1x while
  // they overlap (lib/wipeDpr, via the dpr prop) and goes back to the quality's ratio after.
  useEffect(() => { onWipeActive?.(outgoingSrc !== null); }, [outgoingSrc, onWipeActive]);
  useEffect(() => {
    if (!outgoingSrc || !splatLoaded) return;
    const t0 = performance.now();
    const finish = () => { wipeRef.current = null; outgoingSrcRef.current = null; setSwap((s) => (s.prev === outgoingSrc ? { ...s, prev: null } : s)); };
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { finish(); return; }
    let raf = 0;
    let frames = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / REPLACE_WIPE_MS);
      wipeRef.current = revealEase(p);
      invalidateFrame(); // demand frameloop: draw this step
      frames++;
      if (p < 1) raf = requestAnimationFrame(tick);
      else { onWipeMeasured?.((now - t0) / frames, frames); finish(); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [outgoingSrc, splatLoaded, invalidateFrame, onWipeMeasured]);
  console.log('[Scene] render — showSplat:', showSplat, '| splatSrc:', splatSrc?.substring(0, 80));
  // drei turns depthWrite ON for a splat whenever alphaTest > 0. Splats are sorted
  // by centre, but a big splat's fragments aren't in that order, so a faint
  // fragment writing depth rejects nearer splats drawn after it: holes that show
  // the background through the head and hair. Standard 3DGS never writes depth,
  // so only do it while opaque strand meshes need the head to occlude them.
  const drawsStrands = HAIR_LAYERS.some(l => visibleLayers.has(l.id)) || !!hairstepPlyUrl || !!hairstepPlyUrls?.length;
  const splatAlphaTest = drawsStrands ? 0.02 : 0;
  return (
    <>
      {background && <SceneBackground background={background} />}
      <DemandFrames busy={!!activeSplatSrc && !splatLoaded} />
      <SplatRevealController revealRef={splatRevealRef} wipeRef={wipeRef} outgoingSrcRef={outgoingSrcRef} />
      <ambientLight intensity={renderQuality === 'performance' ? 0.75 : 0.5} />
      {/* Only the polycam head casts a shadow; the splat neither casts nor receives one. */}
      <directionalLight position={[5, 10, 5]} intensity={1.0} castShadow={showPolycam && renderQuality !== 'performance'} />
      <directionalLight position={[0, 2, 5]}  intensity={0.8} />

      {showPolycam && <PolycamHead />}

      {showSplat && [outgoingSrc, splatSrc].filter((s): s is string => !!s).map((src) => (
        // One Suspense per cloud: a suspending newcomer must not hide the cloud already on screen.
        <Suspense key={src} fallback={null}>
          <Splat src={src} userData={{ splatSrc: src }} alphaTest={splatAlphaTest} scale={splatTransform?.scale ?? splatScale} position={splatTransform?.position ?? [0, splatPosY, 0.48]} rotation={splatTransform?.rotation ?? [-Math.PI / 2, Math.PI, Math.PI]} />
        </Suspense>
      ))}

      {HAIR_LAYERS.filter(l => visibleLayers.has(l.id)).map(l => (
        <HairStrandMesh
          key={l.id}
          url={l.url}
          color={hairColor ?? l.color}
          scale={hairScale}
          position={'yOffset' in l ? [hairPos[0], hairPos[1] + (l as {yOffset:number}).yOffset, hairPos[2]] : hairPos}
          lineWidth={l.lineWidth}
          renderOrder={l.renderOrder}
          renderQuality={renderQuality}
          onBBoxReady={l.id === 'hair_modified' ? onPrimaryHairBBoxReady : undefined}
        />
      ))}

      {hairstepPlyUrl && (() => {
        const lw = renderQuality === 'performance' ? 0.6 : renderQuality === 'high' ? 0.9 : 0.8;
        const passes = renderQuality === 'high' ? 3 : 1;
        const offsets: [number, number, number][] = [
          [0, 0, 0],
          [0.003, 0.003, 0],
          [-0.003, -0.003, 0],
        ];
        return (
          <>
            {Array.from({ length: passes }, (_, pi) => (
              <HairStrandMesh
                key={`hairstep-${pi}`}
                url={hairstepPlyUrl}
                color={hairColor ?? "#3b1f0a"}
                scale={hairScale}
                position={[hairPos[0] + offsets[pi][0], hairPos[1] + offsets[pi][1], hairPos[2] + offsets[pi][2]]}
                lineWidth={lw}
                renderOrder={pi}
                renderQuality={renderQuality}
                onBBoxReady={pi === 0 ? onPrimaryHairBBoxReady : undefined}
              />
            ))}
            {visibleLayers.has('top_hair') && (
              <HairStrandMesh
                url={`${S3_HAIR}/top_hair.ply`}
                color={hairColor ?? "#3b1f0a"}
                scale={hairScale}
                position={[hairPos[0], hairPos[1] - 0.3, hairPos[2]]}
                lineWidth={lw}
                renderOrder={0}
                renderQuality={renderQuality}
              />
            )}
          </>
        );
      })()}

      {hairstepPlyUrls?.map((url, i) => (
        <HairStrandMesh
          key={`demo-${i}`}
          url={url}
          color={hairColor ?? '#3b1f0a'}
          scale={hairScale}
          position={hairPos}
          lineWidth={0.8}
          renderOrder={0}
          renderQuality={renderQuality}
        />
      ))}

      <OrbitControls
        ref={orbitRef}
        onChange={handleOrbitChange}
        enablePan={false}
        minPolarAngle={0}
        maxPolarAngle={Math.PI / 2 + (10 * Math.PI / 180)}
        minDistance={2.5}
        maxDistance={7.8}
        rotateSpeed={orbitRotateSpeed}
        // A short coast after letting go, not a long drift: drei's default (0.05)
        // keeps the camera creeping sub-pixel for ~6 s, redrawing every frame;
        // 0.15 settles in about a second and still feels smooth.
        enableDamping
        dampingFactor={0.15}
      />
      {!disableKeyboardControls && <KeyboardCameraController orbitRef={orbitRef} />}
      {onThumbnailReady && activeSplatSrc && (thumbnailInitialCapture || viewSeq > 0) && (
        // Keyed on the src (hairstyle pick) and the settled-view counter, so each restarts the capture.
        <ThumbnailCapture
          key={`${captureKey ?? 0}:${activeSplatSrc}:${viewSeq}`}
          onCapture={handleThumbnailCaptured}
          splatLoaded={splatLoaded}
          revealRef={splatRevealRef}
        />
      )}
      <SplatVideoCapture
        captureKey={videoCaptureKey ?? 0}
        cancelKey={videoCancelKey ?? 0}
        orbitRef={orbitRef}
        defaultCameraPos={DEFAULT_CAMERA_POS}
        defaultTarget={DEFAULT_ORBIT_TARGET}
        captureBackground={captureBackground}
        onProgress={onVideoProgress}
        onReady={onVideoReady}
        onError={onVideoError}
      />
    </>
  );
}

// ── Public component ────────────────────────────────────────

interface HairSceneProps {
  params:                    HairParams;
  colorRGB?:                 string;
  profile?:                  UserHeadProfile;
  autoFaceliftDataUrl?:      string;
  faceliftPlyReady?:         boolean;
  hairstepPlyUrl?:           string;
  hairstepPlyUrls?:          string[];
  splatSrcOverride?:         string | null;
  splatMeta?:                SplatMeta | null;
  disableDefaultHairLayers?: boolean;
  disableKeyboardControls?:  boolean;
  background?:               string;
  backgroundBrightness?:     number;
  uiHidden?:                 boolean;
  captureKey?:               number;
  renderQuality?:            'performance' | 'balanced' | 'high';
  videoCaptureKey?:          number;
  videoCancelKey?:           number;
  onVideoProgress?:          (p: number) => void;
  onVideoReady?:             (blob: Blob, ext: string) => void;
  onVideoError?:             (err: unknown) => void;
  onPrimaryHairBBoxReady?: (bbox: RawHairBBox) => void;
  onThumbnailReady?: (dataUrl: string) => void;
  /** Capture right away (no / stale thumbnail). Otherwise only re-capture once the view settles. */
  thumbnailInitialCapture?: boolean;
  /** Fires once per splat src when the file has fully streamed in (see useSplatLoaded). */
  onSplatLoaded?: () => void;
  /** Bottom→top reveal progress for the splat only (0 hidden … 1 shown); null/absent = render normally.
   *  A ref, not state, so the per-frame animation never re-renders React. */
  splatRevealRef?: { current: number | null };
  /** On a source change, keep the old cloud up and wipe the new one over it bottom to top. */
  replaceWipe?: boolean;
}

export default function HairScene({ params: _params, colorRGB: _colorRGB, profile: _profile, autoFaceliftDataUrl, faceliftPlyReady, hairstepPlyUrl, hairstepPlyUrls, splatSrcOverride, splatMeta, disableDefaultHairLayers, disableKeyboardControls = false, background = 'url(/preview_bg.jpg) center / 100% 100% no-repeat', backgroundBrightness, uiHidden = false, captureKey, renderQuality = 'balanced', videoCaptureKey, videoCancelKey, onVideoProgress, onVideoReady, onVideoError, onPrimaryHairBBoxReady, onThumbnailReady, thumbnailInitialCapture, onSplatLoaded, splatRevealRef, replaceWipe }: HairSceneProps) {
  console.log('[HairScene] mount/render — splatSrcOverride:', splatSrcOverride, '| disableDefaultHairLayers:', disableDefaultHairLayers);
  const [showPolycam, setShowPolycam] = useState(false);
  // A lower resolution while a replace wipe is in flight, learned per device from each wipe's
  // frame time (lib/wipeDpr). Memoised: react-three-fiber re-applies the dpr prop on every
  // render, so its identity must only change when the value does.
  const [wipeActive, setWipeActive] = useState(false);
  const [wipeLevel, setWipeLevel] = useState(() => loadWipeDpr());
  const onWipeMeasured = useCallback((meanFrameMs: number, frames: number) => {
    setWipeLevel((cur) => {
      const next = adaptWipeDpr(cur, meanFrameMs, frames, window.devicePixelRatio);
      if (next !== cur) saveWipeDpr(next);
      return next;
    });
  }, []);
  const dprProp = useMemo(
    () => canvasDpr(renderQuality, wipeActive ? wipeLevel : undefined, typeof window === 'undefined' ? 1 : window.devicePixelRatio),
    [renderQuality, wipeActive, wipeLevel],
  );
  const [showSplat, setShowSplat]     = useState(!!splatSrcOverride);
  const [visibleLayers, setVisibleLayers] = useState<Set<string>>(
    new Set(disableDefaultHairLayers ? [] : ['hair_modified', 'top_hair'])
  );

  // Clear default hair layers if the prop flips to true after mount (e.g. splat loads async)
  useEffect(() => {
    if (disableDefaultHairLayers) {
      setVisibleLayers(prev => {
        if (!prev.has('hair_modified') && !prev.has('top_hair')) return prev;
        const next = new Set(prev);
        next.delete('hair_modified');
        next.delete('top_hair');
        return next;
      });
    }
  }, [disableDefaultHairLayers]);

  // FaceLift job state for ethansample_bald test
  const [ethanJobId, setEthanJobId]       = useState<string | null>(null);
  const [ethanJobStatus, setEthanJobStatus] = useState<'idle' | 'submitting' | 'processing' | 'done' | 'error'>('idle');
  const [ethanSplatSrc, setEthanSplatSrc] = useState<string | null>(null);

  // Auto-submit FaceLift when a baldified image is passed in from the hair edit loop.
  // If faceliftPlyReady is true, the ply+splat were already downloaded — skip re-submission.
  useEffect(() => {
    if (!autoFaceliftDataUrl || ethanJobStatus !== 'idle') return;
    if (faceliftPlyReady) {
      const t = Date.now();
      setEthanSplatSrc(`/output.splat?t=${t}`);
      setEthanJobStatus('done');
      return;
    }
    setEthanJobStatus('submitting');
    fetch('/api/facelift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageDataUrl: autoFaceliftDataUrl,
        currentProfile: _profile ? buildCurrentProfilePayload(_profile) : null,
      }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.splatUrl) {
          setEthanSplatSrc(data.splatUrl);
          setEthanJobStatus('done');
        } else if (data.jobId) {
          setEthanJobId(data.jobId);
          setEthanJobStatus('processing');
        } else {
          setEthanJobStatus('error');
        }
      })
      .catch(() => setEthanJobStatus('error'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFaceliftDataUrl]);


  // Poll FaceLift until the job finishes, then set the splat + ply source URLs.
  useEffect(() => {
    if (ethanJobStatus !== 'processing' || !ethanJobId) return;
    const timer = setInterval(async () => {
      try {
        const res  = await fetch(`/api/facelift?jobId=${encodeURIComponent(ethanJobId)}`);
        const data = await res.json() as { status: string; splatUrl?: string };
        if (data.status === 'success' && data.splatUrl) {
          clearInterval(timer);
          setEthanSplatSrc(data.splatUrl);
          setEthanJobStatus('done');
        } else if (data.status === 'error') {
          clearInterval(timer);
          setEthanJobStatus('error');
        }
      } catch { /* transient — keep polling */ }
    }, 10_000);
    return () => clearInterval(timer);
  }, [ethanJobStatus, ethanJobId]);

  // Turn splat on automatically as soon as a real URL becomes available
  useEffect(() => {
    console.log('[HairScene] splat effect — splatSrcOverride:', splatSrcOverride, '| ethanSplatSrc:', ethanSplatSrc);
    if (splatSrcOverride || ethanSplatSrc) setShowSplat(true);
  }, [splatSrcOverride, ethanSplatSrc]);

  // ethanSplatSrc (FaceLift result) replaces any static fallback when ready
  const effectiveSplatSrc = splatSrcOverride ?? ethanSplatSrc ?? '';
  console.log('[HairScene] effectiveSplatSrc:', effectiveSplatSrc, '| showSplat:', showSplat);

  const hairScale = HAIR_PLY_SCALE_DEFAULT;
  const hairPos: [number, number, number] = HAIR_PLY_POS_DEFAULT;

  const [showHair, setShowHair] = useState(true);
  const [hoveredLayer, setHoveredLayer] = useState<string | null>(null);
  const [hairColor, setHairColor] = useState('#3b1f0a');
  const [cursorHidden, setCursorHidden] = useState(false);
  const [orbitSpeedIdx, setOrbitSpeedIdx] = useState(1);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) return;
      if (e.code === 'KeyH') setCursorHidden(v => !v);
      if (e.code === 'KeyB') setOrbitSpeedIdx(i => (i + 1) % ORBIT_SPEEDS.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleLayer = (id: string) =>
    setVisibleLayers(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const effectiveVisibleLayers = useMemo(() => {
    if (!showHair) return new Set<string>();
    if (!hoveredLayer || visibleLayers.has(hoveredLayer)) return visibleLayers;
    const next = new Set(visibleLayers);
    next.add(hoveredLayer);
    return next;
  }, [visibleLayers, hoveredLayer, showHair]);

  // When backgroundBrightness is provided for a URL background, render the image
  // as a CSS-filtered div behind a transparent canvas so brightness only affects
  // the background plate, not the hair mesh or splat render.
  const useCssBg = backgroundBrightness !== undefined && background.startsWith('url(');
  const cssBrightnessFilter = useCssBg
    ? `brightness(${Math.max(0.05, backgroundBrightness! * 2)})`
    : undefined;
  // Fade the CSS background plate in once its image has loaded instead of
  // letting it pop in (the frame behind shows matching colours meanwhile).
  const bgReady = useImageReady(useCssBg ? cssBackgroundUrl(background) : null);

  return (
    <div
      role="region"
      aria-label="Interactive 3D hairstyle preview"
      aria-describedby="hair-scene-instructions"
      style={{ position: 'relative', width: '100%', height: '100%', cursor: cursorHidden ? 'none' : undefined }}
    >
      <p id="hair-scene-instructions" className="sr-only">
        Use pointer or touch controls to rotate and inspect the hairstyle preview.
      </p>
      {useCssBg && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background,
            filter: cssBrightnessFilter,
            zIndex: 0,
            opacity: bgReady ? 1 : 0,
            transition: 'opacity 500ms ease',
          }}
        />
      )}
      <Canvas
        // Shadow maps only when something casts one (the polycam head); the splat doesn't.
        shadows={showPolycam && renderQuality !== 'performance'}
        dpr={dprProp}
        // Draw only when something changed (see DemandFrames), at every quality.
        frameloop="demand"
        gl={{
          antialias: renderQuality !== 'performance',
          powerPreference: renderQuality === 'performance' ? 'low-power' : 'high-performance',
          toneMapping: THREE.NoToneMapping,
          // No preserveDrawingBuffer: the thumbnail and 360 capture render and read
          // the canvas in the same task, so the buffer never needs to outlive a frame.
          alpha: true,
        }}
        camera={{ position: DEFAULT_CAMERA_POS, fov: 45 }}
        style={{ position: 'relative', zIndex: 1, width: '100%', height: '100%', background: useCssBg ? 'transparent' : background }}
      >
        <Scene
          showPolycam={showPolycam}
          showSplat={showSplat}
          visibleLayers={effectiveVisibleLayers}
          hairScale={hairScale}
          hairPos={hairPos}
          splatScale={2.772}
          splatPosY={-0.07}
          splatTransform={splatMeta ? viewerTransform(splatMeta) : undefined}
          splatSrc={effectiveSplatSrc}
          hairstepPlyUrl={showHair ? hairstepPlyUrl : undefined}
          hairstepPlyUrls={showHair ? hairstepPlyUrls : undefined}
          hairColor={hairColor}
          orbitRotateSpeed={ORBIT_SPEEDS[orbitSpeedIdx]}
          disableKeyboardControls={disableKeyboardControls}
          background={useCssBg ? undefined : background}
          captureKey={captureKey}
          renderQuality={renderQuality}
          videoCaptureKey={videoCaptureKey}
          videoCancelKey={videoCancelKey}
          captureBackground={background}
          onVideoProgress={onVideoProgress}
          onVideoReady={onVideoReady}
          onVideoError={onVideoError}
          onPrimaryHairBBoxReady={onPrimaryHairBBoxReady}
          onThumbnailReady={onThumbnailReady}
          thumbnailInitialCapture={thumbnailInitialCapture}
          onSplatLoaded={onSplatLoaded}
          splatRevealRef={splatRevealRef}
          replaceWipe={replaceWipe}
          onWipeActive={setWipeActive}
          onWipeMeasured={onWipeMeasured}
        />
      </Canvas>
    </div>
  );
}

// ============================================================
// TODO (Coco): replace placeholder geometry with .glb
//
// import { useGLTF } from '@react-three/drei';
//
// function HeadMesh() {
//   const { scene } = useGLTF('/models/head.glb');
//   return <primitive object={scene} />;
// }
//
// Use updateHairMesh(params) below to drive .glb mesh groups:
// ============================================================

export function updateHairMesh(
  scene: THREE.Object3D,
  params: HairParams
) {
  scene.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;

    if (child.name === 'Hair_Top') {
      child.scale.y = params.topLength;
    }
    if (child.name.startsWith('Hair_Side')) {
      child.scale.y = params.sideLength;
      child.scale.x = 1 - params.taper * 0.5;
    }
    if (child.name === 'Hair_Back') {
      child.scale.y = params.backLength;
    }

    if (child.name.startsWith('Hair_') && child.material instanceof THREE.MeshStandardMaterial) {
      child.material.roughness = 0.5 + params.messiness * 0.5;
    }
  });
}
