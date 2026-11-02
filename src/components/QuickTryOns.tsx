'use client';

// Quick try-ons: preview the prebaked hairstyles on a buzz-cut version of the
// user's own head, with no per-style GPU build.
//
// First press builds the base once — the original selfie goes through the
// normal hair edit with a buzz-cut request, then /api/facelift (sync, no
// projectId, so it never touches the main head) — and remembers it on the
// project. The base's bytes are fetched once and kept in memory, and each preset
// is merged into them as a single splat (lib/splatMerge). Keeping the bytes
// matters: re-fetching the head per style was what made the old prebake branch
// take 2–5 s per switch.
//
// State lives in useQuickTryOns (owned by the studio page). Its two views render
// in different places: the toggle sits in the toolbox's action row, the style
// picker floats in the 3D viewport.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { useT } from '@/lib/i18n';
import { PRESET_CATEGORIES, HAIR_COLOR_SWATCH, type HairCut, type PresetGender, type PresetVariant } from '@/data/hairPresets';
import { PREBAKE_DEFAULT_TRANSFORM, gainSplatAlpha, mergeSplatBuffersWith, type PrebakeTransform } from '@/lib/splatMerge';
import { resolvePrebakeTransform, samePrebakeTransform } from '@/data/prebakeTransforms';
import { DEFAULT_VIEWER_TRANSFORM, parseSplatMeta, splatSizeMatches, viewerTransform, type SplatMeta } from '@/lib/splatMeta';
import { pillOutlinePath } from '@/lib/outlinePath';
import ButtonProgressRing from '@/components/ButtonProgressRing';
import GenderIcon from '@/components/GenderIcon';

export { pillOutlinePath };

const BUZZ_PROMPT = 'Give this person a short, even buzz cut all over — a #2 guard, about 6 mm — with a natural hairline and no fade. '
  // Shine on the scalp reconstructs as sheer, skin-like Gaussians; ask for matte stubble under flat light.
  + 'The scalp must read as dense, matte, dark stubble: no shine, highlights, reflections or bare-looking patches. Soft, even, diffuse lighting.';
/** Merged splats kept as blob URLs; older ones are revoked (each is ~5–15 MB). */
const MAX_MERGED_URLS = 6;

// Rough stage lengths for the progress ring (image edit, then cold-ish 3D build).
// It eases toward each stage's end and never claims to be done early.
const STAGES = { edit: { from: 0, to: 0.4, seconds: 12 }, build: { from: 0.4, to: 0.95, seconds: 22 } } as const;

type Phase = 'off' | 'building' | 'loading' | 'on' | 'error';
type Stage = keyof typeof STAGES;

export interface TryOnView {
  src: string;
  meta: SplatMeta | null;
}

interface Options {
  projectId: Id<'projects'>;
  /** The original selfie (never an edit), so the buzz cut can't compound drift. */
  imageUrl: string | null;
  baseSplatS3Key?: string;
  baseMetaS3Key?: string;
  /** null = show the user's normal head again. */
  onViewChange: (view: TryOnView | null) => void;
  /** Changing this turns try-ons off (e.g. a new edit landed). */
  resetSignal?: unknown;
  /** Admin: expose live placement sliders + Submit (see PrebakeCalibration). */
  calibrate?: boolean;
}

/** Which cut a variant belongs to (any gender). */
export function findCutForVariant(variant: PresetVariant | null): HairCut | undefined {
  if (!variant) return undefined;
  for (const c of PRESET_CATEGORIES) for (const cut of c.cuts) if (cut.variants.some((v) => v.id === variant.id)) return cut;
  return undefined;
}

const transformKey = (t: PrebakeTransform) => `${t.scale}|${t.dx}|${t.dy}|${t.dz}|${t.alpha}|${t.headAlpha}`;
/** Sliders re-merge after this much quiet (a merge is a few ms of CPU plus a viewer reload). */
const CALIBRATION_DEBOUNCE_MS = 120;

const proxied = (key: string) => `/api/proxy-ply?key=${encodeURIComponent(key)}`;

export function useQuickTryOns({ projectId, imageUrl, baseSplatS3Key, baseMetaS3Key, onViewChange, resetSignal, calibrate = false }: Options) {
  const setTryOnBase = useMutation(api.projects.setTryOnBase);
  const submitCalibrationMutation = useMutation(api.prebakeCalibrations.submit);
  const [phase, setPhase] = useState<Phase>('off');
  const [stage, setStage] = useState<Stage>('edit');
  const [progress, setProgress] = useState(0);
  const [gender, setGender] = useState<PresetGender>('man');
  const [selected, setSelected] = useState<PresetVariant | null>(null);
  const [merging, setMerging] = useState(false);
  // Which step failed (edit / build / save / base download), shown as a tooltip.
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  const baseRef = useRef<{ bytes: ArrayBuffer; meta: SplatMeta | null; url: string } | null>(null);
  const prebakeBytes = useRef(new Map<string, ArrayBuffer>());
  // Merged splats keyed by `${variantId}|${transformKey}`; base views keyed by head gain.
  const mergedUrls = useRef(new Map<string, string>());
  const baseGainUrls = useRef(new Map<number, string>());

  // ── Placement (calibration) ────────────────────────────────────────────────
  // The transform used for the selected cut. Admins get a live-editable copy
  // seeded from their latest submission for that cut; everyone else uses the
  // baked defaults (src/data/prebakeTransforms).
  const selectedCut = useMemo(() => findCutForVariant(selected), [selected]);
  const [transform, setTransformState] = useState<PrebakeTransform | null>(null);
  const transformRef = useRef<PrebakeTransform | null>(null);
  transformRef.current = transform;
  // Cut whose transform the admin has moved by hand (so a late-arriving
  // "latest submission" doesn't overwrite their edits).
  const touchedCutRef = useRef<string | null>(null);
  const [calibrationStatus, setCalibrationStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const latestCalibration = useQuery(
    api.prebakeCalibrations.latestForCut,
    calibrate && selectedCut ? { cutId: selectedCut.id } : 'skip',
  );
  const effectiveTransform = useCallback((variant: PresetVariant): PrebakeTransform => {
    const cut = findCutForVariant(variant);
    const baked = resolvePrebakeTransform(cut?.id ?? variant.id, variant.id);
    if (!calibrate) return baked;
    const live = transformRef.current;
    if (live && cut && touchedCutRef.current === cut.id) return live;
    if (latestCalibration && cut && latestCalibration.variantId.startsWith(`${cut.id}_`)) {
      const { scale, dx, dy, dz, alpha, headAlpha } = latestCalibration;
      return { scale, dx, dy, dz, alpha, headAlpha };
    }
    return baked;
  }, [calibrate, latestCalibration]);
  const selectToken = useRef(0);
  const onViewChangeRef = useRef(onViewChange);
  useEffect(() => { onViewChangeRef.current = onViewChange; }, [onViewChange]);

  // On unmount: hand the viewer back to the normal head, then free every object
  // URL we minted (the viewer must not keep pointing at a revoked one).
  useEffect(() => {
    const merged = mergedUrls.current;
    const baseGains = baseGainUrls.current;
    return () => {
      onViewChangeRef.current(null);
      for (const url of merged.values()) URL.revokeObjectURL(url);
      for (const url of baseGains.values()) URL.revokeObjectURL(url);
      if (baseRef.current) URL.revokeObjectURL(baseRef.current.url);
    };
  }, []);

  // Turn off when the caller signals (a fresh edit should be visible, not hidden behind a try-on).
  const firstReset = useRef(true);
  useEffect(() => {
    if (firstReset.current) { firstReset.current = false; return; }
    setPhase((p) => (p === 'on' ? 'off' : p));
    setSelected(null);
    onViewChangeRef.current(null);
  }, [resetSignal]);

  // Time-based progress while building: ease toward the current stage's end.
  useEffect(() => {
    if (phase !== 'building') return;
    const { from, to, seconds } = STAGES[stage];
    const started = performance.now();
    const id = setInterval(() => {
      const s = (performance.now() - started) / 1000;
      setProgress(from + (to - from) * (1 - Math.exp(-s / (seconds / 2.5))));
    }, 120);
    return () => clearInterval(id);
  }, [phase, stage]);

  const loadBase = useCallback(async (splatKey: string, metaKey?: string) => {
    const [bytes, meta] = await Promise.all([
      fetch(proxied(splatKey)).then((r) => { if (!r.ok) throw new Error(`base ${r.status}`); return r.arrayBuffer(); }),
      metaKey
        ? fetch(proxied(metaKey)).then((r) => (r.ok ? r.json() : null)).then(parseSplatMeta).catch(() => null)
        : Promise.resolve(null),
    ]);
    // A short or padded download would merge into a garbled head; fail instead.
    if (!splatSizeMatches(meta, bytes.byteLength)) {
      throw new Error(`base size ${bytes.byteLength} != ${meta?.output.splatBytes}`);
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    baseRef.current = { bytes, meta, url };
  }, []);

  const buildBase = useCallback(async (): Promise<{ splatKey: string; metaKey?: string }> => {
    if (!imageUrl) throw new Error('no selfie');
    setStage('edit');
    // Wake the GPU while the image model works (same overlap as EditPanel).
    void fetch('/api/facelift/warmup', { method: 'POST' }).catch(() => {});
    const editRes = await fetch('/api/gemini-hair-edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl, prompt: BUZZ_PROMPT }),
    });
    const edit = await editRes.json().catch(() => null) as { ok?: boolean; newImageUrl?: string } | null;
    if (!edit?.ok || !edit.newImageUrl) throw new Error(`edit ${editRes.status}`);

    setStage('build');
    const { getVisitorId } = await import('@/lib/visitorId');
    const fingerprint = await getVisitorId();
    const buildRes = await fetch('/api/facelift', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageDataUrl: edit.newImageUrl, outputName: 'tryon-base', fingerprint }),
    });
    const build = await buildRes.json().catch(() => null) as { splatS3Key?: string; metaS3Key?: string | null } | null;
    if (!build?.splatS3Key) throw new Error(`build ${buildRes.status}`);
    const metaKey = build.metaS3Key ?? undefined;
    try {
      await setTryOnBase({ projectId, splatS3Key: build.splatS3Key, metaS3Key: metaKey });
    } catch (err) {
      throw new Error(`save: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { splatKey: build.splatS3Key, metaKey };
  }, [imageUrl, projectId, setTryOnBase]);

  const showBase = useCallback(() => {
    const base = baseRef.current;
    if (!base) return;
    // Buzz-cut base alone, with the head-density gain (a sheer scalp reads wrong even with no style on).
    const gain = transformRef.current?.headAlpha ?? PREBAKE_DEFAULT_TRANSFORM.headAlpha;
    let url = gain === 1 ? base.url : baseGainUrls.current.get(gain);
    if (!url) {
      const gained = gainSplatAlpha(base.bytes, gain);
      url = URL.createObjectURL(new Blob([gained.buffer as ArrayBuffer], { type: 'application/octet-stream' }));
      baseGainUrls.current.set(gain, url);
    }
    shownRef.current = { variant: null, url };
    onViewChangeRef.current({ src: url, meta: base.meta });
  }, []);

  const toggle = useCallback(async () => {
    if (phase === 'building' || phase === 'loading') return;
    if (phase === 'on') {
      setPhase('off');
      setSelected(null);
      onViewChangeRef.current(null);
      return;
    }
    if (baseRef.current) { setPhase('on'); showBase(); return; }
    try {
      if (baseSplatS3Key) {
        setPhase('loading');
        await loadBase(baseSplatS3Key, baseMetaS3Key);
      } else {
        setProgress(0);
        setPhase('building');
        const { splatKey, metaKey } = await buildBase();
        await loadBase(splatKey, metaKey);
        setProgress(1);
      }
      setPhase('on');
      showBase();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('[QuickTryOns] base failed:', detail);
      setErrorDetail(detail);
      setPhase('error');
    }
  }, [phase, baseSplatS3Key, baseMetaS3Key, loadBase, buildBase, showBase]);

  // Merge `variant` onto the base with `tf` and show it (cached per variant+transform).
  // What the viewer is showing right now (null variant = the buzz-cut base), so a
  // failed load can stay put instead of snapping back to the buzz cut.
  const shownRef = useRef<{ variant: PresetVariant | null; url: string | null }>({ variant: null, url: null });
  const [styleError, setStyleError] = useState<{ variantId: string; message: string } | null>(null);
  const show = useCallback((variant: PresetVariant | null, url: string, meta: SplatMeta | null) => {
    shownRef.current = { variant, url };
    onViewChangeRef.current({ src: url, meta });
  }, []);
  const rememberMerged = useCallback((key: string, url: string) => {
    const m = mergedUrls.current;
    m.delete(key);
    m.set(key, url); // newest last
    for (const [k, u] of m) {
      if (m.size <= MAX_MERGED_URLS) break;
      if (u === shownRef.current.url || k === key) continue;
      m.delete(k);
      URL.revokeObjectURL(u);
    }
  }, []);

  const mergeAndShow = useCallback(async (variant: PresetVariant, tf: PrebakeTransform, token: number) => {
    const base = baseRef.current;
    if (!base) return;
    const key = `${variant.id}|${transformKey(tf)}`;
    const cached = mergedUrls.current.get(key);
    if (cached) {
      rememberMerged(key, cached);
      if (token === selectToken.current) { setStyleError(null); show(variant, cached, base.meta); }
      return;
    }
    setMerging(true);
    try {
      let hair = prebakeBytes.current.get(variant.id);
      if (!hair) {
        const res = await fetch(variant.splatUrl);
        if (!res.ok) throw new Error(`prebake ${res.status}`);
        hair = await res.arrayBuffer();
        prebakeBytes.current.set(variant.id, hair);
      }
      const headScale = base.meta ? viewerTransform(base.meta).scale : DEFAULT_VIEWER_TRANSFORM.scale;
      const merged = mergeSplatBuffersWith(base.bytes, hair, {
        k: tf.scale / headScale, dx: tf.dx, dy: tf.dy, dz: tf.dz, alpha: tf.alpha, headAlpha: tf.headAlpha,
      });
      const url = URL.createObjectURL(new Blob([merged.buffer as ArrayBuffer], { type: 'application/octet-stream' }));
      rememberMerged(key, url);
      if (token === selectToken.current) { setStyleError(null); show(variant, url, base.meta); }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[QuickTryOns] merge failed:', message);
      // Keep whatever is on screen (and its selection) — don't silently fall back to the buzz cut.
      if (token === selectToken.current) {
        setSelected(shownRef.current.variant);
        setStyleError({ variantId: variant.id, message });
      }
    } finally {
      if (token === selectToken.current) setMerging(false);
    }
  }, [show, rememberMerged]);

  const choose = useCallback(async (variant: PresetVariant | null) => {
    const base = baseRef.current;
    if (!base) return;
    const token = ++selectToken.current;
    setSelected(variant);
    if (!variant) { setStyleError(null); showBase(); return; }
    const tf = effectiveTransform(variant);
    setTransformState(tf);
    await mergeAndShow(variant, tf, token);
  }, [showBase, effectiveTransform, mergeAndShow]);

  // Admin: once the latest submission for the selected cut arrives, start from it
  // (unless the sliders were already moved for this cut).
  useEffect(() => {
    if (!calibrate || !selected || !selectedCut || !latestCalibration) return;
    if (touchedCutRef.current === selectedCut.id) return;
    const next = effectiveTransform(selected);
    if (transformRef.current && samePrebakeTransform(transformRef.current, next)) return;
    setTransformState(next);
    void mergeAndShow(selected, next, ++selectToken.current);
  }, [calibrate, selected, selectedCut, latestCalibration, effectiveTransform, mergeAndShow]);

  // Sliders: the value updates live; the (costly) re-merge happens when the
  // slider is released — pass { merge: false } while dragging, then commitTransform().
  // Every merge mints a new splat URL the viewer must load, so merging on every
  // drag tick piled up memory.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleMerge = useCallback((variant: PresetVariant, tf: PrebakeTransform) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void mergeAndShow(variant, tf, ++selectToken.current);
    }, CALIBRATION_DEBOUNCE_MS);
  }, [mergeAndShow]);
  const setTransform = useCallback((patch: Partial<PrebakeTransform>, opts: { merge?: boolean } = {}) => {
    const sel = selected;
    const cut = selectedCut;
    if (!sel || !cut) return;
    const next = { ...(transformRef.current ?? effectiveTransform(sel)), ...patch };
    touchedCutRef.current = cut.id;
    transformRef.current = next;
    setTransformState(next);
    setCalibrationStatus('idle');
    if (opts.merge !== false) scheduleMerge(sel, next);
  }, [selected, selectedCut, effectiveTransform, scheduleMerge]);
  const commitTransform = useCallback(() => {
    const tf = transformRef.current;
    if (selected && tf) scheduleMerge(selected, tf);
  }, [selected, scheduleMerge]);
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  const resetTransform = useCallback(() => {
    if (!selected || !selectedCut) return;
    const baked = resolvePrebakeTransform(selectedCut.id, selected.id);
    touchedCutRef.current = selectedCut.id;
    setTransformState(baked);
    void mergeAndShow(selected, baked, ++selectToken.current);
  }, [selected, selectedCut, mergeAndShow]);

  const submitCalibration = useCallback(async (note?: string) => {
    const tf = transformRef.current;
    if (!selected || !selectedCut || !tf) return;
    setCalibrationStatus('saving');
    try {
      const base = baseRef.current;
      const headScale = base?.meta ? viewerTransform(base.meta).scale : undefined;
      await submitCalibrationMutation({
        projectId, gender, cutId: selectedCut.id, variantId: selected.id,
        scale: tf.scale, dx: tf.dx, dy: tf.dy, dz: tf.dz, alpha: tf.alpha, headAlpha: tf.headAlpha,
        headScale, note,
      });
      setCalibrationStatus('saved');
      setTimeout(() => setCalibrationStatus((s) => (s === 'saved' ? 'idle' : s)), 2500);
    } catch (err) {
      console.error('[QuickTryOns] calibration submit failed:', err);
      setCalibrationStatus('error');
    }
  }, [selected, selectedCut, projectId, gender, submitCalibrationMutation]);

  // Admin: rebuild the buzz-cut base with the current BUZZ_PROMPT (e.g. after
  // changing it), replacing the one saved on the project, then re-show the style.
  const [rebuilding, setRebuilding] = useState(false);
  const rebuildBase = useCallback(async () => {
    if (!calibrate || rebuilding || phase !== 'on') return;
    setRebuilding(true);
    try {
      const { splatKey, metaKey } = await buildBase();
      const old = baseRef.current;
      await loadBase(splatKey, metaKey);
      // Everything derived from the old base is stale now.
      for (const u of mergedUrls.current.values()) URL.revokeObjectURL(u);
      mergedUrls.current.clear();
      for (const u of baseGainUrls.current.values()) URL.revokeObjectURL(u);
      baseGainUrls.current.clear();
      const sel = selected;
      if (sel) await mergeAndShow(sel, transformRef.current ?? effectiveTransform(sel), ++selectToken.current);
      else showBase();
      if (old) URL.revokeObjectURL(old.url);
    } catch (err) {
      console.error('[QuickTryOns] base rebuild failed:', err);
      setErrorDetail(err instanceof Error ? err.message : String(err));
    } finally {
      setRebuilding(false);
    }
  }, [calibrate, rebuilding, phase, buildBase, loadBase, selected, mergeAndShow, effectiveTransform, showBase]);

  return {
    phase, stage, progress, errorDetail, gender, setGender, selected, merging, toggle, choose, canStart: !!imageUrl,
    /** Last style that failed to load (the previous style stays on screen). */
    styleError,
    // Calibration (admin). Consumers: PrebakeCalibration.
    calibrate, selectedCut, transform, setTransform, commitTransform, resetTransform, submitCalibration, calibrationStatus,
    rebuildBase, rebuilding,
  };
}

export type QuickTryOnsState = ReturnType<typeof useQuickTryOns>;

// ── Toggle: an icon button in the toolbox action row ────────────────────────

function HairIcon() {
  // Filled hair silhouette only (no head): a smooth crown, one fringe sweep over
  // the forehead, and sideburns whose tips curve in; the face is left open.
  // The viewBox is cropped to the shape so it fills the icon.
  return (
    <svg width="25" height="25" viewBox="3.6 2.8 16.8 16.8" aria-hidden>
      <path
        fill="currentColor"
        d="M5.6 17.6C4.6 15.4 4.4 12.6 5 10.2C5.9 6.3 8.7 3.8 12.2 3.7C16 3.6 19 6.4 19.2 10.4C19.3 12.8 18.9 15.4 17.9 17.6C17.6 18.2 16.9 18.1 16.9 17.4C17.1 15.6 17 13.9 16.4 12.5C14.9 12.9 12.6 12.4 11.2 10.9C10.2 12.2 8.6 13 7.4 13.1C7.1 14.5 7.1 16 7.3 17.4C7.3 18.1 6 18.3 5.6 17.6Z"
      />
    </svg>
  );
}

export function QuickTryOnsToggle({ state }: { state: QuickTryOnsState }) {
  const t = useT();
  const { phase, stage, progress, errorDetail, toggle, canStart } = state;
  const busy = phase === 'building' || phase === 'loading';
  const label =
    phase === 'building' ? (stage === 'edit' ? t('Buzzing your hair…') : t('Building your buzz cut…'))
    : phase === 'loading' ? t('Loading…')
    : phase === 'error' ? t('Couldn’t build it — tap to retry')
    : t('Quick try-ons');

  return (
    <button
      type="button"
      className="card-action quick-tryons-toggle"
      data-phase={phase}
      aria-label={label}
      aria-pressed={phase === 'on'}
      aria-busy={busy}
      disabled={busy || !canStart}
      title={phase === 'error' && errorDetail ? `${label} (failed at ${errorDetail})` : label}
      onClick={() => void toggle()}
    >
      {phase === 'building' && <ButtonProgressRing progress={progress} label={t('Building your buzz cut')} />}
      <HairIcon />
    </button>
  );
}

// ── Picker: the style list in the toolbox (replaces the prompt card) ──────────

const GENDER_ICON: Record<PresetGender, 'mens' | 'womens'> = { man: 'mens', woman: 'womens' };
const GENDER_COLOR: Record<PresetGender, string> = { man: '#6d8bb0', woman: '#c97f95' };

export function QuickTryOnsPanel({ state }: { state: QuickTryOnsState }) {
  const t = useT();
  const { phase, gender, setGender, selected, merging, choose, toggle, styleError } = state;
  if (phase !== 'on') return null;
  const category = PRESET_CATEGORIES.find((c) => c.id === gender) ?? PRESET_CATEGORIES[0];
  const selectedCut = selected ? category.cuts.find((c) => c.variants.some((v) => v.id === selected.id)) : undefined;
  const other: PresetGender = gender === 'man' ? 'woman' : 'man';

  return (
    <div className="cut-list tryon-list" role="group" aria-label={t('Quick try-on styles')} aria-busy={merging}>
      <div className="cut-list-head">
        {/* Back: leave try-ons, return to the normal head and the edit menu. */}
        <button type="button" className="tryon-back" onClick={() => void toggle()} aria-label={t('Back from Quick try-ons')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 18l-6-6 6-6" />
          </svg>
          {t('Quick try-ons')}
        </button>
        <button
          type="button"
          onClick={() => setGender(other)}
          className="chip-gender chip-gender-nudge"
          aria-label={gender === 'man' ? t('Showing men’s styles — switch to women’s') : t('Showing women’s styles — switch to men’s')}
          title={gender === 'man' ? t('Men’s') : t('Women’s')}
          style={{ color: GENDER_COLOR[gender], borderColor: 'currentColor' }}
        >
          <GenderIcon gender={GENDER_ICON[gender]} />
        </button>
      </div>
      {/* Keyed by gender so the list re-forms (mist → text) when it switches. */}
      <div key={gender} className="cut-list-scroll tryon-list-scroll">
        <button
          type="button"
          className={`cut-list-item tryon-item${!selected ? ' chip-selected' : ''}`}
          aria-pressed={!selected}
          style={{ '--i': 0 } as React.CSSProperties}
          onClick={() => void choose(null)}
        >
          <span className="tryon-name">{t('Buzz cut')}</span>
          <span className="tryon-blurb">{t('your base, no style on top')}</span>
        </button>
        {category.cuts.map((cut, i) => {
          const isSelected = selectedCut?.id === cut.id;
          // A style that failed to load: the previous one stays on screen; say so
          // here and let the visitor try again (choose() the same variant).
          const failed = styleError ? cut.variants.find((v) => v.id === styleError.variantId) : undefined;
          return (
            <div key={cut.id} className="tryon-row">
              <button
                type="button"
                className={`cut-list-item tryon-item${isSelected ? ' chip-selected' : ''}`}
                aria-pressed={isSelected}
                style={{ '--i': i + 1 } as React.CSSProperties}
                onClick={() => void choose(cut.variants[0])}
              >
                <span className="tryon-name">{cut.name}</span>
                {cut.blurb && <span className="tryon-blurb">{cut.blurb}</span>}
              </button>
              {failed && (
                <button type="button" className="tryon-retry" role="status" aria-live="polite" onClick={() => void choose(failed)}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" />
                  </svg>
                  {t('Couldn’t load: tap to retry')}
                </button>
              )}
              {isSelected && cut.variants.length > 1 && (
                <div className="tryon-colors">
                  {cut.variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className="quick-tryons-swatch"
                      aria-pressed={selected?.id === v.id}
                      aria-label={v.label}
                      title={v.label}
                      onClick={() => void choose(v)}
                      style={{ background: HAIR_COLOR_SWATCH[v.color] }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
