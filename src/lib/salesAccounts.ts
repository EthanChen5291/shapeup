/**
 * Pure planning logic for the sales-account provisioning script
 * (scripts/provision-sales-accounts.ts). Kept here, dependency-free, so it can
 * be unit-tested by vitest (which only includes src/ and convex/).
 *
 * These are company-owned demo accounts handed to salespeople: the "username"
 * each salesperson gets IS the account email (the sign-in widget signs in with
 * email + password), so emails are minted on our own domain — sales01@…,
 * sales02@… — and never need to receive mail.
 */

export interface PlannedAccount {
  /** Short handle we tell the salesperson, e.g. "eagle". */
  username: string;
  /** What they actually type into the sign-in form. */
  email: string;
  password: string;
}

/**
 * Handles are drawn from this pool instead of sales01…salesNN so accounts
 * can't be guessed by incrementing a number and two salespeople never mix
 * theirs up. Words chosen to be visually and phonetically distinct.
 */
export const SALES_NAME_POOL = [
  'eagle', 'blossom', 'canyon', 'harbor', 'tundra', 'falcon', 'meadow',
  'quartz', 'ember', 'willow', 'summit', 'coral', 'badger', 'cedar',
  'fjord', 'garnet', 'heron', 'indigo', 'juniper', 'lagoon', 'marlin',
  'nectar', 'orchid', 'pebble', 'raven', 'sequoia', 'thistle', 'walnut',
  'yarrow', 'zephyr', 'bison', 'clover', 'dune', 'maple', 'onyx', 'sable',
] as const;

/** Sample `count` distinct handles from the pool, order randomized. */
export function pickNames(count: number, randomBytes: (n: number) => Uint8Array): string[] {
  if (count > SALES_NAME_POOL.length) {
    throw new Error(`count must be ≤ ${SALES_NAME_POOL.length} (name pool size), got ${count}`);
  }
  // Fisher–Yates over a copy, driven by crypto randomness.
  const pool = [...SALES_NAME_POOL];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomBytes(4).reduce((acc, b) => acc * 256 + b, 0) % (i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}

/**
 * Password alphabet without lookalikes (0/O, 1/l/I) — these get read aloud and
 * typed on demo tablets. 16 chars over 28 symbols ≈ 77 bits of entropy, grouped
 * in fours for readability: "kw7t-mfq2-xp9r-vd4h".
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function formatPassword(bytes: Uint8Array): string {
  if (bytes.length < 16) throw new Error('need at least 16 random bytes');
  const chars = Array.from(bytes.slice(0, 16), (b) => ALPHABET[b % ALPHABET.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

export function buildAccountPlan(opts: {
  /** Explicit handles; when omitted, `count` are drawn at random from the pool. */
  names?: string[];
  count?: number;
  domain: string;
  /**
   * Fixed password instead of a generated one. Only allowed when exactly one
   * explicit name is given — a shared password across many accounts defeats
   * the point of per-account credentials.
   */
  password?: string;
  randomBytes: (n: number) => Uint8Array;
}): PlannedAccount[] {
  const { domain, randomBytes } = opts;
  if (opts.password !== undefined) {
    if (opts.names?.length !== 1) {
      throw new Error('password can only be set together with exactly one --names handle');
    }
    if (opts.password.length < 8) throw new Error('password must be at least 8 characters');
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) {
    throw new Error(`"${domain}" doesn't look like a domain`);
  }
  let names = opts.names;
  if (!names) {
    const count = opts.count ?? 10;
    if (!Number.isInteger(count) || count < 1) throw new Error(`count must be ≥ 1, got ${count}`);
    names = pickNames(count, randomBytes);
  }
  if (new Set(names).size !== names.length) throw new Error('duplicate names in plan');
  for (const name of names) {
    if (!/^[a-z][a-z0-9]{1,30}$/.test(name)) throw new Error(`"${name}" isn't a usable handle`);
  }
  return names.map((username) => ({
    username,
    email: `${username}@${domain}`,
    password: opts.password ?? formatPassword(randomBytes(16)),
  }));
}
