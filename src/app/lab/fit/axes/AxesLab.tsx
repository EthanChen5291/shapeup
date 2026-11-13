'use client';

// Dev-only: walks a FaceLift head from its raw .splat coordinates to the upright pose HairScene
// shows. The head is a plain THREE.Points cloud of the real bytes; drei's load-time flip is applied
// HERE, explicitly, as an inner "data" group turned 180° about x, and the <Splat> object transform
// (rotation / scale / position from lib/splatMeta DEFAULT_VIEWER_TRANSFORM) as the outer group.
// All matrices and probe vectors come from ./axesMath (tested against THREE.Euler / Object3D).

import { Html, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { samplePoints } from '../fitLabProjection';
import { btn, btnActive, card, h2, mathBox, MONO, ok, page, small, table, td, th } from '../labStyles';
import { HEAD_URL } from '../wearerPresets';
import { axisAngle, dirWords, ease, findNose, HAIRSCENE_CAMERA, matrixOf, POSES, PREV, probe, PROBES, rows4, srgbToLinear, transition, VIA, VIEWER, verdict, type PoseKey, type ProbeId, type Via } from './axesMath';

const SECONDS = 1.1;
const RED = '#ff5a5a', GREEN = '#5ad16a', BLUE = '#5a9dff';
const STEP_KEYS: PoseKey[] = ['0', '1', '2', '3', '4', '5a', '6'];
const STEP_LABEL: Record<string, string> = {
  '0': '0 · raw data', '1': '1 · drei flip', '2': '2 · rotate X −π/2', '3': '3 · rotate Y π', '4': '4 · rotate Z π', '5a': '5 · equivalents', '6': '6 · scale + position',
};
const FORMULA: Record<PoseKey, string> = {
  '0': 'M = I (bytes read as three.js xyz)',
  '1': 'M = F,  F = (x, y, z) → (x, −y, −z) = Rx(π)',
  '2': 'M = Rx(−π/2) · F',
  '3': 'M = Rx(−π/2) · Ry(π) · F',
  '4': 'M = Rx(−π/2) · Ry(π) · Rz(π) · F',
  '5a': 'M = Euler XYZ(−π/2, π, π) · F   (as three.js builds it)',
  '5b': 'M = Rx(+π/2) · F   (the Euler, written as one rotation)',
  '5c': 'M = Rx(−π/2)   (no flip at all: flip and rotation folded together)',
  '6': 'M = T(0, −0.07, 0.48) · Euler(−π/2, π, π) · S(2.772) · F',
  wrong: 'M = Euler XYZ(−π/2, 0, 0) · F   (the "only rotate x" guess)',
  wrong6: 'M = T · Euler XYZ(−π/2, 0, 0) · S · F   (the "only rotate x" guess)',
};

interface Anim { from: ReturnType<typeof transition>; to: (typeof POSES)[PoseKey]; via?: Via; start: number }

/** The head + data gizmo, posed every frame from the shared animation. Writes live probes into `probeEls` when given. */
function Rig({ anim, cloud, nose, labels, probeEls }: {
  anim: React.MutableRefObject<Anim>;
  cloud: THREE.BufferGeometry;
  nose: [number, number, number] | null;
  labels: boolean;
  probeEls?: React.MutableRefObject<Partial<Record<ProbeId, HTMLSpanElement | null>>>;
}) {
  const outer = useRef<THREE.Group>(null);
  const inner = useRef<THREE.Group>(null);
  const done = useRef(false);
  const mat = useMemo(() => new THREE.PointsMaterial({ size: 2.4, sizeAttenuation: false, vertexColors: true }), []);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(() => {
    const a = anim.current;
    const u = ease((performance.now() - a.start) / (SECONDS * 1000));
    const p = transition(a.from, a.to, u, a.via);
    if (outer.current) { outer.current.quaternion.copy(p.q); outer.current.scale.setScalar(p.scale); outer.current.position.copy(p.pos); }
    if (inner.current) inner.current.quaternion.copy(axisAngle('x', p.flip));
    if (probeEls) {
      if (u < 1) done.current = false;
      if (done.current) return;
      const m = matrixOf(p);
      for (const id of Object.keys(PROBES) as ProbeId[]) {
        const el = probeEls.current[id];
        if (el) { const d = probe(m, PROBES[id].v); el.textContent = `(${d.map((x) => x.toFixed(2)).join(', ')})  ${dirWords(d)}`; }
      }
      if (u >= 1) done.current = true;
    }
  });
  return (
    <group ref={outer}>
      <group ref={inner}>
        <points geometry={cloud} material={mat} frustumCulled={false} />
        <DataAxes labels={labels} />
        {nose && (
          <group position={nose}>
            <mesh><sphereGeometry args={[0.03, 16, 16]} /><meshBasicMaterial color="#ff2d55" /></mesh>
            <mesh position={[0, -0.09, 0]} rotation={[Math.PI, 0, 0]}><coneGeometry args={[0.025, 0.1, 16]} /><meshBasicMaterial color="#ff2d55" /></mesh>
            {labels && <Tag at={[0, -0.16, 0]} color="#ff2d55">nose (face is −y)</Tag>}
          </group>
        )}
      </group>
    </group>
  );
}

/** Thick arrow from the origin along `dir`. */
function Arrow({ dir, length, color, radius = 0.014 }: { dir: [number, number, number]; length: number; color: string; radius?: number }) {
  const q = useMemo(() => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize()), [dir]);
  return (
    <group quaternion={q}>
      <mesh position={[0, (length - 0.08) / 2, 0]}><cylinderGeometry args={[radius, radius, length - 0.08, 10]} /><meshBasicMaterial color={color} /></mesh>
      <mesh position={[0, length - 0.04, 0]}><coneGeometry args={[radius * 3, 0.08, 14]} /><meshBasicMaterial color={color} /></mesh>
    </group>
  );
}

function Tag({ at, color, children, center = true }: { at: [number, number, number]; color: string; children: ReactNode; center?: boolean }) {
  return (
    <Html position={at} center={center} style={{ pointerEvents: 'none', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 700, fontFamily: MONO, color, background: 'rgba(11,11,16,0.85)', padding: '2px 6px', borderRadius: 4, border: `1px solid ${color}` }}>
      {children}
    </Html>
  );
}

/** The data (FaceLift) frame: thick arrows, lowercase labels; it rides inside the flip and the object transform. */
function DataAxes({ labels }: { labels: boolean }) {
  const L = 0.75;
  return (
    <group>
      <Arrow dir={[1, 0, 0]} length={L} color={RED} />
      <Arrow dir={[0, 1, 0]} length={L} color={GREEN} />
      <Arrow dir={[0, 0, 1]} length={L} color={BLUE} />
      {labels && (
        <>
          <Tag at={[L + 0.1, 0, 0]} color={RED}>data x (right)</Tag>
          <Tag at={[0, L + 0.1, 0]} color={GREEN}>data y (back)</Tag>
          <Tag at={[0, 0, L + 0.1]} color={BLUE}>data z (up)</Tag>
        </>
      )}
    </group>
  );
}

/** The world (three.js) frame: thin long lines, capital labels; never moves. */
function WorldAxes({ L, Lz = L }: { L: number; Lz?: number }) {
  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, L, 0, 0, 0, 0, 0, 0, L, 0, 0, 0, 0, 0, 0, Lz], 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute([1, 0.35, 0.35, 1, 0.35, 0.35, 0.35, 0.82, 0.42, 0.35, 0.82, 0.42, 0.35, 0.62, 1, 0.35, 0.62, 1], 3));
    return g;
  }, [L, Lz]);
  useEffect(() => () => geom.dispose(), [geom]);
  return (
    <group>
      <lineSegments geometry={geom}><lineBasicMaterial vertexColors transparent opacity={0.7} /></lineSegments>
      <Tag at={[L + 0.12, 0, 0]} color={RED}>WORLD X (screen right)</Tag>
      <Tag at={[0, L + 0.08, 0]} color={GREEN}>WORLD Y (screen up)</Tag>
      <Tag at={[0, 0, Lz + 0.12]} color={BLUE}>WORLD Z (toward camera)</Tag>
    </group>
  );
}

/** HairScene's default camera: an icon looking −z, at its true position (far) or a stand-in nearby; plus its frustum when far. */
function CameraIcon({ far }: { far: boolean }) {
  const z = far ? HAIRSCENE_CAMERA.position[2] : 1.9;
  const helper = useMemo(() => {
    const cam = new THREE.PerspectiveCamera(HAIRSCENE_CAMERA.fov, 1.5, 0.3, HAIRSCENE_CAMERA.position[2] + 0.6);
    cam.position.set(...HAIRSCENE_CAMERA.position); cam.lookAt(...HAIRSCENE_CAMERA.target); cam.updateMatrixWorld();
    const h = new THREE.CameraHelper(cam); h.update();
    return h;
  }, []);
  useEffect(() => () => helper.dispose(), [helper]);
  return (
    <group>
      <group position={[0, 0, z]}>
        <mesh position={[0, 0, 0.12]}><boxGeometry args={[0.22, 0.16, 0.2]} /><meshBasicMaterial color="#dcdce6" /></mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -0.05]}><coneGeometry args={[0.08, 0.14, 16]} /><meshBasicMaterial color="#dcdce6" /></mesh>
        <Tag at={[far ? 0.35 : 0.18, far ? -0.12 : -0.42, 0.1]} center={false} color="#dcdce6">{far ? 'default camera (0, 0, 7.8), fov 45, looks −z' : 'default camera: out along +z (at 7.8), looks −z'}</Tag>
      </group>
      {far && <primitive object={helper} />}
    </group>
  );
}

/** Eases the orbit camera to a near or far vantage when `far` changes; orbit stays free otherwise. */
function ViewRig({ far }: { far: boolean }) {
  const { camera, controls } = useThree() as unknown as { camera: THREE.PerspectiveCamera; controls: { target: THREE.Vector3; update: () => void } | null };
  const tw = useRef({ start: -1, fromP: new THREE.Vector3(), toP: new THREE.Vector3(), fromT: new THREE.Vector3(), toT: new THREE.Vector3() });
  const first = useRef(true);
  useEffect(() => {
    const toP = far ? new THREE.Vector3(8.5, 5.2, 11.5) : new THREE.Vector3(3.3, 1.6, 3.0);
    const toT = far ? new THREE.Vector3(0, 0, 3.2) : new THREE.Vector3(0, 0, 0.5);
    if (first.current) { first.current = false; camera.position.copy(toP); controls?.target.copy(toT); controls?.update(); return; }
    const t = tw.current;
    t.fromP.copy(camera.position); t.toP.copy(toP); t.fromT.copy(controls?.target ?? new THREE.Vector3()); t.toT.copy(toT); t.start = performance.now();
  }, [far, camera, controls]);
  useFrame(() => {
    const t = tw.current;
    if (t.start < 0) return;
    const u = ease((performance.now() - t.start) / (SECONDS * 1000));
    camera.position.lerpVectors(t.fromP, t.toP, u);
    controls?.target.lerpVectors(t.fromT, t.toT, u);
    controls?.update();
    if (u >= 1) t.start = -1;
  });
  return null;
}

export default function AxesLab() {
  const [bytes, setBytes] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<PoseKey>('0');
  const [variant, setVariant] = useState<'5a' | '5b' | '5c'>('5a');
  const [wrong, setWrong] = useState(false);
  const probeEls = useRef<Partial<Record<ProbeId, HTMLSpanElement | null>>>({});

  useEffect(() => {
    let alive = true;
    fetch(HEAD_URL).then((r) => { if (!r.ok) throw new Error(`${HEAD_URL}: HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((b) => { if (alive) setBytes(b); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    return () => { alive = false; };
  }, []);

  const { cloud, nose, count } = useMemo(() => {
    if (!bytes) return { cloud: null, nose: null, count: 0 };
    const pts = samplePoints(bytes, { stride: 3, minAlpha: 0.1 });
    const u8 = new Uint8Array(bytes);
    const pos = new Float32Array(pts.x.length * 3), col = new Float32Array(pts.x.length * 3);
    for (let i = 0; i < pts.x.length; i++) {
      // Raw FaceLift xyz written straight into three.js xyz: no flip here, the groups do it.
      pos[i * 3] = pts.x[i]; pos[i * 3 + 1] = pts.y[i]; pos[i * 3 + 2] = pts.z[i];
      const off = pts.rows[i] * 32;
      col[i * 3] = srgbToLinear(u8[off + 24] / 255); col[i * 3 + 1] = srgbToLinear(u8[off + 25] / 255); col[i * 3 + 2] = srgbToLinear(u8[off + 26] / 255);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return { cloud: g, nose: findNose(pts.x, pts.y, pts.z), count: pts.x.length };
  }, [bytes]);

  const shown: PoseKey = (() => {
    const base = step === '5a' ? variant : step;
    if (!wrong) return base;
    return step === '6' ? 'wrong6' : 'wrong';
  })();

  const anim = useRef<Anim>({ from: POSES['0'], to: POSES['0'], start: 0 });
  const shownPrev = useRef<PoseKey>('0');
  useEffect(() => {
    const a = anim.current, now = performance.now();
    const u = ease((now - a.start) / (SECONDS * 1000));
    const settled = u >= 1;
    const prev = shownPrev.current;
    // Steps 2–4 forward from a settled previous step: turn about the outer group's own axis (intrinsic).
    const via = settled && PREV[shown] === prev ? VIA[shown] : undefined;
    a.from = settled ? POSES[prev] : transition(a.from, a.to, u, a.via);
    a.to = POSES[shown]; a.via = via; a.start = now;
    shownPrev.current = shown;
  }, [shown]);

  const target = matrixOf(POSES[shown]);
  const probesAfter = (Object.keys(PROBES) as ProbeId[]).map((id) => ({ id, d: probe(target, PROBES[id].v) }));
  const upD = probesAfter.find((p) => p.id === 'up')!.d, faceD = probesAfter.find((p) => p.id === 'face')!.d;
  const v = verdict(upD, faceD);
  const far = step === '6';
  const eulerDiff = Math.max(...matrixOf(POSES['5a']).elements.map((x, i) => Math.abs(x - matrixOf(POSES[variant]).elements[i])));

  if (error) return <main style={page}><p style={{ color: '#ff6b6b', fontSize: 20 }}>Could not load {HEAD_URL}: {error}</p></main>;

  return (
    <main style={page}>
      <h1 style={{ fontSize: 40, margin: '0 0 8px', lineHeight: 1.1 }}>Why rotation [−π/2, π, π] stands the head up</h1>
      <p style={{ fontSize: 19, color: '#b9b9c6', maxWidth: 1150, margin: '0 0 16px' }}>
        FaceLift writes heads with x right, y back (the face is at −y) and z up. three.js draws with x right, y up and the default camera on +z looking at −z.
        HairScene renders a head with <code style={{ fontFamily: MONO }}>&lt;Splat rotation=[−π/2, π, π] scale=2.772 position=[0, −0.07, 0.48]&gt;</code>; drei&apos;s loader also flips each point before that.
        Below, the real house head ({count.toLocaleString()} points: every 3rd row, alpha ≥ 0.1) goes through each piece in turn. Drag to orbit. <Link href="/lab/fit" style={{ color: '#9ad0ff' }}>← /lab/fit</Link>
      </p>

      <section style={card}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
          {STEP_KEYS.map((k) => <button key={k} type="button" style={{ ...btn, fontSize: 16, padding: '6px 12px', ...(step === k ? btnActive : {}) }} onClick={() => setStep(k)}>{STEP_LABEL[k]}</button>)}
          <label style={{ fontSize: 17, marginLeft: 12, color: wrong ? '#ff6b6b' : undefined }}>
            <input type="checkbox" checked={wrong} onChange={(e) => setWrong(e.target.checked)} /> what if we only used rotation [−π/2, 0, 0]
          </label>
        </div>
        {step === '5a' && !wrong && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {([['5a', 'flip + Euler(−π/2, π, π)'], ['5b', 'flip + single +90° about x'], ['5c', 'no flip + single −90° about x']] as const).map(([k, l]) => (
              <button key={k} type="button" style={{ ...btn, fontSize: 15, padding: '5px 10px', ...(variant === k ? btnActive : {}) }} onClick={() => setVariant(k)}>{l}</button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ width: 860, maxWidth: '100%', height: 620, borderRadius: 10, border: '1px solid #26262f', background: '#0f0f14', overflow: 'hidden', position: 'relative' }}>
            {cloud ? (
              <Canvas camera={{ position: [3.3, 1.6, 3.0], fov: 40 }} dpr={[1, 2]}>
                <ViewRig far={far} />
                <WorldAxes L={far ? 3.3 : 1.35} Lz={far ? 6.0 : 1.35} />
                <CameraIcon far={far} />
                <Rig anim={anim} cloud={cloud} nose={nose} labels probeEls={probeEls} />
                <OrbitControls makeDefault />
              </Canvas>
            ) : <p style={{ padding: 20, fontSize: 18 }}>Loading {HEAD_URL}…</p>}
            <div style={{ position: 'absolute', left: 12, bottom: 10, fontSize: 14, color: '#a0a0ae', fontFamily: MONO, pointerEvents: 'none' }}>third-person view · thick arrows = data frame · thin lines = world frame</div>
          </div>
          <div style={{ flex: '1 1 400px', minWidth: 380 }}>
            <div style={{ fontSize: 15, color: '#a0a0ae', marginBottom: 4 }}>What HairScene&apos;s default camera sees (position (0, 0, 7.8), fov 45, looking −z)</div>
            <div style={{ width: 420, maxWidth: '100%', height: 300, borderRadius: 10, border: '1px solid #26262f', background: '#0f0f14', overflow: 'hidden' }}>
              {cloud && (
                <Canvas camera={{ position: HAIRSCENE_CAMERA.position, fov: HAIRSCENE_CAMERA.fov }} dpr={[1, 2]}>
                  <Rig anim={anim} cloud={cloud} nose={nose} labels={false} />
                </Canvas>
              )}
            </div>
            <div style={{ ...mathBox, marginTop: 12, fontFamily: MONO, fontSize: 16, lineHeight: 1.55 }}>
              <div style={{ color: '#9ad0ff' }}>{FORMULA[shown]}</div>
              <table style={{ ...table, fontSize: 17, width: 'auto', margin: '6px 0' }}>
                <tbody>
                  {rows4(target).map((r, i) => <tr key={i}>{r.map((x, j) => <td key={j} style={{ padding: '1px 10px', textAlign: 'right', color: j === 3 ? '#a0a0ae' : undefined }}>{x.toFixed(3)}</td>)}</tr>)}
                </tbody>
              </table>
              <div style={{ fontSize: 13, color: '#8a8a98' }}>world = M · (FaceLift point, 1)</div>
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(520px, 1fr))', gap: 20, marginTop: 18 }}>
          <div style={{ ...mathBox, fontSize: 18, lineHeight: 1.6 }}><StepText step={step} wrong={wrong} variant={variant} eulerDiff={eulerDiff} /></div>
          <div>
            <table style={{ ...table, fontSize: 16 }}>
              <thead><tr><th style={th}>probe (data frame)</th><th style={th}>live (as it moves)</th><th style={th}>after this step</th></tr></thead>
              <tbody>
                {probesAfter.map(({ id, d }) => (
                  <tr key={id}>
                    <td style={td}>{PROBES[id].label}</td>
                    <td style={td}><span ref={(el) => { probeEls.current[id] = el; }} /></td>
                    <td style={td}>({d.join(', ')}) {dirWords(d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 19, marginTop: 10, fontWeight: 700, color: v.ok ? ok.color : '#ffb020' }}>From the default camera: {v.text} {v.ok ? '✓' : ''}</div>
          </div>
        </div>
      </section>
      <p style={small}>Sources: drei <code style={{ fontFamily: MONO }}>core/Splat.js</code> pushDataBuffer (the flip), <code style={{ fontFamily: MONO }}>lib/splatMeta</code> DEFAULT_VIEWER_TRANSFORM (rotation {JSON.stringify(VIEWER.rotation.map((x) => +x.toFixed(4)))}, scale {VIEWER.scale}, position {JSON.stringify(VIEWER.position)}), <code style={{ fontFamily: MONO }}>components/HairScene.tsx</code> DEFAULT_CAMERA_POS [0, 0, 7.8], fov 45.</p>
    </main>
  );
}

function StepText({ step, wrong, variant, eulerDiff }: { step: PoseKey; wrong: boolean; variant: '5a' | '5b' | '5c'; eulerDiff: number }) {
  if (wrong) {
    return (
      <>
        <b style={{ color: '#ff6b6b' }}>Only rotation [−π/2, 0, 0].</b> Same flip, then −90° about x and nothing else{step === '6' ? ', then the same scale and position' : ''}. This is exactly the pose after step 2: the flip already turned the head 180° about x, so a further −90° leaves it 90° short in the other direction. The probes on the right are computed from this matrix; the camera inset shows the result. Ry(π)·Rz(π) together are another 180° about x, which is what steps 3–4 add.
      </>
    );
  }
  switch (step) {
    case '0': return <><b>0 · Raw data read as three.js coordinates.</b> The .splat bytes go straight into a THREE.Points as (x, y, z), with no transform. FaceLift&apos;s up (data z, blue arrow) now points along WORLD Z, i.e. at the camera, and the face (−y, the red nose) points down the screen. So the default camera looks down onto the top of the head with the chin toward the bottom of the screen.</>;
    case '1': return <><b>1 · drei&apos;s load-time flip.</b> drei&apos;s Splat loader builds each centre as (x, y, −z) and stores (c.x, −c.y, c.z): net <b>(x, y, z) → (x, −y, −z)</b>, before any object transform. That is a 180° turn about x (determinant +1, so not a mirror) and is animated as one. Up now points away from the camera and the face up the screen: you look at the underside of the neck.</>;
    case '2': return <><b>2 · Euler X = −π/2.</b> three.js Euler order &apos;XYZ&apos; builds the matrix Rx·Ry·Rz. Read right to left, that is Z first, then Y, then X, each about the fixed world axes (extrinsic). Read left to right, it is X, then Y, then Z, each about the object&apos;s own already-turned axes (intrinsic). Same matrix. The animation uses the intrinsic reading so the steps go in the order they are written. First: −90° about the data gizmo&apos;s x. The head is now upside down and facing away.</>;
    case '3': return <><b>3 · Euler Y = π</b>, about the object&apos;s current y (intrinsic). This turns the head right way up, but it is still facing away, and +x now points screen left.</>;
    case '4': return <><b>4 · Euler Z = π</b>, about the object&apos;s current z. Upright and facing the camera, with +x back on screen right. Overall M = Rx(−π/2)·Ry(π)·Rz(π)·F, which equals −90° about x. The test checks this against new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(−π/2, π, π, &apos;XYZ&apos;)) × F.</>;
    case '5a': return <><b>5 · The same pose, three ways.</b> Ry(π)·Rz(π) is a 180° turn about x, so Euler(−π/2, π, π) is just <b>+90° about x</b>. Add drei&apos;s flip (another 180° about x) and the whole thing is <b>−90° about x</b>, applied directly to the FaceLift data. The three buttons switch between the forms; the head does not move between them. Largest matrix entry difference from the Euler form: <b>{eulerDiff.toExponential(1)}</b>{variant === '5c' ? '. This form unwinds the flip and turns the other way, so it moves on the way there but lands in the same place.' : '.'}</>;
    case '6': return <><b>6 · Scale 2.772 and position (0, −0.07, 0.48).</b> The rest of the &lt;Splat&gt; transform: the head grows from about 1.8 units across to about 5, drops 0.07, and comes 0.48 toward the camera. The frustum shows HairScene&apos;s default camera at (0, 0, 7.8) with fov 45, looking −z at the origin. The inset is that camera&apos;s view: the head lands in frame, upright and facing it.</>;
    default: return null;
  }
}
