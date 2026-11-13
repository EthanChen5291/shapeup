import { notFound } from 'next/navigation';
import TurntableLab from './TurntableLab';

// Dev-only: a head from public/lab/ (gitignored) wearing catalog try-ons, posed frame by frame
// by scripts/turntable-gif.mjs to make the README GIF. Not part of the product.
export default function TurntableLabPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <TurntableLab />;
}
