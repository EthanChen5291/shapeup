// When the landing page's orbiting "glimpse" wheel animates. It used to pause at
// a 10% visibility threshold: with a 960px section that froze it while ~96px —
// the satellite tips — were still on screen. Now it runs until the section is
// fully off-screen (threshold 0) and wakes a little before it scrolls back in.
export const GLIMPSE_OBSERVER_OPTIONS: IntersectionObserverInit = {
  threshold: 0,
  rootMargin: '120px 0px',
};
