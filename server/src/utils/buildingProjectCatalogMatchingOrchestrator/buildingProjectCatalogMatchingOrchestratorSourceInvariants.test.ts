/** CM17 source invariants. WRITTEN ONLY; agent does not execute them. */
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const MODULE_DIR = fileURLToPath(new URL("./", import.meta.url));
const SERVER_DIR = fileURLToPath(new URL("../../../", import.meta.url));
const RUNTIME_FILES = [
  "types.ts",
  "validation.ts",
  "requirementToMatcherInput.ts",
  "sameProductComposition.ts",
  "catalogSnapshot.ts",
  "orchestrator.ts",
  "index.ts",
] as const;

function source(file: string): string {
  return readFileSync(`${MODULE_DIR}${file}`, "utf8");
}

function stripComments(text: string): string {
  return text
    .replace(/[/][*][\s\S]*?[*][/]/g, "")
    .replace(/(^|[^:])[/][/][^\n]*/g, "$1");
}

const ALL_RUNTIME = stripComments(RUNTIME_FILES.map(source).join("\n"));
const ORCHESTRATOR = stripComments(source("orchestrator.ts"));
const COMPOSITION = stripComments(source("sameProductComposition.ts"));
const SNAPSHOT = stripComments(source("catalogSnapshot.ts"));

test("CM17-S01 uses CM16 and the existing public Catalog Matcher entry point", () => {
  assert.ok(ORCHESTRATOR.includes("runBuildingProjectEngineeringConfiguration"));
  assert.ok(SNAPSHOT.includes("matchCatalogProducts"));
  assert.ok(!ALL_RUNTIME.includes("evaluateCatalogCandidate"));
});

test("CM17-S02 coherence uses one read transaction and the existing CM15 revision producer", () => {
  assert.ok(SNAPSHOT.includes("BEGIN DEFERRED"));
  assert.ok(SNAPSHOT.includes("COMMIT"));
  assert.ok(SNAPSHOT.includes("ROLLBACK"));
  assert.ok(SNAPSHOT.includes("projectEngineeringCatalogFacts"));
  assert.ok(SNAPSHOT.includes("computeEngineeringCatalogStateRevision"));
});

test("CM17-S03 introduces no new hashing implementation", () => {
  for (const token of ["node:crypto", "createHash", "subtle.digest"]) {
    assert.ok(!ALL_RUNTIME.includes(token), `forbidden hashing token: ${token}`);
  }
});

test("CM17-S04 SAME_PRODUCT composition keys only by componentInstanceId", () => {
  assert.ok(COMPOSITION.includes("componentInstanceId"));
  assert.ok(COMPOSITION.includes("SAME_PRODUCT"));
  assert.ok(!COMPOSITION.includes("groupByEquipmentType"));
});

test("CM17-S05 no title/name parsing or inferred engineering values", () => {
  for (const token of ["name_ru", "product.title", "parseFloat", "extractKw", "titleMatch"]) {
    assert.ok(!ALL_RUNTIME.includes(token), `forbidden inferred-engineering token: ${token}`);
  }
});

test("CM17-S06 no price, stock, availability, or winner-selection logic", () => {
  for (const token of ["price_amd", "stock_quantity", "availability_status", "is_active", "selectedProductId =", "winner", "rankEligibleCandidates", "compareRankTuples"]) {
    assert.ok(!ALL_RUNTIME.includes(token), `forbidden commerce/selection token: ${token}`);
  }
});

test("CM17-S07 no BOM, client, route, HTTP, persistence, or write SQL", () => {
  for (const token of ["BOM", "billOfMaterials", "client/src", "express", "Router", "INSERT ", "UPDATE ", "DELETE ", "saveProject", "updateProject"]) {
    assert.ok(!ALL_RUNTIME.includes(token), `forbidden boundary token: ${token}`);
  }
});

test("CM17-S08 focused package script is exact", () => {
  const pkg = JSON.parse(readFileSync(`${SERVER_DIR}package.json`, "utf8")) as { scripts: Record<string, string> };
  assert.equal(
    pkg.scripts["test:building-project-catalog-matching-orchestrator"],
    "tsx --test src/utils/buildingProjectCatalogMatchingOrchestrator/buildingProjectCatalogMatchingOrchestrator.test.ts src/utils/buildingProjectCatalogMatchingOrchestrator/buildingProjectCatalogMatchingOrchestratorSourceInvariants.test.ts",
  );
});
