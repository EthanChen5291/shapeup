// A short line of text as a note on a crumpled till receipt: the paper sits behind it (CSS,
// .crumpled-note in globals.css) and the letters are nudged and shaded to match (lib/crumpledText).
// Used for the punchline of the landing's problem headline.

import { Fragment } from 'react';
import { crumpleText } from '@/lib/crumpledText';

export default function CrumpledNote({ text }: { text: string }) {
  return (
    <span className="crumpled-note">
      {/* Screen readers get the phrase whole; the letter-by-letter copy below is only for the eye. */}
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {crumpleText(text).map((word, w) => (
          <Fragment key={w}>
            {w > 0 && ' '}
            <span className="crumpled-note__word">
              {word.map((letter, i) => (
                <span
                  key={i}
                  className="crumpled-note__letter"
                  style={{
                    transform: `translateY(${letter.shift}em) rotate(${letter.tilt}deg)`,
                    '--ink': `linear-gradient(${letter.angle}deg, ${letter.from}, ${letter.to})`,
                  } as React.CSSProperties}
                >
                  {letter.char}
                </span>
              ))}
            </span>
          </Fragment>
        ))}
      </span>
    </span>
  );
}
