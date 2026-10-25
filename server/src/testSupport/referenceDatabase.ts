import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

/**
 * Checkout-relative stand-in for the live catalog database in tests.
 *
 * Schema comes from server/test-fixtures/reference-schema.sql (DDL only). The small engineering
 * reference tables are filled from the public catalog export (catalog/data/*.jsonl) when present.
 * The result is an in-memory database, so tests never open data/electro.db.
 */
const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const schemaFile = path.join(serverRoot, 'test-fixtures', 'reference-schema.sql');
const catalogData = path.join(serverRoot, '..', 'catalog', 'data');
const REFERENCE_TABLES = [
  'engineering_equipment_type',
  'engineering_condition_key',
  'engineering_source_type',
  'engineering_parameter',
];

export function openReferenceDatabase(): Database.Database {
  const db = new Database(':memory:');
  db.exec(readFileSync(schemaFile, 'utf8'));
  for (const table of REFERENCE_TABLES) {
    const file = path.join(catalogData, `${table}.jsonl`);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      const row = JSON.parse(line) as Record<string, unknown>;
      const cols = Object.keys(row);
      db.prepare(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...cols.map((c) => row[c]));
    }
  }
  return db;
}

/**
 * Inputs that are deliberately not part of this repository (private research packages and a
 * baseline database snapshot). Supply them via environment variables to run the dependent tests.
 */
export function externalFixture(envName: string): string | undefined {
  const value = process.env[envName];
  return value && existsSync(value) ? value : undefined;
}
