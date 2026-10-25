
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

type CategorySummary = {
  input: string;
  totalRows: number;
  distinctCategories: number;
  categories: { sourceCategory: string; count: number }[];
};

const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');

function parseArgs(argv: string[]) {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) result[key] = 'true';
    else {
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

function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = args.input;
  const output = args.output;

  if (!input || !output) {
    console.error('Usage: tsx src/cli/generateMappingCandidates.ts --input <categories.json> --output <rules.json>');
    process.exit(1);
  }

  const inputPath = resolvePath(input);
  const outputPath = resolvePath(output);
  const summary = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as CategorySummary;

  const rules = summary.categories.map((item) => ({
    match: [item.sourceCategory],
    category_level_1: '',
    category_level_2: '',
    category_level_3: '',
    notes: `count=${item.count}`,
  }));

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(rules, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify({ input: inputPath, output: outputPath, generated: rules.length }, null, 2));
}

main();
