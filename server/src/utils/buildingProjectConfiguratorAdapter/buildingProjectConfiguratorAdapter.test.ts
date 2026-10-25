/**
 * CM11 behavior tests — WRITTEN ONLY, not executed by the agent.
 * Traceability labels CM11-xxx; TESTS_EXECUTED: NO (§44–45).
 *
 * Every fixture is a deliberately synthetic, future-complete snapshot. Positive
 * READY cases do NOT claim any current live project is READY (§6).
 */
import * as assert from "node:assert/strict";
import { test } from "node:test";
import { buildEngineeringConfiguratorInput } from "./buildEngineeringConfiguratorInput.js";
import { makeValidInput, refreshReference, LOAD_TOKEN, CATALOG_TOKEN } from "./fixtures.js";
import type { BuildingProjectConfiguratorAdapterInput, BuildingProjectConfiguratorAdapterResult } from "./types.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

function ok(input: BuildingProjectConfiguratorAdapterInput = makeValidInput()): BuildingProjectConfiguratorAdapterResult {
  const r = buildEngineeringConfiguratorInput(input as any);
  assert.equal(r.status, "READY", JSON.stringify(r.blockingReasons));
  if (r.status !== "READY") throw new Error("expected READY");
  assert.deepEqual(r.blockingReasons, []);
  return r;
}
function blocked(input: BuildingProjectConfiguratorAdapterInput, code?: string): BuildingProjectConfiguratorAdapterResult {
  const r = buildEngineeringConfiguratorInput(input as any);
  assert.equal(r.status, "BLOCKED");
  assert.ok(!("input" in r), "BLOCKED result must omit input (atomic)");
  if (code) assert.ok((r.blockingReasons as any[]).some((b) => b.code === code), `missing ${code}: ${JSON.stringify(r.blockingReasons)}`);
  return r;
}
function mutate(fn: (i: any) => void): BuildingProjectConfiguratorAdapterInput {
  const i = makeValidInput() as any;
  fn(i);
  return i as BuildingProjectConfiguratorAdapterInput;
}
function deepFreeze<T>(o: T): T {
  if (o && typeof o === "object") {
    for (const k of Object.keys(o as any)) deepFreeze((o as any)[k]);
    Object.freeze(o);
  }
  return o;
}
function unresolved(unit: "°C" | null) {
  return { value: null, unit, source: "UNRESOLVED", sourceReference: null, status: "REQUIRED_POLICY_INPUT", policyReference: null };
}
function codeList(r: BuildingProjectConfiguratorAdapterResult): string[] {
  return (r.blockingReasons as any[]).map((b) => b.code);
}

// ===========================================================================
// Group A — valid adapter
// ===========================================================================
test("CM11-001 valid apartment READY [CM10-001]", () => ok(makeValidInput({ objectType: "apartment" })));
test("CM11-002 valid private_house READY [CM10-002]", () => ok(makeValidInput({ objectType: "private_house" })));

test("CM11-003 complete EngineeringConfiguratorInput generated", () => {
  const r = ok();
  const i = r.input as any;
  assert.equal(i.policyId, "ohmx.engineering-configurator.heat-pump-fan-coil.v1");
  assert.equal(i.policyVersion, "1.1.0");
  assert.equal(i.projectId, "proj-1");
  assert.equal(i.projectRevision, 1);
  assert.equal(i.systemConfigurationRevision, 1);
  assert.equal(i.selectionIntent, "PROFESSIONAL");
  assert.equal(i.systemTopology, "HEAT_PUMP_FAN_COIL");
  assert.equal(i.loadCalculationRevision, LOAD_TOKEN);
  assert.equal(i.sourceCalculationId, LOAD_TOKEN);
  assert.equal(i.engineeringCatalogStateRevision, CATALOG_TOKEN);
  assert.deepEqual(i.servedRooms, [{ roomId: "room-1", servedZoneIds: [] }, { roomId: "room-2", servedZoneIds: [] }]);
  assert.equal(i.designMargins.heatPumpHeating.designMarginPercent, 0);
  assert.equal(i.designMargins.fanCoilCooling.marginSource, "NONE");
  assert.equal(i.operatingConditions.heatPumpHeating.waterSupplyC.value, 45);
  assert.equal(i.operatingConditions.heatPumpHeating.outdoorHeatingDesignC.value, -10);
  assert.equal(i.operatingConditions.fanCoilCooling.indoorAirWetBulbC.value, 18);
});

test("CM11-004 READY carries mandated pilot warnings", () => {
  const r = ok();
  const codes = (r.warnings as any[]).map((w) => w.code);
  assert.ok(codes.includes("PILOT_CORE_SELECTION_ONLY"));
  assert.ok(codes.includes("COMPATIBILITY_UNKNOWN"));
});

// ===========================================================================
// Group B — legacy live blockers
// ===========================================================================
test("CM11-005 UNKNOWN coverage blocked", () => blocked(mutate((i) => { i.project.calculationConfiguration.coverageIntent.calculationScope = "UNKNOWN"; }), "LOAD_COVERAGE_INCOMPLETE"));
test("CM11-006 confirmed system validation absent blocked", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.validation = undefined; }), "SYSTEM_CONFIGURATION_MISSING"));
test("CM11-007 UNCONFIRMED confirmation blocked", () => blocked(mutate((i) => { i.project.calculationConfiguration.coverageIntent.coverageConfirmation = "UNCONFIRMED"; }), "LOAD_COVERAGE_INCOMPLETE"));
test("CM11-008 missing hydronic heating temps blocked", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.engineeringDesignInputs.hydronicDesignConditions.heatingWaterSupplyC = unresolved("°C"); }), "OPERATING_CONDITION_REQUIRED"));
test("CM11-009 missing hydronic cooling temps blocked", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.engineeringDesignInputs.hydronicDesignConditions.coolingWaterSupplyC = unresolved("°C"); }), "OPERATING_CONDITION_REQUIRED"));
test("CM11-010 missing wet bulb blocked", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.engineeringDesignInputs.coolingIndoorDesignCondition.indoorCoolingWetBulbC = unresolved("°C"); }), "OPERATING_CONDITION_REQUIRED"));
test("CM11-011 missing fan speed blocked", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.engineeringDesignInputs.fanCoilSizingPolicy.sizingFanSpeed = unresolved(null); }), "FAN_SPEED_REQUIRED"));
test("CM11-012 missing load revision reference blocked", () => blocked(mutate((i) => { i.loadRevisionReference = null; }), "LOAD_REVISION_UNAVAILABLE"));
test("CM11-013 missing engineering catalog reference blocked", () => blocked(mutate((i) => { i.engineeringCatalogStateReference = null; }), "ENGINEERING_CATALOG_STATE_UNAVAILABLE"));

// ===========================================================================
// Group C — coverage
// ===========================================================================
test("CM11-014 explicit whole-object intent accepted", () => ok());
test("CM11-015 area equality alone does not imply confirmation", () => {
  blocked(mutate((i) => {
    i.project.calculationConfiguration.coverageIntent.coverageConfirmation = "UNCONFIRMED";
    i.project.objectConfirmedSnapshot.calculationConfiguration.coverageIntent.coverageConfirmation = "UNCONFIRMED";
    i.loadCalculation.inputSnapshot.calculationConfiguration.coverageIntent.coverageConfirmation = "UNCONFIRMED";
    i.loadCalculation.engineeringQuality.coverage.confirmation = "UNCONFIRMED";
  }), "LOAD_COVERAGE_INCOMPLETE");
});
test("CM11-016 180 declared / 50 modeled blocked", () => blocked(mutate((i) => { i.loadCalculation.engineeringQuality.coverage.declaredAreaM2 = 180; i.loadCalculation.engineeringQuality.coverage.modeledAreaM2 = 50; i.loadCalculation.engineeringQuality.coverage.ratio = 50 / 180; }), "LOAD_COVERAGE_INCOMPLETE"));
test("CM11-017 ratio mismatch blocked", () => blocked(mutate((i) => { i.loadCalculation.engineeringQuality.coverage.ratio = 0.5; }), "LOAD_COVERAGE_INCOMPLETE"));
test("CM11-018 old confirmation revision blocked", () => blocked(mutate((i) => {
  i.project.calculationConfiguration.coverageIntent.buildingRevisionAtConfirmation = 0;
  i.project.objectConfirmedSnapshot.calculationConfiguration.coverageIntent.buildingRevisionAtConfirmation = 0;
  i.loadCalculation.inputSnapshot.calculationConfiguration.coverageIntent.buildingRevisionAtConfirmation = 0;
}), "LOAD_COVERAGE_INCOMPLETE"));

// ===========================================================================
// Group D — revisions
// ===========================================================================
test("CM11-019 current building revision accepted", () => ok());
test("CM11-020 stale building revision blocked", () => blocked(mutate((i) => { i.loadCalculation.buildingRevisionAtCalculation = 2; }), "PROJECT_REVISION_STALE"));
test("CM11-021 stale system revision blocked", () => blocked(mutate((i) => { i.loadCalculation.systemsRevisionAtCalculation = 2; }), "SYSTEM_CONFIGURATION_REVISION_STALE"));
test("CM11-022 malformed load token blocked", () => blocked(mutate((i) => { i.loadRevisionReference.revision = "load:sha256:XYZ"; }), "LOAD_CALCULATION_REVISION_STALE"));
test("CM11-023 timestamp token forbidden", () => blocked(mutate((i) => { i.loadRevisionReference.revision = "2024-01-01T00:00:00.000Z"; i.loadRevisionReference.sourceCalculationId = "2024-01-01T00:00:00.000Z"; }), "LOAD_CALCULATION_REVISION_STALE"));
test("CM11-024 load/source token mismatch blocked", () => blocked(mutate((i) => { i.loadRevisionReference.sourceCalculationId = `load:sha256:${"c".repeat(64)}`; }), "LOAD_CALCULATION_REVISION_STALE"));
test("CM11-025 malformed engineering token blocked", () => blocked(mutate((i) => { i.engineeringCatalogStateReference.revision = "engineering-catalog-state:sha256:XYZ"; }), "ENGINEERING_CATALOG_STATE_INVALID"));

// ===========================================================================
// Group E — operating inputs
// ===========================================================================
test("CM11-026 user hydronic values accepted", () => ok());
test("CM11-027 system-policy hydronic values accepted", () => {
  const input = mutate((i) => {
    const d = i.confirmedSystemSnapshot.engineeringDesignInputs;
    const leaves = ["heatingWaterSupplyC", "heatingWaterReturnC", "coolingWaterSupplyC", "coolingWaterReturnC"];
    for (const l of leaves) {
      d.hydronicDesignConditions[l] = { value: 0, unit: "°C", source: "SYSTEM_POLICY", sourceReference: "policy-ref", status: "RESOLVED", policyReference: { policyId: "pid", policyVersion: "1.0.0", entryId: "e" } };
    }
    d.hydronicDesignConditions.heatingWaterSupplyC.value = 45;
    d.hydronicDesignConditions.heatingWaterReturnC.value = 35;
    d.hydronicDesignConditions.coolingWaterSupplyC.value = 7;
    d.hydronicDesignConditions.coolingWaterReturnC.value = 12;
    i.loadCalculation.inputSnapshot.systemEngineeringDesignInputs = d;
    refreshReference(i);
  });
  ok(input);
});
test("CM11-028 heating supply <= return blocked", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.engineeringDesignInputs.hydronicDesignConditions.heatingWaterReturnC.value = 50; }), "OPERATING_CONDITION_CONFLICT"));
test("CM11-029 cooling supply >= return blocked", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.engineeringDesignInputs.hydronicDesignConditions.coolingWaterReturnC.value = 5; }), "OPERATING_CONDITION_CONFLICT"));
test("CM11-030 wet bulb explicit accepted", () => ok());
test("CM11-031 no catalog wet-bulb default (missing blocked, no 19°C fill)", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.engineeringDesignInputs.coolingIndoorDesignCondition.indoorCoolingWetBulbC = unresolved("°C"); }), "OPERATING_CONDITION_REQUIRED"));
test("CM11-032 fan speed explicit accepted", () => ok());
test("CM11-033 no HIGH default (missing fan speed blocked)", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.engineeringDesignInputs.fanCoilSizingPolicy.sizingFanSpeed = unresolved(null); }), "FAN_SPEED_REQUIRED"));

// ===========================================================================
// Group F — policy / intent
// ===========================================================================
test("CM11-034 PRELIMINARY accepted, level 2 warns", () => {
  const r = ok(makeValidInput({ selectionIntent: "PRELIMINARY", maximumEligibleLevel: 2 }));
  assert.ok((r.warnings as any[]).some((w) => w.code === "PRELIMINARY_LOAD_QUALITY"));
});
test("CM11-035 PROFESSIONAL accepted (max level 3)", () => ok());
test("CM11-036 no downgrade (PROFESSIONAL with level 2 blocked)", () => blocked(makeValidInput({ selectionIntent: "PROFESSIONAL", maximumEligibleLevel: 2 }), "LOAD_QUALITY_INSUFFICIENT"));
test("CM11-037 PILOT_REFERENCE preliminary accepted", () => {
  const input = mutate((i) => {
    const d = i.confirmedSystemSnapshot.engineeringDesignInputs;
    const leaves = ["heatingWaterSupplyC", "heatingWaterReturnC", "coolingWaterSupplyC", "coolingWaterReturnC"];
    for (const l of leaves) {
      d.hydronicDesignConditions[l].source = "PILOT_REFERENCE";
      d.hydronicDesignConditions[l].policyReference = { policyId: "pid", policyVersion: "1.0.0", entryId: "e" };
    }
    i.loadCalculation.inputSnapshot.systemEngineeringDesignInputs = d;
    i.selectionIntent = "PRELIMINARY";
    refreshReference(i);
  });
  const r = ok(input);
  assert.ok((r.warnings as any[]).some((w) => w.code === "PILOT_REFERENCE_OPERATING_INPUT"));
});
test("CM11-038 PILOT_REFERENCE professional blocked", () => blocked(mutate((i) => {
  i.confirmedSystemSnapshot.engineeringDesignInputs.hydronicDesignConditions.heatingWaterSupplyC.source = "PILOT_REFERENCE";
  i.confirmedSystemSnapshot.engineeringDesignInputs.hydronicDesignConditions.heatingWaterSupplyC.policyReference = { policyId: "pid", policyVersion: "1.0.0", entryId: "e" };
}), "OPERATING_CONDITION_REQUIRED"));
test("CM11-039 generic CM7 policy bridge mismatch blocked", () => blocked(mutate((i) => { i.policyIdentities.genericRequirementPolicy.version = "9.9.9"; }), "POLICY_ID_VERSION_INVALID"));
test("CM11-040 topology policy identity mismatch blocked", () => blocked(mutate((i) => { i.policyIdentities.topologyPolicy.id = "ohmx.other.v1"; }), "POLICY_ID_VERSION_INVALID"));

// ===========================================================================
// Group G — rooms
// ===========================================================================
test("CM11-041 served rooms sorted by stable id", () => {
  const r = ok();
  assert.deepEqual((r.input as any).servedRooms.map((s: any) => s.roomId), ["room-1", "room-2"]);
});
test("CM11-042 duplicate room id blocked", () => blocked(mutate((i) => {
  const dup = { ...i.project.rooms[0] };
  i.project.rooms.push(dup);
}), "SERVED_ROOM_INVALID"));
test("CM11-043 orphan assignment blocked", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.roomAssignments.pop(); }), "SERVED_ROOM_INVALID"));
test("CM11-044 missing room load blocked", () => blocked(mutate((i) => { i.loadCalculation.roomResults.pop(); }), "SERVED_ROOM_INVALID"));
test("CM11-045 one-service fan coil blocked", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.roomAssignments[0].coolingSystems = []; }), "SERVED_ROOM_INVALID"));
test("CM11-046 conflicting source family blocked", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.roomAssignments[0].sourceSystemIds.heating = "gas_boiler"; }), "SERVED_ROOM_INVALID"));

// ===========================================================================
// Group H — quality
// ===========================================================================
test("CM11-047 valid quality accepted", () => ok());
test("CM11-048 legacy quality blocked", () => blocked(mutate((i) => { i.loadCalculation.engineeringQuality.gateStatus = "LEGACY_UNASSESSED"; }), "LOAD_QUALITY_INSUFFICIENT"));
test("CM11-049 preliminary blocked-quality warns but stays READY", () => {
  const input = mutate((i) => { i.selectionIntent = "PRELIMINARY"; i.loadCalculation.engineeringQuality.gateStatus = "BLOCKED"; refreshReference(i); });
  const r = ok(input);
  assert.ok((r.warnings as any[]).some((w) => w.code === "BUILDING_QUALITY_WARNING"));
});
test("CM11-050 professional blocked-quality blocked", () => blocked(mutate((i) => { i.loadCalculation.engineeringQuality.gateStatus = "BLOCKED"; i.loadCalculation.engineeringQuality.maximumEligibleLevel = 3; }), "LOAD_QUALITY_INSUFFICIENT"));
test("CM11-051 max level 0 (physical incompleteness) blocked", () => blocked(mutate((i) => { i.loadCalculation.engineeringQuality.maximumEligibleLevel = 0; }), "LOAD_QUALITY_INSUFFICIENT"));
test("CM11-052 max level null (legacy) blocked", () => blocked(mutate((i) => { i.loadCalculation.engineeringQuality.maximumEligibleLevel = null; }), "LOAD_QUALITY_INSUFFICIENT"));
test("CM11-053 critical unresolved field blocked", () => blocked(mutate((i) => {
  i.loadCalculation.engineeringQuality.fields = [{ fieldId: "f1", criticality: "CRITICAL", quality: "UNRESOLVED", effectiveValue: null, parameter: "u_wall", status: "blocked", requiredQuality: "VERIFIED", effectiveProvenance: "UNKNOWN", userConfirmed: false }];
}), "LOAD_QUALITY_INSUFFICIENT"));

// ===========================================================================
// Group I — commerce split
// ===========================================================================
test("CM11-054 absent commerce nonblocking", () => {
  const r = ok();
  assert.equal((r.input as any).commerceStateRevision, undefined);
});
test("CM11-055 valid commerce copied, no size effect", () => {
  const input = mutate((i) => { i.commerceStateRevision = `commerce-state:sha256:${"d".repeat(64)}`; });
  const r = ok(input);
  assert.equal((r.input as any).commerceStateRevision, `commerce-state:sha256:${"d".repeat(64)}`);
});
test("CM11-056 malformed commerce ignored with warning, still READY", () => {
  const input = mutate((i) => { i.commerceStateRevision = "commerce-state:sha256:BAD" as any; });
  const r = ok(input);
  assert.ok((r.warnings as any[]).some((w) => w.code === "COMMERCE_REVISION_IGNORED"));
});
test("CM11-057 price/stock never enter input", () => {
  const r = ok();
  const i = r.input as any;
  for (const key of ["price", "stock", "sku", "productId", "candidates", "equipmentRequirements", "physicalComponents"]) {
    assert.ok(!(key in i), `unexpected ${key}`);
  }
});
test("CM11-058 different commerce reference does not alter engineering input", () => {
  const base = ok(makeValidInput());
  const withCommerce = ok(mutate((i) => { i.commerceStateRevision = `commerce-state:sha256:${"e".repeat(64)}`; }));
  const strip = (o: any) => { const { commerceStateRevision: _omit, ...rest } = o; return rest; };
  assert.deepEqual(strip(withCommerce.input), strip(base.input));
});

// ===========================================================================
// Group J — purity / atomicity / determinism
// ===========================================================================
test("CM11-059 no input mutation (deep-frozen input)", () => {
  const input = deepFreeze(makeValidInput());
  const r = buildEngineeringConfiguratorInput(input as any);
  assert.equal(r.status, "READY");
});
test("CM11-060 deterministic byte-equivalent output (same input twice)", () => {
  const input = makeValidInput();
  const a = JSON.stringify(buildEngineeringConfiguratorInput(input as any));
  const b = JSON.stringify(buildEngineeringConfiguratorInput(input as any));
  assert.equal(a, b);
});
test("CM11-061 deterministic output for structurally-equal distinct inputs", () => {
  const a = JSON.stringify(buildEngineeringConfiguratorInput(makeValidInput() as any));
  const b = JSON.stringify(buildEngineeringConfiguratorInput(makeValidInput() as any));
  assert.equal(a, b);
});
test("CM11-062 atomic BLOCKED never returns partial input", () => {
  const r = blocked(mutate((i) => { i.loadRevisionReference = null; }));
  assert.ok(!("input" in r));
});
test("CM11-063 source trace present and deterministic on READY", () => {
  const r = ok();
  assert.ok(Array.isArray(r.sourceTrace) && r.sourceTrace.length > 0);
  assert.ok((r.sourceTrace as any[]).every((t) => typeof t.targetPath === "string" && typeof t.transformation === "string"));
});
test("CM11-064 revision trace non-certifying", () => {
  const r = ok();
  assert.equal(r.revisionTrace.projectId, "proj-1");
  assert.equal(r.revisionTrace.projectRevision, 1);
  assert.equal(r.revisionTrace.engineeringCurrency, "VALIDATED_SUPPLIED_SNAPSHOT");
  assert.equal(r.revisionTrace.commerceComparisonStatus, "NOT_TRACKED");
  assert.equal(r.revisionTrace.liveCurrentCertified, false);
});

// ===========================================================================
// Expanded negative inventory: every mandatory gate independently
// ===========================================================================
test("CM11-065 project not confirmed blocked", () => blocked(mutate((i) => { i.project.status = "object_confirmed"; }), "building.object_not_confirmed"));
test("CM11-066 object confirmation time missing blocked", () => blocked(mutate((i) => { i.project.objectConfirmedAt = ""; }), "building.object_not_confirmed"));
test("CM11-067 object confirmation revision stale blocked", () => blocked(mutate((i) => { i.project.objectConfirmedRevision = 2; }), "PROJECT_REVISION_STALE"));
test("CM11-068 object snapshot revision stale blocked", () => blocked(mutate((i) => { i.project.objectConfirmedSnapshot.buildingRevision = 2; }), "PROJECT_REVISION_STALE"));
test("CM11-069 object snapshot type mismatch blocked", () => blocked(mutate((i) => { i.project.objectConfirmedSnapshot.objectType = "private_house"; }), "PROJECT_REVISION_STALE"));
test("CM11-070 non-residential object blocked", () => blocked(mutate((i) => { i.project.objectType = "commercial"; }), "TOPOLOGY_NOT_SUPPORTED"));
test("CM11-071 system not confirmed blocked", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.configurationStatus = "draft"; }), "SYSTEM_CONFIGURATION_MISSING"));
test("CM11-072 system validation not ready blocked", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.validation.ready = false; }), "SYSTEM_CONFIGURATION_MISSING"));
test("CM11-073 system validation blockers blocked", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.validation.blockers = [{ code: "x", message: "x" }]; }), "SYSTEM_CONFIGURATION_MISSING"));
test("CM11-074 system confirmation building revision stale blocked", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.buildingRevisionAtConfirmation = 2; }), "PROJECT_REVISION_STALE"));
test("CM11-075 system confirmation systems revision stale blocked", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.systemsRevisionAtConfirmation = 2; }), "SYSTEM_CONFIGURATION_REVISION_STALE"));
test("CM11-076 unknown source family blocked", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.architecture.spaceCombinedSourceId = "gas_boiler"; }), "TOPOLOGY_NOT_SUPPORTED"));
test("CM11-077 wrong distribution id blocked", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.architecture.distribution.id = "hydronic_4pipe_heating_cooling"; }), "TOPOLOGY_NOT_SUPPORTED"));
test("CM11-078 4pipe circuit blocked", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.architecture.distribution.circuitKind = "4pipe"; }), "TOPOLOGY_NOT_SUPPORTED"));
test("CM11-079 simultaneous heat cool required blocked", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.simultaneousHeatCoolRequired = true; }), "SIMULTANEOUS_OPERATION_NOT_SUPPORTED"));
test("CM11-080 distribution simultaneous blocked", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.architecture.distribution.simultaneousHeatCool = true; }), "SIMULTANEOUS_OPERATION_NOT_SUPPORTED"));
test("CM11-081 load mode quick blocked", () => blocked(mutate((i) => { i.loadCalculation.mode = "quick"; }), "LOAD_CALCULATION_NOT_READY"));
test("CM11-082 load status limited blocked", () => blocked(mutate((i) => { i.loadCalculation.status = "limited"; }), "LOAD_CALCULATION_NOT_READY"));
test("CM11-083 unsupported method id blocked", () => blocked(mutate((i) => { i.loadCalculation.methodId = "ohmx.quick.v1"; }), "LOAD_CALCULATION_NOT_READY"));
test("CM11-084 object totals missing blocked", () => blocked(mutate((i) => { i.loadCalculation.heatingDemandW = null; }), "OBJECT_LOAD_MISSING"));
test("CM11-085 object totals negative blocked", () => blocked(mutate((i) => { i.loadCalculation.coolingDemandW = -1; }), "OBJECT_LOAD_MISSING"));
test("CM11-086 room service not calculated blocked", () => blocked(mutate((i) => { i.loadCalculation.roomResults[0].heating.status = "limited"; }), "ROOM_LOAD_MISSING"));
test("CM11-087 room missing input blocked", () => blocked(mutate((i) => { i.loadCalculation.roomResults[0].cooling.missingInputs = ["climate"]; }), "ROOM_LOAD_MISSING"));
test("CM11-088 room demand negative blocked", () => blocked(mutate((i) => { i.loadCalculation.roomResults[0].heating.demandW = -5; }), "ROOM_LOAD_MISSING"));
test("CM11-089 snapshot project id mismatch blocked", () => blocked(mutate((i) => { i.loadCalculation.inputSnapshot.projectId = "proj-2"; }), "PROJECT_REVISION_STALE"));
test("CM11-090 snapshot object type mismatch blocked", () => blocked(mutate((i) => { i.loadCalculation.inputSnapshot.objectType = "private_house"; }), "PROJECT_REVISION_STALE"));
test("CM11-091 load input building revision stale blocked", () => blocked(mutate((i) => { i.loadCalculation.inputSnapshot.buildingRevision = 2; }), "PROJECT_REVISION_STALE"));
test("CM11-092 load input systems revision stale blocked", () => blocked(mutate((i) => { i.loadCalculation.inputSnapshot.systemsRevision = 2; }), "SYSTEM_CONFIGURATION_REVISION_STALE"));
test("CM11-093 climate identity missing blocked", () => blocked(mutate((i) => { i.loadCalculation.climateLocationId = null; }), "LOAD_CALCULATION_NOT_READY"));
test("CM11-094 zone intent blocked", () => blocked(mutate((i) => { i.project.calculationConfiguration.coverageIntent.includedZoneIds = ["z1"]; }), "TOPOLOGY_NOT_SUPPORTED"));
test("CM11-095 excluded room ids blocked", () => blocked(mutate((i) => { i.project.calculationConfiguration.coverageIntent.excludedRoomIds = ["room-1"]; }), "LOAD_COVERAGE_INCOMPLETE"));
test("CM11-096 requested service missing from intent blocked", () => blocked(mutate((i) => { i.project.calculationConfiguration.coverageIntent.requestedServices = ["heating"]; }), "LOAD_COVERAGE_INCOMPLETE"));
test("CM11-097 wet bulb > cooling dry bulb blocked", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.engineeringDesignInputs.coolingIndoorDesignCondition.indoorCoolingWetBulbC.value = 30; }), "OPERATING_CONDITION_CONFLICT"));
test("CM11-098 heterogeneous served-room temperature blocked", () => blocked(mutate((i) => { i.loadCalculation.roomResults[1].transmissionBreakdown.indoorHeatingC = 22; refreshReference(i); }), "OPERATING_CONDITION_CONFLICT"));
test("CM11-099 missing transmission temperature blocked", () => blocked(mutate((i) => { i.loadCalculation.roomResults[0].transmissionBreakdown.outdoorHeatingC = null; refreshReference(i); }), "OPERATING_CONDITION_REQUIRED"));
test("CM11-100 explicit invalid margin blocked", () => blocked(mutate((i) => {
  i.confirmedSystemSnapshot.engineeringDesignInputs.designMargins = { heatPumpHeating: { designMarginPercent: -1, marginSource: "USER_INPUT", marginPolicyId: "p", marginPolicyVersion: "1" } };
}), "DESIGN_MARGIN_INVALID"));
test("CM11-101 NONE margin with nonzero percent blocked", () => blocked(mutate((i) => {
  i.confirmedSystemSnapshot.engineeringDesignInputs.designMargins = { fanCoilHeating: { designMarginPercent: 5, marginSource: "NONE", marginPolicyId: null, marginPolicyVersion: null } };
}), "DESIGN_MARGIN_INVALID"));
test("CM11-102 matcher model identity mismatch blocked", () => blocked(mutate((i) => { i.matcherRequestPolicy.matcherModelId = "x"; }), "POLICY_ID_VERSION_INVALID"));
test("CM11-103 matcher interpolation flag blocked", () => blocked(mutate((i) => { i.matcherRequestPolicy.allowInterpolation = true; }), "CANONICAL_VOCABULARY_INVALID"));
test("CM11-104 matcher maxCandidates invalid blocked", () => blocked(mutate((i) => { i.matcherRequestPolicy.maxCandidates = 0; }), "CANONICAL_VOCABULARY_INVALID"));
test("CM11-105 selection intent invalid blocked", () => blocked(mutate((i) => { i.selectionIntent = "EXPERT"; }), "CANONICAL_VOCABULARY_INVALID"));
test("CM11-106 design input unknown provenance blocked", () => blocked(mutate((i) => { i.confirmedSystemSnapshot.engineeringDesignInputs.hydronicDesignConditions.heatingWaterSupplyC.source = "UNRESOLVED"; }), "OPERATING_CONDITION_REQUIRED"));
test("CM11-107 design input missing policy reference blocked", () => blocked(mutate((i) => {
  i.confirmedSystemSnapshot.engineeringDesignInputs.hydronicDesignConditions.heatingWaterSupplyC = { value: 45, unit: "°C", source: "SYSTEM_POLICY", sourceReference: "r", status: "RESOLVED", policyReference: null };
}), "CANONICAL_VOCABULARY_INVALID"));

// ===========================================================================
// Load revision reference authoring/format coverage
// ===========================================================================
test("CM11-108 unavailable load revision blocked", () => blocked(mutate((i) => { i.loadRevisionReference = { status: "UNAVAILABLE", revision: null, sourceCalculationId: null, algorithmVersion: null, canonicalFacts: null, errors: [{ code: "E", sourceReference: null, message: "missing" }] }; }), "LOAD_REVISION_UNAVAILABLE"));
test("CM11-109 wrong load algorithm version blocked", () => blocked(mutate((i) => { i.loadRevisionReference.algorithmVersion = "x"; }), "LOAD_CALCULATION_REVISION_STALE"));
test("CM11-110 load facts mismatch blocked", () => blocked(mutate((i) => { i.loadRevisionReference.canonicalFacts = { ...i.loadRevisionReference.canonicalFacts, heatingDemandW: 999999 }; }), "LOAD_CALCULATION_REVISION_STALE"));
test("CM11-111 load reference provider errors blocked", () => blocked(mutate((i) => { i.loadRevisionReference.errors = [{ code: "E", sourceReference: null, message: "m" }]; }), "LOAD_CALCULATION_REVISION_STALE"));

// ===========================================================================
// Engineering catalog reference authoring/format coverage
// ===========================================================================
test("CM11-112 unavailable catalog reference blocked", () => blocked(mutate((i) => { i.engineeringCatalogStateReference = { status: "UNAVAILABLE", revision: null, generatedFromPolicyId: null, generatedFromPolicyVersion: null, algorithmVersion: null, scopeEquipmentTypes: [], readConsistency: "UNAVAILABLE", warnings: [], errors: [{ code: "E", sourceReference: null, message: "m" }] }; }), "ENGINEERING_CATALOG_STATE_UNAVAILABLE"));
test("CM11-113 wrong catalog policy id blocked", () => blocked(mutate((i) => { i.engineeringCatalogStateReference.generatedFromPolicyId = "x"; }), "POLICY_ID_VERSION_INVALID"));
test("CM11-114 wrong catalog scope blocked", () => blocked(mutate((i) => { i.engineeringCatalogStateReference.scopeEquipmentTypes = ["FAN_COIL"]; }), "POLICY_ID_VERSION_INVALID"));
test("CM11-115 catalog read inconsistency blocked", () => blocked(mutate((i) => { i.engineeringCatalogStateReference.readConsistency = "PARTIAL"; }), "POLICY_ID_VERSION_INVALID"));
test("CM11-116 catalog provider warning wrapped", () => {
  const input = mutate((i) => { i.engineeringCatalogStateReference.warnings = [{ code: "W1", sourceReference: "src", message: "warn" }]; });
  const r = ok(input);
  assert.ok((r.warnings as any[]).some((w) => w.code === "ENGINEERING_CATALOG_STATE_PROVIDER_WARNING"));
});

// ===========================================================================
// Captured design parity + served identity boundaries
// ===========================================================================
test("CM11-117 captured design parity mismatch blocked", () => blocked(mutate((i) => {
  i.loadCalculation.inputSnapshot.systemEngineeringDesignInputs.hydronicDesignConditions.heatingWaterSupplyC.value = 60;
}), "LOAD_CALCULATION_REVISION_STALE"));

test("CM11-118 empty project rooms blocked", () => blocked(mutate((i) => { i.project.rooms = []; i.project.objectConfirmedSnapshot.rooms = []; }), "SERVED_ROOM_INVALID"));
test("CM11-119 duplicate assignment terminal family blocked", () => blocked(mutate((i) => {
  i.confirmedSystemSnapshot.roomAssignments[0].heatingSystems = [{ familyId: "fan_coils" }, { familyId: "fan_coils" }];
}), "SERVED_ROOM_INVALID"));

// ===========================================================================
// Group A extended — complete determination of every READY leaf category
// ===========================================================================
test("CM11-120 READY operating-conditions consensus sources are BUILDING_LOAD_CONTEXT", () => {
  const r = ok();
  const op = (r.input as any).operatingConditions;
  assert.equal(op.heatPumpHeating.outdoorHeatingDesignC.source, "BUILDING_LOAD_CONTEXT");
  assert.equal(op.fanCoilCooling.indoorAirDryBulbC.source, "BUILDING_LOAD_CONTEXT");
});
test("CM11-121 READY design water sources copied", () => {
  const r = ok();
  const op = (r.input as any).operatingConditions;
  assert.equal(op.heatPumpHeating.waterSupplyC.source, "USER_INPUT");
  assert.equal(op.heatPumpHeating.waterSupplyC.value, 45);
  assert.equal(op.fanCoilHeating.waterInC.value, 45);
  assert.equal(op.fanCoilHeating.waterOutC.value, 35);
});
test("CM11-122 READY margins all four groups materialized NONE", () => {
  const r = ok();
  const m = (r.input as any).designMargins;
  for (const g of ["heatPumpHeating", "heatPumpCooling", "fanCoilHeating", "fanCoilCooling"]) {
    assert.equal(m[g].designMarginPercent, 0);
    assert.equal(m[g].marginSource, "NONE");
  }
});
test("CM11-123 READY matcher request policy copied", () => {
  const r = ok();
  const mp = (r.input as any).matcherRequestPolicy;
  assert.equal(mp.maxCandidates, 10);
  assert.equal(mp.requireExactOperatingPoint, true);
  assert.equal(mp.allowInterpolation, false);
});
test("CM11-124 READY load context temperatures copy through", () => {
  const r = ok();
  const lc = (r.input as any).loadCalculation;
  assert.equal(lc.heatingDemandW, 5000);
  assert.equal(lc.roomResults[0].roomId, "room-1");
  assert.equal(lc.roomResults[0].transmissionBreakdown.indoorHeatingC, 21);
});
test("CM11-125 READY quality coverage copied exactly", () => {
  const r = ok();
  assert.equal((r.input as any).loadCalculation.engineeringQuality.coverage.scope, "WHOLE_OBJECT");
  assert.equal((r.input as any).loadCalculation.engineeringQuality.coverage.confirmation, "WHOLE_OBJECT_CONFIRMED");
});
test("CM11-126 READY system snapshot projected confirmed", () => {
  const r = ok();
  const s = (r.input as any).systemConfigurationSnapshot;
  assert.equal(s.configurationStatus, "confirmed");
  assert.equal(s.architecture.distribution.id, "hydronic_2pipe_heating_cooling");
  assert.deepEqual(s.requestedServices, ["cooling", "heating"]);
});
test("CM11-127 source trace and revision trace are readonly-free of timestamp identity", () => {
  const r = ok();
  const traceText = JSON.stringify(r.sourceTrace) + JSON.stringify(r.revisionTrace);
  assert.ok(!/\b\d{4}-\d{2}-\d{2}T/.test(traceText) || traceText.includes("calculatedAt")); // no introduced clock identity
});

// Determinism of ordering across blockers
test("CM11-128 blockers follow canonical order", () => {
  const r = blocked(mutate((i) => {
    i.loadRevisionReference = null;
    i.confirmedSystemSnapshot.engineeringDesignInputs.fanCoilSizingPolicy.sizingFanSpeed = unresolved(null);
    i.policyIdentities.genericRequirementPolicy.version = "9.9.9";
  }));
  const codes = codeList(r);
  const idx = (c: string) => ["building.object_not_confirmed", "LOAD_REVISION_UNAVAILABLE", "ENGINEERING_CATALOG_STATE_UNAVAILABLE", "POLICY_ID_VERSION_INVALID", "PROJECT_REVISION_STALE", "LOAD_CALCULATION_REVISION_STALE", "SYSTEM_CONFIGURATION_REVISION_STALE", "LOAD_CALCULATION_NOT_READY", "LOAD_QUALITY_INSUFFICIENT", "LOAD_COVERAGE_INCOMPLETE", "OBJECT_LOAD_MISSING", "ROOM_LOAD_MISSING", "SYSTEM_CONFIGURATION_MISSING", "TOPOLOGY_NOT_SUPPORTED", "SIMULTANEOUS_OPERATION_NOT_SUPPORTED", "SERVED_ROOM_INVALID", "OPERATING_CONDITION_REQUIRED", "OPERATING_CONDITION_CONFLICT", "FAN_SPEED_REQUIRED", "DESIGN_MARGIN_INVALID", "CM7_1_PHYSICAL_COMPONENT_REFERENCE_REQUIRED", "CANONICAL_VOCABULARY_INVALID", "ENGINEERING_CATALOG_STATE_REQUIRED", "ENGINEERING_CATALOG_STATE_INVALID"].indexOf(c);
  const positions = codes.map(idx);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
});

test("CM11-129 no dedup loss — independent failures all reported", () => {
  const r = blocked(mutate((i) => {
    i.confirmedSystemSnapshot.engineeringDesignInputs.hydronicDesignConditions.heatingWaterSupplyC = unresolved("°C");
    i.confirmedSystemSnapshot.engineeringDesignInputs.hydronicDesignConditions.heatingWaterReturnC = unresolved("°C");
  }));
  const ops = codeList(r).filter((c) => c === "OPERATING_CONDITION_REQUIRED");
  assert.ok(ops.length >= 2, JSON.stringify(r.blockingReasons));
});

test("CM11-130 object snapshot region mismatch blocked", () => blocked(mutate((i) => { i.project.objectConfirmedSnapshot.region = { code: "AM-ER", name: "Yerevan" }; }), "PROJECT_REVISION_STALE"));
test("CM11-131 READY envelope identity", () => {
  const r = ok();
  assert.equal(r.contractId, "ohmx.building-project-configurator-adapter.v1");
  assert.equal(r.contractVersion, "1.0.0");
});
test("CM11-132 BLOCKED envelope identity + NOT_CERTIFIED", () => {
  const r = blocked(mutate((i) => { i.loadRevisionReference = null; }));
  assert.equal(r.contractId, "ohmx.building-project-configurator-adapter.v1");
  assert.equal(r.contractVersion, "1.0.0");
  assert.equal(r.revisionTrace.engineeringCurrency, "NOT_CERTIFIED");
  assert.equal(r.revisionTrace.liveCurrentCertified, false);
});
test("CM11-133 out-of-order snapshot rooms still READY and sorted", () => {
  const input = mutate((i) => {
    const swap = [...i.project.rooms];
    const t = swap[0];
    swap[0] = swap[1];
    swap[1] = t;
    i.project.rooms = swap;
    i.project.objectConfirmedSnapshot.rooms = swap.map((r: any) => ({ ...r }));
  });
  const r = ok(input);
  assert.deepEqual((r.input as any).servedRooms.map((s: any) => s.roomId), ["room-1", "room-2"]);
});
test("CM11-134 selection intent preserved through READY", () => {
  const r = ok(makeValidInput({ selectionIntent: "PRELIMINARY", maximumEligibleLevel: 1 }));
  assert.equal((r.input as any).selectionIntent, "PRELIMINARY");
});
test("CM11-135 snapshot total area mismatch blocked", () => blocked(mutate((i) => { i.project.objectConfirmedSnapshot.totalAreaM2 = 60; }), "PROJECT_REVISION_STALE"));

// ===========================================================================
// Fixture isolation — order-independence proof (§3)
// ===========================================================================
test("CM11-136 fixture isolation — mutating one fixture never affects another", () => {
  // policy identities
  {
    const A = makeValidInput();
    const B = makeValidInput();
    (A as any).policyIdentities.genericRequirementPolicy.version = "9.9.9";
    assert.equal((B as any).policyIdentities.genericRequirementPolicy.version, "1.0.0");
    assert.equal(buildEngineeringConfiguratorInput(B as any).status, "READY");
  }
  // matcher request policy
  {
    const A = makeValidInput();
    const B = makeValidInput();
    (A as any).matcherRequestPolicy.matcherModelId = "x";
    assert.equal((B as any).matcherRequestPolicy.matcherModelId, "ohmx.catalog-matcher.v1");
    assert.equal(buildEngineeringConfiguratorInput(B as any).status, "READY");
  }
  // quality
  {
    const A = makeValidInput();
    const B = makeValidInput();
    (A as any).loadCalculation.engineeringQuality.maximumEligibleLevel = 0;
    assert.equal((B as any).loadCalculation.engineeringQuality.maximumEligibleLevel, 3);
  }
  // coverage
  {
    const A = makeValidInput();
    const B = makeValidInput();
    (A as any).loadCalculation.engineeringQuality.coverage.scope = "UNKNOWN";
    assert.equal((B as any).loadCalculation.engineeringQuality.coverage.scope, "WHOLE_OBJECT");
  }
  // load revision reference
  {
    const A = makeValidInput();
    const B = makeValidInput();
    (A as any).loadRevisionReference.revision = "load:sha256:XYZ";
    assert.equal((B as any).loadRevisionReference.revision, LOAD_TOKEN);
  }
  // operating inputs (design)
  {
    const A = makeValidInput();
    const B = makeValidInput();
    (A as any).confirmedSystemSnapshot.engineeringDesignInputs.hydronicDesignConditions.heatingWaterSupplyC.value = 99;
    assert.equal((B as any).confirmedSystemSnapshot.engineeringDesignInputs.hydronicDesignConditions.heatingWaterSupplyC.value, 45);
  }
  // rooms
  {
    const A = makeValidInput();
    const B = makeValidInput();
    (A as any).project.rooms.push({ id: "room-x", roomType: "bedroom", name: "X", areaM2: 10, floorId: null, extras: { geometry: {}, windows: {}, conditions: [], engineeringUse: "stored_only" } });
    assert.equal((B as any).project.rooms.length, 2);
  }
});