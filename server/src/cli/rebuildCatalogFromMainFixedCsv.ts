


// V2 Safety Guard
if (
  (() => {
    try {
      return (db.prepare(`
        SELECT COUNT(*) AS count
        FROM categories
        WHERE id IN (910001,910002,910003,910004,910005,910006,910007,910008)
          AND parent_id IS NULL
          AND is_active = 1
      `).get() as any)?.count === 8;
    } catch {
      return false;
    }
  })()
) {
  console.error("=============================================================================");
  console.error("CRITICAL SAFETY BLOCK: THIS LEGACY SCRIPT IS DISABLED ON V2");
  console.error("The project has migrated to the clean V2 category taxonomy.");
  console.error("Running this legacy script would corrupt or overwrite the production tree.");
  console.error("=============================================================================");
  process.exit(1);
}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyProductsCsv } from '../utils/importProducts.js';
import { db, dbPath, ensureApprovedPublicRootCards, hideEmptyPublicRootCards, reconcileCatalogRoots } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../..');

function parseArgs(argv: string[]) {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      result[key] = 'true';
    } else {
      result[key] = next;
      i += 1;
    }
  }
  return result;
}

function resolvePath(filePath: string) {
  if (path.isAbsolute(filePath)) return filePath;
  const fromCwd = path.resolve(process.cwd(), filePath);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(projectRoot, filePath);
}

function backupDatabase(targetDir: string) {
  fs.mkdirSync(targetDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(targetDir, `main-fixed-rebuild-before-${stamp}.db`);
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function count(sql: string) {
  return Number((db.prepare(sql).get() as { count?: number } | undefined)?.count || 0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = resolvePath(args.input || 'main_fixed_category_subcategory.csv');
  const normalizedPath = resolvePath(args.normalized || 'import/generated/main_fixed_category_subcategory.telegram-import.v3.rootmapped.csv');
  const reportPath = resolvePath(args.report || 'backups/import-reset/main_fixed_category_subcategory.rebuild.report.json');
  const backupPath = backupDatabase(path.dirname(reportPath));

  if (!fs.existsSync(inputPath)) throw new Error(`Исходный CSV не найден: ${inputPath}`);
  if (!fs.existsSync(normalizedPath)) throw new Error(`Нормализованный CSV не найден: ${normalizedPath}`);

  const before = {
    categories: count('SELECT COUNT(*) as count FROM categories'),
    products: count('SELECT COUNT(*) as count FROM products'),
    productCategories: count('SELECT COUNT(*) as count FROM product_categories'),
    productsWithPrimaryCategory: count('SELECT COUNT(*) as count FROM products WHERE primary_category_id IS NOT NULL'),
    seriesWithCategory: count('SELECT COUNT(*) as count FROM series WHERE category_id IS NOT NULL'),
  };

  db.transaction(() => {
    db.prepare('DELETE FROM product_categories').run();
    db.prepare('UPDATE products SET primary_category_id = NULL, category_id = NULL, updated_at = CURRENT_TIMESTAMP').run();
    db.prepare('UPDATE series SET category_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE category_id IS NOT NULL').run();
    db.prepare('DELETE FROM categories').run();
  })();

  const importSummary = applyProductsCsv(normalizedPath, {
    createMissingBrands: true,
    createMissingCategories: true,
  });

  ensureApprovedPublicRootCards();
  reconcileCatalogRoots();
  hideEmptyPublicRootCards();

  const after = {
    categories: count('SELECT COUNT(*) as count FROM categories'),
    rootCategories: count('SELECT COUNT(*) as count FROM categories WHERE parent_id IS NULL AND is_active = 1'),
    publicRootCards: count('SELECT COUNT(*) as count FROM categories WHERE parent_id IS NULL AND is_public_card = 1 AND is_active = 1'),
    products: count('SELECT COUNT(*) as count FROM products'),
    productCategories: count('SELECT COUNT(*) as count FROM product_categories'),
    productsWithPrimaryCategory: count('SELECT COUNT(*) as count FROM products WHERE primary_category_id IS NOT NULL'),
    seriesWithCategory: count('SELECT COUNT(*) as count FROM series WHERE category_id IS NOT NULL'),
  };

  const rootSample = db.prepare(
    'SELECT id, name_ru, slug, sort_order, is_public, is_public_card ' +
    'FROM categories WHERE parent_id IS NULL AND is_active = 1 ORDER BY sort_order, name_ru'
  ).all();

  const report = {
    input: inputPath,
    normalized: normalizedPath,
    backup: backupPath,
    before,
    importSummary,
    after,
    rootSample,
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

main();
