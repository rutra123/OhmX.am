import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { openReferenceDatabase } from "../testSupport/referenceDatabase.js";
import { applyFanCoilProfiles, rollbackFanCoilProfiles } from "./applyFanCoilRt41Profiles.js";

const sha = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");

function makeDb(dir: string): string {
  const path = join(dir, "e.db");
  const live = openReferenceDatabase();
  const db = new Database(path);
  db.pragma("journal_mode = DELETE");
  db.exec("CREATE TABLE products (id INTEGER PRIMARY KEY, sku TEXT NOT NULL UNIQUE, is_active INTEGER DEFAULT 1)");
  const ddl = live.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name LIKE 'engineering_%' AND sql IS NOT NULL ORDER BY name").all() as Array<{ sql: string }>;
  for (const r of ddl) db.exec(r.sql);
  db.prepare("INSERT INTO engineering_equipment_type (equipment_type, description) VALUES ('FAN_COIL','Fan coil')").run();
  live.close();
  db.exec("INSERT INTO products (id, sku, is_active) VALUES (1,'A',1),(2,'B',1),(3,'C',0)");
  db.close();
  return path;
}

function writeProfiles(dir: string, rows: string[][]): string {
  const p = join(dir, "profiles.csv");
  const head = "product_id,sku,equipment_type,series,model,identity_status,data_completeness,source_verification,satisfied_tasks";
  writeFileSync(p, [head, ...rows.map((r) => [...r, "10"].join(","))].join("\n") + "\n");
  return p;
}

test("profile apply inserts exact rows, then guarded rollback restores the pre-state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ohmx-profiles-"));
  try {
    const db = makeDb(dir);
    const csv = writeProfiles(dir, [
      ["1", "A", "FAN_COIL", "FC", "FC22", "IDENTIFIED", "PARTIAL", "VERIFIED"],
      ["2", "B", "FAN_COIL", "IVO", "IVO 20 AP", "IDENTIFIED", "PARTIAL", "PARTIALLY_VERIFIED"],
    ]);
    const receipt = await applyFanCoilProfiles({
      databasePath: db, profilesCsvPath: csv, expectedDatabaseSha256: sha(db), expectedProfilesSha256: sha(csv),
      expectedProfileCount: 2, backupPath: join(dir, "bk.db"), receiptPath: join(dir, "r.json"),
    });
    assert.equal((receipt.insertedProfiles as unknown[]).length, 2);
    const conn = new Database(db, { readonly: true });
    assert.equal((conn.prepare("SELECT COUNT(*) n FROM engineering_product_profile").get() as { n: number }).n, 2);
    conn.close();
    const bk = new Database(join(dir, "bk.db"), { readonly: true });
    assert.equal((bk.prepare("SELECT COUNT(*) n FROM engineering_product_profile").get() as { n: number }).n, 0);
    bk.close();
    const rb = rollbackFanCoilProfiles({ databasePath: db, receiptPath: join(dir, "r.json") });
    assert.equal(rb.rolledBack, 2);
    const after = new Database(db, { readonly: true });
    assert.equal((after.prepare("SELECT COUNT(*) n FROM engineering_product_profile").get() as { n: number }).n, 0);
    after.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("profile apply fails closed on hash mismatch, inactive product, SKU mismatch and wrong count", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ohmx-profiles-"));
  try {
    const db = makeDb(dir);
    const base = { databasePath: db, backupPath: join(dir, "b.db"), receiptPath: join(dir, "r.json") };
    const good = writeProfiles(dir, [["1", "A", "FAN_COIL", "FC", "FC22", "IDENTIFIED", "PARTIAL", "VERIFIED"]]);
    await assert.rejects(applyFanCoilProfiles({ ...base, profilesCsvPath: good, expectedDatabaseSha256: "0".repeat(64), expectedProfilesSha256: sha(good), expectedProfileCount: 1 }), /DB SHA-256 mismatch/);
    await assert.rejects(applyFanCoilProfiles({ ...base, profilesCsvPath: good, expectedDatabaseSha256: sha(db), expectedProfilesSha256: sha(good), expectedProfileCount: 2 }), /profile count/);
    const inactive = writeProfiles(dir, [["3", "C", "FAN_COIL", "FC", "FC22", "IDENTIFIED", "PARTIAL", "VERIFIED"]]);
    await assert.rejects(applyFanCoilProfiles({ ...base, profilesCsvPath: inactive, expectedDatabaseSha256: sha(db), expectedProfilesSha256: sha(inactive), expectedProfileCount: 1 }), /inactive/);
    const wrongSku = writeProfiles(dir, [["1", "ZZ", "FAN_COIL", "FC", "FC22", "IDENTIFIED", "PARTIAL", "VERIFIED"]]);
    await assert.rejects(applyFanCoilProfiles({ ...base, profilesCsvPath: wrongSku, expectedDatabaseSha256: sha(db), expectedProfilesSha256: sha(wrongSku), expectedProfileCount: 1 }), /SKU mismatch/);
    const conn = new Database(db, { readonly: true });
    assert.equal((conn.prepare("SELECT COUNT(*) n FROM engineering_product_profile").get() as { n: number }).n, 0);
    conn.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
