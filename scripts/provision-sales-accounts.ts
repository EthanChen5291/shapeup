#!/usr/bin/env npx tsx
// Provision the shared sales-demo accounts (eagle@…, blossom@…) in Clerk.
// Handles are drawn at random from SALES_NAME_POOL (src/lib/salesAccounts.ts)
// so account emails can't be guessed by incrementing a number.
//
//   npx tsx scripts/provision-sales-accounts.ts --dry-run     # print the plan, no API calls
//   npx tsx scripts/provision-sales-accounts.ts               # create --count (10) accounts
//   npx tsx scripts/provision-sales-accounts.ts --names eagle,blossom --domain shapeup.com
//
// Reads CLERK_SECRET_KEY from the real env first, then .env.local, then .env
// (matching how Next.js layers them). Whichever key it finds decides the
// instance: sk_test_… provisions the dev Clerk instance, sk_live_… production.
//
// Behavior per account:
//   - already exists in Clerk → skipped, password left untouched (idempotent;
//     safe to re-run to top up from 10 to 15 later)
//   - created → password generated here, email marked verified so no account
//     ever sees a "verify your email" interstitial, publicMetadata.role="sales"
//     stamped for future auditing/filtering in the Clerk dashboard
//
// Passwords are written ONLY to scripts/sales-accounts.local.csv (gitignored);
// stdout gets emails, Clerk user IDs, and statuses but never a password.

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { buildAccountPlan, type PlannedAccount } from '../src/lib/salesAccounts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV_PATH = join(ROOT, 'scripts', 'sales-accounts.local.csv');
const API = 'https://api.clerk.com/v1';

// ── env layering: process env > .env.local > .env ───────────────────────────

function readEnvFile(name: string): Record<string, string> {
  const path = join(ROOT, name);
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

function resolveSecretKey(): string {
  const key =
    process.env.CLERK_SECRET_KEY ||
    readEnvFile('.env.local').CLERK_SECRET_KEY ||
    readEnvFile('.env').CLERK_SECRET_KEY;
  if (!key) {
    console.error('CLERK_SECRET_KEY not found in env, .env.local, or .env');
    process.exit(1);
  }
  return key;
}

// ── tiny Clerk Backend API client ────────────────────────────────────────────

async function clerk(secretKey: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.errors?.[0]?.long_message ?? json?.errors?.[0]?.message ?? res.statusText;
    throw new Error(`${method} ${path} → ${res.status}: ${msg}`);
  }
  return json;
}

interface ClerkUser {
  id: string;
  email_addresses: Array<{ id: string; email_address: string }>;
}

async function findByEmail(secretKey: string, email: string): Promise<ClerkUser | null> {
  const users: ClerkUser[] = await clerk(
    secretKey,
    'GET',
    `/users?email_address=${encodeURIComponent(email)}&limit=1`,
  );
  return users[0] ?? null;
}

async function createAccount(secretKey: string, acct: PlannedAccount): Promise<ClerkUser> {
  const user: ClerkUser = await clerk(secretKey, 'POST', '/users', {
    email_address: [acct.email],
    password: acct.password,
    first_name: 'Sales',
    last_name: acct.username,
    public_metadata: { role: 'sales' },
  });
  // Backend-created emails start unverified; verify so no interstitial ever
  // appears and freeGen's verified-email gate (convex/freeGen.ts) stays open.
  const emailId = user.email_addresses[0]?.id;
  if (emailId) {
    await clerk(secretKey, 'PATCH', `/email_addresses/${emailId}`, { verified: true });
  }
  return user;
}

// ── main ─────────────────────────────────────────────────────────────────────

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const count = Number(arg('--count') ?? 10);
  const domain = arg('--domain') ?? 'shapeup.com';
  const names = arg('--names')?.split(',').map((s) => s.trim()).filter(Boolean);

  const plan = buildAccountPlan({ count, domain, names, randomBytes: (n) => randomBytes(n) });

  if (dryRun) {
    console.log(`Dry run — would ensure ${plan.length} accounts exist:`);
    for (const a of plan) console.log(`  ${a.email}`);
    return;
  }

  const secretKey = resolveSecretKey();
  const instance = secretKey.startsWith('sk_live_') ? 'LIVE (production)' : 'TEST (dev)';
  console.log(`Provisioning ${plan.length} accounts on the ${instance} Clerk instance…\n`);

  const rows: Array<{ email: string; password: string; userId: string; status: string }> = [];
  for (const acct of plan) {
    const existing = await findByEmail(secretKey, acct.email);
    if (existing) {
      rows.push({ email: acct.email, password: '(unchanged)', userId: existing.id, status: 'exists' });
      console.log(`  exists   ${acct.email}  ${existing.id}`);
      continue;
    }
    const user = await createAccount(secretKey, acct);
    rows.push({ email: acct.email, password: acct.password, userId: user.id, status: 'created' });
    console.log(`  created  ${acct.email}  ${user.id}`);
  }

  const csv = [
    'username,email,password,clerk_user_id,status',
    ...rows.map((r) => {
      const username = r.email.split('@')[0];
      return `${username},${r.email},${r.password},${r.userId},${r.status}`;
    }),
  ].join('\n');
  writeFileSync(CSV_PATH, csv + '\n', { mode: 0o600 });

  const created = rows.filter((r) => r.status === 'created').length;
  console.log(`\n${created} created, ${rows.length - created} already existed.`);
  console.log(`Credentials written to ${CSV_PATH} (gitignored — do not commit).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
