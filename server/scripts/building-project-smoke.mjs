#!/usr/bin/env node
/**
 * Building Project — safe smoke runner (Phase 2.5 data-safety fix).
 *
 * Every automated/manual deployment smoke must use THIS tool so that projects it
 * creates are explicitly owned by the run and cleanup is allowlist-only.
 *
 * Ownership model:
 *   - each run gets a unique RUN_ID:  p25-smoke-<YYYYMMDD-HHMMSS>-<uuid8>
 *   - every project created by the run is named EXACTLY RUN_ID (marker)
 *   - created project IDs are written through to a run manifest BEFORE/AT create
 *   - cleanup deletes ONLY ids present in the manifest AND whose name === RUN_ID
 *
 * HARD RULES (do not bypass):
 *   - cleanup NEVER enumerates data/building-projects/ for deletion
 *   - cleanup NEVER deletes via the list API
 *   - a project is deleted ONLY IF id ∈ manifest AND name === RUN_ID
 *   - any verification failure → skip and report; never delete
 *   - state uncertainty → leave artifacts and report
 *
 * Usage (Node 24):
 *   node server/scripts/building-project-smoke.mjs new
 *       # prints RUN_ID + manifest path
 *   node server/scripts/building-project-smoke.mjs create <RUN_ID> --body '<json>'
 *       # POST /api/tools/building-project with body; forces name=RUN_ID; records id
 *   node server/scripts/building-project-smoke.mjs add-room <RUN_ID> <PROJECT_ID> --body '<json>'
 *       # helper passthrough POST /:id/rooms (no tracking needed; rooms belong to owned project)
 *   node server/scripts/building-project-smoke.mjs api <METHOD> <RUN_ID> <PATH> --body '<json>'
 *       # generic API passthrough for owned project (PATH may contain :id)
 *   node server/scripts/building-project-smoke.mjs cleanup <RUN_ID>
 *       # allowlist-only delete of manifest ids with marker verification
 *   node server/scripts/building-project-smoke.mjs audit
 *       # classify store files: owned-by-this-tool / unknown (never deletes)
 *   node server/scripts/building-project-smoke.mjs backup <DEST>
 *       # snapshot data/building-projects (names+timestamps+contents) into DEST
 *   node server/scripts/building-project-smoke.mjs restore-store <SNAPSHOT> [--dry-run]
 *   node server/scripts/building-project-smoke.mjs restore-single <SNAPSHOT> <PROJECT_ID> [--dry-run]
 *
 * Safety unit tests (no API, no store writes):
 *   node server/scripts/building-project-smoke.test.mjs
 *
 * Env: BP_API_BASE (default http://127.0.0.1:8081), BP_MANIFEST_DIR
 *      (default <this script dir>/bp-smoke-manifests)
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const API_BASE = process.env.BP_API_BASE || 'http://127.0.0.1:8081';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const MANIFEST_DIR = process.env.BP_MANIFEST_DIR || path.join(HERE, 'bp-smoke-manifests');
const STORE = path.resolve(HERE, '../../data/building-projects'); // runtime project store

function nowStamp() {
  const d = new Date();
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function newRunId() {
  return `p25-smoke-${nowStamp()}-${randomUUID().slice(0, 8)}`;
}

function manifestPath(runId) {
  return path.join(MANIFEST_DIR, `${runId}.json`);
}

function loadManifest(runId) {
  const p = manifestPath(runId);
  if (!fs.existsSync(p)) {
    throw new Error(`manifest not found: ${p} (run ${runId} not started here?)`);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeManifest(runId, manifest) {
  fs.mkdirSync(MANIFEST_DIR, { recursive: true });
  fs.writeFileSync(manifestPath(runId), JSON.stringify(manifest, null, 2));
}

async function api(method, urlPath, body) {
  const res = await fetch(API_BASE + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

// ---------- commands ----------

async function cmdNew() {
  const runId = newRunId();
  writeManifest(runId, { runId, marker: runId, createdAt: new Date().toISOString(), createdProjectIds: [] });
  console.log(`RUN_ID=${runId}`);
  console.log(`MANIFEST=${manifestPath(runId)}`);
  return runId;
}

async function cmdCreate(runId, bodyArg) {
  const manifest = loadManifest(runId);
  const body = parseBody(bodyArg) || {};
  body.name = runId; // enforce marker
  const { status, data } = await api('POST', '/api/tools/building-project', body);
  if ((status !== 200 && status !== 201) || !data?.id) {
    throw new Error(`create failed (${status}): ${JSON.stringify(data)}`);
  }
  recordCreatedId(manifest, data.id);
  writeManifest(runId, manifest);
  console.log(`CREATED id=${data.id} name=${data.name}`);
  return data.id;
}

async function cmdApi(method, runId, urlPath, bodyArg) {
  const manifest = loadManifest(runId);
  const body = parseBody(bodyArg);
  const { status, data } = await api(method, urlPath, body);
  console.log(`${method} ${urlPath} -> ${status}`);
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2).slice(0, 2000));
  return { status, data };
}

async function cmdCleanup(runId) {
  const manifest = loadManifest(runId);
  const ids = [...manifest.createdProjectIds];
  if (!ids.length) {
    console.log('No projects recorded for this run; nothing to delete.');
    return;
  }
  let deleted = 0, skipped = [];
  for (const id of ids) {
    // Safety guard: exact ID + marker + created during this run (manifest is the proof of creation)
    const { status, data } = await api('GET', `/api/tools/building-project/${id}`);
    if (status === 404) {
      skipped.push(`${id} (already gone, 404)`);
      continue;
    }
    const name = data?.name || data?.project?.name || null;
    const ok = canDelete(id, name, manifest);
    if (!ok) {
      skipped.push(`${id} (verification failed: name=${JSON.stringify(name)}, expected=${manifest.marker})`);
      continue; // NEVER delete on verification failure
    }
    const del = await api('DELETE', `/api/tools/building-project/${id}`);
    if (del.status === 200 || del.status === 204) {
      deleted++;
      console.log(`DELETED ${id} (marker verified)`);
    } else {
      skipped.push(`${id} (delete returned ${del.status})`);
    }
  }
  console.log(`Cleanup done: deleted=${deleted} skipped=${skipped.length}`);
  for (const s of skipped) console.log(`  SKIPPED ${s}`);
  if (skipped.length) console.log('NOTE: skipped items were left in place — review manually, do NOT force-delete.');
}

async function cmdAudit() {
  if (!fs.existsSync(STORE)) { console.log('store missing:', STORE); return; }
  const files = fs.readdirSync(STORE).filter((f) => f.endsWith('.json')).sort();
  const manifests = fs.existsSync(MANIFEST_DIR)
    ? fs.readdirSync(MANIFEST_DIR).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, f), 'utf8')))
    : [];
  const owned = new Map();
  for (const m of manifests) for (const id of m.createdProjectIds) owned.set(id, m.runId);
  let unknown = 0;
  for (const f of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(STORE, f), 'utf8'));
    const id = raw.id;
    if (owned.has(id) && raw.name === owned.get(id)) {
      console.log(`OWNED   ${f}  run=${owned.get(id)}`);
    } else {
      unknown++;
      console.log(`UNKNOWN ${f}  id=${id} name=${JSON.stringify(raw.name)} — DO NOT DELETE without user confirmation`);
    }
  }
  console.log(unknown ? `AUDIT: ${unknown} unknown file(s) — left untouched` : 'AUDIT: all store files owned by recorded smoke runs');
}

async function cmdBackup(dest) {
  const target = resolveBackupDestination(dest);
  if (!fs.existsSync(STORE)) { console.log('store missing'); return; }
  fs.mkdirSync(target, { recursive: true });
  const files = fs.readdirSync(STORE).filter((f) => f.endsWith('.json')).sort();
  for (const f of files) {
    // cp -p equivalent: preserve mtime
    const src = path.join(STORE, f);
    const st = fs.statSync(src);
    fs.copyFileSync(src, path.join(target, f));
    fs.utimesSync(path.join(target, f), st.atime, st.mtime);
  }
  console.log(`BACKUP: ${files.length} project file(s) -> ${target}`);
  return target;
}

async function cmdRestoreStore(snapshot, dryRun) {
  const files = fs.readdirSync(snapshot).filter((f) => f.endsWith('.json')).sort();
  fs.mkdirSync(STORE, { recursive: true });
  let n = 0;
  for (const f of files) {
    const dest = path.join(STORE, f);
    if (dryRun) { console.log(`[dry-run] would restore ${f}`); continue; }
    fs.copyFileSync(path.join(snapshot, f), dest);
    const st = fs.statSync(path.join(snapshot, f));
    fs.utimesSync(dest, st.atime, st.mtime);
    n++;
  }
  console.log(dryRun ? `[dry-run] store restore: ${files.length} file(s) would be restored` : `Store restored: ${n} file(s) from ${snapshot}`);
}

async function cmdRestoreSingle(snapshot, projectId, dryRun) {
  const f = `${projectId}.json`;
  const src = path.join(snapshot, f);
  if (!fs.existsSync(src)) { throw new Error(`project not found in snapshot: ${f}`); }
  if (dryRun) { console.log(`[dry-run] would restore ${f}`); return; }
  fs.mkdirSync(STORE, { recursive: true });
  fs.copyFileSync(src, path.join(STORE, f));
  const st = fs.statSync(src);
  fs.utimesSync(path.join(STORE, f), st.atime, st.mtime);
  console.log(`Restored single project ${f} from ${snapshot}`);
}

// ---------- pure helpers (exported for the safety unit test) ----------

/**
 * Parse CLI argv into positionals + options. Options (--body, --dry-run) are
 * scanned over the FULL argv, so `create <RUN_ID> --body '<json>'` works even
 * though --body sits at the third position (previously it landed in `a2` and
 * was silently ignored because only args after the third were scanned).
 */
export function parseArgs(argv) {
  const opt = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--body') {
      if (argv[i + 1] === undefined) throw new Error('--body requires a JSON value');
      opt.body = argv[++i];
    } else if (argv[i] === '--dry-run') {
      opt.dryRun = true;
    } else {
      positional.push(argv[i]);
    }
  }
  const [cmd, a1, a2, ...rest] = positional;
  return { cmd, a1, a2, rest, opt };
}

/**
 * Parse a --body value. undefined → undefined (no body sent on the wire);
 * malformed JSON throws (fail safely).
 */
export function parseBody(bodyArg) {
  return bodyArg === undefined ? undefined : JSON.parse(bodyArg);
}

/** Resolve an explicitly supplied backup destination; there is no implicit default. */
export function resolveBackupDestination(dest) {
  if (typeof dest !== 'string' || dest.trim() === '') {
    throw new Error('backup requires an explicit destination path');
  }
  return path.resolve(dest);
}

/** Write-through: append a created project id to the run manifest allowlist. */
export function recordCreatedId(manifest, id) {
  if (!manifest.createdProjectIds.includes(id)) manifest.createdProjectIds.push(id);
  return manifest;
}

/**
 * Allowlist-only delete decision. A project may be deleted ONLY when its id is
 * in THIS run's manifest AND its name equals the run marker. Everything else —
 * foreign ids, non-marker names, other runs' manifests — is refused.
 */
export function canDelete(id, name, manifest) {
  return Boolean(
    manifest &&
    manifest.createdProjectIds &&
    manifest.createdProjectIds.includes(id) &&
    name === manifest.marker,
  );
}

// ---------- main ----------

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

async function main() {
  const { cmd, a1, a2, rest, opt } = parseArgs(process.argv.slice(2));
  try {
    if (cmd === 'new') await cmdNew();
    else if (cmd === 'create') await cmdCreate(a1, opt.body);
    else if (cmd === 'add-room') await cmdApi('POST', a1, `/api/tools/building-project/${a2}/rooms`, opt.body);
    else if (cmd === 'api') await cmdApi((a1 || 'GET').toUpperCase(), a2, rest[0] ?? '/', opt.body);
    else if (cmd === 'cleanup') await cmdCleanup(a1);
    else if (cmd === 'audit') await cmdAudit();
    else if (cmd === 'backup') await cmdBackup(a1);
    else if (cmd === 'restore-store') await cmdRestoreStore(a1, opt.dryRun);
    else if (cmd === 'restore-single') await cmdRestoreSingle(a1, a2, opt.dryRun);
    else {
      console.log(`usage:
  new                          start run -> RUN_ID
  create <RUN_ID> --body '{}'  create owned project (name forced to RUN_ID)
  add-room <RUN_ID> <PROJECT_ID> --body '{}'  add a room to an owned project
  api <METHOD> <RUN_ID> <PATH> generic API call (PATH may contain :id)
  cleanup <RUN_ID>             allowlist delete of manifest ids (marker verified)
  audit                        classify store files owned/unknown (never deletes)
  backup <DEST>                snapshot data/building-projects (names+mtimes)
  restore-store <SNAP> [--dry-run]
  restore-single <SNAP> <ID> [--dry-run]`);
    }
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
}

if (isMain) await main();
