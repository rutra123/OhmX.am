import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { parse } from "csv-parse/sync";

/**
 * RT4.1 FAN_COIL profile migration (phase 1 of 2). Inserts ONLY rows into
 * engineering_product_profile. Values/sources/condition sets are a separate phase.
 * Fail-closed: DB hash guard, exact pre/post invariants, online backup, receipt, rollback.
 */
export const PROFILE_RECEIPT_SCHEMA_ID = "ohmx.rt41-fan-coil-profile-receipt.v1" as const;
const ENGINEERING_TABLES = [
  "engineering_source", "engineering_condition_set", "engineering_condition_entry", "engineering_value",
  "engineering_equipment_type", "engineering_parameter", "engineering_condition_key", "engineering_source_type",
] as const;
const PROFILE_COLUMNS = [
  "product_id", "equipment_type", "series", "model", "identity_status", "data_completeness",
  "source_verification", "schema_id", "schema_version",
] as const;
const IDENTITY = new Set(["IDENTIFIED", "IDENTITY_PARTIAL", "IDENTITY_UNCERTAIN"]);
const COMPLETENESS = new Set(["COMPLETE", "PARTIAL", "BLOCKED"]);
const VERIFICATION = new Set(["VERIFIED", "PARTIALLY_VERIFIED", "UNVERIFIED"]);

export interface ProfileInput {
  productId: number;
  sku: string;
  equipmentType: "FAN_COIL";
  series: string;
  model: string;
  identityStatus: string;
  dataCompleteness: string;
  sourceVerification: string;
}

export interface ProfileApplyOptions {
  databasePath: string;
  profilesCsvPath: string;
  expectedDatabaseSha256: string;
  expectedProfilesSha256: string;
  expectedProfileCount: number;
  backupPath: string;
  receiptPath: string;
}

export interface ProfileRollbackOptions {
  databasePath: string;
  receiptPath: string;
}

const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

export function readProfilesCsv(path: string): ProfileInput[] {
  const rows = parse(readFileSync(path, "utf8").replace(/^﻿/, ""), { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>;
  const seen = new Set<number>();
  return rows.map((r, i) => {
    const productId = Number(r.product_id);
    if (!Number.isInteger(productId) || productId <= 0) throw new Error(`profiles row ${i + 2}: invalid product_id`);
    if (seen.has(productId)) throw new Error(`profiles row ${i + 2}: duplicate product_id ${productId}`);
    seen.add(productId);
    if (r.equipment_type !== "FAN_COIL") throw new Error(`profiles row ${i + 2}: equipment_type must be FAN_COIL`);
    if (!IDENTITY.has(r.identity_status) || !COMPLETENESS.has(r.data_completeness) || !VERIFICATION.has(r.source_verification)) {
      throw new Error(`profiles row ${i + 2}: invalid status enum`);
    }
    if (!r.series || !r.model || !r.sku) throw new Error(`profiles row ${i + 2}: series/model/sku required`);
    return {
      productId, sku: r.sku, equipmentType: "FAN_COIL", series: r.series, model: r.model,
      identityStatus: r.identity_status, dataCompleteness: r.data_completeness, sourceVerification: r.source_verification,
    } as ProfileInput;
  }).sort((a, b) => a.productId - b.productId);
}

function counts(db: Database.Database): Record<string, number> {
  const out: Record<string, number> = {
    engineering_product_profile: (db.prepare("SELECT COUNT(*) AS n FROM engineering_product_profile").get() as { n: number }).n,
  };
  for (const t of ENGINEERING_TABLES) out[t] = (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  return out;
}

function profileRow(db: Database.Database, productId: number): Record<string, unknown> | undefined {
  return db.prepare(`SELECT ${PROFILE_COLUMNS.join(",")} FROM engineering_product_profile WHERE product_id = ?`).get(productId) as Record<string, unknown> | undefined;
}

const rowSha = (row: unknown): string => sha(JSON.stringify(row, Object.keys(row as object).sort()));

function assertHealthy(db: Database.Database, label: string): void {
  const ic = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
  if (ic.length !== 1 || ic[0].integrity_check !== "ok") throw new Error(`${label}: integrity_check failed`);
  const fk = db.pragma("foreign_key_check") as unknown[];
  if (fk.length !== 0) throw new Error(`${label}: foreign_key_check returned ${fk.length} violation(s)`);
}

export async function applyFanCoilProfiles(options: ProfileApplyOptions): Promise<Record<string, unknown>> {
  const dbPath = resolve(options.databasePath);
  const profilesBytes = readFileSync(resolve(options.profilesCsvPath));
  if (sha(profilesBytes) !== options.expectedProfilesSha256) throw new Error("profiles CSV SHA-256 mismatch");
  const profiles = readProfilesCsv(options.profilesCsvPath);
  if (profiles.length !== options.expectedProfileCount) throw new Error(`profile count ${profiles.length} != approved ${options.expectedProfileCount}`);
  const dbSha = sha(readFileSync(dbPath));
  if (dbSha !== options.expectedDatabaseSha256) throw new Error(`DB SHA-256 mismatch: expected ${options.expectedDatabaseSha256} got ${dbSha}`);
  for (const p of [options.backupPath, options.receiptPath]) {
    if (existsSync(resolve(p))) throw new Error(`refusing to overwrite existing ${p}`);
    mkdirSync(dirname(resolve(p)), { recursive: true });
  }
  const db = new Database(dbPath, { fileMustExist: true });
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  let open = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    open = true;
    if (sha(readFileSync(dbPath)) !== options.expectedDatabaseSha256) throw new Error("DB changed after BEGIN IMMEDIATE");
    assertHealthy(db, "pre-apply");
    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='engineering_product_profile'").all();
    if (triggers.length !== 0) throw new Error("triggers exist on engineering_product_profile");
    const fcType = db.prepare("SELECT 1 FROM engineering_equipment_type WHERE equipment_type='FAN_COIL'").get();
    if (!fcType) throw new Error("FAN_COIL equipment type is not registered");
    const before = counts(db);
    const checkProduct = db.prepare("SELECT sku, is_active FROM products WHERE id = ?");
    for (const p of profiles) {
      const prod = checkProduct.get(p.productId) as { sku: string; is_active: number } | undefined;
      if (!prod) throw new Error(`product ${p.productId} does not exist`);
      if (prod.sku !== p.sku) throw new Error(`product ${p.productId} SKU mismatch: db ${prod.sku} csv ${p.sku}`);
      if (prod.is_active !== 1) throw new Error(`product ${p.productId} is inactive`);
      if (profileRow(db, p.productId)) throw new Error(`product ${p.productId} already has a profile`);
    }
    const profilesBefore = (db.prepare("SELECT * FROM engineering_product_profile ORDER BY product_id").all());
    const src = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      src.pragma("query_only = ON");
      await src.backup(resolve(options.backupPath));
    } finally {
      src.close();
    }
    const bk = new Database(resolve(options.backupPath), { readonly: true, fileMustExist: true });
    try {
      assertHealthy(bk, "backup");
      if (JSON.stringify(counts(bk)) !== JSON.stringify(before)) throw new Error("backup table counts differ from source");
    } finally {
      bk.close();
    }
    const backupSha256 = sha(readFileSync(resolve(options.backupPath)));
    const ins = db.prepare(`INSERT INTO engineering_product_profile (product_id, equipment_type, series, model, identity_status, data_completeness, source_verification) VALUES (?,?,?,?,?,?,?)`);
    const receiptRows: Array<{ productId: number; row: Record<string, unknown>; rowSha256: string }> = [];
    for (const p of profiles) {
      const r = ins.run(p.productId, p.equipmentType, p.series, p.model, p.identityStatus, p.dataCompleteness, p.sourceVerification);
      if (r.changes !== 1) throw new Error(`insert for ${p.productId} affected ${r.changes} rows`);
      const row = profileRow(db, p.productId) as Record<string, unknown>;
      if (row.equipment_type !== "FAN_COIL" || row.series !== p.series || row.model !== p.model || row.identity_status !== p.identityStatus
        || row.data_completeness !== p.dataCompleteness || row.source_verification !== p.sourceVerification) {
        throw new Error(`read-back mismatch for ${p.productId}`);
      }
      receiptRows.push({ productId: p.productId, row, rowSha256: rowSha(row) });
    }
    const after = counts(db);
    for (const [t, n] of Object.entries(before)) {
      const expected = t === "engineering_product_profile" ? n + profiles.length : n;
      if (after[t] !== expected) throw new Error(`table ${t}: expected ${expected} got ${after[t]}`);
    }
    const profilesAfter = db.prepare("SELECT * FROM engineering_product_profile ORDER BY product_id").all() as Array<{ product_id: number }>;
    const added = new Set(profiles.map((p) => p.productId));
    const preserved = profilesAfter.filter((r) => !added.has(r.product_id));
    if (JSON.stringify(preserved) !== JSON.stringify(profilesBefore)) throw new Error("existing profiles changed");
    assertHealthy(db, "post-apply");
    db.exec("COMMIT");
    open = false;
    const receipt = {
      schemaId: PROFILE_RECEIPT_SCHEMA_ID,
      mode: "RT41_FC_PROFILE_INSERT_ONLY",
      databaseSha256Before: options.expectedDatabaseSha256,
      profilesCsvSha256: options.expectedProfilesSha256,
      countsBefore: before,
      countsAfter: after,
      insertedProfiles: receiptRows,
      rollback: { strategy: "RECEIPT_GUARDED_DELETE_OR_ONLINE_BACKUP_RESTORE", backupPath: resolve(options.backupPath), backupSha256, requiresNoEngineeringValuesForProducts: true },
      verification: { integrityCheck: "ok", foreignKeyViolations: 0, existingProfilesUnchanged: true },
    };
    writeFileSync(resolve(options.receiptPath), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
    return receipt;
  } catch (error) {
    if (open) db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

export function rollbackFanCoilProfiles(options: ProfileRollbackOptions): Record<string, unknown> {
  const receipt = JSON.parse(readFileSync(resolve(options.receiptPath), "utf8")) as {
    schemaId: string; insertedProfiles: Array<{ productId: number; row: Record<string, unknown>; rowSha256: string }>;
    countsBefore: Record<string, number>;
  };
  if (receipt.schemaId !== PROFILE_RECEIPT_SCHEMA_ID) throw new Error("unsupported receipt");
  const db = new Database(resolve(options.databasePath), { fileMustExist: true });
  db.pragma("foreign_keys = ON");
  let open = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    open = true;
    const del = db.prepare("DELETE FROM engineering_product_profile WHERE product_id = ?");
    const hasValues = db.prepare("SELECT COUNT(*) AS n FROM engineering_value WHERE product_id = ?");
    for (const r of receipt.insertedProfiles) {
      const current = profileRow(db, r.productId);
      if (!current || rowSha(current) !== r.rowSha256) throw new Error(`profile ${r.productId} changed since apply; rollback refused`);
      if ((hasValues.get(r.productId) as { n: number }).n !== 0) throw new Error(`product ${r.productId} has engineering values; roll back values first`);
    }
    for (const r of receipt.insertedProfiles) {
      if (del.run(r.productId).changes !== 1) throw new Error(`delete ${r.productId} failed`);
    }
    const after = counts(db);
    if (after.engineering_product_profile !== receipt.countsBefore.engineering_product_profile) throw new Error("profile count after rollback differs from pre-apply");
    for (const t of ENGINEERING_TABLES) if (after[t] !== receipt.countsBefore[t]) throw new Error(`table ${t} count differs from pre-apply`);
    assertHealthy(db, "post-rollback");
    db.exec("COMMIT");
    open = false;
    return { rolledBack: receipt.insertedProfiles.length, countsAfter: after };
  } catch (error) {
    if (open) db.exec("ROLLBACK");
    throw error;
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
  if (mode === "apply") {
    const r = await applyFanCoilProfiles({
      databasePath: need("db"), profilesCsvPath: need("profiles"), expectedDatabaseSha256: need("expected-db-sha"),
      expectedProfilesSha256: need("expected-profiles-sha"), expectedProfileCount: Number(need("expected-count")),
      backupPath: need("backup"), receiptPath: need("receipt"),
    });
    process.stdout.write(JSON.stringify({ status: "COMMITTED", inserted: (r.insertedProfiles as unknown[]).length, countsAfter: r.countsAfter }, null, 2) + "\n");
  } else if (mode === "rollback") {
    process.stdout.write(JSON.stringify(rollbackFanCoilProfiles({ databasePath: need("db"), receiptPath: need("receipt") }), null, 2) + "\n");
  } else {
    throw new Error("Usage: applyFanCoilRt41Profiles.ts <apply|rollback> --db ... ");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`); process.exitCode = 1; });
}
