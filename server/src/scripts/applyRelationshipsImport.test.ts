import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { openReferenceDatabase } from "../testSupport/referenceDatabase.js";
import { promoteDecisions, queueCandidates, rollbackRelationships } from "./applyRelationshipsImport.js";

const sha = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");

function makeDb(dir: string): string {
  const path = join(dir, "e.db");
  const live = openReferenceDatabase();
  const db = new Database(path);
  db.pragma("journal_mode = DELETE");
  db.exec("CREATE TABLE products (id INTEGER PRIMARY KEY, sku TEXT NOT NULL UNIQUE, is_active INTEGER DEFAULT 1)");
  db.exec("CREATE TABLE engineering_value (value_id INTEGER PRIMARY KEY)");
  db.exec("CREATE TABLE engineering_product_profile (product_id INTEGER PRIMARY KEY)");
  for (const t of ["relationship_rules", "relationship_review_queue", "product_relationships"]) {
    const ddl = live.prepare("SELECT sql FROM sqlite_master WHERE name = ? AND type='table'").get(t) as { sql: string };
    db.exec(ddl.sql);
  }
  live.close();
  db.exec("INSERT INTO products (id, sku, is_active) VALUES (1,'VALVE',1),(2,'ACT',1),(3,'CABLE',1),(4,'OLD',0)");
  db.close();
  return path;
}

function cond(level: string): string {
  return JSON.stringify({ schema: "ohmx.relationship-conditions.v1", candidate_origin: "RT-COMPAT-2026-10-13", evidence: [{ document_id: "D1", evidence_level: level, url: "https://x.invalid/d.pdf", sha256: "0".repeat(64), page: "1", statement: "s" }] });
}
const HDR = "candidate_key,source_product_id,source_sku,target_product_id,target_sku,proposed_relation_type,evidence_level,confidence,priority,reason_engineering,conditions_json,missing_facts_json";
function candidates(dir: string, rows: Array<[number, string, number, string, string, string]>): string {
  const q = (s: string): string => `"${s.replaceAll('"', '""')}"`;
  const lines = rows.map(([s, ss, t, ts, rel, level]) =>
    [`${s}|${t}|${rel}`, s, ss, t, ts, rel, level, level === "EXACT_CODE" ? "high" : "medium", "P2", q("Official manufacturer sheet documents this pairing explicitly."), q(cond(level)), q("[]")].join(","));
  const p = join(dir, "cand.csv");
  writeFileSync(p, [HDR, ...lines].join("\n") + "\n");
  return p;
}
const base = (dir: string, db: string, cand: string, n: number) => ({
  databasePath: db, candidatesPath: cand, expectedDatabaseSha256: sha(db), expectedCandidatesSha256: sha(cand), expectedCount: n,
  backupPath: join(dir, "bk-q.db"), receiptPath: join(dir, "rc-q.json"),
});
const count = (db: string, t: string): number => {
  const c = new Database(db, { readonly: true });
  const n = (c.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
  c.close();
  return n;
};

test("queue inserts pending_review rows; rollback restores; repeat is refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ohmx-rel-"));
  try {
    const db = makeDb(dir);
    const cand = candidates(dir, [[1, "VALVE", 2, "ACT", "optional", "EXACT_CODE"], [2, "ACT", 3, "CABLE", "required", "EXACT_CODE"]]);
    const r = await queueCandidates(base(dir, db, cand, 2));
    assert.equal((r.inserted as unknown[]).length, 2);
    assert.equal(count(db, "relationship_review_queue"), 2);
    assert.equal(count(db, "product_relationships"), 0);
    const c = new Database(db, { readonly: true });
    const row = c.prepare("SELECT rule_source, review_status FROM relationship_review_queue LIMIT 1").get() as { rule_source: string; review_status: string };
    c.close();
    assert.deepEqual(row, { rule_source: "ai_suggested", review_status: "pending_review" });
    await assert.rejects(queueCandidates({ ...base(dir, db, cand, 2), backupPath: join(dir, "b2.db"), receiptPath: join(dir, "r2.json") }), /already holds|SHA-256 mismatch/);
    rollbackRelationships(db, join(dir, "rc-q.json"));
    assert.equal(count(db, "relationship_review_queue"), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("queue fails closed on bad count, hash, inactive product and SKU mismatch", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ohmx-rel-"));
  try {
    const db = makeDb(dir);
    const good = candidates(dir, [[1, "VALVE", 2, "ACT", "optional", "EXACT_CODE"]]);
    await assert.rejects(queueCandidates(base(dir, db, good, 5)), /candidate count/);
    await assert.rejects(queueCandidates({ ...base(dir, db, good, 1), expectedDatabaseSha256: "0".repeat(64) }), /DB SHA-256 mismatch/);
    const inactive = candidates(dir, [[1, "VALVE", 4, "OLD", "optional", "EXACT_CODE"]]);
    await assert.rejects(queueCandidates(base(dir, db, inactive, 1)), /inactive/);
    const wrong = candidates(dir, [[1, "NOPE", 2, "ACT", "optional", "EXACT_CODE"]]);
    await assert.rejects(queueCandidates(base(dir, db, wrong, 1)), /SKU mismatch/);
    assert.equal(count(db, "relationship_review_queue"), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("promotion: reviewer required, FAMILY needs attestation, approve inserts approved row, rollback restores queue", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ohmx-rel-"));
  try {
    const db = makeDb(dir);
    const cand = candidates(dir, [[1, "VALVE", 2, "ACT", "optional", "FAMILY_DOC_CODE_UNLISTED"], [2, "ACT", 3, "CABLE", "required", "EXACT_CODE"]]);
    await queueCandidates(base(dir, db, cand, 2));
    const dec = (rows: string[]): string => {
      const p = join(dir, `dec-${Math.random()}.csv`);
      writeFileSync(p, ["candidate_key,decision,reviewer,attest_family_match,notes", ...rows].join("\n") + "\n");
      return p;
    };
    const opts = (p: string, tag: string) => ({
      databasePath: db, candidatesPath: cand, decisionsPath: p, expectedDatabaseSha256: sha(db), expectedDecisionsSha256: sha(p),
      backupPath: join(dir, `bk-${tag}.db`), receiptPath: join(dir, `rc-${tag}.json`),
    });
    const noReviewer = dec(["2|3|required,approve,,,"]);
    await assert.rejects(promoteDecisions(opts(noReviewer, "a")), /reviewer is required/);
    const noAttest = dec(["1|2|optional,approve,Owner,,"]);
    await assert.rejects(promoteDecisions(opts(noAttest, "b")), /attest_family_match=YES/);
    assert.equal(count(db, "product_relationships"), 0);
    const ok = dec(["2|3|required,approve,Owner,,exact code", "1|2|optional,approve,Owner,YES,family attested"]);
    const r = await promoteDecisions(opts(ok, "c"));
    assert.equal((r.changes as unknown[]).length, 2);
    assert.equal(count(db, "product_relationships"), 2);
    const c = new Database(db, { readonly: true });
    const pr = c.prepare("SELECT review_status, rule_source, manual_review_required, reviewed_by FROM product_relationships WHERE source_product_id=2").get();
    const q = c.prepare("SELECT DISTINCT review_status s FROM relationship_review_queue").all();
    c.close();
    assert.deepEqual(pr, { review_status: "approved", rule_source: "manual", manual_review_required: 0, reviewed_by: "Owner" });
    assert.deepEqual(q, [{ s: "approved" }]);
    rollbackRelationships(db, join(dir, "rc-c.json"));
    assert.equal(count(db, "product_relationships"), 0);
    const c2 = new Database(db, { readonly: true });
    const q2 = c2.prepare("SELECT DISTINCT review_status s FROM relationship_review_queue").all();
    c2.close();
    assert.deepEqual(q2, [{ s: "pending_review" }]);
    rollbackRelationships(db, join(dir, "rc-q.json"));
    assert.equal(count(db, "relationship_review_queue"), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("reject and needs_data only update the queue", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ohmx-rel-"));
  try {
    const db = makeDb(dir);
    const cand = candidates(dir, [[1, "VALVE", 2, "ACT", "optional", "EXACT_CODE"], [2, "ACT", 3, "CABLE", "required", "EXACT_CODE"]]);
    await queueCandidates(base(dir, db, cand, 2));
    const p = join(dir, "dec.csv");
    writeFileSync(p, "candidate_key,decision,reviewer,attest_family_match,notes\n1|2|optional,reject,Owner,,not for this valve\n2|3|required,needs_data,Owner,,length list\n");
    await promoteDecisions({ databasePath: db, candidatesPath: cand, decisionsPath: p, expectedDatabaseSha256: sha(db), expectedDecisionsSha256: sha(p), backupPath: join(dir, "bk.db"), receiptPath: join(dir, "rc.json") });
    assert.equal(count(db, "product_relationships"), 0);
    const c = new Database(db, { readonly: true });
    const s = c.prepare("SELECT review_status s FROM relationship_review_queue ORDER BY id").all();
    c.close();
    assert.deepEqual(s, [{ s: "rejected" }, { s: "needs_data" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
