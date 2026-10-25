/**
 * CM16 — orchestration test fixtures (TEST SUPPORT ONLY).
 *
 * Builds a fully-current, persisted-shaped Building Project (confirmed object,
 * confirmed systems, whole-object-confirmed coverage, complete engineering
 * design inputs, a fresh eligible steady_state load, and a REAL CM14 revision
 * stamped via produceLoadCalculationRevision) plus catalog-provider doubles.
 *
 * Deliberately synthetic: these are test inputs, not observed live projects.
 * Imported ONLY from *.test.ts files; the orchestrator runtime never imports
 * this module.
 */
import type { BuildingProject } from "../buildingProjectTypes.js";
import { produceLoadCalculationRevision } from "../buildingProjectLoadRevision.js";
import type {
  DeepReadonly,
  EngineeringCatalogStateReference,
} from "../buildingProjectConfiguratorAdapter/types.js";
import type { EngineeringCatalogStateProviderLike } from "./types.js";

export const PROJ_ID = "proj-1";
export const LOAD_TOKEN = `load:sha256:${"a".repeat(64)}`;
export const CATALOG_TOKEN = `engineering-catalog-state:sha256:${"b".repeat(64)}`;

const ROOMS = [
  { id: "room-1", roomType: "living", name: "Living", areaM2: 20 },
  { id: "room-2", roomType: "bedroom", name: "Bedroom", areaM2: 30 },
] as const;
const TOTAL_AREA_M2 = 50;
const TEMPS = { indoorHeatingC: 21, indoorCoolingC: 24, outdoorHeatingC: -10, outdoorCoolingC: 35 };

function numLeaf(value: number) {
  return {
    value,
    unit: "°C",
    source: "USER_INPUT",
    sourceReference: "design-ref-1",
    policyReference: null,
    status: "RESOLVED",
  };
}
function textLeaf(value: string) {
  return {
    value,
    unit: null,
    source: "USER_INPUT",
    sourceReference: "design-ref-1",
    policyReference: null,
    status: "RESOLVED",
  };
}

function makeDesign() {
  return {
    hydronicDesignConditions: {
      heatingWaterSupplyC: numLeaf(45),
      heatingWaterReturnC: numLeaf(35),
      coolingWaterSupplyC: numLeaf(7),
      coolingWaterReturnC: numLeaf(12),
    },
    coolingIndoorDesignCondition: { indoorCoolingWetBulbC: numLeaf(18) },
    fanCoilSizingPolicy: { sizingFanSpeed: textLeaf("MED") },
  };
}

function makeIntent() {
  return {
    calculationScope: "WHOLE_OBJECT",
    coverageConfirmation: "WHOLE_OBJECT_CONFIRMED",
    includedRoomIds: ["room-1", "room-2"],
    excludedRoomIds: [],
    includedZoneIds: [],
    requestedServices: ["heating", "cooling"],
    buildingRevisionAtConfirmation: 1,
    sourceReference: "coverage-ref-1",
  };
}

function terminal(familyId: string) {
  return {
    familyId,
    label: familyId,
    service: "heating_and_cooling",
    kind: "terminal",
    scope: "room_local",
    capabilityStatus: "allowed",
    sourceSystemId: null,
    selectedAt: "2024-01-01T00:00:00Z",
    reasons: [],
  };
}

function makeSystem() {
  const system = {
    projectId: PROJ_ID,
    requestedServices: ["heating", "cooling"],
    simultaneousHeatCoolRequired: false,
    selectedSystemFamilies: [],
    architecture: {
      spaceHeatingSourceId: "reversible_air_to_water_heat_pump",
      spaceCoolingSourceId: "reversible_air_to_water_heat_pump",
      spaceCombinedSourceId: "reversible_air_to_water_heat_pump",
      sources: [],
      distribution: { id: "hydronic_2pipe_heating_cooling", label: "2-pipe", circuitKind: "2pipe", simultaneousHeatCool: false, notes: [] },
      dhw: { status: "not_configured", sourceFamilyId: null, architectureId: null, notes: [] },
      simultaneousHeatCoolSupported: false,
      warnings: [],
    },
    roomAssignments: ROOMS.map((r) => ({
      roomId: r.id,
      roomName: r.name,
      roomPurpose: r.roomType,
      sourceSystemId: null,
      sourceSystemIds: { heating: "reversible_air_to_water_heat_pump", cooling: "reversible_air_to_water_heat_pump" },
      userPreference: null,
      servicePreferences: { heating: "required", cooling: "required" },
      servicePreferenceSource: { heating: "user", cooling: "user" },
      towelRadiatorPreference: "not_required",
      towelRadiatorPreferenceSource: "default",
      heatingSystems: [terminal("fan_coils")],
      coolingSystems: [terminal("fan_coils")],
      status: "allowed",
      warnings: [],
      reasons: [],
    })),
    configurationStatus: "confirmed",
    warnings: [],
    confirmedAt: "2024-01-01T00:00:00Z",
    buildingRevisionAtConfirmation: 1,
    systemsRevisionAtConfirmation: 1,
    systemsRevision: 1,
    engineeringDesignInputs: makeDesign(),
    validation: { ready: true, blockers: [], warnings: [], info: [] },
  };
  return system as unknown as BuildingProject["systemsConfigurationSnapshot"];
}

function makeLoad() {
  const roomResults = ROOMS.map((r, i) => {
    const heat = i === 0 ? 2000 : 3000;
    const cool = i === 0 ? 1600 : 2400;
    return {
      roomId: r.id,
      roomName: r.name,
      roomType: r.roomType,
      floorId: null,
      floorLabel: null,
      areaM2: r.areaM2,
      effectiveCeilingHeightM: 2.7,
      heating: { status: "calculated", demandW: heat, assumptions: [], warnings: [], missingInputs: [] },
      cooling: { status: "calculated", demandW: cool, assumptions: [], warnings: [], missingInputs: [] },
      transmissionBreakdown: { elements: [], heatingW: heat, coolingW: cool, ...TEMPS },
    };
  });
  const load = {
    mode: "steady_state",
    status: "calculated",
    methodId: "ohmx.steady-state.v1",
    methodVersion: "1.0.0",
    buildingRevisionAtCalculation: 1,
    systemsRevisionAtCalculation: 1,
    roomResults,
    heatingDemandW: 5000,
    coolingDemandW: 4000,
    climateDatasetId: "climate-ds-1",
    climateDatasetVersion: "1.0.0",
    climateLocationId: "yerevan",
    warnings: [],
    missingInputs: [],
    assumptions: [],
    engineeringQuality: {
      qualityModelId: "ohmx.professional-quality.v1",
      qualityModelVersion: "1.0.0",
      evaluatedAt: "2024-01-01T00:00:00Z",
      requestedLevel: 3,
      maximumEligibleLevel: 3,
      gateStatus: "PASS",
      coverage: { declaredAreaM2: 50, modeledAreaM2: 50, ratio: 1, scope: "WHOLE_OBJECT", confirmation: "WHOLE_OBJECT_CONFIRMED" },
      fields: [],
      blockingFields: [],
      warnings: [],
      assumptions: [],
    },
    calculatedAt: "2024-01-01T00:00:00Z",
    inputSnapshot: {
      projectId: PROJ_ID,
      objectType: "apartment",
      region: null,
      defaultCeilingHeightM: 2.7,
      insulationLevel: "average",
      topology: null,
      rooms: ROOMS.map((r) => ({
        id: r.id,
        roomType: r.roomType,
        name: r.name,
        areaM2: r.areaM2,
        floorId: null,
        ceilingHeightOverrideM: null,
        insulationOverride: null,
        conditions: [],
        windows: { glazingType: null, count: null, areaM2: null },
      })),
      requestedServices: ["heating", "cooling"],
      servicePreferences: ROOMS.map((r) => ({ roomId: r.id, heating: "required", cooling: "required" })),
      buildingRevision: 1,
      systemsRevision: 1,
      mode: "steady_state",
      methodVersion: "1.0.0",
    },
  };
  return load as unknown as NonNullable<BuildingProject["loads"]>;
}

function makeObjectSnapshot() {
  return {
    frozenAt: "2024-01-01T00:00:00Z",
    buildingRevision: 1,
    name: "Demo",
    objectType: "apartment",
    region: null,
    totalAreaM2: TOTAL_AREA_M2,
    defaultCeilingHeightM: 2.7,
    insulationLevel: "average",
    topology: null,
    rooms: ROOMS.map((r) => ({
      id: r.id,
      roomType: r.roomType,
      name: r.name,
      areaM2: r.areaM2,
      floorId: null,
      extras: { geometry: {}, windows: {}, conditions: [], engineeringUse: "stored_only" },
    })),
    roomCount: 2,
    sumRoomAreaM2: TOTAL_AREA_M2,
  } as unknown as BuildingProject["objectConfirmedSnapshot"];
}

/**
 * Build a fresh, fully-current, persisted-shaped Building Project. The load is
 * stamped with a REAL CM14 revision via produceLoadCalculationRevision, so the
 * returned project is guaranteed internally coherent (identity + canonical facts).
 */
export function makeValidLiveProject(): BuildingProject {
  const system = makeSystem();
  const load = makeLoad();
  const project = {
    id: PROJ_ID,
    name: "Demo project",
    status: "systems_configured",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    objectConfirmedAt: "2024-01-01T00:00:00Z",
    objectConfirmedRevision: 1,
    buildingRevision: 1,
    objectType: "apartment",
    region: null,
    totalAreaM2: TOTAL_AREA_M2,
    defaultCeilingHeightM: 2.7,
    insulationLevel: "average",
    topology: null,
    rooms: ROOMS.map((r) => ({
      id: r.id,
      roomType: r.roomType,
      name: r.name,
      areaM2: r.areaM2,
      floorId: null,
      extras: { geometry: {}, windows: {}, conditions: [], engineeringUse: "stored_only" },
    })),
    selectedSystems: [],
    systemsRevision: 1,
    systemsConfiguration: structuredClone(system),
    systemsConfigurationSnapshot: system,
    objectConfirmedSnapshot: makeObjectSnapshot(),
    loads: load,
    calculationConfiguration: { coverageIntent: makeIntent() },
  } as unknown as BuildingProject;

  // Stamp the real CM14 load identity (test layer only; the orchestrator never hashes).
  const production = produceLoadCalculationRevision(project, load as NonNullable<BuildingProject["loads"]>);
  (load as unknown as { loadCalculationRevision: string }).loadCalculationRevision = production.revision;
  (load as unknown as { sourceCalculationId: string }).sourceCalculationId = production.sourceCalculationId;
  return project;
}

/** Deep-clone a project so tests mutate a detached copy, never the shared fixture. */
export function cloneProject(project: BuildingProject): BuildingProject {
  return structuredClone(project);
}

export function makeAvailableReference(
  overrides: Partial<EngineeringCatalogStateReference> = {},
): EngineeringCatalogStateReference {
  return {
    status: "AVAILABLE",
    revision: CATALOG_TOKEN,
    generatedFromPolicyId: "ohmx.engineering-configurator.heat-pump-fan-coil.v1",
    generatedFromPolicyVersion: "1.1.0",
    algorithmVersion: "ohmx.engineering-catalog-state-canonical-json.v1",
    scopeEquipmentTypes: ["FAN_COIL", "HEAT_PUMP"],
    readConsistency: "COMPLETE_COHERENT_SNAPSHOT",
    warnings: [],
    errors: [],
    ...overrides,
  };
}

export function makeUnavailableReference(errors: { code: string; sourceReference: string | null; message: string }[] = []): EngineeringCatalogStateReference {
  return {
    status: "UNAVAILABLE",
    revision: null,
    generatedFromPolicyId: null,
    generatedFromPolicyVersion: null,
    algorithmVersion: null,
    scopeEquipmentTypes: [],
    readConsistency: "UNAVAILABLE",
    warnings: [],
    errors,
  };
}

export function makeProvider(reference: DeepReadonly<EngineeringCatalogStateReference>): EngineeringCatalogStateProviderLike {
  return { getCurrentReference: async () => reference };
}

export function makeAvailableProvider(overrides: Partial<EngineeringCatalogStateReference> = {}): EngineeringCatalogStateProviderLike {
  return makeProvider(makeAvailableReference(overrides));
}

export function makeUnavailableProvider(): EngineeringCatalogStateProviderLike {
  return makeProvider(makeUnavailableReference([
    { code: "catalog_state_db_open_failed", sourceReference: null, message: "catalog db not found" },
  ]));
}