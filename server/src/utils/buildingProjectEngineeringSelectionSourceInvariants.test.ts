/**
 * CM13 — source-invariant guards for the engineering-selection prerequisite code.
 *
 * Written only (not executed by the agent). These assert that the CM13 runtime
 * sources ship NO adapter/Configurator/Matcher wiring, no SQLite, no load/catalog
 * hash producer, and no network/client surface. Avoids false positives:
 * `node:crypto` is a legitimate pre-existing import (randomUUID) in
 * buildingProjectService.ts and is deliberately NOT flagged there.
 */
import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const DIR = dirname(fileURLToPath(import.meta.url));

function read(file: string): string {
  return readFileSync(join(DIR, file), "utf8");
}

const NEW_MODULE = read("buildingProjectEngineeringSelection.ts");
const SERVICE = read("buildingProjectService.ts");
const SYSTEMS = read("buildingProjectSystems.ts");
const QUALITY = read("buildingProjectQualityAdapter.ts");
const TYPES = read("buildingProjectTypes.ts");

/**
 * CM13-RUNTIME-CORRECTION (CM13-S01/S18): documentation and explanatory
 * comments legitimately NAME symbols (e.g. the module header says it never
 * calls `buildEngineeringConfiguratorInput`; the service header says
 * persistence is "not electro.db"). Name-mentioning in comments is not wiring.
 * Invariants that guard against wiring must run against the comment-stripped
 * source; invariants that guard against tokens (hash prefixes, sqlite
 * packages) keep scanning raw text.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 "); // line comments (not inside URLs)
}

const NEW_MODULE_CODE = stripComments(NEW_MODULE);
const SERVICE_CODE = stripComments(SERVICE);
const SYSTEMS_CODE = stripComments(SYSTEMS);
const QUALITY_CODE = stripComments(QUALITY);

function assertAbsent(text: string, patterns: string[], label: string): void {
  for (const pattern of patterns) {
    assert.ok(!text.includes(pattern), `${label} must not contain ${JSON.stringify(pattern)}`);
  }
}

// Wiring symbols: naming one in a comment is documentation, not wiring, so
// these are asserted against comment-stripped code only (CM13-RUNTIME-CORRECTION).
// Plain array (not Set) so iteration compiles under any tsconfig target.
const WIRING_SYMBOLS = [
  "buildEngineeringConfiguratorInput",
  "configureHeatPumpFanCoil",
  "matchCatalogProducts",
  "catalogMatcher",
  "engineeringConfigurator",
];

// The pure new module is the strictest — it must be free of everything.
const NEW_MODULE_FORBIDDEN = [
  "buildEngineeringConfiguratorInput",
  "configureHeatPumpFanCoil",
  "matchCatalogProducts",
  "catalogMatcher",
  "engineeringConfigurator",
  "better-sqlite3",
  "sqlite3",
  "node:sqlite",
  "createHash",
  "node:crypto",
  "load:sha256",
  "engineering-catalog-state:sha256",
  "fetch(",
  "axios",
  "from 'fs'",
  "node:fs",
  "process.env",
  "Math.random",
  "Date.now",
  "new Date(",
];

// Changed service/systems/quality files: enforce no wiring + no hash producer,
// but allow the pre-existing `node:crypto` (randomUUID) import.
const CHANGED_FORBIDDEN = [
  "buildEngineeringConfiguratorInput",
  "configureHeatPumpFanCoil(",
  "matchCatalogProducts",
  "from './catalogMatcher",
  "from '../catalogMatcher",
  "from './buildingProjectConfiguratorAdapter",
  "from '../buildingProjectConfiguratorAdapter",
  "from './engineeringConfigurator",
  "from '../engineeringConfigurator",
  "better-sqlite3",
  "node:sqlite",
  "createHash(",
  "load:sha256",
  "engineering-catalog-state:sha256",
  "fetch(",
  "axios",
];

test("CM13-S01 new module has no forbidden dependency or side effect", () => {
  // CM13-RUNTIME-CORRECTION: wiring symbols are checked on comment-stripped
  // code (the module header documents the symbols it must NOT call); hard
  // tokens (hash prefixes, sqlite packages, node:fs/crypto) are still checked
  // on raw text so a commented-out wiring call can never hide either way.
  for (const symbol of WIRING_SYMBOLS) {
    assert.ok(!NEW_MODULE_CODE.includes(symbol), `buildingProjectEngineeringSelection.ts code must not reference ${JSON.stringify(symbol)}`);
  }
  const hardTokens = NEW_MODULE_FORBIDDEN.filter((p) => !WIRING_SYMBOLS.includes(p));
  assertAbsent(NEW_MODULE, hardTokens, "buildingProjectEngineeringSelection.ts");
});

test("CM13-S02 new module has no fs / network / clock", () => {
  assertAbsent(NEW_MODULE, ["node:fs", "from 'fs'", "fetch(", "axios", "Date.now", "new Date(", "Math.random", "process.env"], "new module");
});

test("CM13-S03 service does not call buildEngineeringConfiguratorInput", () => {
  assert.ok(!SERVICE.includes("buildEngineeringConfiguratorInput"));
});

test("CM13-S04 service does not call configureHeatPumpFanCoil", () => {
  assert.ok(!SERVICE.includes("configureHeatPumpFanCoil"));
});

test("CM13-S05 service does not import Catalog Matcher", () => {
  assertAbsent(SERVICE, ["from './catalogMatcher", "from '../catalogMatcher", "matchCatalogProducts"], "buildingProjectService.ts");
});

test("CM13-S06 service does not import the adapter module", () => {
  assertAbsent(SERVICE, ["buildingProjectConfiguratorAdapter"], "buildingProjectService.ts");
});

test("CM13-S07 service does not import the engineering Configurator", () => {
  assertAbsent(SERVICE, ["engineeringConfigurator"], "buildingProjectService.ts");
});

test("CM13-S08 service has no load hash producer", () => {
  assertAbsent(SERVICE, ["createHash(", "load:sha256"], "buildingProjectService.ts");
});

test("CM13-S09 service has no catalog fingerprint producer", () => {
  assertAbsent(SERVICE, ["engineering-catalog-state:sha256"], "buildingProjectService.ts");
});

test("CM13-S10 service has no SQLite", () => {
  assertAbsent(SERVICE, ["better-sqlite3", "node:sqlite", "from 'sqlite3'"], "buildingProjectService.ts");
});

test("CM13-S11 service has no network / client imports", () => {
  assertAbsent(SERVICE, ["fetch(", "axios"], "buildingProjectService.ts");
});

test("CM13-S12 systems normalization has no load/catalog hash producer", () => {
  assertAbsent(SYSTEMS, ["createHash(", "load:sha256", "engineering-catalog-state:sha256"], "buildingProjectSystems.ts");
});

test("CM13-S13 systems normalization has no adapter/matcher wiring", () => {
  assertAbsent(SYSTEMS, ["buildEngineeringConfiguratorInput", "configureHeatPumpFanCoil(", "matchCatalogProducts"], "buildingProjectSystems.ts");
});

test("CM13-S14 quality adapter consumes coverage but does not wire the adapter", () => {
  assertAbsent(QUALITY, ["buildEngineeringConfiguratorInput", "configureHeatPumpFanCoil(", "matchCatalogProducts"], "buildingProjectQualityAdapter.ts");
});

test("CM13-S15 quality adapter has no hash producer", () => {
  assertAbsent(QUALITY, ["createHash(", "load:sha256", "engineering-catalog-state:sha256"], "buildingProjectQualityAdapter.ts");
});

test("CM13-S16 types module has no runtime wiring (type-only contract)", () => {
  assertAbsent(TYPES, ["buildEngineeringConfiguratorInput(", "configureHeatPumpFanCoil(", "matchCatalogProducts(", "createHash(", "better-sqlite3"], "buildingProjectTypes.ts");
});

test("CM13-S17 no client imports introduced", () => {
  assertAbsent(SERVICE + SYSTEMS + QUALITY + NEW_MODULE, ["from '../client", "from './client", "from '../../client"], "CM13 server modules");
});

test("CM13-S18 service does not access electro.db or catalog DB tables", () => {
  // CM13-RUNTIME-CORRECTION (baseline-aware): the service header comment
  // "JSON persistence under data/building-projects — not electro.db, not
  // warm-floor-projects" is PRE-EXISTING documentation (verbatim in the
  // pre-CM13 backup backups/phase32p-b3-pre-20260902/) that names the DB only
  // to state it is NOT used. Asserted on comment-stripped code so historical
  // documentation is not rejected while any real code-level DB access still is.
  assertAbsent(SERVICE_CODE, ["electro.db", "catalogMatcher"], "buildingProjectService.ts");
});

test("CM13-S19 new module has no dynamic code evaluation", () => {
  assertAbsent(NEW_MODULE, ["eval(", "new Function("], "buildingProjectEngineeringSelection.ts");
});

test("CM13-S20 new module defines no provider/match runtime functions", () => {
  assert.ok(!/export\s+function\s+(getCurrentState|produceRevision|match)/.test(NEW_MODULE), "new module must not define provider/match runtime functions");
});