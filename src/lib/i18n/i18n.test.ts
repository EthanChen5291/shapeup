import { describe, test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { es } from './es';
import { ja } from './ja';
import { translate, localeFor } from './index';
import { ANGLE_SPECS } from '@convex/lib/chair';
import { COACH_SCRIPT, DECISION_CHIPS } from '@/lib/chair/angles';
import { SHAPE_LABELS } from '@/lib/chair/faceShape';
import { suggestionReasons } from '@/lib/chair/recommend';
import { HAIRSTYLES } from '@/data/hairstyles';

const SRC = path.resolve(__dirname, '../..');

/** Every `t('literal')` / `t("literal")` first argument found under src/. */
function literalKeysInSource(): Map<string, string[]> {
  const files: string[] = [];
  (function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(p);
    }
  })(SRC);

  const found = new Map<string, string[]>();
  // First argument of t(...) when it is a plain string literal. Template
  // literals carrying `${}` are skipped — they can't be dictionary keys.
  const call = /\bt\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  for (const file of files) {
    if (file.includes(path.join('lib', 'i18n'))) continue;
    const source = fs.readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = call.exec(source))) {
      const key = m[2]
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
        .replace(/\\`/g, '`')
        .replace(/\\n/g, '\n')
        .replace(/\\\\/g, '\\');
      if (key.includes('${')) continue;
      found.set(key, [...(found.get(key) ?? []), path.relative(SRC, file)]);
    }
  }
  return found;
}

/** `{name}` slots a translation must preserve so interpolation still lands. */
function placeholders(s: string): string[] {
  return (s.match(/\{[a-zA-Z][a-zA-Z0-9]*\}/g) ?? []).sort();
}

describe('translate()', () => {
  test('returns Japanese for ja and the English source for en', () => {
    expect(translate('ja', 'Settings')).toBe('設定');
    expect(translate('en', 'Settings')).toBe('Settings');
  });

  test('falls back to the English source when a key is untranslated', () => {
    expect(translate('ja', 'A string nobody has translated')).toBe('A string nobody has translated');
  });

  test('interpolates and strips ##context in every language', () => {
    expect(translate('ja', '{n} left today', { n: 3 })).toBe('本日あと3回');
    expect(translate('ja', 'Back##angle')).toBe('後ろ');
    expect(translate('en', 'Back##angle')).toBe('Back');
  });
});

describe('localeFor()', () => {
  test('maps every shipped language to a BCP-47 tag', () => {
    expect(localeFor('en')).toBe('en-US');
    expect(localeFor('es')).toBe('es-ES');
    expect(localeFor('ja')).toBe('ja-JP');
    expect(localeFor('nonsense')).toBe('en-US');
  });
});

describe('Japanese dictionary', () => {
  test('covers every string the Spanish dictionary covers', () => {
    const missing = Object.keys(es).filter((key) => !(key in ja));
    expect(missing).toEqual([]);
  });

  test('covers every literal string passed to t() across the app', () => {
    const missing = [...literalKeysInSource().entries()]
      .filter(([key]) => !(key in ja))
      .map(([key, files]) => `${JSON.stringify(key)} (${files.join(', ')})`);
    expect(missing).toEqual([]);
  });

  test('covers the chair angle labels and coaching lines rendered through t()', () => {
    const dynamic = [
      ...ANGLE_SPECS.map((spec) => spec.label),
      ...ANGLE_SPECS.map((spec) => spec.hint),
      ...COACH_SCRIPT.map((cue) => cue.line),
    ];
    expect(dynamic.filter((key) => !(key in ja))).toEqual([]);
  });

  test('covers every word chip a barber can tap after a cut', () => {
    // Guard numbers ('#2') render verbatim — ChairStation and ClientProfile
    // both skip t() for them, so only the word chips need an entry.
    const words = DECISION_CHIPS.filter((chip) => !chip.startsWith('#'));
    expect(words.filter((chip) => !(chip in ja))).toEqual([]);
  });

  test('covers every hairstyle in the catalog', () => {
    // Cut names reach t() as data — off the catalog on the card and the chair,
    // off stored takes on the dashboard — so a cut added to hairstyles.ts
    // would otherwise render in English inside a Japanese chart.
    const labels = HAIRSTYLES.map((cut) => cut.label);
    expect(labels.filter((label) => !(label in ja))).toEqual([]);
  });

  test('keeps the “name, detail” shape so chip labels can cut at the comma', () => {
    // LiveTryOnPreview shows only the part before the first comma; a Japanese
    // label that separates with anything but 、would fill the chip.
    const broken = HAIRSTYLES.filter((cut) => cut.label.includes(','))
      .filter((cut) => !ja[cut.label].includes('、'))
      .map((cut) => cut.label);
    expect(broken).toEqual([]);
  });

  test('covers the face-shape labels and every suggestion reason', () => {
    // These reach t() as variables, so the source scan above can't see them —
    // a new law in recommend.ts is exactly the kind of string that would
    // otherwise ship untranslated.
    const dynamic = [...Object.values(SHAPE_LABELS), ...suggestionReasons()];
    expect(dynamic.filter((key) => !(key in ja))).toEqual([]);
  });

  test('preserves every {placeholder} from its English key', () => {
    const broken = Object.entries(ja)
      .filter(([key, value]) => placeholders(key).join() !== placeholders(value).join())
      .map(([key]) => key);
    expect(broken).toEqual([]);
  });

  test('never leaves a translation identical to a Latin-script English key', () => {
    // A value that still reads as its English key means the entry was copied,
    // not translated. Proper nouns and pure punctuation are legitimately equal.
    const allowed = new Set(['Apple / Outlook (.ics)']);
    const untranslated = Object.entries(ja)
      .filter(([key, value]) => key === value && /[a-zA-Z]{2}/.test(key) && !allowed.has(key))
      .map(([key]) => key);
    expect(untranslated).toEqual([]);
  });
});
