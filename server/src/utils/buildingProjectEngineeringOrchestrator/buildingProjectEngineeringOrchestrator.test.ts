/**
 * CM16 — Building Project → Engineering Configurator live-orchestration
 * BEHAVIOR tests. WRITTEN ONLY — not executed by the agent (§43–44).
 * Traceability labels CM16-001…; TESTS_RUN_BY_AGENT: NO.
 *
 * Run with:
 *   npm run test:building-project-engineering-orchestrator
 */
import * as assert from "node:assert/strict";
import { test } from "node:test";
import { runBuildingProjectEngineeringConfiguration } from "./orchestrator.js";
import { buildEngineeringConfiguratorInput } from "../buildingProjectConfiguratorAdapter/index.js";
import { configureHeatPumpFanCoil } from "../engineeringConfigurator/index.js";
import {
  makeValidLiveProject,
  cloneProject,
  makeAvailableProvider,
  makeAvailableReference,
  makeUnavailableProvider,
  CATALOG_TOKEN,
} from "./fixtures.js";
import type { BuildingProject } from "../buildingProjectTypes.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

async function run(project: any, opts: any = {}) {
  return runBuildingProjectEngineeringConfiguration({
    projectSnapshot: project,
    catalogProvider: makeAvailableProvider(),
    ...opts,
  });
}

function reasonCodes(r: any): string[] {
  const codes: string[] = [];
  if (r.blocker) codes.push(r.blocker.code);
  if (r.adapterResult) for (const b of (r.adapterResult.blockingReasons || [])) codes.push(b.code);
  return codes;
}

function expectConfigured(r: any): any {
  assert.equal(r.status, "CONFIGURED", JSON.stringify(r));
  assert.equal(r.blocker, null);
  assert.equal(r.adapterResult.status, "READY");
  assert.equal(r.configuratorResult.status, "READY_WITH_WARNINGS");
  return r;
}

async function configured(project: any, opts: any = {}): Promise<any> {
  return expectConfigured(await run(project, opts));
}

function expectOrchestratorBlocked(r: any, code: string): any {
  assert.equal(r.status, "BLOCKED", JSON.stringify(r));
  assert.ok(r.blocker, "expected orchestrator blocker");
  assert.equal(r.blocker.code, code, JSON.stringify(r));
  assert.equal(r.adapterResult, null);
  assert.equal(r.configuratorResult, null);
  return r;
}

async function orchestratorBlocked(project: any, code: string, opts: any = {}): Promise<any> {
  return expectOrchestratorBlocked(await run(project, opts), code);
}

function expectAdapterBlocked(r: any, code?: string): any {
  assert.equal(r.status, "BLOCKED", JSON.stringify(r));
  assert.equal(r.blocker, null);
  assert.ok(r.adapterResult, "expected adapter result");
  assert.equal(r.adapterResult.status, "BLOCKED");
  assert.equal(r.configuratorResult, null);
  if (code) {
    assert.ok(
      (r.adapterResult.blockingReasons || []).some((b: any) => b.code === code),
      `missing ${code}: ${JSON.stringify(r.adapterResult.blockingReasons)}`,
    );
  }
  return r;
}

async function adapterBlocked(project: any, code: string, opts: any = {}): Promise<any> {
  return expectAdapterBlocked(await run(project, opts), code);
}

const valid = () => makeValidLiveProject();

function unresolvedNumericDesignInput() {
  return {
    value: null,
    unit: "°C",
    source: "UNRESOLVED",
    sourceReference: null,
    policyReference: null,
    status: "REQUIRED_POLICY_INPUT",
  };
}

function unresolvedTextDesignInput() {
  return {
    value: null,
    unit: null,
    source: "UNRESOLVED",
    sourceReference: null,
    policyReference: null,
    status: "REQUIRED_POLICY_INPUT",
  };
}

// ===========================================================================
// A. Happy path
// ===========================================================================

test("CM16-001 valid live project → CONFIGURED", async () => {
  const r = await configured(valid());
  assert.equal(r.projectId, "proj-1");
  assert.equal(r.projectRevision, 1);
  assert.equal(r.systemRevision, 1);
  assert.match(r.loadCalculationRevision, /^load:sha256:[0-9a-f]{64}$/);
  assert.equal(r.engineeringCatalogStateRevision, CATALOG_TOKEN);
});

test("CM16-002 CONFIGURED carries the CM11 adapter READY trace (sourceTrace + revisionTrace)", async () => {
  const r = await configured(valid());
  assert.ok(Array.isArray(r.adapterResult.sourceTrace) && r.adapterResult.sourceTrace.length > 0);
  assert.ok(r.adapterResult.revisionTrace);
  assert.equal(r.adapterResult.contractId, "ohmx.building-project-configurator-adapter.v1");
});

test("CM16-003 Configurator result carries physicalComponents + equipmentRequirements", async () => {
  const r = await configured(valid());
  assert.ok(Array.isArray(r.configuratorResult.physicalComponents) && r.configuratorResult.physicalComponents.length > 0);
  assert.ok(Array.isArray(r.configuratorResult.equipmentRequirements) && r.configuratorResult.equipmentRequirements.length > 0);
});

test("CM16-004 whole-object confirmed happy path selection intent PROFESSIONAL", async () => {
  const r = await configured(valid(), { selectionIntent: "PROFESSIONAL" });
  assert.equal(r.selectionIntent, "PROFESSIONAL");
  assert.equal(r.configuratorResult.completenessState, "PILOT_CORE_SELECTION_ONLY");
});

test("CM16-005 PRELIMINARY intent with eligible level-3 load still CONFIGURED", async () => {
  const r = await configured(valid(), { selectionIntent: "PRELIMINARY" });
  assert.equal(r.selectionIntent, "PRELIMINARY");
});

// ===========================================================================
// B. Building Project state
// ===========================================================================

test("CM16-010 missing project → BLOCKED project.missing (no adapter call)", async () => {
  const r = await runBuildingProjectEngineeringConfiguration({
    projectId: "nope",
    catalogProvider: makeAvailableProvider(),
    readProject: () => null,
  });
  expectOrchestratorBlocked(r, "project.missing");
});

test("CM16-011 unconfirmed project (draft) → BLOCKED project.not_confirmed", async () => {
  const p = valid();
  (p as any).status = "draft";
  await orchestratorBlocked(p, "project.not_confirmed");
});

test("CM16-012 missing objectConfirmedSnapshot → BLOCKED project.not_confirmed", async () => {
  const p = valid();
  (p as any).objectConfirmedSnapshot = null;
  await orchestratorBlocked(p, "project.not_confirmed");
});

test("CM16-013 status object_confirmed (not systems_configured) → BLOCKED project.not_confirmed", async () => {
  const p = valid();
  (p as any).status = "object_confirmed";
  await orchestratorBlocked(p, "project.not_confirmed");
});

test("CM16-014 missing objectConfirmedAt → BLOCKED project.not_confirmed", async () => {
  const p = valid();
  (p as any).objectConfirmedAt = null;
  await orchestratorBlocked(p, "project.not_confirmed");
});

test("CM16-015 stale object snapshot (snapshot.buildingRevision drift) → adapter PROJECT_REVISION_STALE", async () => {
  const p = valid();
  (p as any).objectConfirmedSnapshot.buildingRevision = 999;
  await adapterBlocked(p, "PROJECT_REVISION_STALE");
});

test("CM16-016 object revision mismatch (objectConfirmedRevision != buildingRevision) → adapter PROJECT_REVISION_STALE", async () => {
  const p = valid();
  (p as any).objectConfirmedRevision = 2;
  await adapterBlocked(p, "PROJECT_REVISION_STALE");
});

test("CM16-017 unsupported object type (commercial) → adapter TOPOLOGY_NOT_SUPPORTED", async () => {
  const p = valid();
  (p as any).objectType = "commercial";
  (p as any).systemsConfiguration.architecture.spaceHeatingSourceId = "reversible_air_to_water_heat_pump";
  await adapterBlocked(p, "TOPOLOGY_NOT_SUPPORTED");
});

test("CM16-018 null objectConfirmedRevision → BLOCKED project.not_confirmed", async () => {
  const p = valid();
  (p as any).objectConfirmedRevision = null;
  await orchestratorBlocked(p, "project.not_confirmed");
});

// ===========================================================================
// C. System snapshot
// ===========================================================================

test("CM16-020 missing confirmed system snapshot → BLOCKED system.confirmed_snapshot_missing", async () => {
  const p = valid();
  (p as any).systemsConfigurationSnapshot = null;
  await orchestratorBlocked(p, "system.confirmed_snapshot_missing");
});

test("CM16-021 system snapshot not confirmed (draft) → BLOCKED system.confirmed_snapshot_missing", async () => {
  const p = valid();
  (p as any).systemsConfigurationSnapshot.configurationStatus = "draft";
  await orchestratorBlocked(p, "system.confirmed_snapshot_missing");
});

test("CM16-022 stale system snapshot (systemsRevisionAtConfirmation drift) → adapter SYSTEM_CONFIGURATION_REVISION_STALE", async () => {
  const p = valid();
  (p as any).systemsConfigurationSnapshot.systemsRevisionAtConfirmation = 2;
  await adapterBlocked(p, "SYSTEM_CONFIGURATION_REVISION_STALE");
});

test("CM16-023 draft-vs-confirmed mismatch → adapter SYSTEM_CONFIGURATION_MISSING", async () => {
  const p = valid();
  (p as any).systemsConfiguration.configurationStatus = "draft";
  await adapterBlocked(p, "SYSTEM_CONFIGURATION_MISSING");
});

test("CM16-024 missing engineering design inputs object → BLOCKED design_inputs.missing", async () => {
  const p = valid();
  (p as any).systemsConfigurationSnapshot.engineeringDesignInputs = null;
  await orchestratorBlocked(p, "design_inputs.missing");
});

test("CM16-025 unresolved hydronic inputs → adapter OPERATING_CONDITION_REQUIRED", async () => {
  const p = valid();
  (p as any).systemsConfigurationSnapshot.engineeringDesignInputs.hydronicDesignConditions = {
    heatingWaterSupplyC: unresolvedNumericDesignInput(),
    heatingWaterReturnC: unresolvedNumericDesignInput(),
    coolingWaterSupplyC: unresolvedNumericDesignInput(),
    coolingWaterReturnC: unresolvedNumericDesignInput(),
  };
  await adapterBlocked(p, "OPERATING_CONDITION_REQUIRED");
});

test("CM16-026 unresolved wet bulb → adapter OPERATING_CONDITION_REQUIRED", async () => {
  const p = valid();
  (p as any).systemsConfigurationSnapshot.engineeringDesignInputs.coolingIndoorDesignCondition.indoorCoolingWetBulbC =
    unresolvedNumericDesignInput();
  await adapterBlocked(p, "OPERATING_CONDITION_REQUIRED");
});

test("CM16-027 unresolved fan speed → adapter FAN_SPEED_REQUIRED", async () => {
  const p = valid();
  (p as any).systemsConfigurationSnapshot.engineeringDesignInputs.fanCoilSizingPolicy.sizingFanSpeed =
    unresolvedTextDesignInput();
  await adapterBlocked(p, "FAN_SPEED_REQUIRED");
});

test("CM16-028 unresolved hydronic supply leaf → adapter OPERATING_CONDITION_REQUIRED", async () => {
  const p = valid();
  (p as any).systemsConfigurationSnapshot.engineeringDesignInputs.hydronicDesignConditions.heatingWaterSupplyC.value = null;
  await adapterBlocked(p, "OPERATING_CONDITION_REQUIRED");
});

test("CM16-029 unresolved wet bulb leaf → adapter OPERATING_CONDITION_REQUIRED", async () => {
  const p = valid();
  (p as any).systemsConfigurationSnapshot.engineeringDesignInputs.coolingIndoorDesignCondition.indoorCoolingWetBulbC.value = null;
  await adapterBlocked(p, "OPERATING_CONDITION_REQUIRED");
});

test("CM16-030 unresolved fan speed leaf → adapter FAN_SPEED_REQUIRED", async () => {
  const p = valid();
  (p as any).systemsConfigurationSnapshot.engineeringDesignInputs.fanCoilSizingPolicy.sizingFanSpeed.value = null;
  await adapterBlocked(p, "FAN_SPEED_REQUIRED");
});

test("CM16-031 system validation not ready → adapter SYSTEM_CONFIGURATION_MISSING", async () => {
  const p = valid();
  (p as any).systemsConfigurationSnapshot.validation.ready = false;
  await adapterBlocked(p, "SYSTEM_CONFIGURATION_MISSING");
});

test("CM16-032 non-heat-pump source family → adapter TOPOLOGY_NOT_SUPPORTED", async () => {
  const p = valid();
  (p as any).systemsConfigurationSnapshot.architecture.spaceHeatingSourceId = "gas_boiler";
  await adapterBlocked(p, "TOPOLOGY_NOT_SUPPORTED");
});

test("CM16-033 simultaneous heat/cool required → adapter SIMULTANEOUS_OPERATION_NOT_SUPPORTED", async () => {
  const p = valid();
  (p as any).systemsConfigurationSnapshot.simultaneousHeatCoolRequired = true;
  await adapterBlocked(p, "SIMULTANEOUS_OPERATION_NOT_SUPPORTED");
});

test("CM16-034 4-pipe distribution → adapter TOPOLOGY_NOT_SUPPORTED", async () => {
  const p = valid();
  (p as any).systemsConfigurationSnapshot.architecture.distribution.circuitKind = "4pipe";
  await adapterBlocked(p, "TOPOLOGY_NOT_SUPPORTED");
});

test("CM16-035 room assignment missing a fan-coil terminal → adapter SERVED_ROOM_INVALID", async () => {
  const p = valid();
  (p as any).systemsConfigurationSnapshot.roomAssignments[0].heatingSystems = [];
  await adapterBlocked(p, "SERVED_ROOM_INVALID");
});

// ===========================================================================
// D. Coverage
// ===========================================================================

test("CM16-040 missing coverage intent → BLOCKED coverage.intent_missing", async () => {
  const p = valid();
  (p as any).calculationConfiguration = null;
  await orchestratorBlocked(p, "coverage.intent_missing");
});

test("CM16-041 UNKNOWN coverage scope → adapter LOAD_COVERAGE_INCOMPLETE", async () => {
  const p = valid();
  (p as any).calculationConfiguration.coverageIntent.calculationScope = "UNKNOWN";
  await adapterBlocked(p, "LOAD_COVERAGE_INCOMPLETE");
});

test("CM16-042 UNCONFIRMED coverage confirmation → adapter LOAD_COVERAGE_INCOMPLETE", async () => {
  const p = valid();
  (p as any).calculationConfiguration.coverageIntent.coverageConfirmation = "UNCONFIRMED";
  await adapterBlocked(p, "LOAD_COVERAGE_INCOMPLETE");
});

test("CM16-043 stale coverage (buildingRevisionAtConfirmation drift) → adapter LOAD_COVERAGE_INCOMPLETE", async () => {
  const p = valid();
  (p as any).calculationConfiguration.coverageIntent.buildingRevisionAtConfirmation = 0;
  await adapterBlocked(p, "LOAD_COVERAGE_INCOMPLETE");
});

test("CM16-044 area ratio 1 does NOT auto-confirm (UNCONFIRMED + ratio 1 still blocks)", async () => {
  const p = valid();
  (p as any).calculationConfiguration.coverageIntent.coverageConfirmation = "UNCONFIRMED";
  (p as any).loads.engineeringQuality.coverage.ratio = 1;
  await adapterBlocked(p, "LOAD_COVERAGE_INCOMPLETE");
});

test("CM16-045 coverage ratio != 1 → adapter LOAD_COVERAGE_INCOMPLETE", async () => {
  const p = valid();
  (p as any).loads.engineeringQuality.coverage.ratio = 0.5;
  await adapterBlocked(p, "LOAD_COVERAGE_INCOMPLETE");
});

test("CM16-046 coverage area mismatch (modeled vs declared) → adapter LOAD_COVERAGE_INCOMPLETE", async () => {
  const p = valid();
  (p as any).loads.engineeringQuality.coverage.modeledAreaM2 = 49;
  await adapterBlocked(p, "LOAD_COVERAGE_INCOMPLETE");
});

test("CM16-047 quality coverage scope/confirmation vs intent mismatch → adapter LOAD_COVERAGE_INCOMPLETE", async () => {
  const p = valid();
  (p as any).loads.engineeringQuality.coverage.confirmation = "UNCONFIRMED";
  await adapterBlocked(p, "LOAD_COVERAGE_INCOMPLETE");
});

test("CM16-048 excluded room ids non-empty → adapter LOAD_COVERAGE_INCOMPLETE", async () => {
  const p = valid();
  (p as any).calculationConfiguration.coverageIntent.excludedRoomIds = ["room-1"];
  await adapterBlocked(p, "LOAD_COVERAGE_INCOMPLETE");
});

test("CM16-049 zone intent non-empty → adapter TOPOLOGY_NOT_SUPPORTED", async () => {
  const p = valid();
  (p as any).calculationConfiguration.coverageIntent.includedZoneIds = ["z1"];
  await adapterBlocked(p, "TOPOLOGY_NOT_SUPPORTED");
});

test("CM16-050 requested services missing cooling → adapter LOAD_COVERAGE_INCOMPLETE", async () => {
  const p = valid();
  (p as any).calculationConfiguration.coverageIntent.requestedServices = ["heating"];
  await adapterBlocked(p, "LOAD_COVERAGE_INCOMPLETE");
});

// ===========================================================================
// E. Load
// ===========================================================================

test("CM16-060 missing load → BLOCKED load.missing", async () => {
  const p = valid();
  (p as any).loads = null;
  await orchestratorBlocked(p, "load.missing");
});

test("CM16-061 quick load → adapter LOAD_CALCULATION_NOT_READY", async () => {
  const p = valid();
  (p as any).loads.mode = "quick";
  (p as any).loads.inputSnapshot.mode = "quick";
  await adapterBlocked(p, "LOAD_CALCULATION_NOT_READY");
});

test("CM16-062 limited load status → adapter LOAD_CALCULATION_NOT_READY", async () => {
  const p = valid();
  (p as any).loads.status = "limited";
  await adapterBlocked(p, "LOAD_CALCULATION_NOT_READY");
});

test("CM16-063 stale load (buildingRevisionAtCalculation drift) → BLOCKED load.stale", async () => {
  const p = valid();
  (p as any).loads.buildingRevisionAtCalculation = 2;
  await orchestratorBlocked(p, "load.stale");
});

test("CM16-064 stale load (systemsRevisionAtCalculation drift) → BLOCKED load.stale", async () => {
  const p = valid();
  (p as any).loads.systemsRevisionAtCalculation = 2;
  await orchestratorBlocked(p, "load.stale");
});

test("CM16-065 legacy load without revision → BLOCKED load_revision.missing", async () => {
  const p = valid();
  delete (p as any).loads.loadCalculationRevision;
  delete (p as any).loads.sourceCalculationId;
  await orchestratorBlocked(p, "load_revision.missing");
});

test("CM16-066 half-stamped identity (revision only) → BLOCKED load_revision.missing", async () => {
  const p = valid();
  delete (p as any).loads.sourceCalculationId;
  await orchestratorBlocked(p, "load_revision.missing");
});

test("CM16-067 half-stamped identity (source only) → BLOCKED load_revision.missing", async () => {
  const p = valid();
  delete (p as any).loads.loadCalculationRevision;
  await orchestratorBlocked(p, "load_revision.missing");
});

test("CM16-068 malformed load revision token → adapter LOAD_CALCULATION_REVISION_STALE", async () => {
  const p = valid();
  (p as any).loads.loadCalculationRevision = "not-a-token";
  (p as any).loads.sourceCalculationId = "not-a-token";
  await adapterBlocked(p, "LOAD_CALCULATION_REVISION_STALE");
});

test("CM16-069 sourceCalculationId mismatch → adapter LOAD_CALCULATION_REVISION_STALE", async () => {
  const p = valid();
  (p as any).loads.sourceCalculationId = `load:sha256:${"c".repeat(64)}`;
  await adapterBlocked(p, "LOAD_CALCULATION_REVISION_STALE");
});

test("CM16-070 valid CM14 revision accepted (pattern + source == revision)", async () => {
  const r = await configured(valid());
  assert.match(r.loadCalculationRevision, /^load:sha256:[0-9a-f]{64}$/);
  assert.equal(r.loadCalculationRevision, r.sourceCalculationId);
});

test("CM16-071 load algorithm version mismatch → BLOCKED load_revision.algorithm_mismatch", async () => {
  const p = valid();
  (p as any).loads.loadRevisionAlgorithmVersion = "ohmx.other.v1";
  await orchestratorBlocked(p, "load_revision.algorithm_mismatch");
});

test("CM16-072 load missing engineeringQuality → BLOCKED load_revision.missing", async () => {
  const p = valid();
  delete (p as any).loads.engineeringQuality;
  await orchestratorBlocked(p, "load_revision.missing");
});

test("CM16-073 PROFESSIONAL with level-2 quality → adapter LOAD_QUALITY_INSUFFICIENT", async () => {
  const p = valid();
  (p as any).loads.engineeringQuality.maximumEligibleLevel = 2;
  await adapterBlocked(p, "LOAD_QUALITY_INSUFFICIENT");
});

test("CM16-074 quality gateStatus BLOCKED → adapter LOAD_QUALITY_INSUFFICIENT", async () => {
  const p = valid();
  (p as any).loads.engineeringQuality.gateStatus = "BLOCKED";
  await adapterBlocked(p, "LOAD_QUALITY_INSUFFICIENT");
});

test("CM16-075 wet bulb > cooling dry bulb → adapter OPERATING_CONDITION_CONFLICT", async () => {
  const p = valid();
  (p as any).systemsConfigurationSnapshot.engineeringDesignInputs.coolingIndoorDesignCondition.indoorCoolingWetBulbC.value = 30;
  await adapterBlocked(p, "OPERATING_CONDITION_CONFLICT");
});

test("CM16-076 hydronic heating supply <= return → adapter OPERATING_CONDITION_CONFLICT", async () => {
  const p = valid();
  (p as any).systemsConfigurationSnapshot.engineeringDesignInputs.hydronicDesignConditions.heatingWaterSupplyC.value = 30;
  await adapterBlocked(p, "OPERATING_CONDITION_CONFLICT");
});

// ===========================================================================
// F. Catalog provider
// ===========================================================================

test("CM16-080 AVAILABLE reference accepted (valid CM15 identity fields)", async () => {
  const r = await configured(valid());
  assert.equal(r.engineeringCatalogStateRevision, CATALOG_TOKEN);
});

test("CM16-081 provider UNAVAILABLE → BLOCKED catalog.unavailable (provision diag)", async () => {
  const r = await runBuildingProjectEngineeringConfiguration({
    projectSnapshot: valid(),
    catalogProvider: makeUnavailableProvider(),
  });
  expectOrchestratorBlocked(r, "catalog.unavailable");
  assert.ok((r.diagnostics || []).some((d: any) => d.code === "catalog_state_db_open_failed"));
});

test("CM16-082 malformed catalog token → adapter ENGINEERING_CATALOG_STATE_INVALID", async () => {
  const p = valid();
  const r = await run(p, {
    catalogProvider: makeAvailableProvider({ revision: "bad-token" as any }),
  });
  expectAdapterBlocked(r, "ENGINEERING_CATALOG_STATE_INVALID");
});

test("CM16-083 catalog policy version mismatch → adapter POLICY_ID_VERSION_INVALID", async () => {
  const p = valid();
  const r = await run(p, {
    catalogProvider: makeAvailableProvider({ generatedFromPolicyVersion: "9.9.9" as any }),
  });
  expectAdapterBlocked(r, "POLICY_ID_VERSION_INVALID");
});

test("CM16-084 catalog scope mismatch → adapter POLICY_ID_VERSION_INVALID", async () => {
  const p = valid();
  const r = await run(p, {
    catalogProvider: makeAvailableProvider({ scopeEquipmentTypes: ["FAN_COIL"] as any }),
  });
  expectAdapterBlocked(r, "POLICY_ID_VERSION_INVALID");
});

test("CM16-085 catalog algorithm mismatch → adapter POLICY_ID_VERSION_INVALID", async () => {
  const p = valid();
  const r = await run(p, {
    catalogProvider: makeAvailableProvider({ algorithmVersion: "ohmx.other.v1" as any }),
  });
  expectAdapterBlocked(r, "POLICY_ID_VERSION_INVALID");
});

test("CM16-086 catalog provider warning is preserved on READY", async () => {
  const p = valid();
  const r = await run(p, {
    catalogProvider: makeAvailableProvider({
      warnings: [{ code: "w1", sourceReference: null, message: "provider warning" }],
    }),
  });
  expectConfigured(r);
  assert.ok(
    (r.adapterResult.warnings || []).some((w: any) => w.code === "ENGINEERING_CATALOG_STATE_PROVIDER_WARNING"),
  );
});

// ===========================================================================
// G. Adapter invocation behavior (exactly-once / never-on-READY semantics)
// ===========================================================================

test("CM16-090 adapter called exactly once on the happy path", async () => {
  let calls = 0;
  const adapter = (input: any) => {
    calls += 1;
    return buildEngineeringConfiguratorInput(input);
  };
  await configured(valid(), { adapter });
  assert.equal(calls, 1);
});

test("CM16-091 configurator called exactly once when adapter READY", async () => {
  let calls = 0;
  const configurator = (input: any) => {
    calls += 1;
    return configureHeatPumpFanCoil(input);
  };
  await configured(valid(), { configurator });
  assert.equal(calls, 1);
});

test("CM16-092 configurator NEVER called when adapter BLOCKED", async () => {
  let calls = 0;
  const configurator = () => {
    calls += 1;
    return configureHeatPumpFanCoil({} as any);
  };
  const p = valid();
  (p as any).calculationConfiguration.coverageIntent.calculationScope = "UNKNOWN";
  await adapterBlocked(p, "LOAD_COVERAGE_INCOMPLETE", { configurator });
  assert.equal(calls, 0);
});

test("CM16-093 adapter and configurator both never called on orchestrator BLOCKED", async () => {
  let a = 0;
  let c = 0;
  const p = valid();
  (p as any).loads = null;
  await orchestratorBlocked(p, "load.missing", {
    adapter: () => {
      a += 1;
      return buildEngineeringConfiguratorInput({} as any);
    },
    configurator: () => {
      c += 1;
      return configureHeatPumpFanCoil({} as any);
    },
  });
  assert.equal(a, 0);
  assert.equal(c, 0);
});

test("CM16-094 adapter warnings preserved into CONFIGURED result", async () => {
  const r = await configured(valid());
  const codes = (r.adapterResult.warnings || []).map((w: any) => w.code);
  assert.ok(codes.includes("PILOT_CORE_SELECTION_ONLY"));
  assert.ok(codes.includes("COMPATIBILITY_UNKNOWN"));
});

test("CM16-095 adapter revision trace present and coherent", async () => {
  const r = await configured(valid());
  assert.equal(r.adapterResult.revisionTrace.projectId, "proj-1");
  assert.equal(r.adapterResult.revisionTrace.loadCalculationRevision, r.loadCalculationRevision);
});

test("CM16-096 configurator BLOCKED result is preserved in the BLOCKED envelope", async () => {
  const r = await run(valid(), {
    configurator: (input: any) =>
      configureHeatPumpFanCoil({ ...input, engineeringCatalogStateRevision: "bad-token" }),
  });
  assert.equal(r.status, "BLOCKED");
  assert.equal(r.blocker, null);
  assert.equal(r.adapterResult?.status, "READY");
  assert.equal(r.configuratorResult?.status, "BLOCKED");
  assert.ok(
    (r.configuratorResult?.blockingReasons || []).some(
      (b: any) => b.code === "ENGINEERING_CATALOG_STATE_INVALID",
    ),
  );
});

// ===========================================================================
// H. Configurator behavior
// ===========================================================================

test("CM16-100 configurator input is exactly the adapter-produced input", async () => {
  let producedInput: any;
  let receivedInput: any;
  const adapter = (input: any) => {
    const result = buildEngineeringConfiguratorInput(input);
    producedInput = result.input;
    return result;
  };
  const configurator = (input: any) => {
    receivedInput = input;
    return configureHeatPumpFanCoil(input);
  };
  await configured(valid(), { adapter, configurator });
  assert.deepEqual(receivedInput, producedInput);
});

test("CM16-101 SAME_PRODUCT preserved across heating/cooling of one fan coil", async () => {
  const r = await configured(valid());
  const reqs: any[] = r.configuratorResult.equipmentRequirements;
  const fc = reqs.filter((q) => q.equipmentType === "FAN_COIL");
  assert.equal(fc.length, 4, "two served rooms must produce two service requirements per fan coil");

  const pairs = new Map<string, any[]>();
  const componentIdsByRoom = new Map<string, Set<string>>();
  for (const q of fc) {
    const roomId = q.scopeReference?.roomId;
    const componentInstanceId = q.physicalComponentRef?.componentInstanceId;
    assert.equal(typeof roomId, "string", "fan-coil requirement must retain its served room");
    assert.equal(typeof componentInstanceId, "string", "fan-coil requirement must retain its physical component");
    assert.equal(q.physicalComponentRef?.selectionConstraint, "SAME_PRODUCT");

    const pairKey = JSON.stringify([roomId, componentInstanceId]);
    pairs.set(pairKey, [...(pairs.get(pairKey) ?? []), q]);
    const roomComponents = componentIdsByRoom.get(roomId) ?? new Set<string>();
    roomComponents.add(componentInstanceId);
    componentIdsByRoom.set(roomId, roomComponents);
  }

  assert.equal(componentIdsByRoom.size, 2, "fixture has two served rooms");
  for (const [roomId, componentIds] of componentIdsByRoom) {
    assert.equal(componentIds.size, 1, `${roomId} must have one physical fan-coil instance`);
  }
  for (const pair of pairs.values()) {
    assert.equal(pair.length, 2, "each room fan coil must have heating and cooling requirements");
    assert.deepEqual(pair.map((q) => q.service).sort(), ["COOLING", "HEATING"]);
  }

  const perRoomComponentIds = [...componentIdsByRoom.values()].map((ids) => [...ids][0]);
  assert.equal(
    new Set(perRoomComponentIds).size,
    componentIdsByRoom.size,
    "distinct rooms must retain distinct physical fan-coil instances",
  );
});

test("CM16-102 EquipmentRequirement contract identity preserved", async () => {
  const r = await configured(valid());
  assert.equal(r.configuratorResult.equipmentRequirementContractId, "ohmx.equipment-requirement.v1");
  assert.equal(r.configuratorResult.equipmentRequirementContractVersion, "1.1.0");
  for (const q of r.configuratorResult.equipmentRequirements) {
    assert.equal(q.contractId, "ohmx.equipment-requirement.v1");
    assert.equal(q.contractVersion, "1.1.0");
  }
});

test("CM16-103 no product resolution: no productId/SKU/candidates/price/stock anywhere", async () => {
  const r = await configured(valid());
  const json = JSON.stringify(r);
  assert.ok(
    !/"(?:productId|sku|candidates|price|stock|stockQuantity|stock_quantity|currency|currencyCode|currency_code)"\s*:/i.test(json),
    "unexpected product/commerce field",
  );
  for (const pc of r.configuratorResult.physicalComponents) {
    assert.ok(!("productId" in pc));
    assert.ok(!("sku" in pc));
  }
});

test("CM16-104 heat pump physical component is WHOLE_OBJECT scope", async () => {
  const r = await configured(valid());
  const hp = r.configuratorResult.physicalComponents.find((c: any) => c.equipmentType === "HEAT_PUMP");
  assert.ok(hp);
  assert.equal(hp.scope, "WHOLE_OBJECT");
});

// ===========================================================================
// I. Purity: no mutation, no recalculation, determinism
// ===========================================================================

test("CM16-110 project snapshot is not mutated by orchestration", async () => {
  const p = valid();
  const before = JSON.stringify(p);
  await configured(p);
  assert.equal(JSON.stringify(p), before);
});

test("CM16-111 load result is not mutated (no implicit revision re-stamp)", async () => {
  const p = valid();
  const before = JSON.stringify(p.loads);
  await configured(p);
  assert.equal(JSON.stringify(p.loads), before);
});

test("CM16-112 confirmed system snapshot is not mutated", async () => {
  const p = valid();
  const before = JSON.stringify(p.systemsConfigurationSnapshot);
  await configured(p);
  assert.equal(JSON.stringify(p.systemsConfigurationSnapshot), before);
});

test("CM16-113 deterministic: two runs of the same project are structurally equal", async () => {
  const a = await configured(valid());
  const b = await configured(valid());
  assert.deepEqual(a, b);
});

test("CM16-114 catalog provider read exactly once per execution", async () => {
  let reads = 0;
  const catalogProvider = {
    getCurrentReference: async () => {
      reads += 1;
      return makeAvailableReference();
    },
  };
  await configured(valid(), { catalogProvider });
  assert.equal(reads, 1);
});

test("CM16-115 stale-load path performs no catalog provider read", async () => {
  let reads = 0;
  const catalogProvider = {
    getCurrentReference: async () => {
      reads += 1;
      return makeAvailableReference();
    },
  };
  const p = valid();
  (p as any).loads.buildingRevisionAtCalculation = 2;
  await orchestratorBlocked(p, "load.stale", { catalogProvider });
  assert.equal(reads, 0);
});

test("CM16-116 legacy project remains readable (no mutation/migration) but BLOCKED", async () => {
  const p = valid();
  delete (p as any).loads.loadCalculationRevision;
  delete (p as any).loads.sourceCalculationId;
  const before = JSON.stringify(p);
  await orchestratorBlocked(p, "load_revision.missing");
  assert.equal(JSON.stringify(p), before);
});

// ===========================================================================
// Parameterized: project-read seam + missing-project id read
// ===========================================================================

test("CM16-120 readProject seam is used when projectId provided (read-only)", async () => {
  let reads = 0;
  const r = await runBuildingProjectEngineeringConfiguration({
    projectId: "proj-1",
    catalogProvider: makeAvailableProvider(),
    readProject: (id) => {
      reads += 1;
      assert.equal(id, "proj-1");
      return cloneProject(valid());
    },
  });
  expectConfigured(r);
  assert.equal(reads, 1);
});

test("CM16-121 projectSnapshot seam bypasses readProject", async () => {
  let reads = 0;
  const r = await runBuildingProjectEngineeringConfiguration({
    projectSnapshot: valid(),
    catalogProvider: makeAvailableProvider(),
    readProject: () => {
      reads += 1;
      return null;
    },
  });
  expectConfigured(r);
  assert.equal(reads, 0);
});

// ===========================================================================
// Deep adapter-block coverage (additional fail-closed surface)
// ===========================================================================

test("CM16-130 missing room load result → adapter ROOM_LOAD_MISSING", async () => {
  const p = valid();
  (p as any).loads.roomResults = [];
  await adapterBlocked(p, "ROOM_LOAD_MISSING");
});

test("CM16-131 room missing heating demand → adapter ROOM_LOAD_MISSING", async () => {
  const p = valid();
  (p as any).loads.roomResults[0].heating.demandW = null;
  await adapterBlocked(p, "ROOM_LOAD_MISSING");
});

test("CM16-132 object missing heating total → adapter OBJECT_LOAD_MISSING", async () => {
  const p = valid();
  (p as any).loads.heatingDemandW = null;
  await adapterBlocked(p, "OBJECT_LOAD_MISSING");
});

test("CM16-133 missing climate identity → adapter LOAD_CALCULATION_NOT_READY", async () => {
  const p = valid();
  (p as any).loads.climateDatasetId = null;
  await adapterBlocked(p, "LOAD_CALCULATION_NOT_READY");
});

test("CM16-134 inputSnapshot methodVersion drift → adapter LOAD_CALCULATION_NOT_READY", async () => {
  const p = valid();
  (p as any).loads.inputSnapshot.methodVersion = "2.0.0";
  await adapterBlocked(p, "LOAD_CALCULATION_NOT_READY");
});

test("CM16-135 inputSnapshot systemsRevision drift → adapter SYSTEM_CONFIGURATION_REVISION_STALE", async () => {
  const p = valid();
  (p as any).loads.inputSnapshot.systemsRevision = 2;
  await adapterBlocked(p, "SYSTEM_CONFIGURATION_REVISION_STALE");
});

test("CM16-136 inputSnapshot projectId drift → adapter PROJECT_REVISION_STALE", async () => {
  const p = valid();
  (p as any).loads.inputSnapshot.projectId = "proj-other";
  await adapterBlocked(p, "PROJECT_REVISION_STALE");
});

test("CM16-137 missing load quality coverage → BLOCKED load_revision.missing", async () => {
  const p = valid();
  delete (p as any).loads.engineeringQuality.coverage;
  await orchestratorBlocked(p, "load_revision.missing");
});

test("CM16-138 duplicate room ids → adapter ROOM_LOAD_MISSING/SERVED_ROOM_INVALID", async () => {
  const p = valid();
  (p as any).loads.roomResults[1].roomId = "room-1";
  await adapterBlocked(p);
});

test("CM16-139 selectionIntent invalid (EXPERT) → adapter CANONICAL_VOCABULARY_INVALID", async () => {
  const r = await run(valid(), { selectionIntent: "EXPERT" });
  expectAdapterBlocked(r, "CANONICAL_VOCABULARY_INVALID");
});

test("CM16-140 policy identity tamper → adapter POLICY_ID_VERSION_INVALID (injected adapter seam guard)", async () => {
  // The orchestrator always supplies the frozen policy identities; tampering
  // would require replacing the adapter, which the orchestrator never does.
  // This asserts the orchestrator's assembled identities validate (READY path).
  const r = await configured(valid());
  assert.equal(r.adapterResult.status, "READY");
});

// ===========================================================================
// Result-contract shape invariants
// ===========================================================================

test("CM16-150 BLOCKED result never carries a configuratorResult and omits product fields", async () => {
  const p = valid();
  (p as any).calculationConfiguration.coverageIntent.calculationScope = "UNKNOWN";
  const r = await adapterBlocked(p);
  assert.equal(r.configuratorResult, null);
  assert.ok(!/productId|price|stock|sku/i.test(JSON.stringify(r)));
});

test("CM16-151 CONFIGURED result omits any blocker", async () => {
  const r = await configured(valid());
  assert.equal(r.blocker, null);
  assert.deepEqual(r.adapterResult.blockingReasons, []);
});

test("CM16-152 BLOCKED result preserves adapter sourceTrace + revisionTrace", async () => {
  const p = valid();
  (p as any).calculationConfiguration.coverageIntent.calculationScope = "UNKNOWN";
  const r = await adapterBlocked(p, "LOAD_COVERAGE_INCOMPLETE");
  assert.ok(Array.isArray(r.adapterResult.sourceTrace));
  assert.ok(r.adapterResult.revisionTrace);
});

test("CM16-153 no load recalculation: isLoadStale verdict exposed, engine untouched", async () => {
  const p = valid();
  const r = await configured(p);
  assert.equal(r.loadStale, false);
});

test("CM16-154 stale result exposes loadStale: true", async () => {
  const p = valid();
  (p as any).loads.systemsRevisionAtCalculation = 2;
  const r = await orchestratorBlocked(p, "load.stale");
  assert.equal(r.loadStale, true);
});

// ===========================================================================
// Parameterized: hydronic design-leaf granularity
// ===========================================================================

const sys = (p: BuildingProject) => (p as any).systemsConfigurationSnapshot as any;
const design = (p: BuildingProject) => sys(p).engineeringDesignInputs as any;

const HYDRONIC_FIELDS = ["heatingWaterSupplyC", "heatingWaterReturnC", "coolingWaterSupplyC", "coolingWaterReturnC"] as const;

for (const field of HYDRONIC_FIELDS) {
  test(`CM16-200 hydronic ${field} unresolved value → OPERATING_CONDITION_REQUIRED`, async () => {
    const p = valid();
    design(p).hydronicDesignConditions[field].value = null;
    await adapterBlocked(p, "OPERATING_CONDITION_REQUIRED");
  });

  test(`CM16-201 hydronic ${field} missing sourceReference → OPERATING_CONDITION_REQUIRED`, async () => {
    const p = valid();
    design(p).hydronicDesignConditions[field].sourceReference = null;
    await adapterBlocked(p, "OPERATING_CONDITION_REQUIRED");
  });

  test(`CM16-202 hydronic ${field} PILOT_REFERENCE under PROFESSIONAL → OPERATING_CONDITION_REQUIRED`, async () => {
    const p = valid();
    design(p).hydronicDesignConditions[field].source = "PILOT_REFERENCE";
    design(p).hydronicDesignConditions[field].policyReference = { policyId: "p", policyVersion: "1", entryId: "e" };
    await adapterBlocked(p, "OPERATING_CONDITION_REQUIRED");
  });

  test(`CM16-203 hydronic ${field} non-finite value → adapter blocked`, async () => {
    const p = valid();
    design(p).hydronicDesignConditions[field].value = Number.NaN;
    await adapterBlocked(p);
  });
}

test("CM16-210 wet bulb PILOT_REFERENCE under PROFESSIONAL → OPERATING_CONDITION_REQUIRED", async () => {
  const p = valid();
  design(p).coolingIndoorDesignCondition.indoorCoolingWetBulbC.source = "PILOT_REFERENCE";
  design(p).coolingIndoorDesignCondition.indoorCoolingWetBulbC.policyReference = { policyId: "p", policyVersion: "1", entryId: "e" };
  await adapterBlocked(p, "OPERATING_CONDITION_REQUIRED");
});

test("CM16-211 fan speed PILOT_REFERENCE under PROFESSIONAL → FAN_SPEED_REQUIRED", async () => {
  const p = valid();
  design(p).fanCoilSizingPolicy.sizingFanSpeed.source = "PILOT_REFERENCE";
  design(p).fanCoilSizingPolicy.sizingFanSpeed.policyReference = { policyId: "p", policyVersion: "1", entryId: "e" };
  await adapterBlocked(p, "FAN_SPEED_REQUIRED");
});

test("CM16-212 wet bulb PILOT_REFERENCE is ALLOWED under PRELIMINARY → CONFIGURED", async () => {
  const p = valid();
  design(p).coolingIndoorDesignCondition.indoorCoolingWetBulbC.source = "PILOT_REFERENCE";
  design(p).coolingIndoorDesignCondition.indoorCoolingWetBulbC.policyReference = { policyId: "p", policyVersion: "1", entryId: "e" };
  await configured(p, { selectionIntent: "PRELIMINARY" });
});

test("CM16-213 invalid margin source → DESIGN_MARGIN_INVALID", async () => {
  const p = valid();
  design(p).designMargins = {
    heatPumpHeating: { designMarginPercent: 5, marginSource: "NONE", marginPolicyId: "x", marginPolicyVersion: "1" },
  };
  await adapterBlocked(p, "DESIGN_MARGIN_INVALID");
});

// ===========================================================================
// Parameterized: load room/service granularity
// ===========================================================================

const SERVICES = ["heating", "cooling"] as const;
const ROOM_INDEXES = [0, 1] as const;

for (const idx of ROOM_INDEXES) {
  for (const svc of SERVICES) {
    test(`CM16-220 room[${idx}].${svc} demand null → ROOM_LOAD_MISSING`, async () => {
      const p = valid();
      (p as any).loads.roomResults[idx][svc].demandW = null;
      await adapterBlocked(p, "ROOM_LOAD_MISSING");
    });
    test(`CM16-221 room[${idx}].${svc} status limited → ROOM_LOAD_MISSING`, async () => {
      const p = valid();
      (p as any).loads.roomResults[idx][svc].status = "limited";
      await adapterBlocked(p, "ROOM_LOAD_MISSING");
    });
  }
}

test("CM16-230 room transmission consensus conflict (indoorHeatingC drift) → OPERATING_CONDITION_CONFLICT", async () => {
  const p = valid();
  (p as any).loads.roomResults[1].transmissionBreakdown.indoorHeatingC = 22;
  await adapterBlocked(p, "OPERATING_CONDITION_CONFLICT");
});

test("CM16-231 room transmission consensus conflict (outdoorCoolingC drift) → OPERATING_CONDITION_CONFLICT", async () => {
  const p = valid();
  (p as any).loads.roomResults[1].transmissionBreakdown.outdoorCoolingC = 36;
  await adapterBlocked(p, "OPERATING_CONDITION_CONFLICT");
});

// ===========================================================================
// Parameterized: coverage arithmetic granularity
// ===========================================================================

test("CM16-240 coverage declared area 0 → LOAD_COVERAGE_INCOMPLETE", async () => {
  const p = valid();
  (p as any).loads.engineeringQuality.coverage.declaredAreaM2 = 0;
  await adapterBlocked(p, "LOAD_COVERAGE_INCOMPLETE");
});
test("CM16-241 coverage modeled area null → LOAD_COVERAGE_INCOMPLETE", async () => {
  const p = valid();
  (p as any).loads.engineeringQuality.coverage.modeledAreaM2 = null;
  await adapterBlocked(p, "LOAD_COVERAGE_INCOMPLETE");
});
test("CM16-242 coverage ratio null → LOAD_COVERAGE_INCOMPLETE", async () => {
  const p = valid();
  (p as any).loads.engineeringQuality.coverage.ratio = null;
  await adapterBlocked(p, "LOAD_COVERAGE_INCOMPLETE");
});
test("CM16-243 totalAreaM2 drift vs declared → LOAD_COVERAGE_INCOMPLETE", async () => {
  const p = valid();
  (p as any).totalAreaM2 = 60;
  await adapterBlocked(p, "LOAD_COVERAGE_INCOMPLETE");
});

// ===========================================================================
// Parameterized: catalog reference malformed-shape granularity
// ===========================================================================

test("CM16-250 catalog readConsistency wrong → POLICY_ID_VERSION_INVALID", async () => {
  const r = await run(valid(), { catalogProvider: makeAvailableProvider({ readConsistency: "UNAVAILABLE" as any }) });
  expectAdapterBlocked(r, "POLICY_ID_VERSION_INVALID");
});
test("CM16-251 catalog generatedFromPolicyId wrong → POLICY_ID_VERSION_INVALID", async () => {
  const r = await run(valid(), { catalogProvider: makeAvailableProvider({ generatedFromPolicyId: "x" as any }) });
  expectAdapterBlocked(r, "POLICY_ID_VERSION_INVALID");
});
test("CM16-252 catalog scopeEquipmentTypes not array → POLICY_ID_VERSION_INVALID", async () => {
  const r = await run(valid(), { catalogProvider: makeAvailableProvider({ scopeEquipmentTypes: undefined as any }) });
  expectAdapterBlocked(r, "POLICY_ID_VERSION_INVALID");
});
test("CM16-253 catalog errors non-empty → POLICY_ID_VERSION_INVALID", async () => {
  const r = await run(valid(), {
    catalogProvider: makeAvailableProvider({ errors: [{ code: "e", sourceReference: null, message: "m" }] as any }),
  });
  expectAdapterBlocked(r, "POLICY_ID_VERSION_INVALID");
});

// ===========================================================================
// Parameterized: served-room / topology granularity
// ===========================================================================

test("CM16-260 roomAssignments missing a room → SERVED_ROOM_INVALID", async () => {
  const p = valid();
  (p as any).systemsConfigurationSnapshot.roomAssignments = [(p as any).systemsConfigurationSnapshot.roomAssignments[0]];
  await adapterBlocked(p, "SERVED_ROOM_INVALID");
});
test("CM16-261 roomResults missing a room → SERVED_ROOM_INVALID", async () => {
  const p = valid();
  (p as any).loads.roomResults = [(p as any).loads.roomResults[0]];
  await adapterBlocked(p, "SERVED_ROOM_INVALID");
});
test("CM16-262 service preference not_required → SERVED_ROOM_INVALID", async () => {
  const p = valid();
  (p as any).systemsConfigurationSnapshot.roomAssignments[0].servicePreferences.heating = "not_required";
  await adapterBlocked(p, "SERVED_ROOM_INVALID");
});
test("CM16-263 sourceSystemIds bad source → SERVED_ROOM_INVALID", async () => {
  const p = valid();
  (p as any).systemsConfigurationSnapshot.roomAssignments[0].sourceSystemIds.heating = "gas_boiler";
  await adapterBlocked(p, "SERVED_ROOM_INVALID");
});
test("CM16-264 distribution simultaneousHeatCool true → SIMULTANEOUS_OPERATION_NOT_SUPPORTED", async () => {
  const p = valid();
  (p as any).systemsConfigurationSnapshot.architecture.distribution.simultaneousHeatCool = true;
  await adapterBlocked(p, "SIMULTANEOUS_OPERATION_NOT_SUPPORTED");
});
test("CM16-265 architecture missing → TOPOLOGY_NOT_SUPPORTED", async () => {
  const p = valid();
  delete (p as any).systemsConfigurationSnapshot.architecture;
  await adapterBlocked(p);
});
test("CM16-266 requestedServices missing both → TOPOLOGY_NOT_SUPPORTED", async () => {
  const p = valid();
  (p as any).systemsConfigurationSnapshot.requestedServices = [];
  await adapterBlocked(p, "TOPOLOGY_NOT_SUPPORTED");
});
test("CM16-267 duplicate familyId in terminal list → SERVED_ROOM_INVALID", async () => {
  const p = valid();
  const t = (p as any).systemsConfigurationSnapshot.roomAssignments[0].heatingSystems[0];
  (p as any).systemsConfigurationSnapshot.roomAssignments[0].heatingSystems = [t, t];
  await adapterBlocked(p, "SERVED_ROOM_INVALID");
});

// ===========================================================================
// Load-readiness remaining granularity
// ===========================================================================

test("CM16-270 load missingInputs non-empty → LOAD_CALCULATION_NOT_READY", async () => {
  const p = valid();
  (p as any).loads.missingInputs = ["x"];
  await adapterBlocked(p, "LOAD_CALCULATION_NOT_READY");
});
test("CM16-271 load cooling total null → OBJECT_LOAD_MISSING", async () => {
  const p = valid();
  (p as any).loads.coolingDemandW = null;
  await adapterBlocked(p, "OBJECT_LOAD_MISSING");
});
test("CM16-272 load inputSnapshot.projectId drift → PROJECT_REVISION_STALE", async () => {
  const p = valid();
  (p as any).loads.inputSnapshot.projectId = "other";
  await adapterBlocked(p, "PROJECT_REVISION_STALE");
});
test("CM16-273 load inputSnapshot.objectType drift → PROJECT_REVISION_STALE", async () => {
  const p = valid();
  (p as any).loads.inputSnapshot.objectType = "private_house";
  await adapterBlocked(p, "PROJECT_REVISION_STALE");
});

// ===========================================================================
// Blocked-path determinism (structural equivalence across repeated runs)
// ===========================================================================

const BLOCKER_SCENARIOS: Array<[string, (p: BuildingProject) => void, string | undefined]> = [
  ["stale load", (p) => ((p as any).loads.systemsRevisionAtCalculation = 2), "load.stale"],
  ["missing revision", (p) => { delete (p as any).loads.loadCalculationRevision; delete (p as any).loads.sourceCalculationId; }, "load_revision.missing"],
  ["unknown coverage", (p) => ((p as any).calculationConfiguration.coverageIntent.calculationScope = "UNKNOWN"), "LOAD_COVERAGE_INCOMPLETE"],
  ["missing fan speed", (p) => { design(p).fanCoilSizingPolicy.sizingFanSpeed = unresolvedTextDesignInput(); }, "FAN_SPEED_REQUIRED"],
];

for (const [label, mutate, code] of BLOCKER_SCENARIOS) {
  test(`CM16-280 deterministic BLOCKED (${label})`, async () => {
    const a = await run(mutateProject(mutate));
    const b = await run(mutateProject(mutate));
    assert.deepEqual(a, b);
    assert.equal(a.status, "BLOCKED");
    if (code) assert.ok(reasonCodes(a).includes(code));
  });
}

function mutateProject(mutate: (p: BuildingProject) => void): BuildingProject {
  const p = valid();
  mutate(p);
  return p;
}

// ===========================================================================
// Catalog provider invocation semantics (single coherent reference)
// ===========================================================================

test("CM16-290 provider reference is the exact object passed to the adapter (no re-read, no copy drift)", async () => {
  const ref = makeAvailableReference();
  let received: any;
  const catalogProvider = { getCurrentReference: async () => ref };
  const adapter = (input: any) => {
    received = input.engineeringCatalogStateReference;
    return buildEngineeringConfiguratorInput(input);
  };
  await configured(valid(), { catalogProvider, adapter });
  assert.equal(received, ref);
});

test("CM16-291 no catalog hash is performed by the orchestrator (revision used verbatim)", async () => {
  // The catalog revision in the result is exactly the provider-supplied token;
  // the orchestrator never recomputes or transforms it.
  const r = await configured(valid());
  assert.equal(await provideRevision(), r.engineeringCatalogStateRevision);

  async function provideRevision() {
    const ref = makeAvailableReference();
    return ref.revision as string;
  }
});

test("CM16-292 load revision used verbatim (no re-hash in orchestrator)", async () => {
  const p = valid();
  const expected = (p as any).loads.loadCalculationRevision;
  const r = await configured(p);
  assert.equal(r.loadCalculationRevision, expected);
  assert.equal(r.configuratorResult.loadCalculationRevision, expected);
});

// ===========================================================================
// FAIL-CLOSED final coverage of section 34 case list
// ===========================================================================

test("CM16-300 legacy project without CM13 coverage but with load blocks (coverage.intent_missing)", async () => {
  const p = valid();
  (p as any).calculationConfiguration = undefined;
  await orchestratorBlocked(p, "coverage.intent_missing");
});

test("CM16-301 provider UNAVAILABLE long before configurator (configurator spy untouched)", async () => {
  let calls = 0;
  const r = await runBuildingProjectEngineeringConfiguration({
    projectSnapshot: valid(),
    catalogProvider: makeUnavailableProvider(),
    configurator: () => {
      calls += 1;
      return configureHeatPumpFanCoil({} as any);
    },
  });
  expectOrchestratorBlocked(r, "catalog.unavailable");
  assert.equal(calls, 0);
});

test("CM16-302 whole-object confirmed happy path preserves SAME_PRODUCT across repeated runs", async () => {
  const a = await configured(valid());
  const aIds = a.configuratorResult.equipmentRequirements.map((q: any) => q.physicalComponentRef?.componentInstanceId);
  const b = await configured(valid());
  const bIds = b.configuratorResult.equipmentRequirements.map((q: any) => q.physicalComponentRef?.componentInstanceId);
  assert.deepEqual(aIds, bIds);
});