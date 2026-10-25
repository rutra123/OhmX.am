
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
const COLOR_WORDS = [
  'белый',
  'белая',
  'белое',
  'черный',
  'чёрный',
  'черная',
  'чёрная',
  'слоновая кость',
  'алюминий',
  'алюминиевый',
  'стальной',
  'графит',
  'антрацит',
  'шампань',
  'champagne',
  'white',
  'magnesium',
  'серый',
  'песок',
  'матовый',
  'глянец',
];
const SERVICE_LEVELS = new Set(['главная', 'action']);
const BRAND_NODE_PATTERNS = [
  /^электротехнические изделия /i,
  /^электроустановочные изделия simon/i,
  /^промышленное оборудование finder/i,
  /^холодильное оборудование danfoss/i,
  /^поперечные вентиляторы longwell$/i,
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

function resolvePath(filePath: string) {
  if (path.isAbsolute(filePath)) return filePath;
  const fromCwd = path.resolve(process.cwd(), filePath);
  if (fs.existsSync(fromCwd)) return fromCwd;
  return path.resolve(projectRoot, filePath);
}

function normalizeKey(value: string) {
  return String(value || '')
    .replace(/^\ufeff/, '')
    .trim()
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function csvEscape(value: string) {
  const stringValue = String(value ?? '');
  if (/[",\n\r]/.test(stringValue)) {
    return '"' + stringValue.replace(/"/g, '""') + '"';
  }
  return stringValue;
}

function toCsv(rows: string[][]) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n') + '\n';
}

function getCategoryHeaders(headers: string[]) {
  return headers
    .map((header) => {
      const match = header.match(/^category_level_(\d+)$/);
      return match ? { header, index: Number(match[1]) } : null;
    })
    .filter((entry): entry is { header: string; index: number } => Boolean(entry))
    .sort((a, b) => a.index - b.index);
}

function shouldDropAsBrandNode(value: string) {
  return BRAND_NODE_PATTERNS.some((pattern) => pattern.test(value));
}

function shouldDropAsSeriesNode(value: string, series: string) {
  const node = normalizeKey(value);
  const normalizedSeries = normalizeKey(series);
  if (!node || !normalizedSeries) return false;
  if (node === normalizedSeries) return true;
  if (node.startsWith(normalizedSeries + ' ') || node.endsWith(' ' + normalizedSeries) || node.includes(normalizedSeries)) return true;
  return /^.+ серия /i.test(value) && node.includes(normalizedSeries.replace(/^.+ серия /i, '').trim());
}

function shouldDropAsColorNode(value: string) {
  const node = normalizeKey(value);
  return COLOR_WORDS.some((word) => node.includes(word));
}

function cleanCategoryPath(row: Row, categoryHeaders: Array<{ header: string; index: number }>) {
  const rootHeader = categoryHeaders[0]?.header;
  const root = rootHeader ? String(row[rootHeader] || '').trim() : '';
  const series = String(row.series || '').trim();
  const unique = new Set<string>();
  const filtered: string[] = [];

  for (const { header } of categoryHeaders.slice(1)) {
    const value = String(row[header] || '').trim();
    const normalized = normalizeKey(value);
    if (!value) continue;
    if (normalized === normalizeKey(root)) continue;
    if (SERVICE_LEVELS.has(normalized)) continue;
    if (shouldDropAsBrandNode(value)) continue;
    if (shouldDropAsSeriesNode(value, series)) continue;
    if (shouldDropAsColorNode(value)) continue;
    if (unique.has(normalized)) continue;
    unique.add(normalized);
    filtered.push(value);
  }

  // Cap depth after root so import does not recreate brand/series/color tails as browse categories.
  return [root, ...filtered.slice(0, 3)].filter(Boolean);
}

function countEdges(paths: string[][]) {
  const edges = new Set<string>();
  for (const path of paths) {
    let parent = 'ROOT';
    for (const level of path) {
      edges.add(parent + ' -> ' + level);
      parent = level;
    }
  }
  return edges.size;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args.input;
  const output = args.output;
  const report = args.report || (output ? output.replace(/\.csv$/i, '.report.json') : '');

  if (!input || !output) {
    console.error('Usage: tsx src/cli/compactCatalogCategories.ts --input <normalized.csv> --output <compacted.csv> [--report <report.json>]');
    process.exit(1);
  }

  const inputPath = resolvePath(input);
  const outputPath = resolvePath(output);
  const reportPath = report ? resolvePath(report) : '';
  const raw = fs.readFileSync(inputPath, 'utf8');
  const parsed = parseCsv(raw, ',');
  if (parsed.length < 2) throw new Error('CSV пустой или некорректный');

  const headers = parsed[0].map((header) => String(header || '').replace(/^\ufeff/, '').trim());
  const dataRows = parsed.slice(1).filter((row) => row.some((cell) => String(cell || '').trim() !== ''));
  const categoryHeaders = getCategoryHeaders(headers);
  if (!categoryHeaders.length) throw new Error('В CSV не найдены category_level_N колонки');

  const outputRows: string[][] = [headers];
  const beforePaths: string[][] = [];
  const afterPaths: string[][] = [];
  const droppedLevels: Record<string, number> = {};

  for (const rawRow of dataRows) {
    const row = Object.fromEntries(headers.map((header, index) => [header, String(rawRow[index] || '').trim()]));
    const beforePath = categoryHeaders.map(({ header }) => String(row[header] || '').trim()).filter(Boolean);
    const afterPath = cleanCategoryPath(row, categoryHeaders);
    beforePaths.push(beforePath);
    afterPaths.push(afterPath);

    const nextRow = { ...row };
    categoryHeaders.forEach(({ header }, index) => {
      const nextValue = afterPath[index] || '';
      const previousValue = String(nextRow[header] || '').trim();
      if (previousValue && previousValue !== nextValue && !afterPath.includes(previousValue)) {
        droppedLevels[previousValue] = (droppedLevels[previousValue] || 0) + 1;
      }
      nextRow[header] = nextValue;
    });

    outputRows.push(headers.map((header) => nextRow[header] || ''));
  }

  const reportData = {
    input: inputPath,
    output: outputPath,
    rows: dataRows.length,
    before: {
      maxDepth: Math.max(...beforePaths.map((path) => path.length)),
      uniqueEdges: countEdges(beforePaths),
    },
    after: {
      maxDepth: Math.max(...afterPaths.map((path) => path.length)),
      uniqueEdges: countEdges(afterPaths),
      uniqueRoots: [...new Set(afterPaths.map((path) => path[0]).filter(Boolean))].sort(),
    },
    topDroppedLevels: Object.entries(droppedLevels)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 80)
      .map(([name, count]) => ({ name, count })),
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, toCsv(outputRows), 'utf8');

  if (reportPath) {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2) + '\n', 'utf8');
  }

  console.log(JSON.stringify(reportData, null, 2));
}

main();
