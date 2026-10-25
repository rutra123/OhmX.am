// Runs against a copy of a real DB snapshot: OHMX_CONSOLIDATION_TEST_DB=<snapshot.db> npx tsx --test src/cli/consolidateAutomationCategories.test.ts
// The snapshot itself is never written; each test works on its own temp copy.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import {
  MERGES,
  SIBLING_ORDER,
  applyConsolidation,
  buildManifest,
  detectState,
  rollbackConsolidation,
  verifyApplied,
  verifyPreconditions,
} from './consolidateAutomationCategories.js';

const snapshot = process.env.OHMX_CONSOLIDATION_TEST_DB;
const skip = snapshot ? false : 'set OHMX_CONSOLIDATION_TEST_DB to a pre-migration DB snapshot';

function copyDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ohmx-consolidation-'));
  const file = path.join(dir, 'copy.db');
  fs.copyFileSync(snapshot!, file);
  return new Database(file);
}

function fingerprint(db: InstanceType<typeof Database>) {
  return JSON.stringify([
    db.prepare('SELECT * FROM categories ORDER BY id').all(),
    db.prepare('SELECT id, sku, category_id, primary_category_id, updated_at FROM products ORDER BY id').all(),
    db.prepare('SELECT product_id, category_id, is_primary, created_at FROM product_categories ORDER BY product_id, category_id').all(),
    db.prepare('SELECT * FROM product_attributes ORDER BY id').all(),
  ]);
}

test('apply merges the two pairs into unique unions, keeps SKUs and classifies every product', { skip }, () => {
  const db = copyDb();
  assert.equal(detectState(db), 'pending');
  verifyPreconditions(db);
  const manifest = buildManifest(db);
  const productsBefore = db.prepare('SELECT COUNT(*) AS c, GROUP_CONCAT(sku) AS skus FROM (SELECT sku FROM products ORDER BY id)').get();
  applyConsolidation(db);
  const visible = verifyApplied(db, manifest);
  assert.deepEqual(visible.map((row: any) => row.id), SIBLING_ORDER.map((item) => item.id));
  assert.deepEqual(db.prepare('SELECT COUNT(*) AS c, GROUP_CONCAT(sku) AS skus FROM (SELECT sku FROM products ORDER BY id)').get(), productsBefore);
  for (const merge of MERGES) {
    const union = manifest.before.unions.find((item) => item.targetId === merge.targetId)!;
    const types = db.prepare(`
      SELECT value_text, COUNT(*) AS c FROM product_attributes
      WHERE attribute_key = 'product_type' AND product_id IN (${[...union.target, ...union.source].join(',')})
      GROUP BY value_text ORDER BY value_text
    `).all();
    assert.deepEqual(types, [
      { value_text: 'accessory', c: union.source.length },
      { value_text: 'equipment', c: union.target.length },
    ]);
    const source = db.prepare('SELECT is_active FROM categories WHERE id = ?').get(merge.sourceId);
    assert.equal(source.is_active, 0, 'source category is archived, not deleted');
    assert.ok(db.prepare('SELECT COUNT(*) AS c FROM product_categories WHERE category_id = ?').get(merge.sourceId).c > 0, 'historical links are kept');
  }
  assert.equal(detectState(db), 'applied');
});

test('rollback restores the exact pre-migration state', { skip }, () => {
  const db = copyDb();
  const before = fingerprint(db);
  const manifest = JSON.parse(JSON.stringify(buildManifest(db)));
  applyConsolidation(db);
  assert.notEqual(fingerprint(db), before);
  rollbackConsolidation(db, manifest);
  assert.equal(fingerprint(db), before);
  assert.equal(detectState(db), 'pending');
});

test('a second apply is refused by the preconditions', { skip }, () => {
  const db = copyDb();
  applyConsolidation(db);
  assert.throws(() => verifyPreconditions(db), /Preconditions failed/);
});
