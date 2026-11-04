'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { parseSplatMeta, type SplatMeta } from '@/lib/splatMeta';
import { useUser } from '@clerk/nextjs';
import { useQuery, useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { Id } from '@convex/_generated/dataModel';
import { useRouter, useParams } from 'next/navigation';
import { HairMeasurementBBox, HairParams, UserHeadProfile } from '@/types';
import { buildHairMeasurementSnapshot } from '@/lib/hairMeasurementSnapshot';
import { verticalSwipe } from '@/lib/swipeGesture';
import { buildCurrentProfilePayload } from '@/lib/llmPayload';
import { track } from '@/lib/analytics';
import { mockUserHeadProfile } from '@/data/mockProfile';
import { useDemoFacelift } from '@/hooks/useDemoFacelift';
import { resolveBuildState, STALE_BUILD_ERROR } from '@/lib/buildState';
import { BuildGhost } from '@/components/BuildGhost';
import { revealEase } from '@/lib/splatReveal';
import EditPanel from '@/components/EditPanel';
import CaptureGlyph from '@/components/CaptureGlyph';
import { QuickTryOnsPanel, QuickTryOnsToggle, useQuickTryOns, type TryOnView } from '@/components/QuickTryOns';
import { useDragSize } from '@/hooks/useDragSize';
import { STUDIO_SIDEBAR, STUDIO_TOP_PAD_CSS, studioTopPad } from '@/lib/studioLayout';
import ProjectNameEditor from '@/components/ProjectNameEditor';
import FeedbackToast from '@/components/FeedbackToast';
import RefundRequestDialog from '@/components/RefundRequestDialog';
import { useFeedbackPrompt } from '@/hooks/useFeedbackPrompt';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { BarberMascot, LogoHomeLink, BouncyButton, ClockCounter, AddTokensButton } from '@/components/AppUI';
import { PricingPopup } from '@/components/PricingPopup';
import { FREE_MODE } from '@/lib/freeMode';
import { useSearchParams } from 'next/navigation';
import { useGhostHandoff } from '@/components/GhostHandoff';
import { EditPanelSkeleton } from '@/components/EditPanelSkeleton';
import { stageArrive } from '@/lib/toolboxArrive';
import { useSettings } from '@/contexts/SettingsContext';
import { useIsMobile, useMediaQuery } from '@/hooks/useMediaQuery';
import { MOBILE_SHORT_POLAROID_CSS, MOBILE_SHORT_REGION_CSS, SHORT_SCREEN_QUERY } from '@/lib/studioLayout';
import { useT } from '@/lib/i18n';
import { isLegacyThumbnailKey } from '@/lib/thumbnailFrame';

const HairScene = dynamic(() => import('@/components/HairScene'), { ssr: false });
const HairRecommendationsBar = dynamic(() => import('@/components/HairRecommendationsBar'), { ssr: false });

type RawHairBBox = Omit<HairMeasurementBBox, 'width' | 'height' | 'depth'>;


function FaceliftLoader({ demoStatus }: { demoStatus: string }) {
  const t = useT();
  const frozen = demoStatus === 'error';
  const r = 20;
  const circumference = 2 * Math.PI * r;
  const dashoffset = circumference * 0.75;
  return (
    <div className="flex flex-col items-center gap-3 p-8">
      <div style={{ width: 48, height: 48, animation: frozen ? 'none' : 'spin 1.1s linear infinite', transformOrigin: 'center' }}>
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r={r} stroke="rgba(255,248,234,0.12)" strokeWidth="3" />
          <circle cx="24" cy="24" r={r} stroke={frozen ? 'rgba(255,248,234,0.25)' : 'var(--butter)'} strokeWidth="3" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={dashoffset} transform="rotate(-90, 24, 24)" />
        </svg>
      </div>
      {frozen ? (
        <span className="font-mono text-[10px] text-[var(--butter)] opacity-85">{t('Error — check console')}</span>
      ) : (
        <span className="font-serif italic text-xs text-[var(--cream)]" style={{ opacity: 0.5 }}>{t('Building your 3D model…')}</span>
      )}
      {!frozen && (
        <span className="font-sans text-[10px] text-center text-[var(--cream)]" style={{ opacity: 0.4, maxWidth: 240, lineHeight: 1.4 }}>
          {t('We infer shape, hairline & proportions from your photos — a great likeness, not a measurement.')}
        </span>
      )}
    </div>
  );
}

interface DemoToolboxProps {
  profile: UserHeadProfile;
  prompt: string;
  onPromptChange: (v: string) => void;
  onSubmit: () => void;
}

function DemoToolbox({ profile, prompt, onPromptChange, onSubmit }: DemoToolboxProps) {
  const t = useT();
  const currentParams = profile.currentStyle.params;
  const llmPayload = buildCurrentProfilePayload(profile);
  const liveMeasurementsJson = JSON.stringify(llmPayload.measurementSnapshot, null, 2);

  // Empty-prompt hint: 'hidden' | 'shown' | 'fading'. Shows for 3s then fades out.
  const [hint, setHint] = useState<'hidden' | 'shown' | 'fading'>('hidden');
  const hintTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const handleSubmit = () => {
    if (!prompt.trim()) {
      hintTimers.current.forEach(clearTimeout);
      setHint('shown');
      hintTimers.current = [
        setTimeout(() => setHint('fading'), 2700),
        setTimeout(() => setHint('hidden'), 3000),
      ];
      return;
    }
    onSubmit();
  };

  useEffect(() => () => hintTimers.current.forEach(clearTimeout), []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  return (
    <div className="flex flex-col gap-6 px-5 py-6 h-full overflow-y-auto cozy-scroll text-[var(--ink)]" style={{ background: 'var(--biscuit-lt)' }}>
      <div className="flex items-center gap-3">
        <span className="inline-block w-2 h-7 barber-pole" />
        <div>
          <div className="font-sans text-[10px] uppercase tracking-wider text-[var(--smoke)]">{t('The barber’s')}</div>
          <h2 className="font-display italic text-2xl text-[var(--ink)] leading-none" style={{ fontWeight: 500 }}>{t('Toolbox')}</h2>
        </div>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="relative flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="pill pill-tomato">{t('new request')}</span>
          <span className="font-mono text-[10px] text-[var(--smoke)]">✂</span>
        </div>
        <textarea
          className="input-soft w-full rounded-xl px-3 py-2 text-sm resize-none h-20 placeholder:text-[var(--smoke)]"
          style={{ fontStyle: 'italic' }}
          placeholder={t('Type your next best haircut here!')}
          value={prompt}
          onChange={(e) => onPromptChange(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="flex gap-2">
          <button type="submit" className="btn btn-tomato flex-1" style={{ padding: '10px 16px', fontSize: 13 }}>✂ {t('Render in 3D')}</button>
          <button type="button" disabled className="btn btn-denim opacity-40 cursor-not-allowed" style={{ padding: '10px 14px', fontSize: 13 }}>🎙 {t('Voice')}</button>
        </div>
        {hint !== 'hidden' && (
          <div
            role="status"
            className="absolute left-0 right-0 -bottom-2 translate-y-full z-20 flex items-center gap-2 rounded-xl px-3 py-2 text-sm shadow-lg pointer-events-none"
            style={{
              background: 'var(--ink)',
              color: 'var(--cream)',
              opacity: hint === 'fading' ? 0 : 1,
              transition: 'opacity 0.3s ease',
            }}
          >
            <span>✂</span>
            <span>{t('Enter your desired hairstyle in the toolbox!')}</span>
          </div>
        )}
      </form>
      <div className="flex flex-col gap-4">
        <p className="font-mono text-[10px] text-[var(--smoke)] uppercase tracking-[0.18em]">{t('Hair Parameters')}</p>
        {(['pc1', 'pc2', 'pc3', 'pc4', 'pc5', 'pc6'] as const).map((key, i) => {
          const labels = ['Hair length', 'Width', 'Ponytail-ness', 'Density', 'Wavyness', 'Parting'];
          return (
            <div key={key} className="flex flex-col gap-1">
              <div className="flex justify-between text-sm">
                <span>{t(labels[i])}</span>
                <span className="font-mono text-[12px] text-[var(--smoke)]">{(currentParams[key] ?? 0).toFixed(2)}</span>
              </div>
              <input type="range" min={-3} max={3} step={0.1} value={currentParams[key] ?? 0} disabled onChange={() => {}} className="slider-warm w-full opacity-40 cursor-not-allowed" />
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-2 pt-4 border-t border-dashed border-[var(--char)]/20">
        <div className="flex items-baseline justify-between">
          <span className="pill pill-denim">{t('live measurements')}</span>
          <span className="font-mono text-[10px] text-[var(--smoke)]">{t('auto')}</span>
        </div>
        <textarea readOnly value={liveMeasurementsJson} className="input-soft w-full rounded-xl p-3 font-mono text-[11px] leading-snug resize-none h-40 focus:outline-none" style={{ fontStyle: 'normal' }} />
      </div>
      <div className="flex flex-col gap-3 pt-4 border-t border-dashed border-[var(--char)]/20">
        <span className="pill pill-tomato">{t('take it to your barber')}</span>
        <button disabled className="btn btn-cream opacity-40 cursor-not-allowed" style={{ padding: '10px 16px', fontSize: 13 }}>📜 {t('Barber’s order')}</button>
      </div>
      <div className="mt-auto pt-4 border-t border-dashed border-[var(--char)]/20 font-mono text-[10px] text-[var(--smoke)] flex items-center justify-between">
        <span>{t('preset')} · <span className="text-[var(--ink)]">{profile.currentStyle.preset}</span></span>
        <span>{t('type')} · <span className="text-[var(--ink)]">{profile.currentStyle.hairType}</span></span>
      </div>
    </div>
  );
}

// Decode a base64 data: URL to a Blob without fetch(). fetch() on a data: URL
// is a "connect" and is blocked by our CSP (connect-src has no data:), which
// silently killed the edit-image upload — see onImageUpdated.
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const header = dataUrl.slice(0, comma);
  const mime = header.match(/data:([^;]+)/)?.[1] ?? 'image/png';
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Desktop top offset (shared by the render frame and the toolbox column so their
// tops line up below the project title) and the edit-panel width live in
// studioLayout, which the dashboard → studio ghost handoff also draws from.

export default function StudioPage() {
  const t = useT();
  const { isSignedIn } = useUser();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const projectId = params.projectId as Id<'projects'>;
  const { renderQuality } = useSettings();
  const isMobile = useIsMobile();
  // Stacked (phone) layout on a short screen — e.g. a desktop zoomed far in, which
  // shrinks the viewport in CSS px. Nothing fits in one screen there, so the page
  // scrolls: a decent-size render on top, the full toolbox below it.
  const shortScreen = useMediaQuery(SHORT_SCREEN_QUERY);
  const mobileScroll = isMobile && shortScreen;

  const saveProject = useMutation(api.projects.save);
  const project = useQuery(api.projects.get, { projectId });
  const userQuery = useQuery(api.users.getMe);
  const isAllowlisted = useQuery(api.users.isAllowlisted) ?? false;
  const feedbackPrompt = useFeedbackPrompt();
  const [paywallDisabled, setPaywallDisabled] = useState(FREE_MODE);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [showPricing, setShowPricing] = useState(false);

  useEffect(() => {
    fetch('/api/config').then(r => r.json()).then(d => setPaywallDisabled(d.paywallDisabled ?? false)).catch(() => {});
  }, []);

  useEffect(() => {
    if (searchParams.get('payment') === 'success') {
      setPaymentSuccess(true);
      track('purchase_completed', { source: 'studio' });
      router.replace(`/studio/${projectId}`);
    }
  }, [searchParams, projectId, router]);

  const [initialized, setInitialized] = useState(false);
  const [profile, setProfile] = useState<UserHeadProfile | null>(null);
  const [hairParams, setHairParams] = useState<HairParams>(mockUserHeadProfile.currentStyle.params);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [displayImageUrl, setDisplayImageUrl] = useState<string | null>(null);
  const [polaroidImgError, setPolaroidImgError] = useState(false);
  const [editSaveError, setEditSaveError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [persistedSplatUrl, setPersistedSplatUrl] = useState<string | null>(null);
  const [splatMeta, setSplatMeta] = useState<SplatMeta | null>(null);
  const [hairstepPlyUrl, setHairstepPlyUrl] = useState<string | null>(null);
  const [editSplatSrc, setEditSplatSrc] = useState<string | null>(null);
  // Quick try-ons: a buzz-cut base (+ optional prebaked style) shown instead of the head.
  const [tryOnView, setTryOnView] = useState<TryOnView | null>(null);
  // Its toggle lives in the toolbox's action row; its style picker in the viewport.
  const tryOns = useQuickTryOns({
    projectId,
    imageUrl,
    baseSplatS3Key: project?.tryOnBaseSplatS3Key,
    baseMetaS3Key: project?.tryOnBaseMetaS3Key,
    onViewChange: setTryOnView,
    resetSignal: editSplatSrc,
    // Calibration (PrebakeCalibration sliders) is hidden for now: the fits are
    // baked into src/data/prebakeTransforms.ts. To bring it back: pass
    // calibrate: useQuery(api.users.amIAdmin) ?? false and mount
    // <PrebakeCalibration state={tryOns} /> under the list.
    calibrate: false,
  });
  const [previewPlyUrl, setPreviewPlyUrl] = useState<string | null>(null);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [editLoopPrompt, setEditLoopPrompt] = useState('');
  const [previewExpanded, setPreviewExpanded] = useState(false);
  // Mobile-only: swipe the "you" polaroid up (or tap its tab) to tuck it away,
  // leaving a small down-arrow tab at the render's top-left corner to bring it back.
  const [polaroidHidden, setPolaroidHidden] = useState(false);
  const polaroidTouchStartY = useRef(0);
  const [sceneBackground, setSceneBackground] = useState(() => {
    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    return isDark
      ? 'url(/preview_bg_dark.jpg) center / 100% 100% no-repeat'
      : 'url(/preview_bg.jpg) center / 100% 100% no-repeat';
  });
  // CSS-mode brightness for non-default backgrounds: 0.5 → brightness(1.0) filter, bypasses Three.js color-space overlay.
  // undefined = Three.js mode (keeps the pleasant lightening on preview_bg.jpg).
  const [sceneBgBrightness] = useState<number | undefined>(() => {
    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    return isDark ? 0.5 : undefined;
  });
  const [menuHidden, setMenuHidden] = useState(false);
  const [splatReady, setSplatReady] = useState(false);
  // 'ghost' = BuildGhost visible; 'revealing' = wipe animation; 'done' = ghost gone
  const [revealPhase, setRevealPhase] = useState<'ghost' | 'revealing' | 'done'>('done');
  // Drives the splat-only reveal inside the WebGL scene (0 hidden … 1 shown, null = normal).
  // The scene background stays visible throughout; only the render fades in.
  const splatRevealRef = useRef<number | null>(null);
  useEffect(() => {
    if (revealPhase === 'ghost') { splatRevealRef.current = 0; return; }
    if (revealPhase === 'done') { splatRevealRef.current = null; return; }
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      splatRevealRef.current = 1;
      return;
    }
    const REVEAL_MS = 1200;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / REVEAL_MS);
      splatRevealRef.current = revealEase(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [revealPhase]);
  const [thumbnailCaptureKey, setThumbnailCaptureKey] = useState(0);
  const [polaroidKey, setPolaroidKey] = useState(0);

  // ── Barber video (360° splat clip) ──────────────────────────
  const [videoCaptureKey, setVideoCaptureKey] = useState(0);
  const [videoCancelKey, setVideoCancelKey] = useState(0);
  const [videoState, setVideoState] = useState<'idle' | 'recording' | 'encoding' | 'ready' | 'error'>('idle');
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoExt, setVideoExt] = useState<'mp4' | 'webm'>('mp4');

  const requestBarberVideo = useCallback(() => {
    setVideoUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    setVideoProgress(0);
    setVideoState('recording');
    setVideoCaptureKey(k => k + 1);
  }, []);

  const handleVideoProgress = useCallback((p: number) => {
    setVideoProgress(p);
    if (p >= 1) setVideoState('encoding');
  }, []);

  const handleVideoReady = useCallback((blob: Blob, ext: string) => {
    const url = URL.createObjectURL(blob);
    setVideoUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
    setVideoExt(ext === 'webm' ? 'webm' : 'mp4');
    setVideoState('ready');
    feedbackPrompt.registerMilestone(); // exporting a barber clip is a high-intent success moment
  }, [feedbackPrompt]);

  const handleVideoError = useCallback((err: unknown) => {
    console.error('[studio] barber video capture failed:', err);
    setVideoState('error');
  }, []);

  // The 360° clip is recorded from the live splat, so re-editing the hair makes
  // any existing video stale (it still shows the old hairstyle). Drop it back to
  // idle on a new splat so the user re-films against the current hairstyle.
  const resetBarberVideo = useCallback(() => {
    setVideoUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    setVideoProgress(0);
    setVideoState('idle');
  }, []);

  // Cancel a 360° capture that's under way: the recorder stops, restores the
  // camera and reports nothing; the card goes back to idle.
  const cancelBarberVideo = useCallback(() => {
    setVideoCancelKey(k => k + 1);
    resetBarberVideo();
  }, [resetBarberVideo]);

  // Release the object URL on unmount.
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  // ── Toolbox auto-fit ────────────────────────────────────────
  // The toolbox column sits a comfortable distance down the page (a big top
  // padding) so the card breathes when it's the only thing there. Once the 360°
  // preview drops in, the column would overflow its max-height and the preview's
  // bottom gets clipped — forcing a scroll. Instead, we smoothly lerp the top
  // padding *down* by exactly the overflow so the whole stack rides up and the
  // preview's bottom lands flush with the bottom of the scene. No scroll needed.
  const toolboxAsideRef = useRef<HTMLElement | null>(null);
  // Desktop edit panel width, dragged from the divider on its left edge. The
  // aside is resized directly during the drag so the 3D view re-fits live, and
  // the final width is saved to the user's account (and cached per browser).
  const setStudioLayout = useMutation(api.users.setStudioLayout);
  const { size: sidebarWidth, handleProps: sidebarResizeHandle } = useDragSize({
    storageKey: STUDIO_SIDEBAR.key, initial: STUDIO_SIDEBAR.initial, min: STUDIO_SIDEBAR.min, max: STUDIO_SIDEBAR.max, axis: 'x', invert: true,
    liveRef: toolboxAsideRef, liveProperty: 'width',
    remoteValue: userQuery?.studioLayout?.sidebarWidth,
    onCommit: (sidebarWidth) => { void setStudioLayout({ sidebarWidth }).catch(() => {}); },
  });
  // Inner content wrapper inside the aside. We measure THIS (not the padded
  // aside) so the height we read is independent of the paddingTop we animate.
  const toolboxContentRef = useRef<HTMLDivElement | null>(null);

  // Toolbox arrival: when the loading shadow lifts, the toolbox's blocks fade in
  // top → bottom one after another (see lib/toolboxArrive) instead of popping in.
  // Layout effect: the tags must be on the elements BEFORE the first visible
  // paint, or that frame shows the finished panel and the animation then
  // restarts from zero — which reads as a pop.
  const prevRevealForArrive = useRef(revealPhase);
  useLayoutEffect(() => {
    const prev = prevRevealForArrive.current;
    prevRevealForArrive.current = revealPhase;
    if (prev !== 'ghost' || revealPhase === 'ghost') return;
    const root = toolboxContentRef.current;
    if (!root) return;
    // The barber card may be docked over the render (a body portal): sweep it too, where it sits.
    const card = document.querySelector('[data-barber-card]');
    return stageArrive([root], card && !root.contains(card) ? [card] : []);
  }, [revealPhase]);
  // Expose the phase on <html> so portaled pieces (the docked barber card) can hide during the shadow.
  useLayoutEffect(() => {
    const html = document.documentElement;
    html.dataset.studioPhase = revealPhase;
    return () => { delete html.dataset.studioPhase; };
  }, [revealPhase]);
  // Mobile: a small, fixed gap between the render and the toolbox card.
  const MOBILE_TOOLBOX_PAD = 10;
  const TOOLBOX_BASE_PAD = isMobile ? MOBILE_TOOLBOX_PAD : studioTopPad(typeof window !== 'undefined' ? window.innerHeight : 0);
  const TOOLBOX_MIN_PAD = isMobile ? MOBILE_TOOLBOX_PAD : 16;
  // A little breathing room so the fitted stack rides slightly lower than dead
  // flush with the scene bottom, rather than jammed all the way up.
  const TOOLBOX_FIT_OFFSET = isMobile ? 2 : 2;
  const [toolboxPadTop, setToolboxPadTop] = useState(TOOLBOX_BASE_PAD);
  const projectLoaded = project !== undefined;

  useLayoutEffect(() => {
    const aside = toolboxAsideRef.current;
    const content = toolboxContentRef.current;
    if (!aside || !content) return;
    const basePad = isMobile ? MOBILE_TOOLBOX_PAD : studioTopPad(window.innerHeight);
    const recompute = () => {
      // Solve for the largest paddingTop (capped at base) that keeps the whole
      // stack within the column's max-height. We measure the inner content
      // wrapper's own height — which the aside's animating paddingTop does NOT
      // affect — plus the aside's bottom padding. Measuring the *padded* aside
      // instead would feed the live (animating) padding back into the next
      // target every ResizeObserver tick, restarting the 420ms transition each
      // frame and walking the padding up pixel-by-pixel. With the wrapper the
      // observer only fires on real content changes (e.g. the clip loading), so
      // the CSS transition runs as one clean lerp. The +OFFSET nudges it lower.
      const availHeight = isMobile ? window.innerHeight * 0.52 : window.innerHeight - 12;
      const padBottom = parseFloat(getComputedStyle(aside).paddingBottom) || 0;
      const contentNoPad = content.offsetHeight + padBottom;
      const target = Math.max(TOOLBOX_MIN_PAD, Math.min(basePad, availHeight - contentNoPad + TOOLBOX_FIT_OFFSET));
      // Ignore sub-pixel churn so we never re-fire the transition for noise.
      setToolboxPadTop(prev => Math.abs(target - prev) > 0.5 ? target : prev);
    };
    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(content);
    window.addEventListener('resize', recompute);
    return () => { ro.disconnect(); window.removeEventListener('resize', recompute); };
    // videoState/videoUrl drive the content height; re-run when they change.
    // projectLoaded: the toolbox only mounts once the project is in. Without it
    // the effect ran (and bailed) before the aside existed and never ran again,
    // leaving the first render's padding in place: on phones the desktop value
    // (~84px), because the first render doesn't know it's a phone yet.
  }, [isMobile, videoState, videoUrl, TOOLBOX_MIN_PAD, TOOLBOX_FIT_OFFSET, projectLoaded]);

  // Default trending-list height. Desktop: whatever lines the bottom of the lowest
  // toolbox card up with the bottom of the render frame (used only while the user
  // has no saved height). Mobile: whatever keeps the whole toolbox, down to the
  // "Show your barber" buttons, above the bottom of the screen (always used there).
  const [cutListFitHeight, setCutListFitHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (menuHidden) return;
    const frame = canvasFrameRef.current;
    const content = toolboxContentRef.current;
    if (!frame || !content) return;
    const MOBILE_BOTTOM_GAP = 16 + 8; // the column's pb-4 + a little air
    const MOBILE_MIN_LIST = 96; // never fewer than ~2 rows
    const fit = () => {
      const list = content.querySelector<HTMLElement>('.cut-list-scroll');
      if (!list) return;
      const bottom = isMobile ? window.innerHeight - MOBILE_BOTTOM_GAP : frame.getBoundingClientRect().bottom;
      const gap = bottom - content.getBoundingClientRect().bottom;
      if (Math.abs(gap) < 1) return;
      const h = Math.round(list.offsetHeight + gap);
      setCutListFitHeight(isMobile ? Math.max(MOBILE_MIN_LIST, h) : h);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(frame);
    ro.observe(content);
    window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, [isMobile, menuHidden, revealPhase]);


  const sceneControlsEnabled = process.env.NEXT_PUBLIC_SCENE_CONTROLS !== '0';
  const { adoptHandoff, releaseHandoff } = useGhostHandoff();
  // The rounded canvas frame — the carried ghost settles into its rect.
  const canvasFrameRef = useRef<HTMLDivElement>(null);

  // Redirect if signed out
  useEffect(() => {
    if (isSignedIn === false) router.push('/');
  }, [isSignedIn, router]);


  // Read transient sessionId from sessionStorage (set by dashboard after scan)
  useEffect(() => {
    const sid = sessionStorage.getItem('studio_sessionId');
    if (sid) { setSessionId(sid); sessionStorage.removeItem('studio_sessionId'); }
    const splatFromSession = sessionStorage.getItem('studio_splatUrl');
    if (splatFromSession) { setPersistedSplatUrl(splatFromSession); sessionStorage.removeItem('studio_splatUrl'); }
  }, []);

  // Initialize from Convex project once loaded. A layout effect: the studio
  // mounts with the project, and the loading shadow (revealPhase 'ghost') must
  // be committed before the first paint, or the real panel flashes in first.
  useLayoutEffect(() => {
    if (!project || initialized) return;
    setInitialized(true);
    if (project.lastProfile) setProfile(project.lastProfile as UserHeadProfile);
    if (project.lastHairParams) setHairParams(project.lastHairParams as HairParams);
    const imageS3Key = (project as { lastImageS3Key?: string }).lastImageS3Key;
    if (imageS3Key) {
      // Prefer a freshly-generated URL from the permanent S3 key over the stored
      // presigned URL, which may have expired (presigned URLs last 7 days).
      setImageUrl(`/api/img?key=${encodeURIComponent(imageS3Key)}`);
    } else if (project.lastImageUrl) {
      setImageUrl(project.lastImageUrl);
    }
    const editImageS3Key = (project as { lastEditImageS3Key?: string }).lastEditImageS3Key;
    if (editImageS3Key) {
      setDisplayImageUrl(`/api/img?key=${encodeURIComponent(editImageS3Key)}`);
    }
    const splatS3Key = (project as { splatS3Key?: string }).splatS3Key;
    if (splatS3Key) {
      setPersistedSplatUrl(`/api/splat?key=${encodeURIComponent(splatS3Key)}`);
    } else {
      const savedSplat = (project as { lastSplatUrl?: string }).lastSplatUrl;
      if (savedSplat) setPersistedSplatUrl(savedSplat);
    }
    // If the project is building or already failed, show the ghost overlay. An
    // already-built head also shows it (as a plain loading shadow) while its
    // splat streams in, then gets the same reveal.
    const bState = resolveBuildState(project);
    const hasHead = !!splatS3Key || !!(project as { lastSplatUrl?: string }).lastSplatUrl;
    if (bState === 'building' || bState === 'failed' || hasHead) setRevealPhase('ghost');
  }, [project, initialized]);

  // Safety net for the loading shadow: if an already-built head never reports
  // loaded (network error), don't leave the shadow up forever.
  useEffect(() => {
    if (revealPhase !== 'ghost' || buildState === 'building' || buildState === 'failed') return;
    const t = setTimeout(() => setRevealPhase(p => (p === 'ghost' ? 'done' : p)), 20000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealPhase]);

  // Take over the carried ghost (see GhostHandoff): once the project is in and
  // this page's own BuildGhost is mounted, settle the overlay into the canvas
  // frame and fade it out. Runs after the init effect above, so revealPhase
  // (and therefore the ghost) is already committed.
  useEffect(() => {
    if (!initialized) return;
    const raf = requestAnimationFrame(() => {
      const el = canvasFrameRef.current;
      const r = el?.getBoundingClientRect();
      const radius = el ? parseFloat(getComputedStyle(el).borderRadius) || 0 : 0;
      adoptHandoff(r && r.width > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height, radius } : undefined);
    });
    return () => cancelAnimationFrame(raf);
  }, [initialized, adoptHandoff]);
  // Project missing: nothing to hand off to.
  useEffect(() => { if (project === null) releaseHandoff(); }, [project, releaseHandoff]);

  // React to the LATER arrival of splatS3Key when the async build completes.
  // The one-shot `initialized` guard above can't catch this because it already ran.
  const projectSplatKey = project?.splatS3Key;
  useEffect(() => {
    if (!initialized || !projectSplatKey || persistedSplatUrl) return;
    // Build just completed — set the persisted URL and start the reveal.
    setPersistedSplatUrl(`/api/splat?key=${encodeURIComponent(projectSplatKey)}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSplatKey, initialized]);

  // Sidecar meta.json (viewer transform + provenance) the worker writes next to
  // the splat. Optional: heads built before it existed have none and use the
  // viewer's built-in constants.
  const projectMetaKey = (project as { metaS3Key?: string } | null | undefined)?.metaS3Key;
  useEffect(() => {
    if (!projectMetaKey) { setSplatMeta(null); return; }
    let cancelled = false;
    fetch(`/api/splat?key=${encodeURIComponent(projectMetaKey)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!cancelled) setSplatMeta(parseSplatMeta(j)); })
      .catch(() => { if (!cancelled) setSplatMeta(null); });
    return () => { cancelled = true; };
  }, [projectMetaKey]);

  // The polaroid's error flag is shared by the loading screen and the main
  // studio view. A transient miss on the loading screen (S3 not yet warm) would
  // otherwise stick the flag true and leave the main polaroid on the mascot
  // fallback forever. Re-arm it whenever the source image resolves/changes so
  // the real selfie gets a fresh load attempt.
  useEffect(() => {
    setPolaroidImgError(false);
  }, [imageUrl, displayImageUrl]);

  const buildState = resolveBuildState(project);

  // Gate the auto-builder: a building or failed project must not kick off a second build.
  const { splatSrc, splatKey, status: demoStatus } = useDemoFacelift(
    persistedSplatUrl || buildState === 'building' || buildState === 'failed' ? null : imageUrl
  );
  const effectiveSplatUrl = persistedSplatUrl ?? splatSrc;

  // Promote splatSrc to persisted once done
  useEffect(() => {
    if (!splatSrc || !projectId) return;
    if (splatKey) {
      setPersistedSplatUrl(`/api/splat?key=${encodeURIComponent(splatKey)}`);
      saveProject({ projectId, splatS3Key: splatKey }).catch(() => {});
    } else {
      setPersistedSplatUrl(splatSrc);
      saveProject({ projectId, lastSplatUrl: splatSrc }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splatSrc, splatKey, projectId]);

  // Track when splat becomes ready so we can switch to studio view
  useEffect(() => {
    if (effectiveSplatUrl) setSplatReady(true);
  }, [effectiveSplatUrl]);

  // When the ghost was showing (async build) and the splat starts rendering,
  // run the reveal wipe. Also handles the normal studio entry path.
  const handleSplatLoaded = useCallback(() => {
    setRevealPhase(prev => {
      if (prev === 'ghost') {
        // Start wipe, then remove ghost after animation finishes.
        setTimeout(() => setRevealPhase('done'), 1600);
        return 'revealing';
      }
      return prev;
    });
  }, []);

  // Re-dispatch the async build for a failed project.
  // Fetches the scan image, converts to data URL, and POSTs async facelift.
  const handleRetryBuild = useCallback(async () => {
    const lastImageS3Key = project?.lastImageS3Key;
    if (!lastImageS3Key || !projectId) return;
    try {
      const imgRes = await fetch(`/api/img?key=${encodeURIComponent(lastImageS3Key)}`);
      const blob = await imgRes.blob();
      const imageDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const { getVisitorId } = await import('@/lib/visitorId');
      const fingerprint = await getVisitorId();
      const res = await fetch('/api/facelift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageDataUrl, fingerprint, projectId, async: true }),
      });
      if (res.ok || res.status === 202) {
        // Build kicked off — Convex subscription will push buildStatus → 'building'
        setRevealPhase('ghost');
      }
    } catch (err) {
      console.error('[studio] retry build failed:', err);
    }
  }, [project, projectId]);

  // New accounts get the feedback prompt as soon as their first render shows —
  // the initial model render counts as their first "edit". Fires once per mount,
  // and only once the feedback state has loaded so the new-account check is real.
  const initialRenderFeedbackRef = useRef(false);
  useEffect(() => {
    if (!effectiveSplatUrl || initialRenderFeedbackRef.current || !feedbackPrompt.isReady) return;
    initialRenderFeedbackRef.current = true;
    feedbackPrompt.registerInitialRender();
  }, [effectiveSplatUrl, feedbackPrompt.isReady, feedbackPrompt.registerInitialRender]);

  // Token-refund reminder. `refundIsReminder` marks the proactive, acknowledgment-
  // required notice shown once per project after the model first loads; false is
  // the casual dialog opened from the "not happy?" link.
  const [showRefund, setShowRefund] = useState(false);
  const [refundIsReminder, setRefundIsReminder] = useState(false);
  useEffect(() => {
    if (FREE_MODE) return; // no token-refund concept while everything is free
    if (!effectiveSplatUrl || !projectId) return;
    if (localStorage.getItem(`refundReminderSeen_${projectId}`)) return;
    const t = setTimeout(() => {
      localStorage.setItem(`refundReminderSeen_${projectId}`, '1');
      setRefundIsReminder(true);
      setShowRefund(true);
    }, 2500);
    return () => clearTimeout(t);
  }, [effectiveSplatUrl, projectId]);

  // Thumbnail capture is gated inside HairScene on the splat being fully
  // loaded and revealed (no blind timer). Projects still carrying a legacy
  // thumbnail (a baked-backdrop JPEG, or a pre-WebP PNG) recapture once on open;
  // the upload route stores the new one as WebP.
  const storedThumbnailKey = project?.thumbnailS3Key;
  const legacyRecaptured = useRef<string | null>(null);
  useEffect(() => {
    if (!isLegacyThumbnailKey(storedThumbnailKey)) return;
    if (legacyRecaptured.current === storedThumbnailKey) return;
    legacyRecaptured.current = storedThumbnailKey!;
    setThumbnailCaptureKey(k => k + 1);
  }, [storedThumbnailKey]);

  // When arriving from the dashboard's "Show my barber a 360°" picker, show a
  // "waiting for the render" gate instead of auto-firing on a blind timer: the
  // user watches the splat load and presses "All ready!" to start the 360 sweep
  // the moment it looks right. The flag is a one-shot sessionStorage handoff
  // set right before navigation (mirrors studio_splatUrl).
  const autoBarberConsumed = useRef(false);
  const [autoBarberPending, setAutoBarberPending] = useState(false);
  useEffect(() => {
    if (autoBarberConsumed.current || !effectiveSplatUrl) return;
    if (typeof window === 'undefined' || sessionStorage.getItem('studio_autoBarber') !== '1') return;
    autoBarberConsumed.current = true;
    sessionStorage.removeItem('studio_autoBarber');
    setAutoBarberPending(true);
  }, [effectiveSplatUrl]);

  const handleAutoBarberReady = useCallback(() => {
    setAutoBarberPending(false);
    requestBarberVideo();
  }, [requestBarberVideo]);

  // Auto-save every 30s
  useEffect(() => {
    if (!projectId || !imageUrl) return;
    const t = setInterval(async () => {
      try {
        const profileToSave = profile ? {
          ...profile,
          faceScanData: profile.faceScanData ? { ...profile.faceScanData, imageDataUrl: undefined } : profile.faceScanData,
        } : undefined;
        await saveProject({
          projectId,
          lastHairParams: hairParams,
          lastProfile: profileToSave,
          lastImageUrl: imageUrl,
        });
      } catch { /* silent */ }
    }, 30_000);
    return () => clearInterval(t);
  }, [projectId, hairParams, profile, imageUrl, saveProject]);

  const handleParamsChange = useCallback((next: HairParams) => {
    setHairParams(next);
    setProfile(prev => prev ? {
      ...prev,
      currentStyle: { ...prev.currentStyle, params: next },
      measurementSnapshot: buildHairMeasurementSnapshot({
        source: 'derived_params',
        baselineMeasurements: prev.hairMeasurements,
        params: next,
        revision: (prev.measurementSnapshot?.revision ?? 0) + 1,
        bbox: prev.measurementSnapshot?.bbox,
      }),
    } : prev);
  }, []);

  const handleHairBBoxReady = useCallback((bbox: RawHairBBox) => {
    setProfile(prev => prev ? {
      ...prev,
      measurementSnapshot: buildHairMeasurementSnapshot({
        source: 'mesh_bbox',
        baselineMeasurements: prev.hairMeasurements,
        params: prev.currentStyle.params,
        revision: (prev.measurementSnapshot?.revision ?? 0) + 1,
        bbox,
      }),
    } : prev);
  }, []);

  const handleThumbnailReady = useCallback(async (dataUrl: string) => {
    if (!projectId || !dataUrl || !dataUrl.startsWith('data:image/')) return;
    try {
      const [header, b64] = dataUrl.split(',');
      const mime = header.match(/:(.*?);/)?.[1] ?? 'image/jpeg';
      const bytes = atob(b64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const blob = new Blob([arr], { type: mime });
      console.log('[thumbnail] captured blob size:', blob.size);
      if (blob.size < 2048) { console.warn('[thumbnail] blob too small, skipping'); return; }
      const res = await fetch('/api/upload-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': mime },
        body: blob,
      });
      if (!res.ok) { console.error('[thumbnail] upload failed:', res.status, await res.text()); return; }
      const { key } = await res.json() as { key?: string };
      if (!key || typeof key !== 'string') { console.error('[thumbnail] no key in upload response'); return; }
      console.log('[thumbnail] saving key to project:', key);
      await saveProject({ projectId, thumbnailS3Key: key });
      console.log('[thumbnail] saved OK');
    } catch (err) { console.error('[thumbnail] non-fatal error:', err); }
  }, [projectId, saveProject]);

  // Show project-not-found state
  if (project === null) {
    return (
      <main className="fixed inset-0 flex items-center justify-center bg-tomato-shop">
        <div className="text-center text-[var(--cream)]">
          <p className="font-mono text-sm opacity-60">{t('Project not found')}</p>
          {/* Tomato with white text in both themes (btn-cream went white-on-white in dark mode). */}
          <button onClick={() => router.push('/dashboard')} className="mt-4 btn btn-tomato btn-calm" style={{ padding: '10px 24px', fontSize: 13, fontWeight: 700, color: '#fff' }}>
            ← Dashboard
          </button>
        </div>
      </main>
    );
  }

  const faceliftReady = splatReady && !!effectiveSplatUrl;
  // While the loading shadow is up, every piece of chrome (title, polaroid,
  // toolbox) holds a skeleton shape; when the head is revealed they all mist in
  // together. `studio-shell` hides a wrapper's children behind a pulsing block.
  const revealClass = revealPhase === 'ghost' ? 'studio-shell' : 'studio-mist-in';

  // Hair edit loop view (waiting for splat, or splat is ready — we stay here until user submits a prompt)
  if (!faceliftReady || (faceliftReady && editLoopPrompt === '' && !splatReady)) {
    // Show loading/preview while building
  }

  // ── Hair edit loop (sync splat building — not used for async builds) ──
  // For async builds (buildState building/failed), fall through to the studio
  // so the BuildGhost renders in context of the real layout.
  // Also skipped the moment a head URL exists: `splatReady` only catches up an
  // effect later, and that one frame used to flash this light loader before
  // the studio's loading shadow.
  if (!faceliftReady && imageUrl && !effectiveSplatUrl && buildState !== 'building' && buildState !== 'failed') {
    return (
      <main className={`fixed inset-0 overflow-hidden flex ${isMobile ? 'flex-col' : ''}`} style={{ background: '#1e1e1e' }}>
        <div className="absolute top-5 left-6 z-20 flex items-center gap-3">
          <LogoHomeLink cream small label="Back to home" onClick={() => router.push('/dashboard')} />
        </div>
        <div className="flex-1 min-w-0 relative" style={{ backgroundImage: 'url(/preview_bg.jpg)', backgroundSize: 'cover', backgroundPosition: 'center', zIndex: 1 }}>
          <div className={`w-full h-full flex flex-col items-center justify-center ${isMobile ? 'gap-4 p-4 pt-20' : 'gap-8 p-8'}`}>
            <div
              className={`polaroid ${previewExpanded ? '' : 'wonky-sm-l'}`}
              style={{
                width: previewExpanded ? 'min(60vh, 54vw)' : (isMobile ? 'min(260px, 72vw)' : '340px'),
                transition: 'width 0.4s cubic-bezier(0.34, 1.2, 0.64, 1)',
                cursor: previewExpanded ? 'zoom-out' : 'zoom-in',
              }}
              onClick={() => setPreviewExpanded(v => !v)}
            >
              <div className="tape tape-tl" />
              <div className="tape tape-tr" />
              <div className="relative overflow-hidden rounded-sm" style={{ background: '#1c1510', aspectRatio: '1' }}>
                {!polaroidImgError ? (
                  <Image src={imageUrl} alt="Your scan" fill className="object-cover" unoptimized onError={() => setPolaroidImgError(true)} />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center" style={{ opacity: 0.18 }}>
                    <div style={{ width: 60 }}><BarberMascot isStatic /></div>
                  </div>
                )}
              </div>
              <div className="absolute bottom-3 left-0 right-0 text-center">
                <span className="font-display text-[var(--char)] text-lg" style={{ fontStyle: 'italic', fontWeight: 500 }}>{t('you')} ✂</span>
              </div>
            </div>
            <FaceliftLoader demoStatus={demoStatus} />
          </div>
        </div>
        <aside className={`flex flex-col p-4 gap-4 relative overflow-hidden ${isMobile ? 'w-full flex-shrink-0 max-h-[48vh]' : 'w-80 flex-shrink-0 self-start h-[70vh]'}`}>
          <div className="flex items-center justify-end">
            <div className="flex items-center gap-2">
              <button disabled className="btn-ink opacity-40 cursor-not-allowed" style={{ padding: '6px 12px', fontSize: 10 }}>✦ Recommend</button>
              <button onClick={() => router.push('/dashboard')} className="btn-tomato" style={{ padding: '11px 22px', fontSize: 18, borderRadius: 20, outline: '2px solid #ffffff', outlineOffset: 2, color: '#ffffff', boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.1)' }}>✂ Home</button>
            </div>
          </div>
          <div className="flex-1 overflow-hidden rounded-2xl" style={{ background: 'var(--biscuit-lt)', border: '1px solid rgba(42,32,26,0.1)', boxShadow: '0 30px 60px -24px rgba(0,0,0,0.45)' }}>
            <DemoToolbox
              profile={profile ?? mockUserHeadProfile}
              prompt={editLoopPrompt}
              onPromptChange={setEditLoopPrompt}
              onSubmit={() => { if (editLoopPrompt.trim()) setSplatReady(true); }}
            />
          </div>
        </aside>
      </main>
    );
  }

  // ── Loading placeholder while project data loads ──
  if (!imageUrl && project === undefined) {
    return <main className="fixed inset-0 bg-tomato-shop" />;
  }

  // ── 3D Studio ──
  return (
    <main className={`fixed inset-0 ${mobileScroll ? 'overflow-y-auto overflow-x-hidden' : 'overflow-hidden'} bg-tomato-shop flex ${isMobile ? 'flex-col' : ''}`}>
      {/* Scrolling short screens: the header is in the page flow (not overlaid), so the
          render starts below it however large zoomed text gets; name centred on the icon. */}
      <div className={`z-20 flex items-center ${mobileScroll ? 'studio-header-short relative flex-shrink-0 px-4 pt-3 pb-1 min-w-0 max-w-full' : isMobile ? 'absolute top-3 left-4 max-w-[56vw] min-w-0' : 'absolute top-3.5 left-6'}`}>
        <LogoHomeLink
          cream
          small
          label="Back to home"
          onClick={() => router.push('/dashboard')}
          homeIcon={isMobile}
          textScale={isMobile ? 1.2 : 1}
          // No "ShapeUp" wordmark in the studio; on mobile the slot holds the project name.
          wordmarkSlot={project && isMobile ? <span className={`studio-mobile-title relative inline-block min-w-0 ${revealClass}`} style={{ ['--shell-radius' as string]: '9999px' }}><ProjectNameEditor projectId={projectId} name={project.name} compact /></span> : null}
        />
      </div>

      {isMobile && !FREE_MODE && (
        <div className="absolute top-4 right-3 z-30 flex items-center gap-2">
          <span
            className="flex items-center gap-1 px-2.5 py-1 rounded-full font-mono text-sm"
            title={!userQuery?.topPlan ? t('Includes {n} free/month · resets monthly, unused don\'t roll over', { n: 3 }) : undefined}
            style={{
              background: (userQuery?.availableGenerations ?? 0) > 0 ? 'rgba(255,248,234,0.12)' : 'rgba(217,78,58,0.25)',
              border: (userQuery?.availableGenerations ?? 0) > 0 ? '1px solid rgba(255,248,234,0.2)' : '1px solid rgba(217,78,58,0.5)',
              color: (userQuery?.availableGenerations ?? 0) > 0 ? 'var(--cream)' : 'var(--butter)',
            }}
          >
            <img src="/shapeup_token.webp" alt="token" draggable={false} style={{ width: '1.7em', height: '1.7em', borderRadius: '50%', display: 'inline-block', verticalAlign: '-0.5em', boxShadow: '0 0 0 1px rgba(42,32,26,0.22)' }} /> <ClockCounter value={userQuery?.availableGenerations ?? 0} />
          </span>
          <AddTokensButton onClick={() => setShowPricing(true)} />
        </div>
      )}

      {/* Project name as the centred title (desktop); click it to rename. Spans the
          full width (not anchored at 50%) so a long name gets the whole row before
          it truncates; only the name itself takes clicks. */}
      {!isMobile && project && (
        // Fills the band above the render frame / toolbox (same top offset), so the
        // name sits vertically centred between the screen top and those windows.
        <div className="absolute top-0 inset-x-0 z-10 flex items-center justify-center pointer-events-none" style={{ height: STUDIO_TOP_PAD_CSS }}>
          <div className={`pointer-events-auto min-w-0 relative ${revealClass}`} style={{ ['--shell-radius' as string]: '9999px' }}>
            <ProjectNameEditor projectId={projectId} name={project.name} title />
          </div>
        </div>
      )}

      <div className={`min-w-0 relative flex items-center justify-center ${isMobile ? (mobileScroll ? 'flex-shrink-0 p-2' : 'h-[46vh] flex-shrink-0 p-2 pt-20') : 'flex-1 p-6'}`}
        // Desktop: same top offset as the toolbox column (TOOLBOX_BASE_PAD), so the
        // render frame and the first sidebar card start on one line; and a 16px
        // left gutter to match the toolbox's 16px right gutter (px-4).
        style={isMobile ? (mobileScroll ? { height: MOBILE_SHORT_REGION_CSS } : undefined) : { paddingTop: STUDIO_TOP_PAD_CSS, paddingLeft: 16 }}>
        {(() => {
          const displayImg = displayImageUrl ?? imageUrl;
          const polaroidEl = (
          <div
            className={`absolute z-10 polaroid studio-polaroid ${isMobile ? 'top-0 left-0' : ''} ${previewExpanded ? 'studio-polaroid--big' : 'wonky-l'}`}
            style={{
              // `.polaroid` sets position:relative (unlayered, beats the Tailwind
              // `absolute` class), which would put the polaroid in-flow and steal a
              // column. Force absolute on mobile so it overlays the scene's corner
              // and the render fills the full width.
              ...(isMobile ? { position: 'absolute' as const } : {}),
              // Thin outline on the unexpanded polaroid (mobile) so it reads as a
              // tappable profile button against the render behind it.
              ...(isMobile && !previewExpanded ? { outline: '1px solid rgba(42,32,26,0.35)', outlineOffset: 0 } : {}),
              width: previewExpanded ? 'min(55vh, 46vw)' : (isMobile ? (mobileScroll ? MOBILE_SHORT_POLAROID_CSS : 156) : 100),
              // Enlarged: keep the small polaroid's roundness (24px on 100px = 24% of
              // its width) on the three free corners; see .studio-polaroid--big.
              ...(previewExpanded ? { ['--polaroid-r' as string]: 'calc(min(55vh, 46vw) * 0.24)' } : {}),
              padding: '6px 6px 22px',
              pointerEvents: 'auto' as const,
              // Ease the width out without overshoot (a springy width curve made the
              // layout overshoot and snap back); the playful spring stays on the tilt.
              transition: 'width 0.4s cubic-bezier(0.22, 1, 0.36, 1), border-radius 0.4s cubic-bezier(0.22, 1, 0.36, 1), transform 0.4s cubic-bezier(0.34, 1.2, 0.64, 1)',
              // Mobile: tucked away (swiped up) → slide straight up and let the
              // render rectangle's top edge cover it (no fade — it's clipped, same x).
              ...(isMobile && polaroidHidden
                ? { transform: 'translateY(calc(-100% - 5rem))', pointerEvents: 'none' as const }
                : {}),
              cursor: isMobile ? 'default' : (previewExpanded ? 'zoom-out' : 'zoom-in'),
              // Desktop: pinned in the frame's top-right corner, so tilt/grow from there.
              ...(isMobile ? {} : { transformOrigin: 'top right' }),
            }}
            // Mobile keeps the small profile (no tap-to-enlarge); desktop still toggles.
            onClick={isMobile ? undefined : () => setPreviewExpanded(v => !v)}
            onTouchStart={isMobile ? (e) => { polaroidTouchStartY.current = e.touches[0].clientY; } : undefined}
            onTouchEnd={isMobile ? (e) => {
              if (verticalSwipe(polaroidTouchStartY.current, e.changedTouches[0].clientY) === 'up') setPolaroidHidden(true);
            } : undefined}
          >
            <div className="studio-polaroid__photo relative" style={{ aspectRatio: '1', overflow: 'hidden' }}>
              {/* Image glyph, centred: shown while the photo loads (it develops in on
                  top and covers it) and when there's no photo or it failed. */}
              <div className="absolute inset-0 flex items-center justify-center" style={{ opacity: 0.38 }} aria-label={displayImg && !polaroidImgError ? undefined : t('No photo')}>
                {/* Same filled glyph as the reference-photo button (sun + mountains cut out). */}
                <svg width="32" height="32" viewBox="2.4 2.4 19.2 19.2" aria-hidden>
                  <path
                    fill="currentColor"
                    fillRule="evenodd"
                    d="M6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Z M9 7.2a1.8 1.8 0 1 0 0 3.6a1.8 1.8 0 1 0 0-3.6Z M5.8 18.3l4.3-5.1 2.9 3.1 2.4-2.6 2.9 3.4v1.2Z"
                  />
                </svg>
              </div>
              {displayImg && !polaroidImgError && (
                <img key={polaroidKey} src={displayImg} alt="scan" className="relative block w-full h-full object-cover cut-develop" onError={() => setPolaroidImgError(true)} />
              )}
            </div>
            {/* Mobile: up-arrow tab fused to the polaroid's bottom edge — tap (or swipe up) to tuck away. */}
            {isMobile && (
              <button
                type="button"
                aria-label={t("Hide photo")}
                onClick={(e) => { e.stopPropagation(); setPolaroidHidden(true); }}
                // studio-polaroid-tab: same surface/border as the polaroid (so it reads as
                // part of it) and a 44px invisible tap area around the small visible tab.
                className="studio-polaroid-tab"
                style={{
                  position: 'absolute', left: '50%', top: 'calc(100% - 1px)', transform: 'translateX(-50%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 44, height: 19, padding: 0,
                  borderRadius: '0 0 7px 7px',
                  boxShadow: '0 6px 10px -6px rgba(0,0,0,0.35)', cursor: 'pointer',
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--char)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15" /></svg>
              </button>
            )}
            {editSaveError && (
              <div
                className="absolute left-0 right-0 top-full mt-2 rounded-md px-2 py-1.5 text-[10px] leading-tight font-mono"
                style={{ background: 'rgba(217,78,58,0.14)', border: '1px solid rgba(217,78,58,0.4)', color: 'var(--cherry, #d94e3a)', minWidth: 160 }}
                onClick={(e) => e.stopPropagation()}
              >
                {editSaveError}
              </div>
            )}
          </div>
          );

          // Mobile: down-arrow tab to bring the photo back. Sits at the same x as the
          // up-arrow (centered on the polaroid), tucked against the render's top edge.
          const downArrow = (
            <button
              className="studio-polaroid-tab studio-polaroid-tab--restore"
              type="button"
              aria-label={t("Show photo")}
              onClick={() => setPolaroidHidden(false)}
              onTouchStart={(e) => { polaroidTouchStartY.current = e.touches[0].clientY; }}
              onTouchEnd={(e) => {
                if (verticalSwipe(polaroidTouchStartY.current, e.changedTouches[0].clientY) === 'down') setPolaroidHidden(false);
              }}
              style={{
                // left:78 = half the mobile polaroid width (156), so the tab is centered
                // on the polaroid's x — exactly where the up-arrow lives.
                position: 'absolute', top: 0, left: mobileScroll ? `calc(${MOBILE_SHORT_POLAROID_CSS} / 2)` : 78, zIndex: 11,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 44, height: 22, padding: 0,
                borderRadius: '0 0 9px 9px',
                boxShadow: '0 6px 12px -6px rgba(0,0,0,0.4)', cursor: 'pointer',
                transition: 'opacity 0.3s ease, transform 0.3s ease',
                opacity: polaroidHidden ? 1 : 0,
                transform: polaroidHidden ? 'translateX(-50%) translateY(0)' : 'translateX(-50%) translateY(-8px)',
                pointerEvents: polaroidHidden ? 'auto' : 'none',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--char)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
            </button>
          );

          // Desktop: float in the render frame's top-right corner (14px inset), over
          // the scene rather than beside it, so enlarging grows down-left and never
          // resizes the 3D view. The frame starts at the column's top padding and
          // ends 24px (p-6) from the column's right edge.
          if (!isMobile) {
            return (
              <div className={`absolute z-20 ${revealClass}`} style={{ top: `calc(${STUDIO_TOP_PAD_CSS} + 14px)`, right: 24 + 14, ['--shell-radius' as string]: '24px' /* = .studio-polaroid's corners */ }}>
                {polaroidEl}
              </div>
            );
          }
          // Mobile: clip the polaroid + tab against the render rectangle's bounds so the
          // photo is covered as it slides up out of the scene instead of fading away.
          return (
            <div style={{ position: 'absolute', top: '5rem', left: '0.5rem', right: '0.5rem', bottom: '0.5rem', overflow: 'hidden', pointerEvents: 'none', zIndex: 10 }}>
              {polaroidEl}
              {downArrow}
            </div>
          );
        })()}

        <div ref={canvasFrameRef} className="render-frame relative w-full h-full rounded-3xl overflow-hidden" style={{ border: '1px solid rgba(255,248,234,0.12)', boxShadow: '0 40px 80px -30px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,248,234,0.08)' }}>
          <div className="absolute top-3 right-3 z-10">
            <HairRecommendationsBar visible={showRecommendations} onHover={setPreviewPlyUrl} onSelect={(url) => { setHairstepPlyUrl(url); setPreviewPlyUrl(null); }} />
          </div>

          {/* The canvas (and its background) is always visible; while the ghost is up the
              splat itself is held at reveal 0 inside the shader, so a half-streamed cloud
              can't show through. */}
          <div style={{ position: 'absolute', inset: 0 }}>
          <HairScene
            params={hairParams}
            colorRGB={profile?.currentStyle.colorRGB ?? '#3b1f0a'}
            profile={profile ?? mockUserHeadProfile}
            onPrimaryHairBBoxReady={handleHairBBoxReady}
            hairstepPlyUrl={previewPlyUrl ?? hairstepPlyUrl ?? undefined}
            splatSrcOverride={tryOnView?.src ?? editSplatSrc ?? effectiveSplatUrl ?? undefined}
            splatMeta={tryOnView ? tryOnView.meta : splatMeta}
            // No default hair mesh while the ghost is up — it showed through the silhouette.
            disableDefaultHairLayers={!!(editSplatSrc ?? effectiveSplatUrl) || revealPhase !== 'done'}
            disableKeyboardControls={!sceneControlsEnabled}
            background={sceneBackground}
            backgroundBrightness={sceneBgBrightness}
            uiHidden={menuHidden}
            captureKey={thumbnailCaptureKey}
            renderQuality={renderQuality}
            videoCaptureKey={videoCaptureKey}
            videoCancelKey={videoCancelKey}
            onVideoProgress={handleVideoProgress}
            onVideoReady={handleVideoReady}
            onVideoError={handleVideoError}
            onSplatLoaded={revealPhase === 'ghost' ? handleSplatLoaded : undefined}
            splatRevealRef={splatRevealRef}
            replaceWipe={tryOnView !== null}
            onThumbnailReady={handleThumbnailReady}
            // Snap immediately when there's no usable thumbnail yet (or a hairstyle
            // change / legacy recapture bumped the key); otherwise the first
            // thumbnail stands until the user settles on a new view.
            thumbnailInitialCapture={
              !project?.thumbnailS3Key || !project.thumbnailS3Key.startsWith('thumbnails/') || thumbnailCaptureKey > 0
            }
          />
          </div>

          {/* BuildGhost overlay — shown while async build runs or reveals */}
          {revealPhase !== 'done' && (
            <BuildGhost
              state={
                revealPhase === 'revealing' ? 'revealing'
                : buildState === 'failed' ? 'failed'
                : buildState === 'building' ? 'building'
                : 'loading'
              }
            >
              {/* Error card shown in 'failed' state */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center', maxWidth: 340, padding: '28px 32px', background: 'rgba(14,10,7,0.85)', borderRadius: 18, border: '1px solid rgba(255,248,234,0.1)', backdropFilter: 'blur(8px)' }}>
                <p style={{ fontFamily: 'var(--font-dmsans)', fontSize: 14, color: 'rgba(255,248,234,0.75)', lineHeight: 1.5, margin: 0 }}>
                  {project?.buildError ?? STALE_BUILD_ERROR}
                </p>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    onClick={handleRetryBuild}
                    style={{ padding: '9px 20px', background: 'var(--tomato)', color: 'var(--cream)', border: 'none', borderRadius: 10, fontFamily: 'var(--font-dmsans)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                  >
                    {t('Try again')}
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push('/dashboard')}
                    style={{ padding: '9px 20px', background: 'rgba(255,248,234,0.08)', color: 'rgba(255,248,234,0.6)', border: 'none', borderRadius: 10, fontFamily: 'var(--font-dmsans)', fontSize: 13, cursor: 'pointer' }}
                  >
                    {t('Retake selfie')}
                  </button>
                </div>
              </div>
            </BuildGhost>
          )}

          <div className="absolute bottom-4 left-4 right-4 flex items-end justify-between z-10">
            <div className="flex items-end gap-3">
              {!FREE_MODE && (
              <button
                onClick={() => { setRefundIsReminder(false); setShowRefund(true); }}
                className="font-mono text-[9px] uppercase tracking-[0.18em] underline underline-offset-2 transition-colors"
                style={{ color: 'rgba(255,248,234,0.5)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--butter)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,248,234,0.5)')}
              >
                not happy?
              </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {sceneControlsEnabled && (
                <button
                  onClick={() => setSceneBackground('url(/project_bg.jpg) center / 100% 100% no-repeat')}
                  title="Photo background"
                  style={{ width: 13, height: 13, borderRadius: '50%', cursor: 'pointer', backgroundImage: 'url(/project_bg.jpg)', backgroundSize: '100% 100%', border: (sceneBackground.startsWith('url(/project_bg') || sceneBackground.startsWith('url(/preview_bg_dark.jpg')) ? '2px solid rgba(255,248,234,0.9)' : '1px solid rgba(255,248,234,0.25)', flexShrink: 0 }}
                />
              )}
              {sceneControlsEnabled && ['#000000', '#1c1510', '#00b140', '#f5f0e8'].map(c => (
                <button key={c} onClick={() => setSceneBackground(c)} style={{ width: 13, height: 13, borderRadius: '50%', cursor: 'pointer', background: c, border: sceneBackground === c ? '2px solid rgba(255,248,234,0.9)' : '1px solid rgba(255,248,234,0.25)', flexShrink: 0 }} />
              ))}
              {sceneControlsEnabled && (
                <input type="color" value={sceneBackground.startsWith('#') ? sceneBackground : '#000000'} onChange={e => setSceneBackground(e.target.value)} title="Custom background" style={{ width: 16, height: 16, padding: 0, border: 'none', cursor: 'pointer', borderRadius: 3, background: 'none', flexShrink: 0 }} />
              )}
              {sceneControlsEnabled && (
                <button onClick={() => setMenuHidden(v => !v)} className="font-mono text-[9px] uppercase tracking-[0.18em] hover:text-[var(--cream)]" style={{ color: 'rgba(255,248,234,0.55)', background: 'rgba(0,0,0,0.35)', borderRadius: 4, padding: '3px 8px' }}>
                  {menuHidden ? 'show ui' : 'hide ui'}
                </button>
              )}
            </div>
          </div>

          {/* "Waiting for the render" gate — shown after picking a cut for a 360
              from the dashboard. The user watches the splat load behind it and
              presses "All ready!" to kick off the sweep. */}
          {autoBarberPending && videoState !== 'recording' && videoState !== 'encoding' && (
            <div
              className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-5"
              style={{ background: 'rgba(23,17,13,0.7)', backdropFilter: 'blur(3px)' }}
              role="status"
              aria-live="polite"
            >
              <span className="font-mono text-[12px] uppercase tracking-[0.22em] text-[var(--cream)]/85">
                Waiting for the render to load
                <span className="barber-wait-dots" aria-hidden>
                  <span>.</span><span>.</span><span>.</span>
                </span>
              </span>
              <button
                onClick={handleAutoBarberReady}
                className="font-sans text-[13px] font-semibold rounded-full px-6 py-2.5 transition-transform active:scale-95"
                style={{ background: 'var(--moss)', color: 'var(--chalk)', boxShadow: '0 6px 20px -6px rgba(107,140,79,0.7)' }}
              >
                All ready!
              </button>
            </div>
          )}

          {/* Capture overlay — masks the spinning canvas while recording the
              360° clip. Pure DOM, so it never appears in the recording. */}
          {(videoState === 'recording' || videoState === 'encoding') && (
            <div
              className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-4"
              style={{ background: 'rgba(23,17,13,0.78)', backdropFilter: 'blur(3px)' }}
              role="status"
              aria-label={t('Rendering your barber video')}
            >
              {/* The camera at work, and how far along the render is. */}
              <CaptureGlyph state={videoState} label={t('Rendering your barber video')} />
              <span className="font-sans font-bold text-[18px] text-[var(--cream)]/90" style={{ fontVariantNumeric: 'tabular-nums' }} aria-hidden>
                {/* aria-hidden: the overlay's status label already speaks; a per-frame number would spam screen readers. */}
                {Math.round(Math.min(1, Math.max(0, videoState === 'encoding' ? 1 : videoProgress)) * 100)}%
              </span>
              <button type="button" className="capture-cancel" onClick={cancelBarberVideo}>
                {t('Cancel')}
              </button>
            </div>
          )}
        </div>
      </div>

      {!menuHidden && !isMobile && (
        <div className="panel-resizer" aria-label={t('Resize the edit panel')} {...sidebarResizeHandle} />
      )}
      {!menuHidden && (
        <aside
          ref={toolboxAsideRef}
          className={`flex flex-col px-4 pb-4 relative overflow-y-auto cozy-scroll sidebar-in ${isMobile ? (mobileScroll ? 'w-full flex-shrink-0' : 'w-full flex-shrink-0 max-h-[52vh]') : 'flex-shrink-0 self-start max-h-[calc(100vh-0.75rem)]'}`}
          style={{
            // Capped at 46vw so a narrow (e.g. zoomed-in) desktop window keeps a usable render.
            ...(isMobile ? {} : { width: `min(${sidebarWidth}px, 46vw)` }),
            paddingTop: toolboxPadTop,
            // While the loading shadow is up the panel is hidden and still settling
            // (auto-fit, saved sizes): snap, so it's already in place when it appears.
            transition: revealPhase === 'ghost' ? 'none' : 'padding-top 420ms cubic-bezier(0.4,0,0.2,1)',
            zIndex: 50,
            // Disable toolbox interaction while the async build runs.
            ...(buildState === 'building' ? { pointerEvents: 'none' as const, opacity: 0.38 } : {}),
          }}
          aria-disabled={buildState === 'building' || undefined}
        >
          {/* Shadow-loading: pulse a skeleton of the toolbox over it. The real panel
              stays mounted (just invisible) so the auto-fit still measures it. */}
          {/* As the shadow lifts ('revealing') the skeleton fades out while the real
              panel mists in underneath, together with the head. */}
          {revealPhase !== 'done' && (
            <EditPanelSkeleton
              isMobile={isMobile}
              className={`absolute left-4 right-4 ${revealPhase === 'revealing' ? 'studio-skeleton-out' : ''}`}
              style={{ top: toolboxPadTop, zIndex: 2 }}
            />
          )}
          <div
            ref={toolboxContentRef}
            className="flex flex-col gap-3"
            style={revealPhase === 'ghost' ? { visibility: 'hidden' } : undefined}
            aria-hidden={revealPhase === 'ghost' || undefined}
          >
          {/* Token count / top-up only exist outside FREE_MODE; skip the row otherwise
              so its flex gap doesn't push the cards below the render frame's top. */}
          {!isMobile && !FREE_MODE && (
          <div className="flex items-center gap-3 flex-shrink-0" style={{ transform: 'translateY(-12px)' }}>
            {!FREE_MODE && (
              <span
                className="flex items-center gap-1.5 px-3 py-1 rounded-full font-mono text-sm"
                title={!userQuery?.topPlan ? t('Includes {n} free/month · resets monthly, unused don\'t roll over', { n: 3 }) : undefined}
                style={{
                  background: (userQuery?.availableGenerations ?? 0) > 0 ? 'rgba(255,248,234,0.12)' : 'rgba(217,78,58,0.25)',
                  border: (userQuery?.availableGenerations ?? 0) > 0 ? '1px solid rgba(255,248,234,0.2)' : '1px solid rgba(217,78,58,0.5)',
                  color: (userQuery?.availableGenerations ?? 0) > 0 ? 'var(--cream)' : 'var(--butter)',
                  transition: 'background 0.3s, border-color 0.3s',
                }}
              >
                <img src="/shapeup_token.webp" alt="token" draggable={false} style={{ width: '2.156em', height: '2.156em', borderRadius: '50%', display: 'inline-block', verticalAlign: '-0.6em', boxShadow: '0 0 0 1px rgba(42,32,26,0.22)' }} /> <ClockCounter value={userQuery?.availableGenerations ?? 0} />
              </span>
            )}
            {!FREE_MODE && <AddTokensButton onClick={() => setShowPricing(true)} />}
            {!FREE_MODE && paymentSuccess && (
              <span className="font-mono text-[10px] text-[var(--butter)] animate-pulse">✦ tokens added!</span>
            )}
          </div>
          )}
          <EditPanel
              isMobile={isMobile}
              profile={profile ?? mockUserHeadProfile}
              onParamsChange={handleParamsChange}
              sessionId={sessionId}
              latestImageUrl={imageUrl}
              onImageUpdated={(url, savedKey) => {
                track('image_generated', { projectId });
                feedbackPrompt.registerEdit(); // success moment — Nth edit may surface the rating toast
                setDisplayImageUrl(url);
                setPreviewExpanded(false);
                setPolaroidImgError(false);
                setPolaroidKey(k => k + 1);
                setEditSaveError(null);
                // The edit route normally saves the image itself (savedKey). If it
                // couldn't, upload the model-edited image to S3 and persist under
                // lastEditImageS3Key, keeping lastImageS3Key (original scan) intact for
                // drift prevention. Every step is checked and surfaced — a silent failure
                // here loses the edit on refresh, which is exactly the bug that hid behind
                // a swallowed catch.
                if (!savedKey && url.startsWith('data:') && projectId) {
                  (async () => {
                    try {
                      const blob = dataUrlToBlob(url);
                      const uploadRes = await fetch('/api/upload-edit-image', {
                        method: 'POST',
                        headers: { 'Content-Type': blob.type || 'image/png' },
                        body: blob,
                      });
                      if (!uploadRes.ok) {
                        const body = await uploadRes.text().catch(() => '');
                        console.error('[studio] edit-image upload failed:', uploadRes.status, body.slice(0, 300));
                        setEditSaveError(`Edit not saved — upload failed (HTTP ${uploadRes.status}). Refresh will lose it.`);
                        return;
                      }
                      const { key } = (await uploadRes.json()) as { key?: string };
                      if (!key) {
                        console.error('[studio] edit-image upload returned no key');
                        setEditSaveError('Edit not saved — upload returned no key. Refresh will lose it.');
                        return;
                      }
                      try {
                        await saveProject({ projectId, lastEditImageS3Key: key });
                      } catch (e) {
                        console.error('[studio] saveProject(lastEditImageS3Key) failed:', e);
                        setEditSaveError('Edit uploaded but not linked to project — refresh will lose it.');
                        return;
                      }
                      setEditSaveError(null);
                      setDisplayImageUrl(`/api/img?key=${encodeURIComponent(key)}`);
                    } catch (e) {
                      console.error('[studio] edit-image persist pipeline threw:', e);
                      setEditSaveError('Edit not saved — see console for details. Refresh will lose it.');
                    }
                  })();
                }
              }}
              userCredits={userQuery?.availableGenerations}
              paywallDisabled={paywallDisabled}
              isAllowlisted={isAllowlisted}
              projectId={projectId}
              projectName={project?.name}
              editPrompts={project?.editPrompts}
              cutListFitHeight={cutListFitHeight}
              // The 360° card floats over the render frame when the toolbox is taller than the viewport.
              // Enabled during the shadow too, so the card settles into its final spot (docked or in the panel)
              // while hidden and the reveal sweep finds it there — no jump at the end of the reveal.
              videoDock={{ frameRef: canvasFrameRef, enabled: !isMobile && !menuHidden }}
              onCancelVideo={cancelBarberVideo}
              tryOnActive={tryOns.phase === 'on'}
              tryOnPanel={<QuickTryOnsPanel state={tryOns} />}
              // Mounted from the start (hidden with the panel during the shadow) so it's part of the reveal, not a late pop.
              cardActions={effectiveSplatUrl ? <QuickTryOnsToggle state={tryOns} /> : undefined}
              onPlyReady={(url, splatKey) => {
                if (url.startsWith('/')) {
                  setEditSplatSrc(url);
                  if (splatKey) {
                    setPersistedSplatUrl(`/api/splat?key=${encodeURIComponent(splatKey)}`);
                    saveProject({ projectId, splatS3Key: splatKey }).catch(() => {});
                  } else {
                    const SPLAT_URL_PREFIX = '/api/splat?url=';
                    const rawUrl = url.startsWith(SPLAT_URL_PREFIX)
                      ? decodeURIComponent(url.slice(SPLAT_URL_PREFIX.length))
                      : url;
                    setPersistedSplatUrl(rawUrl);
                    saveProject({ projectId, lastSplatUrl: rawUrl }).catch(() => {});
                  }
                } else {
                  setHairstepPlyUrl(`/api/splat?url=${encodeURIComponent(url)}`);
                }
                setThumbnailCaptureKey(k => k + 1);
                resetBarberVideo(); // new hairstyle → any prior 360° clip is stale
              }}
              onUncertain={() => setShowRecommendations(true)}
              onRequestVideo={requestBarberVideo}
              videoState={videoState}
              videoProgress={videoProgress}
              videoUrl={videoUrl}
              videoExt={videoExt}
            />
          </div>
        </aside>
      )}

      {!FREE_MODE && showPricing && (
        <PricingPopup
          returnUrl={`/studio/${projectId}`}
          onDismiss={() => setShowPricing(false)}
        />
      )}

      <FeedbackToast
        open={feedbackPrompt.open}
        onClose={feedbackPrompt.close}
        route="studio"
        projectId={projectId}
        editCount={feedbackPrompt.editCount}
      />

      {!FREE_MODE && showRefund && (
        <RefundRequestDialog
          projectId={projectId}
          requireAck={refundIsReminder}
          onClose={() => setShowRefund(false)}
        />
      )}
    </main>
  );
}
