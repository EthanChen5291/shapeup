'use client';

// ============================================================
// BarberLiveTryOn — the live mirror on a barber's card.
//
// This replaces the selfie flow that used to live here (photo → 2D edit → 3D
// splat). Nothing about a still photo survived contact with what people
// actually want to know, which is "does it move like that on ME" — a fringe
// that sits right in one frozen frame reads completely differently the moment
// the head turns. So the card now runs the same live model the chair does:
// camera on, haircut applied in real time, the client steering it in their own
// words while they watch.
//
//   consent → ready → live → review → sent
//
// Choices worth defending:
//
//  * This panel IS the card's experience — there is no lookbook or choice
//    screen in front of it. Cut suggestions live inside the flow as chips
//    (ready: pick before starting; live: steer without reconnecting), the
//    same shape as the prompt examples row on a realtime playground.
//  * The prompt bar is LIVE, not a pre-flight form. "Shorter on the sides" mid-
//    take re-steers the existing connection (setPrompt) — no reconnect, no
//    black frame, no second charge. Typing while watching yourself is the whole
//    product; making the client stop, submit, and wait would just be the selfie
//    flow with extra steps.
//  * Consent is its own screen and it names what is filmed and where it goes.
//    A client on their own phone has no barber standing there to explain it.
//  * A take that started is already in the barber's roster (convex/chair.ts).
//    "Send" marks which one they want cut and puts it in the barber's inbox —
//    it never has to move the video anywhere.
//  * Errors surface in place with the take intact. Nothing here bounces the
//    client back to the lookbook, which is the same rule the chair follows.
//
// Money: every take spends the BARBER's daily cap, claimed server-side before a
// token exists. `takesLeftToday` is read straight off that meter so the panel
// can say "not today" honestly instead of failing at the camera.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import type { Hairstyle } from '@/data/hairstyles';
import SignUpWidget from '@/components/SignUpWidget';
import LiveTryOnPreview from '@/components/LiveTryOnPreview';
import CountdownRing from '@/components/chair/CountdownRing';
import { useChairTake } from '@/hooks/useChairTake';
import { useConvexUpload } from '@/hooks/useConvexUpload';
import { buildBarberPrompt, takeLabel } from '@/lib/lucy/barberPrompt';
import { MAX_TAKE_SECONDS, coachLineAt } from '@/lib/chair/angles';
import { extractFrames } from '@/lib/chair/frames';
import type { TakeRecording } from '@/lib/lucy/recorder';
import { useT } from '@/lib/i18n';

export interface BarberLiveTryOnProps {
  barberSlug: string;
  /** For the "Book with {name}" close of the loop. */
  barberName: string;
  cut: Hairstyle;
  /** Cuts specifically selected by this barber. */
  barberPicks?: Hairstyle[];
  /** The complete generated hairstyle menu. */
  menuCuts?: Hairstyle[];
  /** Attributes a sign-up through this flow back to the barber who sent them. */
  referralCode?: string;
  /** The barber's booking link, when they have one — shown after a take. */
  bookingUrl?: string;
  /** Native scheduling: jump to the card's slot picker instead of an external link. */
  onBook?: () => void;
  /** Reports the cut currently on screen (the booking panel labels slots with it). */
  onCutChange?: (cut: Hairstyle) => void;
  /** When the panel is embedded under something worth returning to. Without it
   *  the flow is the whole page and the back affordance disappears. */
  onClose?: () => void;
}

type Phase = 'consent' | 'ready' | 'live' | 'review' | 'sent';

function BackIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function FlipIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 2v4h4M7 22v-4H3" />
      <path d="M21 6a9 9 0 0 0-15.6-2.4M3 18a9 9 0 0 0 15.6 2.4" />
    </svg>
  );
}

export default function BarberLiveTryOn({
  barberSlug,
  barberName,
  cut,
  barberPicks = [],
  menuCuts = [],
  referralCode,
  bookingUrl,
  onBook,
  onCutChange,
  onClose,
}: BarberLiveTryOnProps) {
  const t = useT();
  const { isSignedIn, user } = useUser();
  const take = useChairTake();
  const upload = useConvexUpload();

  const session = useQuery(api.chair.cardSession, isSignedIn ? { slug: barberSlug } : 'skip');
  const joinCard = useMutation(api.chair.joinCard);
  const shareTake = useMutation(api.chair.shareTake);
  const discardTake = useMutation(api.chair.discardTake);
  const sendToBarber = useAction(api.barberTryOn.sendToBarber);
  const getOrCreate = useMutation(api.users.getOrCreate);
  const recordEvent = useMutation(api.barberPages.recordEvent);

  const [phase, setPhase] = useState<Phase>('consent');
  const [activeCut, setActiveCut] = useState(cut);
  const [tweak, setTweak] = useState('');
  const [draft, setDraft] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [joinError, setJoinError] = useState('');
  const [busy, setBusy] = useState(false);

  const [takeId, setTakeId] = useState<Id<'chairTakes'> | null>(null);
  const [recording, setRecording] = useState<TakeRecording | null>(null);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendOutcome, setSendOutcome] = useState<'emailed' | 'saved' | 'failed' | null>(null);
  const [shelf, setShelf] = useState<'picks' | 'menu'>('picks');

  const outputVideoRef = useRef<HTMLVideoElement>(null);
  const selfViewRef = useRef<HTMLVideoElement>(null);

  const prompt = useMemo(
    () => buildBarberPrompt({ cut: activeCut, tweak, voice: 'client' }),
    [activeCut, tweak],
  );
  // The cut is this panel's state; the booking panel downstream labels the
  // appointment with it, so report every change upward.
  useEffect(() => {
    onCutChange?.(activeCut);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCut]);
  const label = useMemo(() => takeLabel({ cut: activeCut, tweak }), [activeCut, tweak]);
  // `label` is what gets stored and prompted with, so it stays in the source
  // language; this is the same string with the cut name read back to the
  // client in theirs.
  const shownLabel = useMemo(
    () => takeLabel({ cut: { ...activeCut, label: t(activeCut.label) }, tweak }),
    [activeCut, tweak, t],
  );
  const takesLeft = session?.takesLeftToday ?? null;
  const coachLine = coachLineAt(take.elapsedMs);

  // Fires once, the moment sign-in completes — a visitor who signs up here
  // never passes through `/`, which is the only other place that attributes a
  // new account back to the barber who sent them.
  const attributedRef = useRef(false);
  useEffect(() => {
    if (!isSignedIn || attributedRef.current) return;
    attributedRef.current = true;
    void getOrCreate({ referralCode }).catch(() => {});
  }, [isSignedIn, referralCode, getOrCreate]);

  // Seed the consent screen with the name they already gave Clerk, so the
  // common case is one tap and not one tap plus typing your own name.
  useEffect(() => {
    if (nameDraft) return;
    const fromClerk = user?.firstName ?? user?.fullName ?? '';
    if (fromClerk) setNameDraft(fromClerk);
  }, [user, nameDraft]);

  // Consent already on file from an earlier visit to this card — skip the
  // screen rather than asking the same person the same question twice.
  useEffect(() => {
    if (session && !session.needsConsent && phase === 'consent') setPhase('ready');
  }, [session, phase]);

  // Attach live streams imperatively — srcObject isn't a React prop. `phase` is
  // a dependency because the self-view is a DIFFERENT element on the ready
  // screen than during the take: without it the second one mounts blank.
  useEffect(() => {
    if (outputVideoRef.current) outputVideoRef.current.srcObject = take.outputStream;
  }, [take.outputStream, phase]);
  useEffect(() => {
    if (selfViewRef.current) selfViewRef.current.srcObject = take.cameraStream;
  }, [take.cameraStream, phase]);

  // Warm the camera while they're reading the "ready" screen, so the start
  // button opens on a live face instead of a permission prompt.
  useEffect(() => {
    if (phase !== 'ready') return;
    void take.openCamera();
    // `take` is a stable bag of callbacks; re-running on every render would
    // re-request the camera on each keystroke in the prompt field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  useEffect(() => {
    if (!reviewUrl) return;
    return () => URL.revokeObjectURL(reviewUrl);
  }, [reviewUrl]);

  // The camera and the session are torn down by useChairTake's own unmount
  // effect — deliberately not repeated here, because `take` is a fresh object
  // every render and a cleanup keyed on it would close the camera mid-take.

  const runTake = useCallback(async () => {
    if (!prompt) return;
    setPhase('live');
    setRecording(null);
    setReviewUrl(null);
    setSendOutcome(null);
    // The take starting IS the try-on — there is no earlier tap to count.
    void recordEvent({ slug: barberSlug, kind: 'tryOn', cutSlug: activeCut.slug }).catch(() => {});

    const result = await take.startTake({
      slug: barberSlug,
      cutLabel: label,
      cutSlug: activeCut.slug,
      prompt,
    });

    if (!result) {
      // The hook has already surfaced why. Stay on the ready screen with the
      // cut still chosen rather than dumping them back to the lookbook.
      setPhase('ready');
      return;
    }

    setTakeId(result.takeId);
    setRecording(result.recording);
    setReviewUrl(URL.createObjectURL(result.recording.blob));
    setPhase('review');
    void recordEvent({ slug: barberSlug, kind: 'preview' }).catch(() => {});
    void take.saveRecording(result.takeId, result.recording);
  }, [prompt, label, activeCut, barberSlug, take, recordEvent]);

  /** Re-steer the live feed: the connection stays up, the cut changes in place. */
  const steer = useCallback(
    (next: Hairstyle, nextTweak: string) => {
      setActiveCut(next);
      setTweak(nextTweak);
      const composed = buildBarberPrompt({ cut: next, tweak: nextTweak, voice: 'client' });
      if (composed && phase === 'live') take.setPrompt(composed);
    },
    [take, phase],
  );

  const submitDraft = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const next = draft.trim();
      if (!next) return;
      steer(activeCut, next);
      setDraft('');
    },
    [draft, activeCut, steer],
  );

  const submitConsent = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setBusy(true);
      setJoinError('');
      try {
        await joinCard({ slug: barberSlug, name: nameDraft });
        setPhase('ready');
      } catch (err) {
        setJoinError(err instanceof Error ? err.message : t('Couldn’t start that. Try again.'));
      } finally {
        setBusy(false);
      }
    },
    [joinCard, barberSlug, nameDraft, t],
  );

  const tryAnother = useCallback(() => {
    if (takeId) void discardTake({ takeId }).catch(() => {});
    setTakeId(null);
    setRecording(null);
    setReviewUrl(null);
    setSendOutcome(null);
    setPhase('ready');
  }, [takeId, discardTake]);

  const send = useCallback(async () => {
    if (!takeId) return;
    setSending(true);
    try {
      // One frame off the middle of the clip, as the still the barber sees
      // first in their inbox. A failed grab is not a failed send — the video
      // is already filed under this client either way.
      let posterStorageId: Id<'_storage'> | undefined;
      if (recording) {
        try {
          const [poster] = await extractFrames(recording.blob, [
            Math.max(0, Math.round(recording.durationMs / 2)),
          ]);
          if (poster) posterStorageId = (await upload(poster)).storageId;
        } catch {
          /* no poster; the clip still goes */
        }
      }

      const shared = await shareTake({
        takeId,
        posterStorageId,
        note: tweak || undefined,
        phone: clientPhone.trim() || undefined,
      });

      if (shared.posterUrl) {
        const result = await sendToBarber({
          slug: barberSlug,
          cutLabel: label,
          imageUrl: shared.posterUrl,
          videoUrl: shared.videoUrl ?? undefined,
          clientRequest: tweak || activeCut.label,
          clientEmail: user?.primaryEmailAddress?.emailAddress,
          clientPhone: clientPhone.trim() || undefined,
        });
        setSendOutcome(result.ok ? (result.emailed ? 'emailed' : 'saved') : 'failed');
      } else {
        // No still to attach, but the take is pinned in the barber's chair
        // history — which is where they'd look for it anyway.
        setSendOutcome('saved');
      }
      setPhase('sent');
    } catch {
      setSendOutcome('failed');
      setPhase('sent');
    } finally {
      setSending(false);
    }
  }, [
    takeId, recording, upload, shareTake, tweak, clientPhone, sendToBarber,
    barberSlug, label, activeCut, user,
  ]);

  const shelfCuts = shelf === 'picks' ? barberPicks : menuCuts;
  // The suggestion chips under the prompt bar — the barber's picks when they
  // chose some, otherwise a taste of the menu. Same row on ready and live.
  const chipCuts = (barberPicks.length ? barberPicks : menuCuts).slice(0, 10);

  return (
    <section className="bt-panel" aria-label={t('Try it on live')} data-phase={phase}>
      {(phase === 'live' || onClose) && (
        <header className="bt-head">
          <button
            type="button"
            className="bt-back"
            onClick={phase === 'live' ? () => { take.cancelTake(); setPhase('ready'); } : onClose}
          >
            <BackIcon />
            <span className="font-sans">{phase === 'live' ? t('Stop') : t('Back')}</span>
          </button>
          <span className="bt-cut font-mono">{t(activeCut.label)}</span>
        </header>
      )}

      {/* useChairTake reports in the source language (it has no hook context of
          its own); t() looks the string up the same way the chair does.
          Server-supplied messages fall through untranslated. */}
      {take.error && (
        <p className="bt-error font-sans" role="alert">
          {t(take.error)}
        </p>
      )}

      {!isSignedIn ? (
        <div className="bt-auth">
          <p className="bt-auth-copy font-sans">
            {t('One quick sign-in — it’s how we send you the result and let this barber know what you want.')}
          </p>
          <SignUpWidget onEnter={() => {}} />
        </div>
      ) : session === undefined ? (
        <div className="bt-connecting" role="status">
          <span className="bt-spinner" aria-hidden />
          <p className="font-sans">{t('Loading…')}</p>
        </div>
      ) : (
        <>
          {/* ── consent ── */}
          {phase === 'consent' && (
            <div className="bt-consent">
              <h3 className="bt-step-title">{t('Before the camera starts')}</h3>
              <div className="bt-consent-copy font-sans">
                <p>
                  {t('We’ll film about 30 seconds of you and show your face with the haircut applied, live, so you can see it move.')}
                </p>
                <p>
                  {t('The clip is saved to {name}’s ShapeUp account under your name. Ask them to delete it any time and it’s gone.', { name: barberName })}
                </p>
              </div>
              <form className="bt-consent-form" onSubmit={(e) => void submitConsent(e)}>
                <label className="bt-field">
                  <span className="font-mono">{t('Your name')}</span>
                  <input
                    className="bt-input font-sans"
                    value={nameDraft}
                    onChange={(e) => { setNameDraft(e.target.value); setJoinError(''); }}
                    placeholder={t('Marcus T.')}
                    autoComplete="given-name"
                    enterKeyHint="go"
                  />
                </label>
                {joinError && <p className="bt-error font-sans" role="alert">{joinError}</p>}
                <button type="submit" className="bt-btn is-primary" disabled={busy}>
                  {busy ? t('Starting…') : t('Let’s do it!')}
                </button>
              </form>
            </div>
          )}

          {/* ── ready: same structure the live screen has — stage, prompt,
                suggestions — so starting the take changes nothing around you. ── */}
          {phase === 'ready' && (
            <div className="bt-ready">
              <div className="bt-ready-frame">
                <video
                  ref={selfViewRef}
                  className="bt-ready-video"
                  autoPlay
                  playsInline
                  muted
                  aria-label={t('Your camera, before the haircut is applied')}
                />
                <img
                  className="bt-ready-cut"
                  src={`/hair-previews/${activeCut.slug}.png`}
                  alt=""
                  width={72}
                  height={72}
                />
              </div>

              <label className="bt-field">
                <span className="font-mono">{t('Anything you want different?')}</span>
                <input
                  className="bt-input font-sans"
                  value={tweak}
                  onChange={(e) => setTweak(e.target.value)}
                  placeholder={t('Tighter on the sides, keep the fringe…')}
                />
              </label>

              {chipCuts.length > 0 && (
                <ul className="bt-chips" aria-label={t('Pick a cut')}>
                  {chipCuts.map((option) => (
                    <li key={option.slug}>
                      <button
                        type="button"
                        className={`bt-chip${activeCut.slug === option.slug ? ' is-on' : ''}`}
                        aria-pressed={activeCut.slug === option.slug}
                        onClick={() => steer(option, tweak)}
                      >
                        <img src={`/hair-previews/${option.slug}.png`} alt="" width={28} height={28} loading="lazy" />
                        <span className="font-sans">{t(option.label)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="bt-actions">
                <button
                  type="button"
                  className="bt-btn is-primary"
                  onClick={() => void runTake()}
                  disabled={!prompt || takesLeft === 0}
                >
                  {takesLeft === 0
                    ? t('The mirror’s had a busy day — try tomorrow')
                    : t('Start the {n}s take', { n: MAX_TAKE_SECONDS })}
                </button>
              </div>
              {/* What the 30 seconds are FOR, and a drawing of the screen they
                  buy. Consent is once per client — this is the last screen
                  before the take and every client sees it every time, so the
                  explanation lives here rather than behind that gate. */}
              <p className="bt-ready-hint font-sans">
                {t('The next step will use the camera to style your hair. You have 30 seconds to explore which hairstyles fit you best! Use the prompt box and suggestions below to style.')}
              </p>
              <LiveTryOnPreview />
            </div>
          )}

          {/* ── live ── */}
          {phase === 'live' && (
            <div className="bt-live">
              <div className="bt-stage">
                <video
                  ref={outputVideoRef}
                  className="bt-output"
                  autoPlay
                  playsInline
                  muted
                  aria-label={t('You, live, with the new cut')}
                />
                <video ref={selfViewRef} className="bt-selfview" autoPlay playsInline muted aria-hidden />

                {take.status !== 'streaming' ? (
                  <div className="bt-connecting" role="status">
                    <span className="bt-spinner" aria-hidden />
                    <p className="font-sans">{t('Getting the mirror ready…')}</p>
                  </div>
                ) : (
                  <>
                    <div className="bt-coach" role="status" aria-live="polite">
                      <p className="bt-coach-line">{t(coachLine)}</p>
                    </div>
                    <CountdownRing
                      elapsedMs={take.elapsedMs}
                      totalMs={MAX_TAKE_SECONDS * 1000}
                      label={t('{n} seconds left in this take', {
                        n: Math.ceil(Math.max(0, MAX_TAKE_SECONDS * 1000 - take.elapsedMs) / 1000),
                      })}
                    />
                  </>
                )}

                <button
                  type="button"
                  className="bt-flip"
                  onClick={() => void take.flipCamera()}
                  aria-label={t('Switch camera')}
                >
                  <FlipIcon />
                </button>
              </div>

              {/* Live prompting: this re-steers the take that is already
                  running. Nothing restarts, nothing is charged twice. */}
              <form className="bt-prompt" onSubmit={submitDraft}>
                <input
                  className="bt-prompt-input font-sans"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={t('Say it while you watch — “shorter on top”')}
                  aria-label={t('Change the cut while it’s running')}
                />
                <button
                  type="submit"
                  className="bt-prompt-go"
                  disabled={!draft.trim()}
                  aria-label={t('Go')}
                >
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              </form>

              {chipCuts.length > 0 && (
                <ul className="bt-chips" aria-label={t('Switch the cut live')}>
                  {chipCuts.map((option) => (
                    <li key={option.slug}>
                      <button
                        type="button"
                        className={`bt-chip${activeCut.slug === option.slug ? ' is-on' : ''}`}
                        aria-pressed={activeCut.slug === option.slug}
                        onClick={() => steer(option, tweak)}
                      >
                        <img src={`/hair-previews/${option.slug}.png`} alt="" width={28} height={28} loading="lazy" />
                        <span className="font-sans">{t(option.label)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="bt-actions">
                <button type="button" className="bt-btn is-primary" onClick={take.stopTake}>
                  {t('That’s the one')}
                </button>
              </div>
            </div>
          )}

          {/* ── review ── */}
          {(phase === 'review' || phase === 'sent') && reviewUrl && (
            <div className="bt-result">
              <div className="bt-result-frame">
                <video className="bt-playback" src={reviewUrl} controls autoPlay loop playsInline />
              </div>

              {phase === 'review' && (
                <>
                  <h3 className="bt-step-title">{t('That’s {cut}. Send it to {name}?', { cut: shownLabel, name: barberName })}</h3>

                  <div className="bt-style-browser">
                    <div className="bt-style-tabs" role="tablist" aria-label={t('Hairstyle collections')}>
                      <button type="button" role="tab" aria-selected={shelf === 'picks'} className={shelf === 'picks' ? 'is-on' : ''} onClick={() => setShelf('picks')}>
                        {t('Barber’s picks')}
                      </button>
                      <button type="button" role="tab" aria-selected={shelf === 'menu'} className={shelf === 'menu' ? 'is-on' : ''} onClick={() => setShelf('menu')}>
                        {t('Menu')}
                      </button>
                    </div>
                    <div className="bt-style-grid" role="tabpanel">
                      {shelfCuts.map((option) => (
                        <button
                          key={option.slug}
                          type="button"
                          className={`bt-menu-cut${activeCut.slug === option.slug ? ' is-current' : ''}`}
                          disabled={sending}
                          onClick={() => { setActiveCut(option); tryAnother(); }}
                        >
                          <img src={`/hair-previews/${option.slug}.png`} alt="" width={88} height={88} loading="lazy" />
                          <span className="font-sans">{t(option.label)}</span>
                        </button>
                      ))}
                      {shelf === 'picks' && barberPicks.length === 0 ? (
                        <p className="bt-style-empty font-sans">{t('This barber hasn’t added picks yet — explore the full menu.')}</p>
                      ) : null}
                    </div>
                  </div>

                  <label className="bt-phone">
                    <span className="font-mono">{t('Phone (optional)')}</span>
                    <input
                      className="bt-phone-input font-sans"
                      type="tel"
                      inputMode="tel"
                      value={clientPhone}
                      onChange={(e) => setClientPhone(e.target.value)}
                      placeholder="(415) 555-0134"
                      disabled={sending}
                    />
                  </label>
                </>
              )}

              <div className="bt-actions">
                {phase === 'review' ? (
                  <>
                    <button type="button" className="bt-btn is-primary" onClick={() => void send()} disabled={sending}>
                      {sending ? t('Sending…') : t('Send to {name}', { name: barberName })}
                    </button>
                    <button type="button" className="bt-btn" onClick={tryAnother} disabled={sending}>
                      {t('Try another')}
                    </button>
                  </>
                ) : (
                  <div className="bt-sent font-sans" role="status">
                    {sendOutcome === 'emailed' && t('Sent! They’ll see exactly what you want before you sit down.')}
                    {sendOutcome === 'saved' && t('Sent to {name}’s ShapeUp inbox — they’ll see it before your cut.', { name: barberName })}
                    {sendOutcome === 'failed' && t('Couldn’t send that — show them this clip in the chair instead.')}
                  </div>
                )}

                {onBook ? (
                  <button type="button" className="bt-btn is-book" onClick={onBook}>
                    {t('Book with {name}', { name: barberName })}
                  </button>
                ) : bookingUrl ? (
                  <a className="bt-btn is-book" href={bookingUrl} target="_blank" rel="noopener noreferrer">
                    {t('Book with {name}', { name: barberName })}
                  </a>
                ) : null}
              </div>

              {phase === 'sent' && (
                <div className="bt-actions">
                  <button type="button" className="bt-btn" onClick={tryAnother}>
                    {t('Try another cut')}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
