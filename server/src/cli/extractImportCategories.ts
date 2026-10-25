
import { db } from '../db.js';

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
import { parseCsv } from '../utils/importProducts.js';

type Row = Record<string, string>;

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');

const CATEGORY_ALIASES = [
  'category',
  'категория',
  'source category',
  'old_category_name',
  'old category',
  'group',
  'product group',
];

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

function normalizeKey(value: string) {
  return String(value || '')
    .replace(/^\ufeff/, '')
    .trim()
    .toLowerCase()
    .replace(/["'`]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function resolvePath(filePath: string) {
  if (path.isAbsolute(filePath)) return filePath;
  const fromCwd = path.resolve(process.cwd(), filePath);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(projectRoot, filePath);
}

function pickCategoryField(row: Row, headersMap: Map<string, string>) {
  for (const alias of CATEGORY_ALIASES) {
    const actualHeader = headersMap.get(normalizeKey(alias));
    if (actualHeader && String(row[actualHeader] || '').trim()) {
      return String(row[actualHeader]).trim();
    }
  }
  return '';
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args.input;
  const output = args.output;

  if (!input || !output) {
    console.error('Usage: tsx src/cli/extractImportCategories.ts --input <source.csv> --output <categories.json>');
    process.exit(1);
  }

  const inputPath = resolvePath(input);
  const outputPath = resolvePath(output);
  const raw = fs.readFileSync(inputPath, 'utf8');
  const parsed = parseCsv(raw);
  if (parsed.length < 2) throw new Error('Source CSV пустой или некорректный');

  const sourceHeaders = parsed[0].map((header) => String(header || '').replace(/^\ufeff/, '').trim());
  const sourceRows = parsed.slice(1).filter((row) => row.some((cell) => String(cell || '').trim() !== ''));
  const headersMap = new Map(sourceHeaders.map((header) => [normalizeKey(header), header]));

  const counts = new Map<string, number>();
  for (const rawRow of sourceRows) {
    const row = Object.fromEntries(sourceHeaders.map((header, index) => [header, String(rawRow[index] || '').trim()]));
    const category = pickCategoryField(row, headersMap);
    if (!category) continue;
    counts.set(category, (counts.get(category) || 0) + 1);
  }

  const categories = Array.from(counts.entries())
    .map(([sourceCategory, count]) => ({ sourceCategory, count }))
    .sort((a, b) => b.count - a.count || a.sourceCategory.localeCompare(b.sourceCategory, 'ru'));

  const result = {
    input: inputPath,
    totalRows: sourceRows.length,
    distinctCategories: categories.length,
    categories,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(result, null, 2));
}

main();
