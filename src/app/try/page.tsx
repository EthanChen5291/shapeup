'use client';

// /try — the consumer studio landing, kept when / went barber-first. Clients
// normally arrive through a barber's card (/b/<slug>); this is the direct
// door for someone who just wants to try a cut on themselves.

import { useRouter } from 'next/navigation';
import LandingPage from '@/components/LandingPage';

export default function TryPage() {
  const router = useRouter();
  return <LandingPage onEnter={() => router.push('/dashboard')} />;
}
