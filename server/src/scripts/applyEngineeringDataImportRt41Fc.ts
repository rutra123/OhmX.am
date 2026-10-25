import { readFileSync, writeFileSync, existsSync } from "node:fs";
import Database from "better-sqlite3";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyEngineeringDataImport,
  type EngineeringDataImportApproval,
} from "./applyEngineeringDataImport.js";
import { inspectEngineeringDataImport } from "./previewEngineeringDataImport.js";

/**
 * RT4.1 FAN_COIL values apply (phase 2 of 2). Reuses the ED2B guarded apply engine
 * (BEGIN IMMEDIATE, locked re-preview, online backup, exact row receipts, post-apply
 * no-change preview, allowed tables = sources/condition sets/entries/values only).
 *   freeze: read-only; writes an approval JSON from the CURRENT preview.
 *   apply : requires the approval JSON AND the three expected hashes typed on the CLI.
 * The input CSV must contain READY facts only (apply refuses INVALID/NO_CHANGE).
 */
const PHASE = "RT41_FC" as const;

function args(argv: string[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i]?.startsWith("--") || argv[i + 1] === undefined || argv[i + 1] === "") throw new Error(`bad argument ${argv[i]}`);
    o[argv[i].slice(2)] = argv[i + 1];
  }
  return o;
}

export async function freezeApproval(databasePath: string, inputPath: string, auditPath: string): Promise<EngineeringDataImportApproval> {
  const p = await inspectEngineeringDataImport({ databasePath, inputPath, auditPath });
  const ids = (c: string): number[] => p.facts.filter((f) => f.classification === c).map((f) => f.factId as number).sort((a, b) => a - b);
  if (p.summary.invalidCount !== 0 || p.summary.noChangeCount !== 0) {
    throw new Error(`cannot freeze: invalid=${p.summary.invalidCount} noChange=${p.summary.noChangeCount}`);
  }
  return {
    phase: PHASE,
    expectedDatabaseSha256: p.baseline.databaseSha256,
    expectedInputSha256: p.baseline.inputSha256,
    expectedPreviewFingerprint: p.previewFingerprint,
    expectedSummary: { ...p.summary },
    readyFactIds: ids("READY"),
    conflictFactIds: ids("CONFLICT"),
    blockedContractFactIds: ids("BLOCKED_CONTRACT"),
    reviewRequiredFactIds: ids("REVIEW_REQUIRED"),
  };
}


interface ReceiptRowSet { row: Record<string, unknown> }
interface ValuesReceipt {
  mode: string;
  applied: { sources: number; conditionSets: number; conditionEntries: number; values: number };
  inserted: { sources: ReceiptRowSet[]; conditionSets: ReceiptRowSet[]; conditionEntries: ReceiptRowSet[]; values: ReceiptRowSet[] };
}

/** Guarded inverse of the RT4.1 values apply: deletes exactly the receipt rows, only if unchanged. */
export function rollbackValues(databasePath: string, receiptPath: string): Record<string, unknown> {
  const receipt = JSON.parse(readFileSync(resolve(receiptPath), "utf8")) as ValuesReceipt;
  if (receipt.mode !== "RT41_FC_CONTROLLED_READY_ONLY_APPLY") throw new Error("receipt is not an RT41_FC values receipt");
  const db = new Database(resolve(databasePath), { fileMustExist: true });
  db.pragma("foreign_keys = ON");
  const plan: Array<{ table: string; idCol: string; rows: ReceiptRowSet[] }> = [
    { table: "engineering_value", idCol: "value_id", rows: receipt.inserted.values },
    { table: "engineering_condition_entry", idCol: "condition_entry_id", rows: receipt.inserted.conditionEntries },
    { table: "engineering_condition_set", idCol: "condition_set_id", rows: receipt.inserted.conditionSets },
    { table: "engineering_source", idCol: "source_id", rows: receipt.inserted.sources },
  ];
  const count = (t: string): number => (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  let open = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    open = true;
    const before: Record<string, number> = {};
    for (const s of plan) before[s.table] = count(s.table);
    for (const s of plan) {
      const get = db.prepare(`SELECT * FROM ${s.table} WHERE ${s.idCol} = ?`);
      for (const r of s.rows) {
        const cur = get.get(r.row[s.idCol]) as Record<string, unknown> | undefined;
        if (!cur) throw new Error(`${s.table} ${String(r.row[s.idCol])} is missing; rollback refused`);
        for (const [k, v] of Object.entries(r.row)) {
          if (cur[k] !== v) throw new Error(`${s.table} ${String(r.row[s.idCol])} column ${k} changed since apply; rollback refused`);
        }
      }
    }
    const valueIds = new Set(receipt.inserted.values.map((r) => r.row.value_id as number));
    const setIds = receipt.inserted.conditionSets.map((r) => r.row.condition_set_id as number);
    const sourceIds = receipt.inserted.sources.map((r) => r.row.source_id as number);
    for (const id of setIds) {
      const users = db.prepare("SELECT value_id FROM engineering_value WHERE condition_set_id = ?").all(id) as Array<{ value_id: number }>;
      if (users.some((u) => !valueIds.has(u.value_id))) throw new Error(`condition set ${id} is used by values outside this apply; rollback refused`);
    }
    for (const id of sourceIds) {
      const users = db.prepare("SELECT value_id FROM engineering_value WHERE source_id = ?").all(id) as Array<{ value_id: number }>;
      if (users.some((u) => !valueIds.has(u.value_id))) throw new Error(`source ${id} is used by values outside this apply; rollback refused`);
    }
    for (const s of plan) {
      const del = db.prepare(`DELETE FROM ${s.table} WHERE ${s.idCol} = ?`);
      for (const r of s.rows) if (del.run(r.row[s.idCol]).changes !== 1) throw new Error(`delete failed in ${s.table}`);
    }
    const expected: Record<string, number> = {
      engineering_value: before.engineering_value - receipt.applied.values,
      engineering_condition_entry: before.engineering_condition_entry - receipt.applied.conditionEntries,
      engineering_condition_set: before.engineering_condition_set - receipt.applied.conditionSets,
      engineering_source: before.engineering_source - receipt.applied.sources,
    };
    for (const [t, n] of Object.entries(expected)) if (count(t) !== n) throw new Error(`post-rollback ${t}: expected ${n} got ${count(t)}`);
    const ic = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
    if (ic[0]?.integrity_check !== "ok") throw new Error("integrity_check failed after rollback");
    if ((db.pragma("foreign_key_check") as unknown[]).length !== 0) throw new Error("foreign_key_check failed after rollback");
    db.exec("COMMIT");
    open = false;
    return { status: "ROLLED_BACK", countsAfter: expected };
  } catch (e) {
    if (open) db.exec("ROLLBACK");
    throw e;
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const [mode, ...rest] = process.argv.slice(2);
  const a = args(rest);
  const need = (k: string): string => { if (!a[k]) throw new Error(`missing --${k}`); return a[k]; };
  const databasePath = resolve(need("db"));
  const inputPath = mode === "rollback" ? "" : resolve(need("input"));
  const auditPath = mode === "rollback" ? "" : join(dirname(inputPath), "engineering_data_research_audit.csv");
  if (mode === "freeze") {
    const approval = await freezeApproval(databasePath, inputPath, auditPath);
    const out = resolve(need("approval-out"));
    if (existsSync(out)) throw new Error(`refusing to overwrite ${out}`);
    writeFileSync(out, JSON.stringify(approval, null, 2) + "\n", { flag: "wx" });
    process.stdout.write(JSON.stringify({ status: "FROZEN", approvalFile: out, summary: approval.expectedSummary, databaseSha256: approval.expectedDatabaseSha256, inputSha256: approval.expectedInputSha256, previewFingerprint: approval.expectedPreviewFingerprint }, null, 2) + "\n");
  } else if (mode === "apply") {
    const approval = JSON.parse(readFileSync(resolve(need("approval")), "utf8")) as EngineeringDataImportApproval;
    if (approval.phase !== PHASE) throw new Error("approval file is not an RT41_FC approval");
    if (approval.expectedDatabaseSha256 !== need("expected-db-sha")) throw new Error("--expected-db-sha does not match approval file");
    if (approval.expectedInputSha256 !== need("expected-input-sha")) throw new Error("--expected-input-sha does not match approval file");
    if (approval.expectedPreviewFingerprint !== need("expected-preview-fingerprint")) throw new Error("--expected-preview-fingerprint does not match approval file");
    const receipt = await applyEngineeringDataImport({
      databasePath, inputPath, auditPath, backupPath: resolve(need("backup")), receiptPath: resolve(need("receipt")), approval,
    });
    process.stdout.write(JSON.stringify({ status: receipt.status, mode: receipt.mode, applied: receipt.applied, verification: receipt.verification }, null, 2) + "\n");
  } else if (mode === "rollback") {
    process.stdout.write(JSON.stringify(rollbackValues(databasePath, need("receipt")), null, 2) + "\n");
  } else {
    throw new Error("Usage: applyEngineeringDataImportRt41Fc.ts <freeze|apply|rollback> --db <db> --input <csv> ...");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exitCode = 1; });
}
