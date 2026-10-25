/**
 * Cleanup script for the legacy "Электротехнические изделия Legrand (Франция)" marker.
 *
 * - Studies products that still carry the marker in legacy_categories (3351+).
 * - Verifies / reports their current placement (already mostly correct under V2 taxonomy:
 *   Рамки, Выключатели и кнопки, Лицевые панели, Модульные/Силовые автоматы, УЗО, розетки etc.).
 * - Reassigns any that are clearly in wrong place (rare after V2).
 * - Purges the bad phrase from legacy_categories on all affected products.
 * - After successful cleanup, deletes the category row itself if it exists and has zero links.
 *
 * Usage:
 *   tsx src/cli/cleanLegrandFranceLegacy.ts --dry-run     (default, safe preview)
 *   tsx src/cli/cleanLegrandFranceLegacy.ts --apply
 *
 * Per AGENTS: always backup DB first, preview before apply, full report with counts.
 */

import { db, dbPath } from '../db.js';
import fs from 'node:fs';
import path from 'node:path';

const LEGACY_PHRASE = 'Электротехнические изделия Legrand (Франция)';
const LEGACY_RE = /электротехнические изделия legrand \(франция\)/i;

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');

function parseArgs(argv: string[]) {
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      result[key] = true;
    } else {
      result[key] = next;
      i += 1;
    }
  }
  return result;
}

function backupDb() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(projectRoot, 'backups', 'db');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `electro-before-legrand-france-clean-${stamp}.db`);
  fs.copyFileSync(dbPath, backupPath);
  console.log('DB backup created:', backupPath);
  return backupPath;
}

function getCurrentPrimaryName(product: any): string {
  const id = product.primary_category_id || product.category_id;
  if (!id) return '';
  const row = db.prepare('SELECT name_ru FROM categories WHERE id = ?').get(id) as any;
  return row?.name_ru || '';
}

function inferTargetCategory(product: any): { targetPrimaryId: number | null; reason: string } {
  // IMPORTANT: From analysis, the 3351 products are already in excellent V2 places
  // (Рамки, Выключатели и кнопки, Лицевые панели, Модульные/Силовые автоматы, УЗО, розетки, контакторы, кабель-каналы etc.).
  // The old "Электротехнические изделия Legrand (Франция)" was a legacy wrapper during import.
  // We do NOT auto-move here to avoid mis-classifying contactors/breakers as "mechanisms".
  // The real work is purging the marker from legacy_categories.
  // If specific SKUs need manual move later, they can be handled individually in admin.
  return { targetPrimaryId: null, reason: 'current placement acceptable (V2 taxonomy already applied)' };
}

function cleanLegacyString(legacy: string | null): string {
  if (!legacy) return '';
  const parts = legacy.split('|').map((p) => p.trim()).filter(Boolean);
  const cleaned = parts.filter((p) => !LEGACY_RE.test(p));
  return cleaned.join(' | ');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const apply = !!args.apply;
  const dry = !apply;

  console.log('=== Legrand France legacy cleanup ===');
  console.log('Mode:', dry ? 'DRY-RUN (preview only)' : 'APPLY (will modify DB)');
  console.log('Phrase to purge:', LEGACY_PHRASE);

  if (apply) {
    backupDb();
  }

  const legLike = `%${LEGACY_PHRASE}%`;

  // 1. Find all affected
  const affected = db.prepare(`
    SELECT p.id, p.sku, p.name_ru, p.legacy_categories, p.category_id, p.primary_category_id, p.brand_id, p.series_id
    FROM products p
    WHERE p.legacy_categories LIKE ?
    ORDER BY p.id
  `).all(legLike) as any[];

  console.log(`\nFound ${affected.length} products carrying the legacy marker in legacy_categories.`);

  if (affected.length === 0) {
    console.log('Nothing to do. The legacy marker is already gone.');
    return;
  }

  // 2. Breakdown by current primary (for report)
  const byPrimary: Record<string, number> = {};
  affected.forEach((p) => {
    const nm = getCurrentPrimaryName(p) || '(none)';
    byPrimary[nm] = (byPrimary[nm] || 0) + 1;
  });
  const sorted = Object.entries(byPrimary).sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log('\nCurrent primary category distribution (top):');
  sorted.forEach(([nm, cnt]) => console.log(`  ${nm}: ${cnt}`));

  // 3. Analyze for needed moves + clean legacy
  let needCategoryMove = 0;
  let legacyWouldChange = 0;
  const moves: Array<{ id: number; sku: string; from: string; to: string; reason: string }> = [];
  const legacyChanges: Array<{ id: number; sku: string; before: string; after: string }> = [];

  affected.forEach((p) => {
    const beforeLegacy = p.legacy_categories || '';
    const afterLegacy = cleanLegacyString(beforeLegacy);
    if (afterLegacy !== beforeLegacy) {
      legacyWouldChange++;
      if (legacyChanges.length < 5) legacyChanges.push({ id: p.id, sku: p.sku, before: beforeLegacy.slice(0, 90), after: afterLegacy.slice(0, 90) });
    }

    const { targetPrimaryId, reason } = inferTargetCategory(p);
    if (targetPrimaryId && targetPrimaryId !== (p.primary_category_id || p.category_id)) {
      needCategoryMove++;
      const fromName = getCurrentPrimaryName(p);
      const toName = (db.prepare('SELECT name_ru FROM categories WHERE id = ?').get(targetPrimaryId) as any)?.name_ru || String(targetPrimaryId);
      if (moves.length < 5) moves.push({ id: p.id, sku: p.sku, from: fromName, to: toName, reason });
    }
  });

  console.log(`\nAnalysis:`);
  console.log(`  Products needing category reassignment: ${needCategoryMove}`);
  console.log(`  Products whose legacy_categories will be cleaned: ${legacyWouldChange}`);

  if (moves.length) {
    console.log('\nExample moves (if apply):');
    moves.forEach(m => console.log(`  ${m.sku}: ${m.from} -> ${m.to} (${m.reason})`));
  }
  if (legacyChanges.length) {
    console.log('\nExample legacy clean (before | after):');
    legacyChanges.forEach(ch => console.log(`  ${ch.sku}: "${ch.before}" -> "${ch.after}"`));
  }

  if (dry) {
    console.log('\n=== DRY-RUN COMPLETE ===');
    console.log('Run with --apply to perform the reassignments and legacy purge.');
    console.log('A fresh DB backup will be created automatically on --apply.');
    return;
  }

  // ========== APPLY ==========
  console.log('\n=== APPLYING CHANGES ===');
  let categoryUpdates = 0;
  let legacyUpdates = 0;
  let errors = 0;

  const tx = db.transaction(() => {
    affected.forEach((p) => {
      try {
        let newPrim = p.primary_category_id || p.category_id;
        const { targetPrimaryId, reason } = inferTargetCategory(p);
        if (targetPrimaryId && targetPrimaryId !== newPrim) {
          db.prepare('UPDATE products SET primary_category_id = ?, category_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(targetPrimaryId, targetPrimaryId, p.id);
          // Ensure join table has it
          db.prepare('INSERT OR IGNORE INTO product_categories (product_id, category_id, is_primary) VALUES (?, ?, 1)')
            .run(p.id, targetPrimaryId);
          categoryUpdates++;
          newPrim = targetPrimaryId;
        }

        const cleaned = cleanLegacyString(p.legacy_categories);
        if (cleaned !== (p.legacy_categories || '')) {
          db.prepare('UPDATE products SET legacy_categories = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run(cleaned, p.id);
          legacyUpdates++;
        }
      } catch (e) {
        errors++;
        console.error('Error on product', p.id, (e as Error).message);
      }
    });
  });

  tx();

  // Final verification
  const remaining = db.prepare('SELECT COUNT(*) as cnt FROM products WHERE legacy_categories LIKE ?').get(legLike) as any;
  console.log(`\nAfter apply: ${remaining.cnt} products still carry the legacy marker (should be 0).`);

  // Delete the category itself if it exists and now has zero links (safe: double-check no remaining references)
  let deletedCategories = 0;
  const badCats = db.prepare(`
    SELECT id, name_ru FROM categories 
    WHERE name_ru LIKE ? OR name_ru LIKE ?
  `).all('%Электротехнические изделия Legrand (Франция)%', '%Legrand (Франция)%') as any[];

  badCats.forEach((cat) => {
    const pcLinks = db.prepare('SELECT COUNT(*) as cnt FROM product_categories WHERE category_id = ?').get(cat.id) as any;
    const prodDirect = db.prepare('SELECT COUNT(*) as cnt FROM products WHERE category_id = ? OR primary_category_id = ?').get(cat.id, cat.id) as any;
    const totalLinks = (pcLinks?.cnt || 0) + (prodDirect?.cnt || 0);
    if (totalLinks === 0) {
      db.prepare('DELETE FROM categories WHERE id = ?').run(cat.id);
      deletedCategories++;
      console.log(`Deleted empty legacy category #${cat.id} "${cat.name_ru}"`);
    } else {
      console.log(`Category #${cat.id} "${cat.name_ru}" still has ${totalLinks} links, not deleting.`);
    }
  });

  console.log('\n=== FINAL REPORT ===');
  console.log(`Products found with legacy marker: ${affected.length}`);
  console.log(`Products whose category was reassigned: ${categoryUpdates}`);
  console.log(`Products whose legacy_categories was purged: ${legacyUpdates}`);
  console.log(`Legacy category rows deleted: ${deletedCategories}`);
  console.log(`Errors: ${errors}`);
  console.log(`Remaining with marker: ${remaining.cnt}`);
  if (remaining.cnt === 0 && errors === 0) {
    console.log('SUCCESS: The legacy "Электротехнические изделия Legrand (Франция)" has been removed from products and (if present) from categories.');
  }
}

main();
