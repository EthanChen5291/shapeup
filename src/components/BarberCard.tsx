'use client';

// ============================================================
// BarberCard — the public /b/<slug> page.
//
// Reached by a phone camera pointed at a QR code taped to a barbershop mirror,
// so it is mobile-first: one column, big targets, labels that don't need a
// hover. On desktop it becomes a split composition divided by a diagonal seam:
//
//   LEFT  — the barber, and only the barber: photo, name, shop, location,
//           bio, hours, services, booking + social links.
//   RIGHT — the ShapeUp experience, and only that: the LIVE MIRROR itself —
//           camera on, the haircut applied to moving video, the client steering
//           it in their own words. There is no choice screen, no lookbook
//           detour, and no photo step in front of it; cut suggestions are
//           chips inside the flow. (The builder's inert preview shows a static
//           lookbook instead — sign-in and a camera have no business there.)
//
// The page commits to the dark studio palette (--void/--surface/--coral) —
// the same tokens the rest of the app's dark mode uses, not a new scheme —
// with Montserrat for display type. Mobile keeps the required vertical order
// via a `display: contents` side wrapper + flex `order`: barber summary →
// discovery/flow → details & booking.
//
// Every outbound link to ShapeUp carries the barber's referral code, which is
// how a client who signs up here gets attributed back to the barber who sent
// them. Counters (view / tryOn / linkClick / bookingClick and the funnel
// events inside BarberLiveTryOn) are the barber's evidence the QR is earning its
// place on the mirror — all fire-and-forget, a dropped count never breaks
// the page.
// ============================================================

import { useEffect, useRef, useState } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@convex/_generated/api';
import { HAIRSTYLES, hairstyleBySlug, type Hairstyle } from '@/data/hairstyles';
import BarberLiveTryOn from '@/components/BarberLiveTryOn';
import BarberBooking from '@/components/BarberBooking';
import type { LinkKind } from '@/lib/barberLinks';
import { useT } from '@/lib/i18n';

export interface BarberCardData {
  slug: string;
  displayName: string;
  shopName?: string;
  bio?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  location?: string;
  hours?: string;
  services?: { name: string; price?: string }[];
  links: { kind: string; label: string; url: string }[];
  styles: string[];
  referralCode?: string;
  /** Native scheduling — present only when the barber turned it on. */
  booking?: {
    timezone: string;
    slotMinutes: number;
    days: { day: number; start: string; end: string }[];
  };
}

/** Preview-only: the builder renders the same card without touching the counters. */
interface BarberCardProps {
  page: BarberCardData;
  preview?: boolean;
}

// ── icons (stroke 2, 20px, one family — never emoji) ──
const iconProps = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const LINK_ICONS: Record<LinkKind, React.ReactNode> = {
  booking: (
    <svg {...iconProps}>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4" />
    </svg>
  ),
  instagram: (
    <svg {...iconProps}>
      <rect x="2" y="2" width="20" height="20" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <path d="M17.5 6.5h.01" />
    </svg>
  ),
  tiktok: (
    <svg {...iconProps}>
      <path d="M9 12a4 4 0 1 0 4 4V4a5 5 0 0 0 5 5" />
    </svg>
  ),
  venmo: (
    <svg {...iconProps}>
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  cashapp: (
    <svg {...iconProps}>
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  phone: (
    <svg {...iconProps}>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.4 1.8.6 2.8.8a2 2 0 0 1 1.7 2z" />
    </svg>
  ),
  sms: (
    <svg {...iconProps}>
      <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5z" />
    </svg>
  ),
  maps: (
    <svg {...iconProps}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  website: (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  custom: (
    <svg {...iconProps}>
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </svg>
  ),
};

function ChevronIcon() {
  return (
    <svg {...iconProps} width={16} height={16} style={{ flexShrink: 0, opacity: 0.4 }}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg {...iconProps} width={14} height={14}>
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg {...iconProps} width={14} height={14}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

/** Their initials, when there's no photo — better than a grey silhouette. */
function monogram(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

export default function BarberCard({ page, preview = false }: BarberCardProps) {
  const t = useT();
  const recordEvent = useMutation(api.barberPages.recordEvent);
  const countedView = useRef(false);

  const [activeCut, setActiveCut] = useState<Hairstyle | null>(null);
  const bookingRef = useRef<HTMLDivElement>(null);

  // "Book with {name}" CTAs: native scheduler when the barber turned it on
  // (scroll the panel into view), otherwise their external booking link.
  const scrollToBooking = () => {
    const el = bookingRef.current;
    if (!el || typeof el.scrollIntoView !== 'function') return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  };

  // One view per mount. Fire-and-forget: a failed count must never break the page.
  useEffect(() => {
    if (preview || countedView.current) return;
    countedView.current = true;
    void recordEvent({ slug: page.slug, kind: 'view' }).catch(() => {});
  }, [preview, page.slug, recordEvent]);

  const count = (kind: 'tryOn' | 'linkClick' | 'bookingClick', cutSlug?: string) => {
    if (preview) return;
    void recordEvent({ slug: page.slug, kind, cutSlug }).catch(() => {});
  };

  const ref = page.referralCode;

  // This page is the barber's recommendation ticket, not the full ShapeUp
  // catalog. Only their selected cuts belong here; unknown/stale slugs are
  // dropped safely so a removed hairstyle can never render a broken card.
  const picks = page.styles.map(hairstyleBySlug).filter((cut) => cut !== undefined);
  // The preview's static lookbook: the barber's picks, or a taste of the menu
  // when they haven't chosen any.
  const lookbook = picks.length ? picks : HAIRSTYLES.slice(0, 8);

  const bookingUrl = page.links.find((link) => link.kind === 'booking')?.url;
  return (
    <div className={`bc-root${preview ? ' is-embedded' : ''}`}>
      {/* Dark editorial banner behind the barber's identity. On desktop it is
          clipped to the left side of the diagonal seam; on mobile it spans
          the full card width and fades out through the name. */}
      <div
        className="bc-banner"
        aria-hidden
        style={page.bannerUrl ? ({ '--bc-banner-url': `url("${page.bannerUrl}")` } as React.CSSProperties) : undefined}
      />

      {/* Decorative diagonal seam — desktop only, drawn behind the columns. */}
      <div className="bc-seam" aria-hidden />

      <main className="bc-layout">
        <aside className="bc-side">
          {/* ── 1 · who the barber is ── */}
          <header className="bc-who">
            {page.avatarUrl ? (
              <img
                className="bc-avatar"
                src={page.avatarUrl}
                alt={t('Photo of {name}', { name: page.displayName })}
                width={116}
                height={116}
              />
            ) : (
              <div className="bc-avatar bc-avatar-mono" aria-hidden>
                {monogram(page.displayName)}
              </div>
            )}
            <div className="bc-who-text">
              {page.shopName ? <p className="bc-shop font-mono">{page.shopName}</p> : null}
              <h1 className="bc-name">{page.displayName}</h1>
              {page.location ? (
                <a
                  className="bc-location font-sans"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(page.location)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t('Open {location} in Google Maps', { location: page.location })}
                >
                  <PinIcon />
                  {page.location}
                </a>
              ) : null}
            </div>
            {page.bio ? <p className="bc-bio font-sans">{page.bio}</p> : null}
          </header>

          {/* ── 3 · the barber's details: hours, services, links ── */}
          <div className="bc-details">
            {page.hours ? (
              <p className="bc-hours font-sans">
                <ClockIcon />
                {page.hours}
              </p>
            ) : null}

            {page.services && page.services.length > 0 ? (
              <section className="bc-services" aria-label={t('Services')}>
                <h2 className="bc-side-heading font-mono">{t('Services')}</h2>
                <ul className="bc-service-list">
                  {page.services.map((service, i) => (
                    <li key={`${service.name}-${i}`} className="bc-service font-sans">
                      <span className="bc-service-name">{service.name}</span>
                      {service.price ? (
                        <span className="bc-service-price font-mono">{service.price}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {page.booking ? (
              <div ref={bookingRef}>
                <BarberBooking
                  slug={page.slug}
                  barberName={page.displayName}
                  shopName={page.shopName}
                  location={page.location}
                  services={page.services}
                  booking={page.booking}
                  cutLabel={activeCut?.label}
                  preview={preview}
                  onBooked={() => count('bookingClick')}
                />
              </div>
            ) : null}

            {page.links.length > 0 ? (
              <nav className="bc-links" aria-label={t('Links')}>
                {page.links.map((link, i) => (
                  <a
                    key={`${link.kind}-${i}`}
                    className={`bc-link${link.kind === 'booking' ? ' is-booking' : ''}`}
                    href={link.url}
                    target={link.url.startsWith('http') ? '_blank' : undefined}
                    rel="noopener noreferrer"
                    onClick={() => {
                      count('linkClick');
                      if (link.kind === 'booking') count('bookingClick');
                    }}
                  >
                    <span className="bc-link-icon" aria-hidden>
                      {LINK_ICONS[link.kind as LinkKind] ?? LINK_ICONS.custom}
                    </span>
                    <span className="bc-link-label font-sans">{link.label}</span>
                    <ChevronIcon />
                  </a>
                ))}
              </nav>
            ) : null}

            <footer className="bc-foot">
              <a
                className="bc-foot-link font-mono"
                href={ref ? `/for-barbers?ref=${ref}` : '/for-barbers'}
              >
                {t('Fitting room by ShapeUp')}
              </a>
            </footer>
          </div>
        </aside>

        {/* ── 2 · the ShapeUp experience: the live mirror, nothing in front ── */}
        <section className="bc-exp" aria-live="polite">
          {!preview ? (
            <>
              <div className="bc-book-head">
                <p className="bc-book-eyebrow font-mono">{t('Virtual try-on')}</p>
                <h2 className="bc-book-title">{t('See your next cut on you, live')}</h2>
              </div>
              <BarberLiveTryOn
                barberSlug={page.slug}
                barberName={page.displayName}
                cut={picks[0] ?? HAIRSTYLES[0]}
                referralCode={ref}
                bookingUrl={bookingUrl}
                onBook={page.booking ? scrollToBooking : undefined}
                onCutChange={setActiveCut}
                barberPicks={picks}
                menuCuts={HAIRSTYLES}
              />
            </>
          ) : (
            /* The builder's inert preview: the live flow can't run in that
               frame (sign-in, camera), so show the lookbook it will offer. */
            <div className="bc-book">
              <div className="bc-book-head">
                <p className="bc-book-eyebrow font-mono">{t('Virtual try-on')}</p>
                <h2 className="bc-book-title">{t('See your next cut on you, live')}</h2>
                <p className="bc-book-sub font-sans">{t('Clients get a live mirror here — these are the cuts it will suggest.')}</p>
              </div>
              <div className="bc-lookbook">
                <div className="bc-look-head">
                  <h3 className="bc-side-heading font-mono">
                    {picks.length ? t('Barber’s picks') : t('From the menu')}
                  </h3>
                </div>
                <ul className="bc-grid">
                  {lookbook.map((cut) => (
                    <li key={cut.slug}>
                      <div className="bc-tile" aria-label={t(cut.label)}>
                        <img src={`/hair-previews/${cut.slug}.png`} alt="" loading="lazy" width={118} height={118} />
                        <span className="bc-tile-label">{t(cut.label)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
