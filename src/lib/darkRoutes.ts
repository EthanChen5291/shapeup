// ============================================================
// Which surfaces are dark — the whole answer, in one place.
//
// ShapeUp has no light mode and no theme preference: the app (the dashboard,
// the chair, admin) is the dark studio, always. It pairs with the chair, which
// is a tablet on a mirror in a dim shop, and a barber flipping their dashboard
// to a bright cream page mid-shift was never something anyone asked for.
//
// Everything NOT listed here stays on the warm biscuit brand palette — the
// landing page, /for-barbers, pricing, legal, sign-in, and the client-facing
// card at /b/<slug>. Those aren't "light mode"; they're their own design, and
// they simply never receive `.dark`.
//
// Lives in a plain module (not SettingsContext) so the server layout can read
// the list for its pre-paint script without pulling in the client boundary.
// ============================================================

export const DARK_ROUTE_PREFIXES = ['/barber', '/chair', '/admin', '/admin-admin'];

/**
 * True when `pathname` is an app surface, i.e. one that renders dark. Prefix
 * match on path segments, so /barber covers /barber/clients/<id> while
 * /barbershop (a different page entirely) is left alone.
 */
export function isDarkOnlyRoute(pathname: string): boolean {
  return DARK_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
