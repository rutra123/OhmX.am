#!/usr/bin/env node
/**
 * Building Project smoke tool — safety unit tests (source/static level only).
 *
 * SAFETY: imports ONLY the pure helper functions from building-project-smoke.mjs.
 * No API calls, no store writes, no manifest writes, no deletions. Safe to run
 * at any time (Node 24):
 *
 *   node server/scripts/building-project-smoke.test.mjs
 *
 * Covers the required guarantees:
 *   A. create --body '<json>'  → body is really parsed and passed through
 *   B. created smoke project id → lands in the current-run manifest allowlist
 *   C. cleanup                 → may delete only ids from the current-run allowlist
 *   D. foreign/non-smoke project → NEVER DELETE
 *   E. malformed body          → fails safely (throws, no partial state)
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseArgs, parseBody, recordCreatedId, canDelete, resolveBackupDestination } from './building-project-smoke.mjs';

// ---- A. create --body: body is parsed and reaches the create call ----
{
  const argv = ['create', 'RUN-123', '--body', '{"objectType":"private_house","totalAreaM2":180,"floorCount":2}'];
  const { cmd, a1, opt } = parseArgs(argv);
  assert.equal(cmd, 'create');
  assert.equal(a1, 'RUN-123');
  assert.equal(opt.body, '{"objectType":"private_house","totalAreaM2":180,"floorCount":2}');
  const body = parseBody(opt.body);
  assert.deepEqual(body, { objectType: 'private_house', totalAreaM2: 180, floorCount: 2 });
  // the tool forces the marker name AFTER parsing; body itself is untouched
  assert.equal(body.name, undefined);
}

// body may appear anywhere after positionals (api passthrough shape too)
{
  const { cmd, a1, a2, rest, opt } = parseArgs(['api', 'POST', 'RUN-123', '/api/tools/building-project/x/rooms', '--body', '{"name":"Кухня"}']);
  assert.equal(cmd, 'api');
  assert.equal(a1, 'POST');
  assert.equal(a2, 'RUN-123');
  assert.deepEqual(rest, ['/api/tools/building-project/x/rooms']);
  assert.equal(opt.body, '{"name":"Кухня"}');
  assert.deepEqual(parseBody(opt.body), { name: 'Кухня' });
}

// positionals and options are order-independent
{
  const { cmd, a1, opt } = parseArgs(['--dry-run', 'restore-store', 'SNAP', '--body', '{}']);
  assert.equal(cmd, 'restore-store');
  assert.equal(a1, 'SNAP');
  assert.equal(opt.dryRun, true);
  assert.equal(opt.body, '{}');
}

// ---- B. created id is recorded in the current-run manifest allowlist ----
{
  const manifest = { runId: 'RUN-123', marker: 'RUN-123', createdProjectIds: [] };
  recordCreatedId(manifest, 'id-1');
  recordCreatedId(manifest, 'id-2');
  recordCreatedId(manifest, 'id-1'); // duplicate is not re-added
  assert.deepEqual(manifest.createdProjectIds, ['id-1', 'id-2']);
}

// ---- C. cleanup may delete only ids from the current-run allowlist ----
{
  const manifest = { runId: 'RUN-123', marker: 'RUN-123', createdProjectIds: ['id-1', 'id-2'] };
  assert.equal(canDelete('id-1', 'RUN-123', manifest), true);
  assert.equal(canDelete('id-2', 'RUN-123', manifest), true);
}

// ---- D. foreign / non-smoke project → NEVER DELETE ----
{
  const manifest = { runId: 'RUN-123', marker: 'RUN-123', createdProjectIds: ['id-1'] };
  assert.equal(canDelete('foreign-id', 'RUN-123', manifest), false, 'id not in manifest');
  assert.equal(canDelete('id-1', 'Собственный дом — Ереван', manifest), false, 'name is not the run marker');
  assert.equal(canDelete('id-1', 'RUN-123', { runId: 'OTHER', marker: 'OTHER', createdProjectIds: ['id-1'] }), false, 'different run manifest');
  assert.equal(canDelete('id-1', 'RUN-123', null), false, 'no manifest');
  assert.equal(canDelete('id-1', 'RUN-123', { runId: 'RUN-123', marker: 'RUN-123' }), false, 'missing createdProjectIds');
}

// ---- E. malformed body → fail safely (throw, no partial create) ----
{
  assert.throws(() => parseBody('{not valid json'), SyntaxError);
  assert.throws(() => parseArgs(['create', 'RUN', '--body']), /--body requires a JSON value/);
  assert.equal(parseBody(undefined), undefined, 'no --body → no body on the wire');
}

// ---- F. backup destinations are explicit and resolved from the caller ----
{
  assert.throws(() => resolveBackupDestination(undefined), /explicit destination path/);
  assert.throws(() => resolveBackupDestination('   '), /explicit destination path/);
  assert.equal(resolveBackupDestination('snapshots/building-projects'), path.resolve('snapshots/building-projects'));
}

console.log('SMOKE-TOOL-TESTS: ALL PASS (A..F)');
