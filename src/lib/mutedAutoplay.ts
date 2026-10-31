// Start a muted, decorative <video> without waiting for a click on it.
//
// play() can be rejected on page load: React sets `muted` only as a DOM
// property (some browsers' autoplay checks look for the attribute), and Safari
// Low Power Mode or a "never auto-play" setting refuse play() until the page has
// a user gesture. A single silent play() on mount therefore left the landing
// hero frozen until someone happened to click its arrows.
//
// So: mark the video muted both ways, try now, retry once data has loaded, and
// otherwise start on the visitor's first interaction anywhere on the page.
// Returns a cleanup that cancels any pending retry (call it when the video is
// swapped out, so a later gesture can't restart a hidden video).

// iOS Safari grants playback permission on touchend/click, not touchstart.
const GESTURES = ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown', 'wheel', 'scroll'] as const;

export function startMutedAutoplay(video: HTMLVideoElement, playbackRate = 1): () => void {
  video.muted = true;
  video.defaultMuted = true;
  video.setAttribute('muted', '');

  let done = false;
  const cancel = () => {
    if (done) return;
    done = true;
    video.removeEventListener('loadeddata', attempt);
    for (const g of GESTURES) window.removeEventListener(g, attempt);
  };

  function attempt() {
    if (done) return;
    video.playbackRate = playbackRate;
    video.play().then(cancel, () => {});
  }

  video.addEventListener('loadeddata', attempt);
  for (const g of GESTURES) window.addEventListener(g, attempt, { passive: true });
  attempt();
  return cancel;
}
