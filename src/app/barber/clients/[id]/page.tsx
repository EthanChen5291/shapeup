'use client';

// /barber/clients/[id] — one client's profile: reference strip per visit,
// standing preferences, every take, and the erase button.

import { useParams } from 'next/navigation';
import type { Id } from '@convex/_generated/dataModel';
import ClientProfile from '@/components/barber/ClientProfile';

export default function BarberClientPage() {
  const params = useParams<{ id: string }>();
  return params?.id ? <ClientProfile clientId={params.id as Id<'chairClients'>} /> : null;
}
