// ♂ / ♀ glyphs for the "which cuts are showing" toggles (trending cuts, try-ons).
export default function GenderIcon({ gender }: { gender: 'mens' | 'womens' }) {
  return gender === 'mens' ? (
    // Mars — men's styles are showing
    <svg key="mens" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="9.5" cy="14.5" r="5" />
      <line x1="13.5" y1="10.5" x2="20" y2="4" />
      <polyline points="14.5 4 20 4 20 9.5" />
    </svg>
  ) : (
    // Venus — women's styles are showing
    <svg key="womens" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8.5" r="5" />
      <line x1="12" y1="13.5" x2="12" y2="22" />
      <line x1="8.5" y1="19" x2="15.5" y2="19" />
    </svg>
  );
}
