import { notFound } from 'next/navigation';
import FitLab from './FitLab';

// Dev-only: explains the per-head catalog fit on data in public/lab/ (gitignored). Not part of the product.
export default function FitLabPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <FitLab />;
}
