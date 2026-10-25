


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
import { db, dbPath, slugify } from '../db.js';
import { parseCsv } from '../utils/importProducts.js';

type LegacyCategoryRow = {
  sourceId: string;
  name: string;
  description: string;
  position: number;
  visible: boolean;
};

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

function parseBoolean(value: string) {
  return ['1', 'true', 'yes', 'y'].includes(String(value || '').trim().toLowerCase());
}

function parseNumber(value: string) {
  const normalized = String(value || '').trim();
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapRows(inputPath: string) {
  const raw = fs.readFileSync(inputPath, 'utf8');
  const parsed = parseCsv(raw, ';');
  if (parsed.length < 2) throw new Error('CSV пустой или некорректный');

  const headers = parsed[0].map((header) => String(header || '').replace(/^\ufeff/, '').trim());
  const rows = parsed.slice(1).filter((row) => row.some((cell) => String(cell || '').trim() !== ''));
  const required = ['ID', 'Имя', 'Описание', 'Позиция', 'Показывать'];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) throw new Error(`В CSV отсутствуют обязательные колонки: ${missing.join(', ')}`);

  return rows.map((row) => {
    const item = Object.fromEntries(headers.map((header, index) => [header, String(row[index] || '').trim()]));
    return {
      sourceId: item.ID,
      name: item.Имя,
      description: item.Описание,
      position: parseNumber(item.Позиция),
      visible: parseBoolean(item.Показывать),
    } satisfies LegacyCategoryRow;
  }).filter((item) => item.name);
}

function resolveUniqueRootSlug(name: string, sourceId: string) {
  const base = slugify(name) || slugify(sourceId) || 'category';
  let candidate = base;
  let attempt = 1;
  while (true) {
    const existing = db.prepare('SELECT id FROM categories WHERE slug = ?').get(candidate) as { id: number } | undefined;
    if (!existing) return candidate;
    attempt += 1;
    candidate = slugify(`${base}-${sourceId || attempt}`) || `${base}-${attempt}`;
  }
}

function backupDatabase(targetDir: string) {
  fs.mkdirSync(targetDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(targetDir, `categories_reset_before_${stamp}.db`);
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error('Usage: tsx src/cli/resetCategoriesFromLegacyCsv.ts --input <legacy-categories.csv> [--report <report.json>]');
    process.exit(1);
  }

  const inputPath = resolvePath(args.input);
  const reportPath = args.report ? resolvePath(args.report) : path.resolve(projectRoot, 'backups', 'category-reset', 'last-report.json');
  const backupDir = path.dirname(reportPath);
  const rows = mapRows(inputPath);
  const backupPath = backupDatabase(backupDir);

  const before = {
    categories: Number((db.prepare('SELECT COUNT(*) as count FROM categories').get() as { count: number }).count),
    productCategories: Number((db.prepare('SELECT COUNT(*) as count FROM product_categories').get() as { count: number }).count),
    productsWithPrimaryCategory: Number((db.prepare('SELECT COUNT(*) as count FROM products WHERE primary_category_id IS NOT NULL').get() as { count: number }).count),
    seriesWithCategory: Number((db.prepare('SELECT COUNT(*) as count FROM series WHERE category_id IS NOT NULL').get() as { count: number }).count),
  };

  const insert = db.prepare(`
    INSERT INTO categories (
      parent_id, name_ru, name_hy, name_en, slug, description_ru, short_description_ru,
      icon, image_url, menu_type, old_aliases, sort_order, is_active, is_public, is_public_card
    ) VALUES (
      NULL, ?, '', '', ?, ?, ?, '', '', 'category', ?, ?, ?, ?, ?
    )
  `);

  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM product_categories').run();
    db.prepare('UPDATE products SET primary_category_id = NULL, category_id = NULL, updated_at = CURRENT_TIMESTAMP').run();
    db.prepare('UPDATE series SET category_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE category_id IS NOT NULL').run();
    db.prepare('DELETE FROM categories').run();

    for (const row of rows) {
      const slug = resolveUniqueRootSlug(row.name, row.sourceId);
      const description = row.description || 'Импортировано из legacy category CSV';
      const oldAliases = JSON.stringify({ legacyCategoryId: row.sourceId, source: path.basename(inputPath) });
      insert.run(
        row.name,
        slug,
        description,
        row.description || '',
        oldAliases,
        row.position,
        row.visible ? 1 : 0,
        row.visible ? 1 : 0,
        row.visible ? 1 : 0,
      );
    }
  });

  transaction();

  const afterRows = db.prepare('SELECT id, name_ru, slug, sort_order, is_active, is_public_card FROM categories ORDER BY sort_order ASC, id ASC').all() as Array<Record<string, unknown>>;
  const report = {
    input: inputPath,
    backup: backupPath,
    before,
    inserted: rows.length,
    visibleInserted: rows.filter((row) => row.visible).length,
    hiddenInserted: rows.filter((row) => !row.visible).length,
    after: {
      categories: afterRows.length,
      productCategories: Number((db.prepare('SELECT COUNT(*) as count FROM product_categories').get() as { count: number }).count),
      productsWithPrimaryCategory: Number((db.prepare('SELECT COUNT(*) as count FROM products WHERE primary_category_id IS NOT NULL').get() as { count: number }).count),
      seriesWithCategory: Number((db.prepare('SELECT COUNT(*) as count FROM series WHERE category_id IS NOT NULL').get() as { count: number }).count),
    },
    categories: afterRows,
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

main();
