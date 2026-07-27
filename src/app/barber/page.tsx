// /barber — the dashboard is gone; the chair IS the barber app now. Old links,
// bookmarks and muscle memory still land here, so send them straight to the
// one page that does the work. The card builder stays at /barber/card.

import { redirect } from 'next/navigation';

export default function BarberIndexPage() {
  redirect('/chair');
}
