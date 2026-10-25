import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { parse } from "csv-parse/sync";

/**
 * Compatibility relationships import (contract ohmx.compatibility-contract.v1).
 *   queue   : candidates -> relationship_review_queue (status pending_review, rule_source ai_suggested)
 *   promote : reviewer decisions CSV -> product_relationships (approved, rule_source manual) + queue update
 *   rollback: receipt-guarded inverse of queue or promote
 * Fail-closed: DB sha, input sha, count, product existence/active/SKU, no duplicates,
 * online backup validated, exact receipt rows with hashes. Never touches other tables.
 */
export const RELATIONSHIP_RECEIPT_SCHEMA_ID = "ohmx.relationships-import-receipt.v1" as const;
const RELATION_TYPES = new Set(["required", "recommended", "optional", "alternative", "incompatible"]);
const CONFIDENCE = new Set(["high", "medium", "low"]);
const PRIORITY = new Set(["P1", "P2", "P3"]);
const ORIGIN = "RT-COMPAT-2026-10-13";
const WATCHED = ["product_relationships", "relationship_review_queue", "relationship_rules", "products", "engineering_value", "engineering_product_profile"] as const;

export interface Candidate {
  candidateKey: string;
  sourceProductId: number;
  sourceSku: string;
  targetProductId: number;
  targetSku: string;
  relationType: string;
  evidenceLevel: string;
  confidence: string;
  priority: string;
  reasonEngineering: string;
  conditionsJson: string;
  missingFactsJson: string;
}

export interface Decision {
  candidateKey: string;
  decision: string;
  reviewer: string;
  attestFamilyMatch: string;
  notes: string;
}

const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");
const rowSha = (row: unknown): string => sha(JSON.stringify(row, Object.keys(row as object).sort()));
const csvRows = (path: string): Array<Record<string, string>> =>
  parse(readFileSync(path, "utf8").replace(/^﻿/, ""), { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>;

export function readCandidates(path: string): Candidate[] {
  const seen = new Set<string>();
  return csvRows(path).map((r, i) => {
    const c: Candidate = {
      candidateKey: r.candidate_key, sourceProductId: Number(r.source_product_id), sourceSku: r.source_sku,
      targetProductId: Number(r.target_product_id), targetSku: r.target_sku, relationType: r.proposed_relation_type,
      evidenceLevel: r.evidence_level, confidence: r.confidence, priority: r.priority,
      reasonEngineering: r.reason_engineering, conditionsJson: r.conditions_json, missingFactsJson: r.missing_facts_json,
    };
    const where = `candidate row ${i + 2}`;
    if (!Number.isInteger(c.sourceProductId) || !Number.isInteger(c.targetProductId) || c.sourceProductId === c.targetProductId) throw new Error(`${where}: invalid product ids`);
    if (c.candidateKey !== `${c.sourceProductId}|${c.targetProductId}|${c.relationType}`) throw new Error(`${where}: candidate_key mismatch`);
    if (!RELATION_TYPES.has(c.relationType) || !CONFIDENCE.has(c.confidence) || !PRIORITY.has(c.priority)) throw new Error(`${where}: invalid enum`);
    if (!["EXACT_CODE", "FAMILY_DOC_CODE_UNLISTED"].includes(c.evidenceLevel)) throw new Error(`${where}: evidence level not importable (${c.evidenceLevel})`);
    if (c.reasonEngineering.trim().length < 20) throw new Error(`${where}: reason_engineering shorter than 20 chars`);
    const cond = JSON.parse(c.conditionsJson) as { evidence?: unknown[]; candidate_origin?: string };
    if (!Array.isArray(cond.evidence) || cond.evidence.length === 0 || cond.candidate_origin !== ORIGIN) throw new Error(`${where}: conditions_json must carry evidence and origin`);
    JSON.parse(c.missingFactsJson);
    if (seen.has(c.candidateKey)) throw new Error(`${where}: duplicate candidate ${c.candidateKey}`);
    seen.add(c.candidateKey);
    return c;
  });
}

export function readDecisions(path: string): Decision[] {
  return csvRows(path).map((r) => ({
    candidateKey: r.candidate_key, decision: (r.decision ?? "").trim(), reviewer: (r.reviewer ?? "").trim(),
    attestFamilyMatch: (r.attest_family_match ?? "").trim(), notes: (r.notes ?? "").trim(),
  }));
}

function counts(db: Database.Database): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of WATCHED) out[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  return out;
}

function assertHealthy(db: Database.Database, label: string): void {
  const ic = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
  if (ic.length !== 1 || ic[0].integrity_check !== "ok") throw new Error(`${label}: integrity_check failed`);
  if ((db.pragma("foreign_key_check") as unknown[]).length !== 0) throw new Error(`${label}: foreign_key_check failed`);
}

async function backupValidated(dbPath: string, backupPath: string, expected: Record<string, number>): Promise<string> {
  const src = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    src.pragma("query_only = ON");
    await src.backup(resolve(backupPath));
  } finally {
    src.close();
  }
  const bk = new Database(resolve(backupPath), { readonly: true, fileMustExist: true });
  try {
    assertHealthy(bk, "backup");
    if (JSON.stringify(counts(bk)) !== JSON.stringify(expected)) throw new Error("backup table counts differ from source");
  } finally {
    bk.close();
  }
  return sha(readFileSync(resolve(backupPath)));
}

function prepareOutputs(...paths: string[]): void {
  for (const p of paths) {
    if (existsSync(resolve(p))) throw new Error(`refusing to overwrite existing ${p}`);
    mkdirSync(dirname(resolve(p)), { recursive: true });
  }
}

function checkProducts(db: Database.Database, cands: readonly Candidate[]): void {
  const get = db.prepare("SELECT sku, is_active FROM products WHERE id = ?");
  for (const c of cands) {
    for (const [id, sku] of [[c.sourceProductId, c.sourceSku], [c.targetProductId, c.targetSku]] as const) {
      const p = get.get(id) as { sku: string; is_active: number } | undefined;
      if (!p) throw new Error(`product ${id} does not exist`);
      if (p.sku !== sku) throw new Error(`product ${id} SKU mismatch: db ${p.sku} csv ${sku}`);
      if (p.is_active !== 1) throw new Error(`product ${id} is inactive`);
    }
  }
}

export interface QueueOptions {
  databasePath: string; candidatesPath: string; expectedDatabaseSha256: string; expectedCandidatesSha256: string;
  expectedCount: number; backupPath: string; receiptPath: string;
}

export async function queueCandidates(o: QueueOptions): Promise<Record<string, unknown>> {
  const dbPath = resolve(o.databasePath);
  if (sha(readFileSync(resolve(o.candidatesPath))) !== o.expectedCandidatesSha256) throw new Error("candidates CSV SHA-256 mismatch");
  const cands = readCandidates(o.candidatesPath);
  if (cands.length !== o.expectedCount) throw new Error(`candidate count ${cands.length} != approved ${o.expectedCount}`);
  if (sha(readFileSync(dbPath)) !== o.expectedDatabaseSha256) throw new Error("DB SHA-256 mismatch");
  prepareOutputs(o.backupPath, o.receiptPath);
  const db = new Database(dbPath, { fileMustExist: true });
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  let open = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    open = true;
    if (sha(readFileSync(dbPath)) !== o.expectedDatabaseSha256) throw new Error("DB changed after BEGIN IMMEDIATE");
    assertHealthy(db, "pre-apply");
    const trig = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('relationship_review_queue','product_relationships')").all();
    if (trig.length) throw new Error("triggers exist on relationship tables");
    const before = counts(db);
    checkProducts(db, cands);
    const dupQ = db.prepare("SELECT id FROM relationship_review_queue WHERE source_product_id=? AND target_product_id=? AND proposed_relation_type=? AND review_status NOT IN ('rejected','superseded','archived')");
    const dupP = db.prepare("SELECT id FROM product_relationships WHERE source_product_id=? AND target_product_id=? AND relation_type=?");
    for (const c of cands) {
      if (dupQ.get(c.sourceProductId, c.targetProductId, c.relationType)) throw new Error(`queue already holds ${c.candidateKey}`);
      if (dupP.get(c.sourceProductId, c.targetProductId, c.relationType)) throw new Error(`product_relationships already holds ${c.candidateKey}`);
    }
    const backupSha256 = await backupValidated(dbPath, o.backupPath, before);
    const ins = db.prepare(`INSERT INTO relationship_review_queue
      (source_product_id, target_product_id, proposed_relation_type, reason_engineering, confidence, rule_source, rule_id,
       missing_facts_json, conditions_json, priority, review_status)
      VALUES (?,?,?,?,?,'ai_suggested',NULL,?,?,?,'pending_review')`);
    const get = db.prepare("SELECT * FROM relationship_review_queue WHERE id = ?");
    const inserted: Array<{ candidateKey: string; id: number; rowSha256: string }> = [];
    for (const c of cands) {
      const r = ins.run(c.sourceProductId, c.targetProductId, c.relationType, c.reasonEngineering, c.confidence, c.missingFactsJson, c.conditionsJson, c.priority);
      if (r.changes !== 1) throw new Error(`insert ${c.candidateKey} affected ${r.changes} rows`);
      const row = get.get(Number(r.lastInsertRowid)) as Record<string, unknown>;
      inserted.push({ candidateKey: c.candidateKey, id: Number(r.lastInsertRowid), rowSha256: rowSha(row) });
    }
    const after = counts(db);
    for (const [t, n] of Object.entries(before)) {
      const exp = t === "relationship_review_queue" ? n + cands.length : n;
      if (after[t] !== exp) throw new Error(`table ${t}: expected ${exp} got ${after[t]}`);
    }
    assertHealthy(db, "post-apply");
    db.exec("COMMIT");
    open = false;
    const receipt = { schemaId: RELATIONSHIP_RECEIPT_SCHEMA_ID, mode: "QUEUE_INSERT", candidatesSha256: o.expectedCandidatesSha256, databaseSha256Before: o.expectedDatabaseSha256, backup: { path: resolve(o.backupPath), sha256: backupSha256 }, countsBefore: before, countsAfter: after, inserted };
    writeFileSync(resolve(o.receiptPath), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
    return receipt;
  } catch (e) {
    if (open) db.exec("ROLLBACK");
    throw e;
  } finally {
    db.close();
  }
}

export interface PromoteOptions {
  databasePath: string; candidatesPath: string; decisionsPath: string; expectedDatabaseSha256: string;
  expectedDecisionsSha256: string; backupPath: string; receiptPath: string; now?: () => string;
}

export async function promoteDecisions(o: PromoteOptions): Promise<Record<string, unknown>> {
  const dbPath = resolve(o.databasePath);
  if (sha(readFileSync(resolve(o.decisionsPath))) !== o.expectedDecisionsSha256) throw new Error("decisions CSV SHA-256 mismatch");
  if (sha(readFileSync(dbPath)) !== o.expectedDatabaseSha256) throw new Error("DB SHA-256 mismatch");
  const cands = new Map(readCandidates(o.candidatesPath).map((c) => [c.candidateKey, c] as const));
  const decisions = readDecisions(o.decisionsPath).filter((d) => d.decision !== "");
  if (decisions.length === 0) throw new Error("no decisions to apply");
  const seenKeys = new Set<string>();
  for (const d of decisions) {
    const c = cands.get(d.candidateKey);
    if (!c) throw new Error(`decision for unknown candidate ${d.candidateKey}`);
    if (seenKeys.has(d.candidateKey)) throw new Error(`duplicate decision ${d.candidateKey}`);
    seenKeys.add(d.candidateKey);
    if (!["approve", "reject", "needs_data"].includes(d.decision)) throw new Error(`invalid decision ${d.decision} for ${d.candidateKey}`);
    if (d.reviewer === "") throw new Error(`reviewer is required (${d.candidateKey})`);
    if (d.decision === "approve" && c.evidenceLevel !== "EXACT_CODE" && d.attestFamilyMatch !== "YES") {
      throw new Error(`FAMILY_DOC_CODE_UNLISTED approval requires attest_family_match=YES (${d.candidateKey})`);
    }
  }
  prepareOutputs(o.backupPath, o.receiptPath);
  const nowIso = (o.now ?? (() => new Date().toISOString()))();
  const db = new Database(dbPath, { fileMustExist: true });
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  let open = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    open = true;
    if (sha(readFileSync(dbPath)) !== o.expectedDatabaseSha256) throw new Error("DB changed after BEGIN IMMEDIATE");
    assertHealthy(db, "pre-apply");
    const before = counts(db);
    const backupSha256 = await backupValidated(dbPath, o.backupPath, before);
    const findQ = db.prepare("SELECT * FROM relationship_review_queue WHERE source_product_id=? AND target_product_id=? AND proposed_relation_type=? AND review_status='pending_review'");
    const insP = db.prepare(`INSERT INTO product_relationships
      (source_product_id, target_product_id, relation_type, reason_engineering, confidence, rule_source, manual_review_required,
       review_status, conditions_json, created_by, reviewed_by, reviewed_at)
      VALUES (?,?,?,?,?,'manual',0,'approved',?,?,?,?)`);
    const updQ = db.prepare("UPDATE relationship_review_queue SET review_status=?, reviewed_by=?, reviewed_at=?, reviewer_notes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?");
    const getP = db.prepare("SELECT * FROM product_relationships WHERE id=?");
    const changes: Array<Record<string, unknown>> = [];
    for (const d of decisions) {
      const c = cands.get(d.candidateKey) as Candidate;
      const q = findQ.get(c.sourceProductId, c.targetProductId, c.relationType) as (Record<string, unknown> & { id: number; conditions_json: string }) | undefined;
      if (!q) throw new Error(`no pending queue row for ${d.candidateKey}`);
      if (q.conditions_json !== c.conditionsJson) throw new Error(`queue row ${q.id} conditions differ from candidate`);
      const status = d.decision === "approve" ? "approved" : d.decision === "reject" ? "rejected" : "needs_data";
      let relId: number | null = null;
      let relSha: string | null = null;
      if (d.decision === "approve") {
        const r = insP.run(c.sourceProductId, c.targetProductId, c.relationType, c.reasonEngineering, c.confidence === "high" && c.evidenceLevel === "EXACT_CODE" ? "high" : "medium", c.conditionsJson, "compat-evidence-pass-2026-10-13", d.reviewer, nowIso);
        if (r.changes !== 1) throw new Error(`promotion insert ${d.candidateKey} failed`);
        relId = Number(r.lastInsertRowid);
        relSha = rowSha(getP.get(relId));
      }
      if (updQ.run(status, d.reviewer, nowIso, d.notes || null, q.id).changes !== 1) throw new Error(`queue update ${q.id} failed`);
      changes.push({ candidateKey: d.candidateKey, queueId: q.id, queuePreviousStatus: "pending_review", queueBefore: { review_status: q.review_status, reviewed_by: q.reviewed_by, reviewed_at: q.reviewed_at, reviewer_notes: q.reviewer_notes, updated_at: q.updated_at }, queueNewStatus: status, productRelationshipId: relId, productRelationshipSha256: relSha, reviewer: d.reviewer });
    }
    const after = counts(db);
    const approvedN = changes.filter((c) => c.productRelationshipId != null).length;
    for (const [t, n] of Object.entries(before)) {
      const exp = t === "product_relationships" ? n + approvedN : n;
      if (after[t] !== exp) throw new Error(`table ${t}: expected ${exp} got ${after[t]}`);
    }
    assertHealthy(db, "post-apply");
    db.exec("COMMIT");
    open = false;
    const receipt = { schemaId: RELATIONSHIP_RECEIPT_SCHEMA_ID, mode: "PROMOTE", decisionsSha256: o.expectedDecisionsSha256, databaseSha256Before: o.expectedDatabaseSha256, backup: { path: resolve(o.backupPath), sha256: backupSha256 }, countsBefore: before, countsAfter: after, changes };
    writeFileSync(resolve(o.receiptPath), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
    return receipt;
  } catch (e) {
    if (open) db.exec("ROLLBACK");
    throw e;
  } finally {
    db.close();
  }
}

export function rollbackRelationships(databasePath: string, receiptPath: string): Record<string, unknown> {
  const receipt = JSON.parse(readFileSync(resolve(receiptPath), "utf8")) as {
    schemaId: string; mode: string; inserted?: Array<{ id: number; rowSha256: string }>;
    changes?: Array<{ queueId: number; queueNewStatus: string; queueBefore: { review_status: string; reviewed_by: string | null; reviewed_at: string | null; reviewer_notes: string | null; updated_at: string }; productRelationshipId: number | null; productRelationshipSha256: string | null }>;
    countsBefore: Record<string, number>;
  };
  if (receipt.schemaId !== RELATIONSHIP_RECEIPT_SCHEMA_ID) throw new Error("unsupported receipt");
  const db = new Database(resolve(databasePath), { fileMustExist: true });
  db.pragma("foreign_keys = ON");
  let open = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    open = true;
    if (receipt.mode === "QUEUE_INSERT") {
      const get = db.prepare("SELECT * FROM relationship_review_queue WHERE id=?");
      for (const r of receipt.inserted ?? []) {
        const cur = get.get(r.id);
        if (!cur || rowSha(cur) !== r.rowSha256) throw new Error(`queue row ${r.id} changed since import; rollback refused`);
      }
      const del = db.prepare("DELETE FROM relationship_review_queue WHERE id=?");
      for (const r of receipt.inserted ?? []) if (del.run(r.id).changes !== 1) throw new Error(`delete queue ${r.id} failed`);
    } else if (receipt.mode === "PROMOTE") {
      const getP = db.prepare("SELECT * FROM product_relationships WHERE id=?");
      const getQ = db.prepare("SELECT review_status FROM relationship_review_queue WHERE id=?");
      for (const c of receipt.changes ?? []) {
        if (c.productRelationshipId != null) {
          const cur = getP.get(c.productRelationshipId);
          if (!cur || rowSha(cur) !== c.productRelationshipSha256) throw new Error(`relationship ${c.productRelationshipId} changed since promotion; rollback refused`);
        }
        const q = getQ.get(c.queueId) as { review_status: string } | undefined;
        if (!q || q.review_status !== c.queueNewStatus) throw new Error(`queue row ${c.queueId} changed since promotion; rollback refused`);
      }
      const delP = db.prepare("DELETE FROM product_relationships WHERE id=?");
      const resetQ = db.prepare("UPDATE relationship_review_queue SET review_status=?, reviewed_by=?, reviewed_at=?, reviewer_notes=?, updated_at=? WHERE id=?");
      for (const c of receipt.changes ?? []) {
        if (c.productRelationshipId != null && delP.run(c.productRelationshipId).changes !== 1) throw new Error("delete relationship failed");
        const b = c.queueBefore;
        if (resetQ.run(b.review_status, b.reviewed_by, b.reviewed_at, b.reviewer_notes, b.updated_at, c.queueId).changes !== 1) throw new Error("queue reset failed");
      }
    } else {
      throw new Error(`unsupported receipt mode ${receipt.mode}`);
    }
    const after = counts(db);
    for (const t of ["product_relationships", "relationship_review_queue"] as const) {
      if (after[t] !== receipt.countsBefore[t]) throw new Error(`table ${t} count differs from pre-apply (${after[t]} vs ${receipt.countsBefore[t]})`);
    }
    assertHealthy(db, "post-rollback");
    db.exec("COMMIT");
    open = false;
    return { status: "ROLLED_BACK", mode: receipt.mode, countsAfter: after };
  } catch (e) {
    if (open) db.exec("ROLLBACK");
    throw e;
  } finally {
    db.close();
  }
}

function cli(argv: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--") || argv[i + 1] === undefined) throw new Error(`bad argument ${argv[i]}`);
    o[argv[i].slice(2)] = argv[i + 1];
  }
  return o;
}

async function main(): Promise<void> {
  const [mode, ...rest] = process.argv.slice(2);
  const a = cli(rest);
  const need = (k: string): string => { if (!a[k]) throw new Error(`missing --${k}`); return a[k]; };
  if (mode === "queue") {
    const r = await queueCandidates({ databasePath: need("db"), candidatesPath: need("candidates"), expectedDatabaseSha256: need("expected-db-sha"), expectedCandidatesSha256: need("expected-candidates-sha"), expectedCount: Number(need("expected-count")), backupPath: need("backup"), receiptPath: need("receipt") });
    process.stdout.write(JSON.stringify({ status: "COMMITTED", mode: r.mode, countsAfter: r.countsAfter }, null, 2) + "\n");
  } else if (mode === "promote") {
    const r = await promoteDecisions({ databasePath: need("db"), candidatesPath: need("candidates"), decisionsPath: need("decisions"), expectedDatabaseSha256: need("expected-db-sha"), expectedDecisionsSha256: need("expected-decisions-sha"), backupPath: need("backup"), receiptPath: need("receipt") });
    process.stdout.write(JSON.stringify({ status: "COMMITTED", mode: r.mode, countsAfter: r.countsAfter }, null, 2) + "\n");
  } else if (mode === "rollback") {
    process.stdout.write(JSON.stringify(rollbackRelationships(need("db"), need("receipt")), null, 2) + "\n");
  } else {
    throw new Error("Usage: applyRelationshipsImport.ts <queue|promote|rollback> ...");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exitCode = 1; });
}
