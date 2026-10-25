/**
 * Static source invariants for the pure evaluator. Reads module source text only.
 * Intentionally not executed in this phase.
 */
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const FILES = [
  'evaluator.ts',
  'operatingPoint.ts',
  'valueSelection.ts',
  'ranking.ts',
  'reasons.ts',
  'normalize.ts',
  'policy.ts',
  'index.ts',
];

function source(): string {
  return FILES.map((name) => readFileSync(join(dir, name), 'utf8')).join('\n');
}

test('evaluator modules have no sqlite import', () => {
  assert.equal(/\bsqlite3\b|\bbetter-sqlite3\b/.test(source()), false);
});

test('evaluator modules have no fs or network access', () => {
  const text = source();
  assert.equal(/\bfrom 'node:fs'|\bfrom "node:fs"|\bfrom 'fs'/.test(text), false);
  assert.equal(/\bfetch\(/.test(text), false);
  assert.equal(/\bhttp\b/.test(text) && /\bimport\b.*http/.test(text), false);
});

test('evaluator modules have no Date.now or Math.random', () => {
  const text = source();
  assert.equal(/Date\.now\s*\(/.test(text), false);
  assert.equal(/Math\.random\s*\(/.test(text), false);
});

test('evaluator does not parse titles or ecommerce kW columns', () => {
  const text = source();
  assert.equal(/name_ru|name_en|name_hy/.test(text), false);
  assert.equal(/heating_power_kw|cooling_power_kw/.test(text), false);
  assert.equal(/stock_quantity/.test(text), false);
});

test('no interpolation or extrapolation implementation path', () => {
  const text = source();
  assert.equal(/linearInterpolate|extrapolateCapacity|lerp\(/.test(text), false);
});

test('no arbitrary oversize threshold', () => {
  const text = source();
  assert.equal(/oversizeLimit|maxOversize|0\.15|1\.15/.test(text), false);
});

test('queryAdapter exists as the sqlite read-only boundary', () => {
  const text = readFileSync(join(dir, 'queryAdapter.ts'), 'utf8');
  assert.match(text, /better-sqlite3/);
  assert.match(text, /query_only/);
  assert.match(text, /readonly: true/);
  assert.equal(/INSERT INTO/.test(text), false);
});
