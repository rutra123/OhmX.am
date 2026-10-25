import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

/**
 * Activation / deactivation of staged FAN_COIL profiles (engineering sign-off step).
 * Staged records are inserted with data_completeness = BLOCKED, which the catalog matcher rejects
 * (INSUFFICIENT_DATA). Activation flips ONLY the listed profiles BLOCKED -> PARTIAL (optionally
 * source_verification too); nothing else is touched.
 * Fail-closed: DB hash guard, exact expected current state per row, online backup, receipt, rollback.
 */
export const READINESS_RECEIPT_SCHEMA_ID = "ohmx.fan-coil-profile-readiness-receipt.v1" as const;
const COMPLETENESS = new Set(["COMPLETE", "PARTIAL", "BLOCKED"]);
const VERIFICATION = new Set(["VERIFIED", "PARTIALLY_VERIFIED", "UNVERIFIED"]);

export interface ReadinessChange {
  productId: number;
  sku: string;
  fromCompleteness: string;
  toCompleteness: string;
  fromVerification: string;
  toVerification: string;
}

export interface ReadinessApplyOptions {
  databasePath: string;
  changes: ReadinessChange[];
  expectedDatabaseSha256: string;
  backupPath: string;
  receiptPath: string;
}

const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

export function parseReadinessCsv(text: string): ReadinessChange[] {
  const lines = text.replace(/^﻿/, "").trim().split(/\r?\n/);
  const header = lines.shift()?.split(",") ?? [];
  const expected = ["product_id", "sku", "from_completeness", "to_completeness", "from_verification", "to_verification"];
  if (header.join(",") !== expected.join(",")) throw new Error(`readiness CSV header must be ${expected.join(",")}`);
  const seen = new Set<number>();
  return lines.filter((l) => l.trim()).map((line, i) => {
    const [productId, sku, fc, tc, fv, tv] = line.split(",").map((c) => c.trim());
    const id = Number(productId);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) throw new Error(`row ${i + 2}: invalid or duplicate product_id`);
    seen.add(id);
    if (!COMPLETENESS.has(fc) || !COMPLETENESS.has(tc) || !VERIFICATION.has(fv) || !VERIFICATION.has(tv)) throw new Error(`row ${i + 2}: invalid status enum`);
    if (!sku) throw new Error(`row ${i + 2}: sku required`);
    return { productId: id, sku, fromCompleteness: fc, toCompleteness: tc, fromVerification: fv, toVerification: tv };
  });
}

type ProfileRow = { product_id: number; equipment_type: string; data_completeness: string; source_verification: string; sku: string };

function readRows(db: Database.Database, ids: number[]): Map<number, ProfileRow> {
  const stmt = db.prepare(`SELECT p.product_id, p.equipment_type, p.data_completeness, p.source_verification, pr.sku
    FROM engineering_product_profile p JOIN products pr ON pr.id = p.product_id WHERE p.product_id = ?`);
  return new Map(ids.map((id) => [id, stmt.get(id) as ProfileRow | undefined]).filter((e): e is [number, ProfileRow] => Boolean(e[1])));
}

function otherProfilesFingerprint(db: Database.Database, ids: number[]): string {
  const rows = db.prepare("SELECT * FROM engineering_product_profile ORDER BY product_id").all() as ProfileRow[];
  return sha(JSON.stringify(rows.filter((r) => !ids.includes(r.product_id))));
}

function apply(databasePath: string, changes: ReadinessChange[], direction: "forward" | "reverse") {
  const db = new Database(databasePath, { fileMustExist: true });
  db.pragma("foreign_keys = ON");
  const ids = changes.map((c) => c.productId);
  let open = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    open = true;
    const before = readRows(db, ids);
    const othersBefore = otherProfilesFingerprint(db, ids);
    for (const c of changes) {
      const row = before.get(c.productId);
      if (!row) throw new Error(`profile ${c.productId} not found`);
      if (row.equipment_type !== "FAN_COIL") throw new Error(`profile ${c.productId} is not FAN_COIL`);
      if (row.sku !== c.sku) throw new Error(`profile ${c.productId}: SKU ${row.sku} != expected ${c.sku}`);
      const [fc, fv] = direction === "forward" ? [c.fromCompleteness, c.fromVerification] : [c.toCompleteness, c.toVerification];
      if (row.data_completeness !== fc || row.source_verification !== fv) {
        throw new Error(`profile ${c.productId}: current ${row.data_completeness}/${row.source_verification} != expected ${fc}/${fv}; refused`);
      }
    }
    const update = db.prepare("UPDATE engineering_product_profile SET data_completeness = ?, source_verification = ?, updated_at = CURRENT_TIMESTAMP WHERE product_id = ? AND data_completeness = ? AND source_verification = ?");
    for (const c of changes) {
      const args = direction === "forward"
        ? [c.toCompleteness, c.toVerification, c.productId, c.fromCompleteness, c.fromVerification]
        : [c.fromCompleteness, c.fromVerification, c.productId, c.toCompleteness, c.toVerification];
      if (update.run(...args).changes !== 1) throw new Error(`profile ${c.productId}: update affected != 1 row`);
    }
    if (otherProfilesFingerprint(db, ids) !== othersBefore) throw new Error("other profiles changed; refused");
    const integrity = (db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
    const fk = (db.prepare("PRAGMA foreign_key_check").all() as unknown[]).length;
    if (integrity !== "ok" || fk !== 0) throw new Error(`integrity ${integrity}, foreign key violations ${fk}`);
    db.exec("COMMIT");
    open = false;
    const after = readRows(db, ids);
    return { before: [...before.values()], after: [...after.values()], integrity, foreignKeyViolations: fk };
  } catch (error) {
    if (open) db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

export async function applyReadiness(options: ReadinessApplyOptions) {
  const databasePath = resolve(options.databasePath);
  const actual = sha(readFileSync(databasePath));
  if (actual !== options.expectedDatabaseSha256) throw new Error(`database sha256 ${actual} != expected ${options.expectedDatabaseSha256}`);
  if (existsSync(options.backupPath)) throw new Error("backup path already exists");
  if (existsSync(options.receiptPath)) throw new Error("receipt path already exists");
  const source = new Database(databasePath, { fileMustExist: true, readonly: true });
  await source.backup(options.backupPath);
  source.close();
  const result = apply(databasePath, options.changes, "forward");
  const receipt = {
    schemaId: READINESS_RECEIPT_SCHEMA_ID,
    mode: "FAN_COIL_PROFILE_READINESS",
    databaseSha256Before: actual,
    backupPath: resolve(options.backupPath),
    backupSha256: sha(readFileSync(options.backupPath)),
    changes: options.changes,
    ...result,
    appliedAt: new Date().toISOString(),
  };
  writeFileSync(options.receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export function rollbackReadiness(databasePath: string, receiptPath: string) {
  const receipt = JSON.parse(readFileSync(resolve(receiptPath), "utf8")) as { schemaId: string; changes: ReadinessChange[] };
  if (receipt.schemaId !== READINESS_RECEIPT_SCHEMA_ID) throw new Error("not a readiness receipt");
  return apply(resolve(databasePath), receipt.changes, "reverse");
}

async function main(argv: string[]) {
  const [mode, ...rest] = argv;
  const o: Record<string, string> = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i]?.startsWith("--") || !rest[i + 1]) throw new Error(`bad argument ${rest[i]}`);
    o[rest[i].slice(2)] = rest[i + 1];
  }
  if (mode === "apply") {
    const changes = parseReadinessCsv(readFileSync(resolve(o.changes), "utf8"));
    const r = await applyReadiness({ databasePath: o.db, changes, expectedDatabaseSha256: o["expected-db-sha"], backupPath: resolve(o.backup), receiptPath: resolve(o.receipt) });
    console.log(JSON.stringify({ status: "COMMITTED", changed: r.after.length, after: r.after }, null, 2));
  } else if (mode === "rollback") {
    const r = rollbackReadiness(o.db, o.receipt);
    console.log(JSON.stringify({ status: "ROLLED_BACK", after: r.after }, null, 2));
  } else {
    throw new Error("usage: apply --db --changes --expected-db-sha --backup --receipt | rollback --db --receipt");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
