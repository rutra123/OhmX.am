


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
import { db, dbPath } from '../db.js';

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
  return path.resolve(projectRoot, filePath);
}

function backupDatabase(targetDir: string) {
  fs.mkdirSync(targetDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(targetDir, `electro-before-switches-category-fix-${stamp}.db`);
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function getCategoryBySlug(slug: string) {
  return db.prepare('SELECT id, slug, name_ru FROM categories WHERE slug = ?').get(slug) as { id: number; slug: string; name_ru: string } | undefined;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const reportPath = resolvePath(args.report || 'backups/category-fixes/switches-category-fix-report.json');
  const backupPath = backupDatabase(path.dirname(reportPath));

  const switchesRoot = getCategoryBySlug('rozetki-i-vyklyuchateli');
  const panelsRoot = getCategoryBySlug('shchity-i-shkafy');
  if (!switchesRoot || !panelsRoot) {
    throw new Error('Не найдены корневые категории rozetki-i-vyklyuchateli или shchity-i-shkafy');
  }

  const sourceRows = db.prepare(`
    SELECT id, parent_id, slug, name_ru, is_public, is_active
    FROM categories
    WHERE parent_id = ? AND name_ru IN ('Клеммные блоки Viking 3', 'Распределительные клеммы,блоки, шины')
    ORDER BY id
  `).all(switchesRoot.id) as Array<Record<string, unknown>>;

  const beforePanelsChildren = db.prepare('SELECT id, slug, name_ru FROM categories WHERE parent_id = ? ORDER BY sort_order, name_ru').all(panelsRoot.id) as Array<Record<string, unknown>>;

  const update = db.prepare('UPDATE categories SET parent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  const transaction = db.transaction(() => {
    for (const row of sourceRows) update.run(panelsRoot.id, row.id);
  });
  transaction();

  const afterSwitchesChildren = db.prepare('SELECT id, slug, name_ru FROM categories WHERE parent_id = ? ORDER BY sort_order, name_ru').all(switchesRoot.id) as Array<Record<string, unknown>>;
  const afterPanelsChildren = db.prepare('SELECT id, slug, name_ru FROM categories WHERE parent_id = ? ORDER BY sort_order, name_ru').all(panelsRoot.id) as Array<Record<string, unknown>>;

  const report = {
    backup: backupPath,
    movedCount: sourceRows.length,
    moved: sourceRows.map((row) => ({
      ...row,
      new_parent_id: panelsRoot.id,
      new_parent_slug: panelsRoot.slug,
    })),
    switchesRoot: switchesRoot,
    panelsRoot: panelsRoot,
    beforePanelsChildren,
    afterSwitchesChildren,
    afterPanelsChildren,
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

main();
