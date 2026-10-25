#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(scriptDirectory, '..');
const source = resolve(serverRoot, 'src/data/buildingProjectSolarIrradianceV2.json');
const defaultDestination = resolve(serverRoot, 'dist/data/buildingProjectSolarIrradianceV2.json');

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function parseDestination(arguments_) {
  if (arguments_.length === 0) return defaultDestination;
  if (arguments_.length === 2 && arguments_[0] === '--destination') {
    return resolve(arguments_[1]);
  }
  throw new Error('usage: node scripts/sync-building-project-runtime-assets.mjs [--destination <path>]');
}

function main() {
  const destination = parseDestination(process.argv.slice(2));

  if (!existsSync(source) || !statSync(source).isFile()) {
    throw new Error(`source asset missing or not a regular file: ${source}`);
  }
  if (destination === source) {
    throw new Error('destination must differ from source asset');
  }

  const sourceBytes = readFileSync(source);
  const sourceSha256 = sha256(sourceBytes);

  if (existsSync(destination)) {
    if (!statSync(destination).isFile()) {
      throw new Error(`destination exists but is not a regular file: ${destination}`);
    }
    const currentBytes = readFileSync(destination);
    if (currentBytes.equals(sourceBytes) && sha256(currentBytes) === sourceSha256) {
      console.log('BUILDING_PROJECT_RUNTIME_ASSET_ALREADY_SYNCED');
      console.log(`source=${source}`);
      console.log(`destination=${destination}`);
      console.log(`sha256=${sourceSha256}`);
      return;
    }
  }

  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);

  const copiedBytes = readFileSync(destination);
  const copiedSha256 = sha256(copiedBytes);
  if (!copiedBytes.equals(sourceBytes) || copiedSha256 !== sourceSha256) {
    throw new Error(
      `post-copy verification failed: source_sha256=${sourceSha256} destination_sha256=${copiedSha256}`,
    );
  }

  console.log('BUILDING_PROJECT_RUNTIME_ASSET_SYNCED');
  console.log(`source=${source}`);
  console.log(`destination=${destination}`);
  console.log(`sha256=${sourceSha256}`);
}

try {
  main();
} catch (error) {
  console.error(`BUILDING_PROJECT_RUNTIME_ASSET_SYNC_ERROR: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
