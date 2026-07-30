#!/usr/bin/env npx tsx
// Per-sales-account usage report: live-video seconds, takes, customers reached.
//
//   npx tsx scripts/sales-usage.ts           # dev deployment
//   npx tsx scripts/sales-usage.ts --prod    # production
//
// Reads the account emails from scripts/sales-accounts.local.csv (written by
// provision-sales-accounts.ts) and asks the Convex deployment's
// admin:salesUsage query to attribute the chair-mode meters to each one.
// Read-only: prints a table, changes nothing.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { SalesAccountUsage } from '../convex/admin';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV_PATH = join(ROOT, 'scripts', 'sales-accounts.local.csv');

function csvEmails(): string[] {
  const lines = readFileSync(CSV_PATH, 'utf8').split('\n').slice(1);
  return lines.map((l) => l.split(',')[1]).filter(Boolean);
}

function fmtWhen(ms: number | null): string {
  return ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '—';
}

function main() {
  const prod = process.argv.includes('--prod');
  const emails = csvEmails();
  if (emails.length === 0) {
    console.error(`No accounts found in ${CSV_PATH} — run provision-sales-accounts.ts first.`);
    process.exit(1);
  }

  const res = spawnSync(
    'npx',
    ['convex', 'run', ...(prod ? ['--prod'] : []), 'admin:salesUsage', JSON.stringify({ emails })],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  );
  if (res.status !== 0) {
    console.error(res.stderr || res.stdout || 'convex run failed');
    process.exit(res.status ?? 1);
  }

  const report: SalesAccountUsage[] = JSON.parse(res.stdout);

  const header = ['account', 'video sec', 'takes', 'customers', 'via card', 'credits', 'last active'];
  const rows = report.map((r) => [
    r.email.split('@')[0] + (r.signedIn ? '' : ' (never signed in)'),
    String(Math.round(r.videoSeconds)),
    String(r.takes),
    r.customersReached,
    String(r.viaCard),
    r.credits === null ? '—' : String(r.credits),
    fmtWhen(r.lastActiveAt),
  ]);

  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
  console.log(`Sales demo usage — ${prod ? 'PRODUCTION' : 'dev'} deployment\n`);
  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));
}

main();
