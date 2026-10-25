import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { applyReadiness, parseReadinessCsv, rollbackReadiness } from "./setFanCoilProfileReadiness.js";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "fc-readiness-"));
  const path = join(dir, "db.sqlite");
  const db = new Database(path);
  db.exec(`
    CREATE TABLE products (id INTEGER PRIMARY KEY, sku TEXT NOT NULL);
    CREATE TABLE engineering_product_profile (product_id INTEGER PRIMARY KEY REFERENCES products(id), equipment_type TEXT NOT NULL,
      data_completeness TEXT NOT NULL, source_verification TEXT NOT NULL, updated_at TEXT);
    INSERT INTO products VALUES (1, 'A'), (2, 'B'), (3, 'C');
    INSERT INTO engineering_product_profile VALUES (1, 'FAN_COIL', 'BLOCKED', 'PARTIALLY_VERIFIED', NULL),
      (2, 'FAN_COIL', 'BLOCKED', 'PARTIALLY_VERIFIED', NULL), (3, 'FAN_COIL', 'PARTIAL', 'VERIFIED', NULL);`);
  db.close();
  return { dir, path };
}
const sha = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");
const csv = "product_id,sku,from_completeness,to_completeness,from_verification,to_verification\n1,A,BLOCKED,PARTIAL,PARTIALLY_VERIFIED,PARTIALLY_VERIFIED\n";
const state = (path: string) => new Database(path, { readonly: true }).prepare("SELECT product_id, data_completeness, source_verification FROM engineering_product_profile ORDER BY product_id").all();

test("activates only the listed staged profile; receipt + backup; rollback restores", async () => {
  const { dir, path } = fixture();
  const changes = parseReadinessCsv(csv);
  const r = await applyReadiness({ databasePath: path, changes, expectedDatabaseSha256: sha(path), backupPath: join(dir, "bk.db"), receiptPath: join(dir, "r.json") });
  assert.equal(r.after[0].data_completeness, "PARTIAL");
  assert.deepEqual(state(path), [
    { product_id: 1, data_completeness: "PARTIAL", source_verification: "PARTIALLY_VERIFIED" },
    { product_id: 2, data_completeness: "BLOCKED", source_verification: "PARTIALLY_VERIFIED" },
    { product_id: 3, data_completeness: "PARTIAL", source_verification: "VERIFIED" },
  ]);
  rollbackReadiness(path, join(dir, "r.json"));
  assert.equal((state(path)[0] as { data_completeness: string }).data_completeness, "BLOCKED");
  assert.throws(() => rollbackReadiness(path, join(dir, "r.json")), /refused/);
});

test("refuses a wrong DB hash, an unexpected current state and an SKU mismatch", async () => {
  const { dir, path } = fixture();
  await assert.rejects(applyReadiness({ databasePath: path, changes: parseReadinessCsv(csv), expectedDatabaseSha256: "0".repeat(64), backupPath: join(dir, "b1"), receiptPath: join(dir, "r1") }), /sha256/);
  const wrongState = parseReadinessCsv("product_id,sku,from_completeness,to_completeness,from_verification,to_verification\n3,C,BLOCKED,PARTIAL,PARTIALLY_VERIFIED,PARTIALLY_VERIFIED\n");
  await assert.rejects(applyReadiness({ databasePath: path, changes: wrongState, expectedDatabaseSha256: sha(path), backupPath: join(dir, "b2"), receiptPath: join(dir, "r2") }), /refused/);
  const wrongSku = parseReadinessCsv("product_id,sku,from_completeness,to_completeness,from_verification,to_verification\n1,Z,BLOCKED,PARTIAL,PARTIALLY_VERIFIED,PARTIALLY_VERIFIED\n");
  await assert.rejects(applyReadiness({ databasePath: path, changes: wrongSku, expectedDatabaseSha256: sha(path), backupPath: join(dir, "b3"), receiptPath: join(dir, "r3") }), /SKU/);
  assert.equal((state(path)[0] as { data_completeness: string }).data_completeness, "BLOCKED", "nothing changed after refusals");
});

test("CSV contract: exact header, valid enums, unique ids", () => {
  assert.throws(() => parseReadinessCsv("id,sku\n1,A\n"), /header/);
  assert.throws(() => parseReadinessCsv("product_id,sku,from_completeness,to_completeness,from_verification,to_verification\n1,A,BLOCKED,DONE,UNVERIFIED,UNVERIFIED\n"), /enum/);
  assert.throws(() => parseReadinessCsv(`${csv}1,A,BLOCKED,PARTIAL,PARTIALLY_VERIFIED,PARTIALLY_VERIFIED\n`), /duplicate/);
});
