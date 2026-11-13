import { notFound } from 'next/navigation';
import FitAnim from './FitAnim';

// Dev-only: animated 3D companion to /lab/fit, on data in public/lab/ (gitignored). Not part of the product.
export default function FitAnimPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <FitAnim />;
}
