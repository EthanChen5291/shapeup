// Every /barber page shares one shell, mounted here rather than inside each
// page. That is the whole reason tab switches feel like tab switches: React
// keeps the header, the Clerk session and the settings drawer's card query
// mounted across the navigation and re-renders only the panel below.
//
// Stays a server component — the shell itself is the client boundary, so the
// tab frame costs nothing extra on the wire.

import BarberShell from '@/components/barber/BarberShell';

export default function BarberLayout({ children }: { children: React.ReactNode }) {
  return <BarberShell>{children}</BarberShell>;
}
