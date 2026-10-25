#!/usr/bin/env node
// Copies runtime data files that production modules read via fs/URL (not via import),
// so tsc does not emit them. Usage: node scripts/copy-prod-runtime-data.mjs [--out-dir <dist>]
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = args[0] === '--out-dir' && args[1] ? resolve(args[1]) : resolve(serverRoot, 'dist');
const FILES = ['data/buildingProjectClimateQuickV1.json'];

for (const file of FILES) {
  const destination = resolve(outDir, file);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(resolve(serverRoot, 'src', file), destination);
  console.log(`copied ${file} -> ${destination}`);
}
