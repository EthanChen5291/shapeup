'use client';

// ============================================================
// Chair Mode — the barber's station.
//
// The design constraint is not "make a nice page". It is: a stranger just sat
// down, the barber has one hand free, and every second spent on the tablet is a
// second not cutting. So the whole flow is one screen at a time, one primary
// action per screen, and never more than two taps between the door and a live
// camera.
//
//   name → consent → stage → review → saved
//
// Deliberate choices worth defending:
//
//  * There is no cut-picker screen. Consent hands straight to the stage: the
//    camera is already the page, and the menu is a strip of chips under it.
//    A picker screen was a toll gate in front of the only thing anyone came
//    for, and it made the barber choose a haircut for a face they were looking
//    at on a form instead of in the mirror.
//  * NOTHING IS CHARGED UNTIL THE FIRST ASK. Arming the stage costs a camera
//    permission, not a take: no token is minted, no daily take is claimed. The
//    first chip tap or prompt submit is what starts the take clock, so a barber
//    who opens the chair to check the light hasn't spent anything.
//  * The review screen is where the reference sheet is BORN. The moment a take
//    lands, MediaPipe reads the whole clip for the sharpest on-angle frames and
//    deals them onto the screen; the barber picks the 2–4 the cut will actually
//    be worked from, and only those are uploaded. The machine nominates, the
//    barber decides.
//  * Armed and running are the same screen — same chips, same prompt bar, in
//    the same places. Starting a take shrinks the mirror into the corner and
//    lights the ring; nothing under the barber's thumb moves.
//  * The name form is the home screen — there is no roster screen in front of
//    it. A stranger just sat down, so "Who's in the chair?" is the first and
//    only question. No client list renders here: the screen faces whoever is
//    in the chair, and other clients' names are not theirs to read. A regular
//    retypes their name; convex/chair.ts startVisit reuses their row and
//    carries consent on file, so nothing but the typing is repeated.
//  * The person in the chair drives the whole thing themselves — enter a name,
//    agree, pick, watch, keep or scrap. There is no hand-the-tablet-back step:
//    keeping a take files the reference angles in the background, so the saved
//    screen is up before the upload finishes and "Next client" never waits.
//  * "None of these" is a real exit, not a soft discard. A client who liked
//    nothing walks away with nothing on file — every take from the sitting is
//    scrapped (deleted, files included), because they never picked a winner
//    the near-misses would be worth comparing against.
//  * Consent is a screen, not a checkbox in a corner. A walk-in has no account
//    to carry consent on (see convex/chair.ts), so this tap is the only record
//    that exists — burying it would make the record worthless.
//  * Re-steering during a live take goes through `setPrompt`, not a restart.
//    Changing the cut mid-take costs nothing and keeps the client watching
//    themselves instead of a reconnect spinner. The same chip that STARTS a
//    take is the one that steers it, which is why both live on the same bar.
//  * "Try another" keeps the client and the camera and re-arms the stage.
//    Retries are the expected path, not an error path — the second or third
//    take is usually the one that gets approved.
//
// Errors never bounce the barber to the start. They surface in place with the
// take intact, the same rule the card's live mirror follows.
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@convex/_generated/api';
import type { Id } from '@convex/_generated/dataModel';
import { HAIRSTYLES, hairstyleBySlug, type Gender, type Hairstyle } from '@/data/hairstyles';
import { presentableError } from '@/lib/errors';
import { buildBarberPrompt, takeLabel } from '@/lib/lucy/barberPrompt';
import TakeDebugPanel from '@/components/chair/TakeDebugPanel';
import {
  ANGLE_SPECS,
  DECISION_CHIPS,
  MAX_TAKE_SECONDS,
  MAX_VISIT_CHIPS,
  MAX_VISIT_NOTE_LENGTH,
  coachLineAt,
  normalizeClientName,
  type AngleKey,
} from '@/lib/chair/angles';
import { pickAngleFrames } from '@/lib/chair/angleSelection';
import { extractFrames, measureTake, preloadLandmarker } from '@/lib/chair/frames';
import { MIN_CONFIDENCE, measureFaceShape, type FaceReading } from '@/lib/chair/faceMeasure';
import { SHAPE_LABELS } from '@/lib/chair/faceShape';
import { recommendCuts } from '@/lib/chair/recommend';
import { useChairTake } from '@/hooks/useChairTake';
import { useConvexUpload } from '@/hooks/useConvexUpload';
import { useDictation } from '@/hooks/useDictation';
import type { TakeRecording } from '@/lib/lucy/recorder';
import { localeFor, useT } from '@/lib/i18n';
import { useSettings } from '@/contexts/SettingsContext';
import LiveTryOnPreview from '@/components/LiveTryOnPreview';
import CountdownRing from './CountdownRing';

type Phase = 'name' | 'consent' | 'stage' | 'review' | 'saved';

/**
 * How many reference shots the barber picks off the review sheet. Two is the
 * least a cut can be worked from (a front alone lies about the sides); four is
 * where a reference sheet stops being a selection and starts being the take
 * again.
 */
const MIN_REFERENCE_PICKS = 2;
const MAX_REFERENCE_PICKS = 4;

/** One MediaPipe-nominated frame: the pick's geometry plus the decoded image. */
interface ReferenceShot {
  key: AngleKey;
  yawDeg: number;
  tMs: number;
  /** 0–1; zero means "placed by coach timing alone — check it". */
  confidence: number;
  blob: Blob;
  url: string;
}

interface ActiveClient {
  id: Id<'chairClients'>;
  name: string;
}

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

export default function ChairStation() {
  const t = useT();
  const { language } = useSettings();
  const upload = useConvexUpload();
  const budget = useQuery(api.chair.budgetStatus);
  const card = useQuery(api.chair.myCard);
  const startVisit = useMutation(api.chair.startVisit);
  const recordConsent = useMutation(api.chair.recordConsent);
  const approveTake = useMutation(api.chair.approveTake);
  const discardTake = useMutation(api.chair.discardTake);
  const scrapTake = useMutation(api.chair.scrapTake);
  const recordDecision = useMutation(api.chair.recordDecision);

  const take = useChairTake();

  const [phase, setPhase] = useState<Phase>('name');
  const [client, setClient] = useState<ActiveClient | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [phoneDraft, setPhoneDraft] = useState('');
  const [nameError, setNameError] = useState('');
  const [cut, setCut] = useState<Hairstyle | null>(null);
  // `tweak` is what has been ASKED FOR; `draft` is what's being typed. Keeping
  // them apart is what makes the prompt bar live: a half-typed sentence never
  // steers the model, and submitting doesn't clear the ask behind it.
  const [tweak, setTweak] = useState('');
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [gender, setGender] = useState<Gender>('mens');

  // Whether a take is actually in flight — i.e. whether the meter is running.
  // Not derived from take.status, because 'error' and 'idle' both mean "armed
  // and free" and the bar has to be able to tell the barber that.
  const [running, setRunning] = useState(false);

  // What the camera read off this client's face, and whether the barber has
  // asked to see the reasoning. `reading` is measured once per client and never
  // re-taken — see faceMeasure.ts for why settling beats improving.
  const [reading, setReading] = useState<FaceReading | null>(null);
  const [whyOpen, setWhyOpen] = useState(false);
  const measuredForRef = useRef<string | null>(null);

  const [takeId, setTakeId] = useState<Id<'chairTakes'> | null>(null);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);

  // ── the reference sheet, born on the review screen ──
  // The moment a take lands, MediaPipe walks the clip (measureTake), the
  // selection rules nominate the best frame per angle (pickAngleFrames), and
  // the winners are decoded at full size (extractFrames). `shots` holds the
  // nominees; `picked` holds the 2–4 the barber chose — the shots the cut will
  // actually be worked from.
  //
  // NOTE on `picked`: this is the barber's chosen reference set — we will
  // export this somewhere but export left up to interpretation (a client
  // handoff, a print sheet, the booking thread…). Keep the selection an
  // ordered, self-contained list so any exporter can consume it as-is.
  const [shots, setShots] = useState<ReferenceShot[] | 'working' | 'failed'>('working');
  const [picked, setPicked] = useState<AngleKey[]>([]);
  // Bumped when the chair moves on so a slow analysis can't deal frames onto
  // the next client's screen; the ref mirrors `shots` for URL cleanup.
  const shotsRunRef = useRef(0);
  const shotsRef = useRef<ReferenceShot[]>([]);

  // Every take this sitting produced, kept so "None of these" can scrap the
  // whole session — the near-misses too, not just the one on screen.
  const sessionTakesRef = useRef<Id<'chairTakes'>[]>([]);

  // The optional ten seconds after a save: the note and quick facts for next
  // time. 'saved' flips the button copy briefly so the barber knows it landed.
  const [visitNote, setVisitNote] = useState('');
  const [visitChips, setVisitChips] = useState<string[]>([]);
  const [decisionState, setDecisionState] = useState<'idle' | 'saving' | 'saved'>('idle');

  // What this client walked out with last time — the "like last time" card.
  // Skipped until a client is active; barber-facing only.
  const lastVisit = useQuery(
    api.chair.lastVisitContext,
    client ? { clientId: client.id } : 'skip',
  );

  // The background save of the kept take. 'saving' and 'saved' both render the
  // saved screen — the difference is one line of copy, never a blocked button.
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [savedAngles, setSavedAngles] = useState(0);
  // Bumped when the chair resets so a save finishing late can't paint state
  // over the next client's screen. The upload itself still lands.
  const saveRunRef = useRef(0);

  const [busy, setBusy] = useState(false);

  const outputVideoRef = useRef<HTMLVideoElement>(null);
  const selfViewRef = useRef<HTMLVideoElement>(null);

  /**
   * A weak measurement is treated as no measurement. Ranking six cuts off a
   * face the camera couldn't actually read would be worse than showing the
   * house order, because the barber can't tell the two apart on screen.
   */
  const trusted = reading && reading.confidence >= MIN_CONFIDENCE ? reading : null;

  const suggestions = useMemo(
    () => recommendCuts({ signals: trusted?.signals ?? null, gender }),
    [trusted, gender],
  );
  const menuCuts = useMemo(() => HAIRSTYLES.filter((c) => c.gender === gender), [gender]);

  // The ask as it currently stands — null when nobody has asked for anything,
  // which is exactly when there is nothing to start and nothing to charge.
  const prompt = useMemo(() => buildBarberPrompt({ cut, tweak }), [cut, tweak]);
  const label = useMemo(() => takeLabel({ cut, tweak }), [cut, tweak]);
  const takesLeft = budget?.takesLeftToday ?? null;

  // Object URLs are ours to free — a session of twenty takes would otherwise
  // pin every clip in memory for the whole shift.
  useEffect(() => {
    if (!reviewUrl) return;
    return () => URL.revokeObjectURL(reviewUrl);
  }, [reviewUrl]);

  // Attach live streams imperatively — srcObject isn't a React prop.
  useEffect(() => {
    if (outputVideoRef.current) outputVideoRef.current.srcObject = take.outputStream;
  }, [take.outputStream]);
  useEffect(() => {
    if (selfViewRef.current) selfViewRef.current.srcObject = take.cameraStream;
  }, [take.cameraStream]);

  // Warm the camera and the landmarker the moment the stage is armed, so the
  // first ask is instant rather than a permission prompt plus a 3MB load. None
  // of this costs a take — the meter starts at startTake, not here.
  useEffect(() => {
    if (phase !== 'stage') return;
    preloadLandmarker();
    void take.openCamera();
    // `take` is a stable bag of callbacks; re-running on every render would
    // re-request the camera on each keystroke in the tweak field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Read the client's face once, off the warm camera, while they're settling
  // into the chair. Never re-taken for the same client: a ranking that settles
  // is worth more than one that keeps improving under the barber's finger.
  useEffect(() => {
    if (phase !== 'stage' || !client || !take.cameraStream) return;
    if (measuredForRef.current === client.id) return;
    measuredForRef.current = client.id;

    const controller = new AbortController();
    void measureFaceShape(take.cameraStream, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        // A null reading is a normal outcome — bad light, a mask, a client who
        // won't look up. The house order stands and nothing is said about it.
        setReading(result);
      })
      .catch(() => {})
      .finally(() => {
        // An aborted measurement never happened; let the next visit retry.
        if (controller.signal.aborted) measuredForRef.current = null;
      });

    return () => controller.abort();
  }, [phase, client, take.cameraStream]);

  // ── the Today view's handoff: /chair?name=…&phone=…&booking=… ──
  // A booked client tapped "Seat in the chair", so skip the name screen and
  // open their visit directly. Runs once; the URL is cleaned so a reload
  // doesn't re-seat them.
  const router = useRouter();
  const searchParams = useSearchParams();
  const seatedFromParamsRef = useRef(false);
  useEffect(() => {
    if (seatedFromParamsRef.current) return;
    const name = searchParams?.get('name')?.trim();
    if (!name) return;
    seatedFromParamsRef.current = true;
    const phone = searchParams?.get('phone')?.trim() || undefined;
    const booking = searchParams?.get('booking') ?? undefined;
    router.replace('/chair');
    void startVisit({
      name,
      phone,
      bookingId: booking ? (booking as Id<'barberBookings'>) : undefined,
    })
      .then((result) => {
        setClient({ id: result.clientId, name: result.name });
        setCut(null);
        setTweak('');
        forgetFace();
        setPhase(result.needsConsent ? 'consent' : 'stage');
      })
      .catch(() => {
        // A bad handoff just lands on the name form — never a dead end mid-shift.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  /** A new head in the chair — the last client's proportions must not survive. */
  const forgetFace = useCallback(() => {
    setReading(null);
    setWhyOpen(false);
    measuredForRef.current = null;
  }, []);

  const submitName = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const check = normalizeClientName(nameDraft);
      if (!check.ok) {
        setNameError(
          check.reason === 'empty'
            ? t('Give this client a name so the cut files under it.')
            : t('That name’s too long.'),
        );
        return;
      }
      setBusy(true);
      try {
        const result = await startVisit({
          name: check.name,
          phone: phoneDraft.trim() || undefined,
        });
        setClient({ id: result.clientId, name: result.name });
        setCut(null);
        setTweak('');
        forgetFace();
        setPhase(result.needsConsent ? 'consent' : 'stage');
      } catch (err) {
        setNameError(t(presentableError(err, 'Couldn’t start that client.')));
      } finally {
        setBusy(false);
      }
    },
    [nameDraft, phoneDraft, startVisit, forgetFace, t],
  );

  const acceptConsent = useCallback(async () => {
    if (!client) return;
    setBusy(true);
    try {
      await recordConsent({ clientId: client.id });
      setPhase('stage');
    } catch {
      take.setError(t('Couldn’t save that. Try again.'));
    } finally {
      setBusy(false);
    }
  }, [client, recordConsent, take, t]);

  /** Free the sheet's object URLs and reset it to "being read". */
  const clearShots = useCallback(() => {
    shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url));
    shotsRef.current = [];
    setShots('working');
    setPicked([]);
  }, []);

  // A shift's worth of decoded frames would otherwise stay pinned in memory.
  useEffect(
    () => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)),
    [],
  );

  /**
   * Read the clip for the barber's contact sheet. Runs the moment the review
   * screen opens, so the shots are dealing themselves in while the client is
   * still watching the playback. A take with no readable frames is a normal
   * outcome (bad light, a mask) — the sheet just says so.
   */
  const analyzeRecording = useCallback(
    async (rec: TakeRecording) => {
      const run = ++shotsRunRef.current;
      clearShots();
      try {
        const { samples, measured } = await measureTake(rec.blob, rec.durationMs);
        const picks = pickAngleFrames(samples);
        const frames = await extractFrames(rec.blob, picks.map((p) => p.tMs));
        const items: ReferenceShot[] = [];
        picks.forEach((pick, i) => {
          const blob = frames[i];
          if (!blob) return;
          items.push({
            key: pick.key,
            yawDeg: pick.yawDeg,
            tMs: pick.tMs,
            confidence: measured ? pick.confidence : 0,
            blob,
            url: URL.createObjectURL(blob),
          });
        });
        if (shotsRunRef.current !== run) {
          // The chair moved on mid-read; these frames belong to nobody now.
          items.forEach((item) => URL.revokeObjectURL(item.url));
          return;
        }
        shotsRef.current = items;
        setShots(items);
      } catch {
        if (shotsRunRef.current === run) setShots('failed');
      }
    },
    [clearShots],
  );

  /** Tap a shot on or off. Hard-capped — a fifth tap does nothing until one is let go. */
  const togglePick = useCallback((key: AngleKey) => {
    setPicked((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= MAX_REFERENCE_PICKS) return prev;
      return [...prev, key];
    });
  }, []);

  // ── the take ──
  // Takes the ask as arguments rather than reading `cut`/`tweak` off state: the
  // tap that starts a take is the same tap that chooses the cut, and state set
  // in that handler isn't readable until the next render.
  const runTake = useCallback(
    async (nextCut: Hairstyle | null, nextTweak: string) => {
      if (!client || running) return;
      const nextPrompt = buildBarberPrompt({ cut: nextCut, tweak: nextTweak });
      if (!nextPrompt) return;

      // The first thing in this function that costs money is startTake, and it
      // is guarded on the meter the header is showing.
      if (takesLeft === 0) return;

      setRunning(true);
      setReviewUrl(null);

      const result = await take.startTake({
        clientId: client.id,
        cutLabel: takeLabel({ cut: nextCut, tweak: nextTweak }),
        cutSlug: nextCut?.slug,
        prompt: nextPrompt,
      });
      setRunning(false);

      if (!result) {
        // The hook has already surfaced why. The stage just goes back to armed
        // with the ask intact — nothing bounces to the name form, and the failed
        // attempt left the barber where they were standing.
        return;
      }

      setTakeId(result.takeId);
      sessionTakesRef.current.push(result.takeId);
      setReviewUrl(URL.createObjectURL(result.recording.blob));
      setPhase('review');
      void take.saveRecording(result.takeId, result.recording);
      // Start reading the clip for the contact sheet immediately — the shots
      // should be arriving while the client is still watching the playback.
      void analyzeRecording(result.recording);
    },
    [client, running, takesLeft, take, analyzeRecording],
  );

  /**
   * One ask, whatever state the stage is in. Armed, it starts the take (and
   * this is the only place in the chair that spends one). Running, it re-steers
   * the open connection — no reconnect, no second charge.
   */
  const commit = useCallback(
    (nextCut: Hairstyle | null, nextTweak: string) => {
      setCut(nextCut);
      setTweak(nextTweak);
      if (!running) {
        void runTake(nextCut, nextTweak);
        return;
      }
      const nextPrompt = buildBarberPrompt({ cut: nextCut, tweak: nextTweak });
      if (nextPrompt) take.setPrompt(nextPrompt);
    },
    [running, runTake, take],
  );

  const submitDraft = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const next = draft.trim();
      if (!next) return;
      commit(cut, next);
      setDraft('');
    },
    [draft, cut, commit],
  );

  // ── Speak the tweak instead of typing it ──
  // Dictation edits `draft` and nothing else: heard words land in the same box
  // typing does, so the barber reads them before they steer anything. `micBase`
  // is whatever was typed before the mic opened — words append to it while
  // listening, and cancelling puts it back exactly.
  const dictation = useDictation(localeFor(language));
  const micBaseRef = useRef('');
  useEffect(() => {
    if (!dictation.listening) return;
    const base = micBaseRef.current;
    setDraft(base && dictation.transcript ? `${base} ${dictation.transcript}` : base + dictation.transcript);
  }, [dictation.listening, dictation.transcript]);

  const micTap = useCallback(() => {
    if (dictation.listening) {
      dictation.stop();
    } else {
      micBaseRef.current = draft.trim();
      dictation.start();
    }
  }, [dictation, draft]);

  const micCancel = useCallback(() => {
    dictation.cancel();
    setDraft(micBaseRef.current);
  }, [dictation]);

  // ── "That's the one" → file it, quietly ──
  // The analysis already ran on the review screen and the barber already chose
  // the shots, so all that's left is housekeeping: upload the chosen frames and
  // pin the take. It runs while the saved screen is already up, so nobody in
  // the chair watches an upload bar and "Next client" never waits on the
  // network.
  const keepTake = useCallback(async () => {
    if (!takeId) return;
    // A failed analysis still lets the barber keep the cut — the take itself is
    // the record then, and the sheet is simply empty.
    const chosen = Array.isArray(shots) ? shots.filter((s) => picked.includes(s.key)) : [];
    const run = ++saveRunRef.current;
    setSaveState('saving');
    setPhase('saved');
    try {
      const angles = await Promise.all(
        chosen.map(async (shot) => ({
          key: shot.key,
          yawDeg: shot.yawDeg,
          tMs: shot.tMs,
          storageId: (await upload(shot.blob)).storageId,
          confidence: shot.confidence,
        })),
      );
      await approveTake({ takeId, angles });
      if (saveRunRef.current !== run) return; // the chair moved on — say nothing
      setSavedAngles(angles.length);
      setSaveState('saved');
    } catch {
      if (saveRunRef.current === run) setSaveState('error');
    }
  }, [takeId, shots, picked, upload, approveTake]);

  // Back to an armed stage with the ask still loaded: the camera stays open and
  // nothing is spent until they ask for the next one.
  const tryAnother = useCallback(() => {
    if (takeId) void discardTake({ takeId }).catch(() => {});
    shotsRunRef.current += 1; // a mid-read analysis is now nobody's sheet
    clearShots();
    setTakeId(null);
    setReviewUrl(null);
    setPhase('stage');
  }, [takeId, discardTake, clearShots]);

  const finishClient = useCallback(() => {
    take.closeCamera();
    saveRunRef.current += 1;
    shotsRunRef.current += 1;
    clearShots();
    sessionTakesRef.current = [];
    setClient(null);
    setCut(null);
    setTweak('');
    setDraft('');
    setMenuOpen(false);
    setRunning(false);
    setTakeId(null);
    setReviewUrl(null);
    setSaveState('idle');
    setSavedAngles(0);
    forgetFace();
    setVisitNote('');
    setVisitChips([]);
    setDecisionState('idle');
    setNameDraft('');
    setPhoneDraft('');
    setNameError('');
    setPhase('name');
  }, [take, forgetFace, clearShots]);

  // ── "None of these" → leave nothing behind ──
  // Scraps every take from this sitting, near-misses included. A client who
  // liked none of them never picked a winner, so there's nothing the discards
  // would be worth comparing against — they just become a record the client
  // didn't ask for.
  const scrapSession = useCallback(() => {
    const ids = [...sessionTakesRef.current];
    ids.forEach((id) => void scrapTake({ takeId: id }).catch(() => {}));
    finishClient();
  }, [scrapTake, finishClient]);

  // ── the decision: note + quick facts for next time ──
  const toggleChip = useCallback((chip: string) => {
    setDecisionState('idle');
    setVisitChips((prev) => {
      if (prev.includes(chip)) return prev.filter((c) => c !== chip);
      if (prev.length >= MAX_VISIT_CHIPS) return prev;
      return [...prev, chip];
    });
  }, []);

  const saveDecision = useCallback(async () => {
    if (!client) return;
    setDecisionState('saving');
    try {
      await recordDecision({ clientId: client.id, note: visitNote, chips: visitChips });
      setDecisionState('saved');
    } catch {
      setDecisionState('idle');
      take.setError(t('Couldn’t save that. Try again.'));
    }
  }, [client, visitNote, visitChips, recordDecision, take, t]);

  /** "Same as last time" — the shortcut a regular actually wants, as a chip. */
  const lastCut = useMemo(() => {
    const slug = lastVisit?.cutSlug;
    return (slug ? hairstyleBySlug(slug) : undefined) ?? null;
  }, [lastVisit]);

  const coachLine = coachLineAt(take.elapsedMs);
  const armedAndBroke = !running && takesLeft === 0;

  // The keep gate: enough shots picked to cut from. A short sheet lowers the
  // floor (one nominee can't yield two picks), and a failed read waives it —
  // the take itself is the record then.
  const minPicks = Array.isArray(shots) ? Math.min(MIN_REFERENCE_PICKS, shots.length) : MIN_REFERENCE_PICKS;
  const canKeep = shots === 'failed' || (Array.isArray(shots) && picked.length >= minPicks);

  return (
    <main className="chair" data-phase={phase}>
      <header className="chair-head">
        {/* The name screen is the home screen — a walk-in facing the tablet
            gets no back door and no meter, just the question. The take budget
            still gates on the server; it surfaces only if it actually runs out. */}
        {phase !== 'name' && (
          <button
            type="button"
            className="chair-back"
            onClick={running ? () => { take.cancelTake(); setRunning(false); } : finishClient}
          >
            <BackIcon />
            <span className="font-sans">{running ? t('Cancel take') : t('Done')}</span>
          </button>
        )}
        <span className="chair-head-title font-mono">
          {client ? client.name : t('Chair')}
        </span>
      </header>

      {/* useChairTake reports in the source language (it has no hook context of
          its own); t() looks the string up the same way the card's live mirror
          does. Server-supplied messages fall through untranslated. */}
      {take.error && (
        <p className="chair-error font-sans" role="alert">
          {t(take.error)}
        </p>
      )}

      {/* ── name: the home screen ── */}
      {phase === 'name' && (
        <section className="chair-panel" aria-label={t('New client')}>
          {card === null ? (
            <p className="chair-muted font-sans">
              {t('Set up your barber card first — that’s what the chair files clients under.')}
            </p>
          ) : (
            <>
              <h2 className="chair-title">{t('Who’s in the chair?')}</h2>
              <form className="chair-form" onSubmit={(e) => void submitName(e)}>
                <label className="chair-field">
                  <span className="font-mono">{t('Name')}</span>
                  <input
                    className="chair-input font-sans"
                    value={nameDraft}
                    onChange={(e) => { setNameDraft(e.target.value); setNameError(''); }}
                    placeholder={t('Marcus T.')}
                    autoFocus
                    autoComplete="off"
                    enterKeyHint="go"
                  />
                </label>
                <label className="chair-field">
                  <span className="font-mono">{t('Phone (optional)')}</span>
                  <input
                    className="chair-input font-sans"
                    type="tel"
                    inputMode="tel"
                    value={phoneDraft}
                    onChange={(e) => setPhoneDraft(e.target.value)}
                    placeholder="(415) 555-0134"
                    autoComplete="off"
                  />
                </label>
                {nameError && <p className="chair-error font-sans" role="alert">{nameError}</p>}
                <button type="submit" className="chair-btn is-primary" disabled={busy}>
                  {busy ? t('Starting…') : t('Start')}
                </button>
              </form>
            </>
          )}
        </section>
      )}

      {/* ── consent ── */}
      {phase === 'consent' && client && (
        <section className="chair-panel" aria-label={t('Before we film')}>
          <h2 className="chair-title">{t('Before we film, {name}', { name: client.name })}</h2>
          <div className="chair-consent font-sans">
            <p>
              {t('We’ll film up to 3 minutes of you in the chair and show your face with the haircut applied, so your barber can see it from every angle.')}
            </p>
            <p>
              {t('The clip and the reference photos are saved to your barber’s account under your name. Ask them to delete it any time and it’s gone.')}
            </p>
            {/* What the minute is FOR. The paragraphs above say what is
                filmed and where it goes; this one says the time is theirs to
                spend, and the drawing under it shows how. */}
            <p>
              {t('The next step will use the camera to style your hair. You have up to 3 minutes to explore which hairstyles fit you best! Use the prompt box and suggestions below to style.')}
            </p>
          </div>

          <LiveTryOnPreview tone="dark" />

          <div className="chair-actions">
            <button type="button" className="chair-btn is-primary" onClick={() => void acceptConsent()} disabled={busy}>
              {t('Let’s do it!')}
            </button>
            <button type="button" className="chair-btn" onClick={finishClient}>
              {t('No thanks')}
            </button>
          </div>
        </section>
      )}

      {/* ── stage: the recording UI, armed before it is running ──
            One screen for both states. Armed, the mirror fills it and nothing
            is being spent; the first chip or prompt below starts the clock and
            the model's own output takes the frame over. */}
      {phase === 'stage' && client && (
        <section className="chair-live" aria-label={t('Live try-on')}>
          <div className="chair-stage">
            {running && (
              <video
                ref={outputVideoRef}
                className="chair-output"
                autoPlay
                playsInline
                muted
                aria-label={t('Live preview of the new cut')}
              />
            )}
            {/* One element in both states — it only changes class — so starting
                a take never re-attaches the camera or blinks the picture. */}
            <video
              ref={selfViewRef}
              className={running ? 'chair-selfview' : 'chair-output'}
              autoPlay
              playsInline
              muted
              aria-hidden={running || undefined}
              aria-label={running ? undefined : t('The chair, before any haircut is applied')}
            />

            {running ? (
              take.status !== 'streaming' ? (
                <div className="chair-connecting" role="status">
                  <span className="chair-spinner" aria-hidden />
                  <p className="font-sans">{t('Getting the mirror ready…')}</p>
                </div>
              ) : (
                <>
                  <div className="chair-coach" role="status" aria-live="polite">
                    <p className="chair-coach-line">{t(coachLine)}</p>
                  </div>
                  <CountdownRing
                    elapsedMs={take.elapsedMs}
                    totalMs={MAX_TAKE_SECONDS * 1000}
                    label={t('{n} seconds left in this take', {
                      n: Math.ceil(Math.max(0, MAX_TAKE_SECONDS * 1000 - take.elapsedMs) / 1000),
                    })}
                  />
                </>
              )
            ) : (
              /* Says the quiet part out loud: the camera being on is not the
                 take starting, and the barber controls which second it does. */
              <p className="chair-armed font-sans" role="status">
                {takesLeft === 0
                  ? t('That’s every live take for today. They reset tomorrow morning.')
                  : t('Nothing running yet — the {n} seconds start when you pick a cut or say what you want.', {
                      n: MAX_TAKE_SECONDS,
                    })}
              </p>
            )}

            <button type="button" className="chair-flip" onClick={() => void take.flipCamera()} aria-label={t('Switch camera')}>
              <FlipIcon />
            </button>

            {/* The full menu is a sheet over the mirror, not a screen in front
                of it: the client stays on camera while the barber scrolls. */}
            {menuOpen && (
              <div className="chair-sheet" role="dialog" aria-label={t('Full menu')}>
                <div className="chair-menu-head">
                  <div className="chair-gender" role="group" aria-label={t('Menu')}>
                    {(['mens', 'womens'] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        className={`chair-gender-btn${gender === option ? ' is-on' : ''}`}
                        aria-pressed={gender === option}
                        onClick={() => setGender(option)}
                      >
                        {option === 'mens' ? t('Men’s') : t('Women’s')}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="chair-link" onClick={() => setMenuOpen(false)}>
                    {t('Close')}
                  </button>
                </div>
                {/*
                  Keyed on what determines the ORDER, so a re-rank remounts the
                  grid and the tiles pop back in staggered. Within one ranking
                  the order is frozen — nothing re-sorts under a descending
                  finger.
                */}
                <ul className="chair-cuts" key={gender}>
                  {menuCuts.map((option, i) => (
                    <li key={option.slug}>
                      <button
                        type="button"
                        className={`chair-cut is-popping${cut?.slug === option.slug ? ' is-on' : ''}`}
                        style={{ animationDelay: `${Math.min(i, 11) * 35}ms` }}
                        aria-pressed={cut?.slug === option.slug}
                        disabled={armedAndBroke}
                        onClick={() => { setMenuOpen(false); commit(option, tweak); }}
                      >
                        <img src={`/hair-previews/${option.slug}.png`} alt="" width={72} height={72} loading="lazy" />
                        <span className="font-sans">{option.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="chair-live-bar">
            {/* What they walked out with last time — the "same as last time"
                conversation, answered before it's asked. Armed only: once the
                take is running the mirror answers it better than the card. */}
            {!running && lastVisit && (
              <aside className="chair-lastvisit" aria-label={t('Last visit')}>
                {(lastVisit.posterUrl || lastVisit.angles[0]?.url) && (
                  <img
                    className="chair-lastvisit-thumb"
                    src={lastVisit.posterUrl ?? lastVisit.angles[0]!.url!}
                    alt={t('Reference from the last visit')}
                    loading="lazy"
                  />
                )}
                <div className="chair-lastvisit-body">
                  <span className="chair-lastvisit-head font-mono">
                    {t('Last time')} · {stamp(t, lastVisit.when)}
                  </span>
                  <span className="chair-lastvisit-cut font-sans">
                    {lastVisit.cutLabel ? t(lastVisit.cutLabel) : t('No cut on file')}
                    {lastVisit.chips?.length
                      ? ` · ${lastVisit.chips.map((chip) => t(chip)).join(' · ')}`
                      : ''}
                  </span>
                  {lastVisit.note && (
                    <span className="chair-lastvisit-note font-sans">“{lastVisit.note}”</span>
                  )}
                </div>
              </aside>
            )}

            <div className="chair-bar-head">
              <h3 className="chair-section font-mono">{t('Suggested')}</h3>
              <div className="chair-bar-links">
                {/*
                  Barber-facing only. The tablet is pointed at a stranger, so
                  what the camera worked out about their face lives behind a tap
                  the barber chooses to make — never in the client's eyeline.
                */}
                {trusted && (
                  <button
                    type="button"
                    className="chair-link"
                    aria-expanded={whyOpen}
                    onClick={() => setWhyOpen((v) => !v)}
                  >
                    {whyOpen ? t('Hide reasons') : t('Why these?')}
                  </button>
                )}
                <button type="button" className="chair-link" onClick={() => setMenuOpen(true)}>
                  {t('Full menu ({n} cuts)', { n: menuCuts.length })}
                </button>
              </div>
            </div>

            {trusted && whyOpen && (
              <div className="chair-why font-sans">
                <p className="chair-why-shape font-mono">
                  {t(SHAPE_LABELS[trusted.shape])}
                  {' · '}
                  {t('{n}% sure', { n: Math.round(trusted.confidence * 100) })}
                </p>
                <ul className="chair-why-list">
                  {suggestions.map((s) => (
                    <li key={s.cut.slug}>
                      <span className="chair-why-cut">{t(s.cut.label)}</span>
                      <span className="chair-why-reason">{s.why ? t(s.why) : t('House favourite')}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* The same chips before and during the take. Tapping one is the
                ask: armed it starts the take clock, running it re-steers it. */}
            <ul
              className="chair-steer"
              key={`${gender}-${trusted ? 'ranked' : 'house'}`}
              aria-label={running ? t('Switch the cut live') : t('Pick a cut')}
            >
              {lastCut && (
                <li>
                  <button
                    type="button"
                    className="chair-steer-chip"
                    disabled={armedAndBroke}
                    onClick={() => commit(lastCut, tweak)}
                  >
                    {t('Same again')}
                  </button>
                </li>
              )}
              {suggestions.map((s, i) => (
                <li key={s.cut.slug}>
                  <button
                    type="button"
                    className={`chair-steer-chip is-popping${cut?.slug === s.cut.slug ? ' is-on' : ''}`}
                    style={{ animationDelay: `${i * 35}ms` }}
                    aria-pressed={cut?.slug === s.cut.slug}
                    disabled={armedAndBroke}
                    onClick={() => commit(s.cut, tweak)}
                  >
                    <img src={`/hair-previews/${s.cut.slug}.png`} alt="" width={26} height={26} loading="lazy" />
                    <span>{t(s.cut.label)}</span>
                  </button>
                </li>
              ))}
            </ul>

            {/* Typing is the other way to ask. Armed it starts the take with
                those words; running it re-steers without a reconnect. */}
            <form className="chair-prompt" onSubmit={submitDraft}>
              <input
                className="chair-prompt-input font-sans"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={dictation.listening ? t('Listening…') : t('Tighter on the sides, leave the fringe')}
                aria-label={running ? t('Change the cut while it’s running') : t('Say what you want')}
                disabled={armedAndBroke}
                enterKeyHint="go"
              />
              {/* The mic is the same button in both states: a quiet outline at
                  rest, and the liquid-glass orb while listening. Tapping the
                  orb keeps the words; the X beside it throws them away. */}
              {dictation.supported && (
                <button
                  type="button"
                  className={`chair-mic${dictation.listening ? ' is-listening' : ''}`}
                  aria-label={dictation.listening ? t('Stop dictation') : t('Dictate instead of typing')}
                  aria-pressed={dictation.listening}
                  disabled={armedAndBroke}
                  onClick={micTap}
                >
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                    <path d="M19 10v1a7 7 0 0 1-14 0v-1" />
                    <path d="M12 18v4" />
                  </svg>
                </button>
              )}
              {dictation.listening ? (
                <button
                  type="button"
                  className="chair-mic-cancel"
                  onClick={micCancel}
                  aria-label={t('Cancel dictation')}
                >
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              ) : (
                <button
                  type="submit"
                  className="chair-prompt-go"
                  disabled={!draft.trim() || armedAndBroke}
                  aria-label={t('Go')}
                >
                  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </button>
              )}
            </form>
            {dictation.error && (
              <p className="chair-muted font-sans" role="status">
                {dictation.error === 'blocked'
                  ? t('The mic is blocked — allow microphone access in the browser and try again.')
                  : t('Couldn’t hear you — try the mic again.')}
              </p>
            )}

            {running ? (
              <button type="button" className="chair-btn is-primary" onClick={take.stopTake}>
                {t('Stop early')}
              </button>
            ) : (
              /* Only ever a re-run of an ask that already exists — after "Try
                 another", the cut is still loaded and this saves re-tapping it.
                 Disabled until something has been asked for, because with
                 nothing asked there is nothing to spend a take on. */
              <button
                type="button"
                className="chair-btn is-primary"
                onClick={() => void runTake(cut, tweak)}
                disabled={!prompt || takesLeft === 0}
              >
                {takesLeft === 0
                  ? t('No takes left today')
                  : t('Start the {n}s take', { n: MAX_TAKE_SECONDS })}
              </button>
            )}

            <TakeDebugPanel info={take.debugInfo} />
          </div>
        </section>
      )}

      {/* ── review ── */}
      {phase === 'review' && reviewUrl && (
        <section className="chair-panel" aria-label={t('Review the take')}>
          <h2 className="chair-title">{t('That’s {cut}. Is that it?', { cut: label })}</h2>
          <video className="chair-playback" src={reviewUrl} controls autoPlay loop playsInline />

          {/* The contact sheet, dealt onto the screen as MediaPipe finishes
              reading the clip. Each shot lands big and settles into place, one
              after another; tapping 2–4 of them is what the save will file. */}
          <div className="chair-shots-block">
            <h3 className="chair-section font-mono">{t('Reference shots')}</h3>

            {shots === 'working' && (
              <p className="chair-muted font-sans" role="status">
                {t('Reading the take for the sharpest angles…')}
              </p>
            )}
            {shots === 'failed' && (
              <p className="chair-muted font-sans">
                {t('Couldn’t read reference shots out of this take. You can still keep the cut.')}
              </p>
            )}
            {Array.isArray(shots) && shots.length === 0 && (
              <p className="chair-muted font-sans">
                {t('No clear frames in that take — try another with steadier light.')}
              </p>
            )}

            {Array.isArray(shots) && shots.length > 0 && (
              <>
                <p className="chair-muted font-sans">
                  {t('Tap the 2–4 shots the barber should cut from.')}
                </p>
                <ul className="chair-shots">
                  {shots.map((shot, i) => {
                    const on = picked.includes(shot.key);
                    const spec = ANGLE_SPECS.find((s) => s.key === shot.key);
                    return (
                      <li key={shot.key}>
                        <button
                          type="button"
                          className={`chair-shot is-landing${on ? ' is-picked' : ''}`}
                          style={{ animationDelay: `${i * 140}ms` }}
                          aria-pressed={on}
                          onClick={() => togglePick(shot.key)}
                        >
                          {/* The label names the shot; the img is its picture. */}
                          <img src={shot.url} alt="" />
                          <span className="chair-shot-label font-mono">
                            {spec ? t(spec.label) : shot.key}
                          </span>
                          <span className={`chair-shot-check${on ? ' is-on' : ''}`} aria-hidden>
                            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
                              <path d="M20 6 9 17l-5-5" />
                            </svg>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {shots.every((s) => s.confidence === 0) && (
                  /* The fallback sheet: placed by coach timing, not by a face
                     the camera actually read. Honest about it, per
                     angleSelection.ts. */
                  <p className="chair-muted font-sans">
                    {t('The camera couldn’t verify these angles — check them before you save.')}
                  </p>
                )}
              </>
            )}
          </div>

          <div className="chair-actions">
            <button
              type="button"
              className="chair-btn is-primary"
              onClick={() => void keepTake()}
              disabled={!canKeep}
            >
              {shots === 'working' ? t('Reading the take…') : t('Yes — that’s the one')}
            </button>
            <button type="button" className="chair-btn" onClick={tryAnother}>
              {t('Try another')}
            </button>
            {/* The real exit for a client who liked nothing: every take from
                this sitting is deleted, files included — no quiet record. */}
            <button type="button" className="chair-btn is-scrap" onClick={scrapSession}>
              {t('None of these — save nothing')}
            </button>
          </div>
        </section>
      )}

      {/* ── saved ── */}
      {phase === 'saved' && saveState === 'error' && (
        <section className="chair-panel chair-saved" aria-label={t('Save failed')}>
          <h2 className="chair-title">{t('Couldn’t save that take')}</h2>
          <p className="chair-muted font-sans">
            {t('The clip is still here. Check the connection and try again.')}
          </p>
          <div className="chair-actions">
            <button type="button" className="chair-btn is-primary" onClick={() => void keepTake()}>
              {t('Try saving again')}
            </button>
            <button type="button" className="chair-btn is-scrap" onClick={scrapSession}>
              {t('Scrap it — save nothing')}
            </button>
          </div>
        </section>
      )}

      {phase === 'saved' && saveState !== 'error' && (
        <section className="chair-panel chair-saved" aria-label={t('Saved')}>
          <h2 className="chair-title">
            {saveState === 'saving'
              ? t('Saving under {name}…', { name: client?.name ?? '' })
              : t('Filed under {name}', { name: client?.name ?? '' })}
          </h2>
          <p className="chair-muted font-sans">
            {saveState === 'saving'
              ? t('The reference angles are filing themselves in the background — no need to wait.')
              : t('{n} reference shots saved under this client.', { n: savedAngles })}
          </p>

          {/* The optional ten seconds that make next time faster. Entirely
              skippable — "Next client" stays the primary action. */}
          <div className="chair-decide">
            <h3 className="chair-section font-mono">{t('For next time (optional)')}</h3>
            <div className="chair-decide-chips" role="group" aria-label={t('Quick facts')}>
              {DECISION_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  className={`chair-steer-chip${visitChips.includes(chip) ? ' is-on' : ''}`}
                  aria-pressed={visitChips.includes(chip)}
                  onClick={() => toggleChip(chip)}
                >
                  {chip.startsWith('#') ? chip : t(chip)}
                </button>
              ))}
            </div>
            <label className="chair-field">
              <span className="font-mono">{t('Note for next time')}</span>
              <input
                className="chair-input font-sans"
                value={visitNote}
                maxLength={MAX_VISIT_NOTE_LENGTH}
                onChange={(e) => {
                  setVisitNote(e.target.value);
                  setDecisionState('idle');
                }}
                placeholder={t('Went 0.5 lower on the sides than usual')}
              />
            </label>
            <button
              type="button"
              className="chair-btn"
              onClick={() => void saveDecision()}
              disabled={
                decisionState === 'saving' || (!visitNote.trim() && visitChips.length === 0)
              }
            >
              {decisionState === 'saved'
                ? t('Noted — it’ll be here next visit')
                : decisionState === 'saving'
                  ? t('Saving…')
                  : t('Save note')}
            </button>
          </div>

          <div className="chair-actions">
            <button type="button" className="chair-btn is-primary" onClick={finishClient}>
              {t('Next client')}
            </button>
            {/* Rebooking lands hardest while they're still in the chair. */}
            {card?.bookingEnabled && (
              <a
                href={`/b/${card.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="chair-btn"
              >
                {t('Book next visit ↗')}
              </a>
            )}
          </div>
        </section>
      )}
    </main>
  );
}

function stamp(t: (en: string, vars?: Record<string, string | number>) => string, ms: number): string {
  const mins = Math.max(1, Math.round((Date.now() - ms) / 60_000));
  if (mins < 60) return t('{n}m ago', { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t('{n}h ago', { n: hours });
  return t('{n}d ago', { n: Math.round(hours / 24) });
}
