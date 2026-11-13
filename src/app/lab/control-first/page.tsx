import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import ControlFirstLab from './ControlFirstLab';

// Dev-only: loads whatever is in public/lab/ (gitignored). Not part of the product.
export default function ControlFirstPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return (
    <Suspense fallback={null}>
      <ControlFirstLab />
    </Suspense>
  );
}
