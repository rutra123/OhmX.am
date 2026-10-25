#!/usr/bin/env node
// Safe test runner. Every child process gets a scrubbed environment and a throwaway DB_PATH, so no
// test can open data/electro.db, read .env secrets, call operational services or write project data.
//
//   node scripts/run-tests.mjs                 unit suites: server, client, root .mjs, Python
//   node scripts/run-tests.mjs --known-gaps    only the documented failing tests (tests/known-gaps.json)
//   node scripts/run-tests.mjs --only=server|client|root|python
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const knownGapsMode = args.includes('--known-gaps');
const only = (args.find((a) => a.startsWith('--only=')) ?? '').slice(7);
const gaps = JSON.parse(readFileSync(join(root, 'tests', 'known-gaps.json'), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'ohmx-tests-'));
const tsx = join(root, 'node_modules', '.bin', 'tsx');

const env = {
  PATH: process.env.PATH ?? '',
  HOME: scratch,
  TMPDIR: scratch,
  NODE_ENV: 'test',
  DB_PATH: join(scratch, 'test.db'),
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.test\.(ts|tsx|js|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

function run(label, cwd, cmd, cmdArgs) {
  console.log(`\n=== ${label}`);
  const r = spawnSync(cmd, cmdArgs, { cwd, env, stdio: 'inherit' });
  const ok = r.status === 0;
  console.log(`=== ${label}: ${ok ? 'PASS' : 'FAIL'} (exit ${r.status})`);
  return ok;
}

const rel = (base, file) => file.slice(base.length + 1);
const results = [];

function serverUnit() {
  const base = join(root, 'server');
  const gapFiles = new Set(gaps.server.filter((g) => !g.namePattern).map((g) => g.file));
  const skip = gaps.server.filter((g) => g.namePattern).flatMap((g) => ['--test-skip-pattern', g.namePattern]);
  const files = walk(join(base, 'src')).map((f) => rel(base, f)).filter((f) => !gapFiles.has(f));
  return run('server unit tests', base, tsx, ['--test', ...skip, ...files]);
}

function serverGaps() {
  const base = join(root, 'server');
  return gaps.server.map((g) => run(`known gap: ${g.file}${g.namePattern ? ` [${g.namePattern}]` : ''}`, base, tsx,
    ['--test', ...(g.namePattern ? ['--test-name-pattern', g.namePattern] : []), g.file])).every(Boolean);
}

function clientUnit() {
  const base = join(root, 'client');
  const files = walk(join(base, 'tests')).map((f) => rel(base, f));
  const skip = gaps.client.filter((g) => g.namePattern).flatMap((g) => ['--test-skip-pattern', g.namePattern]);
  return run('client tests', base, tsx, ['--tsconfig', 'tsconfig.json', '--test', ...skip, ...files]);
}

function rootUnit() {
  const files = walk(join(root, 'tests')).map((f) => rel(root, f)).filter((f) => f.endsWith('.mjs'));
  return run('root node tests', root, process.execPath, ['--test', ...files]);
}

function pythonUnit() {
  return run('python regression tests', root, 'python3', ['-I', 'tests/test_engineering_product_data_rollback.py']);
}

try {
  if (knownGapsMode) {
    results.push(['known gaps (server)', serverGaps()]);
  } else {
    if (!only || only === 'server') results.push(['server', serverUnit()]);
    if (!only || only === 'client') results.push(['client', clientUnit()]);
    if (!only || only === 'root') results.push(['root', rootUnit()]);
    if (!only || only === 'python') results.push(['python', pythonUnit()]);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log('\nSummary:');
for (const [name, ok] of results) console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`);
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
