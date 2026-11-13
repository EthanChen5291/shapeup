import { notFound } from 'next/navigation';
import AxesLab from './AxesLab';

// Dev-only: why <Splat rotation={[-π/2, π, π]}> shows a FaceLift head upright. Data in public/lab/ (gitignored).
export default function AxesLabPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <AxesLab />;
}
