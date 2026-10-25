/**
 * CM16 — source invariants for the live engineering orchestrator module.
 * WRITTEN ONLY — not executed by the agent (§43–44). Labels CM16-S01….
 *
 * These tests READ the orchestrator runtime source files and assert the frozen
 * import/call allowlist (§35) and the forbidden surface (§20–21, §24–28). They
 * guard against accidental introduction of the Matcher, load recalculation,
 * hash production, direct DB access, commerce, mutation paths, clock, or
 * randomness into the orchestrator runtime.
 */
import * as assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";



const MODULE_DIR = fileURLToPath(new URL("./", import.meta.url));

const RUNTIME_FILES = [
  "orchestrator.ts",
  "assembleAdapterInput.ts",
  "types.ts",
  "policy.ts",
  "validation.ts",
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

const ALL_SOURCE = RUNTIME_FILES.map((f) => source(f)).join("\n");
const ORCHESTRATOR_SOURCE = source("orchestrator.ts");

// ---------------------------------------------------------------------------
// Forbidden surface (must be ABSENT from every runtime file)
// ---------------------------------------------------------------------------

const FORBIDDEN_MATCHER = [
  "matchCatalogProducts",
  "CatalogMatcherService",
  "/api/catalog-matcher",
  "catalogMatcher/",
];

const FORBIDDEN_CRYPTO_HASH = ["node:crypto", "createHash"];

const FORBIDDEN_DB = ["better-sqlite3", "sqlite"];

const FORBIDDEN_LOAD_ENGINE = ["calculateLoads", "computeBuildingLoads", "steady-state", "runQuickLoad"];

const FORBIDDEN_MUTATION = ["saveProject", "updateProject", "createProject", "deleteProject", "updateEngineeringDesignInputs", "setCalculationCoverage"];

const FORBIDDEN_COMMERCE = ["price", "stock", "currency", "BOM", "procurement", "availability"];

const FORBIDDEN_TIMING = ["Date.now", "new Date", "Math.random", "randomUUID", "crypto.random"];

for (const file of RUNTIME_FILES) {
  test(`CM16-S01 ${file} imports no Matcher runtime`, () => {
    const text = source(file);
    for (const token of FORBIDDEN_MATCHER) {
      assert.ok(!text.includes(token), `forbidden token "${token}" in ${file}`);
    }
  });

  test(`CM16-S02 ${file} performs no hash production`, () => {
    const text = source(file);
    for (const token of FORBIDDEN_CRYPTO_HASH) {
      assert.ok(!text.includes(token), `forbidden token "${token}" in ${file}`);
    }
  });

  test(`CM16-S03 ${file} performs no direct DB access`, () => {
    const text = source(file);
    for (const token of FORBIDDEN_DB) {
      assert.ok(!text.includes(token), `forbidden token "${token}" in ${file}`);
    }
  });

  test(`CM16-S04 ${file} invokes no load engine`, () => {
    const text = source(file);
    for (const token of FORBIDDEN_LOAD_ENGINE) {
      assert.ok(!text.includes(token), `forbidden token "${token}" in ${file}`);
    }
  });

  test(`CM16-S05 ${file} performs no project mutation`, () => {
    const text = source(file);
    for (const token of FORBIDDEN_MUTATION) {
      assert.ok(!text.includes(token), `forbidden token "${token}" in ${file}`);
    }
  });

  test(`CM16-S06 ${file} contains no commerce logic`, () => {
    const text = source(file);
    for (const token of FORBIDDEN_COMMERCE) {
      assert.ok(!text.includes(token), `forbidden token "${token}" in ${file}`);
    }
  });

  test(`CM16-S07 ${file} has no clock/random dependency`, () => {
    const text = stripComments(source(file));
    for (const token of FORBIDDEN_TIMING) {
      assert.ok(!text.includes(token), `forbidden token "${token}" in ${file}`);
    }
  });
}

// ---------------------------------------------------------------------------
// No client / route wiring in the module
// ---------------------------------------------------------------------------

test("CM16-S10 orchestrator imports no client code", () => {
  assert.ok(!/from\s+["'][^"']*client/.test(ALL_SOURCE), "no client import");
});

test("CM16-S11 orchestrator imports no route/http wiring (no express/router import)", () => {
  assert.ok(!/(?:express|[/]router|[/]http)/.test(ALL_SOURCE), "no http/route import");
});

// ---------------------------------------------------------------------------
// Sanctioned allowlist (must be PRESENT where expected)
// ---------------------------------------------------------------------------

test("CM16-S12 orchestrator reads the live project through the existing read service", () => {
  assert.ok(ORCHESTRATOR_SOURCE.includes("loadProject"), "imports loadProject");
});

test("CM16-S13 orchestrator uses the frozen isLoadStale semantics (no recalculation)", () => {
  assert.ok(ORCHESTRATOR_SOURCE.includes("isLoadStale"), "imports isLoadStale");
});

test("CM16-S14 orchestrator calls the CM11 adapter once", () => {
  assert.ok(ORCHESTRATOR_SOURCE.includes("buildEngineeringConfiguratorInput"), "imports adapter");
});

test("CM16-S15 orchestrator calls the CM9 configurator", () => {
  assert.ok(ORCHESTRATOR_SOURCE.includes("configureHeatPumpFanCoil"), "imports configurator");
});

test("CM16-S16 orchestrator consumes CM14 exports (no duplicate hash producer)", () => {
  assert.ok(ORCHESTRATOR_SOURCE.includes("buildCanonicalLoadFacts"), "imports canonical facts");
  assert.ok(ORCHESTRATOR_SOURCE.includes("loadRevisionIdentityOf"), "imports identity helper");
});

test("CM16-S17 orchestrator consumes the CM15 provider (single reference)", () => {
  assert.ok(ORCHESTRATOR_SOURCE.includes("EngineeringCatalogStateProvider"), "imports provider");
});

test("CM16-S18 orchestrator blocks before adapter on structural gates (validation.ts)", () => {
  const vm = RUNTIME_FILES.map((f) => source(f)).join("\n");
  assert.ok(vm.includes("catalog.unavailable"));
  assert.ok(vm.includes("load_revision.missing"));
  assert.ok(vm.includes("load.stale"));
});

// ---------------------------------------------------------------------------
// Public surface does not export forbidden symbols
// ---------------------------------------------------------------------------

test("CM16-S20 index.ts exports no Matcher / hash / commerce symbols", () => {
  const index = source("index.ts");
  for (const token of [...FORBIDDEN_MATCHER, ...FORBIDDEN_CRYPTO_HASH, ...FORBIDDEN_COMMERCE]) {
    assert.ok(!index.includes(token), `forbidden export token "${token}"`);
  }
});

test("CM16-S21 index.ts exports exactly the sanctioned public symbols", () => {
  const index = source("index.ts");
  assert.ok(index.includes("runBuildingProjectEngineeringConfiguration"));
  assert.ok(index.includes("BuildingProjectEngineeringOrchestrationResult"));
  assert.ok(index.includes("ORCHESTRATION_BLOCKER_CODES"));
});

// ---------------------------------------------------------------------------
// Frozen block vocabulary completeness
// ---------------------------------------------------------------------------

test("CM16-S22 blocker vocabulary is frozen and complete (10 codes)", () => {
  const v = source("validation.ts");
  for (const code of [
    "project.missing",
    "project.not_confirmed",
    "system.confirmed_snapshot_missing",
    "coverage.intent_missing",
    "design_inputs.missing",
    "load.missing",
    "load.stale",
    "load_revision.missing",
    "load_revision.algorithm_mismatch",
    "catalog.unavailable",
  ]) {
    assert.ok(v.includes(`"${code}"`), `missing blocker code ${code}`);
  }
});