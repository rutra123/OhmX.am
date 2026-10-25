/**
 * CM11 adapter test fixtures — DELIBERATELY SYNTHETIC, future-complete typed
 * snapshots that a correct adapter returns READY for. They are test inputs, NOT
 * observed live projects; no current live Building Project is READY (§6).
 *
 * The load revision reference is built from the same canonical projection the
 * adapter compares against, so the fixed token + matching canonicalFacts is a
 * valid externally-supplied reference. CM11 hashes nothing here.
 */
import type {
  BuildingProjectConfiguratorAdapterInput,
  AdapterBuildingProject,
  AdapterLoadCalculation,
  AdapterSystemConfiguration,
  AdapterObjectSnapshot,
  AdapterLoadInputSnapshot,
  CoverageIntent,
  SystemEngineeringDesignInputs,
  LoadRevisionReference,
  EngineeringCatalogStateReference,
  AdapterPolicyIdentities,
} from "./types.js";
import type { MatcherRequestPolicySnapshot } from "../engineeringConfigurator/equipmentRequirementTypes.js";
import { materializeMargins } from "./operatingInputs.js";
import { projectCanonicalLoadFacts } from "./loadRevision.js";

export const PROJ_ID = "proj-1";
export const LOAD_TOKEN = `load:sha256:${"a".repeat(64)}`;
export const CATALOG_TOKEN = `engineering-catalog-state:sha256:${"b".repeat(64)}`;

const ROOMS = [
  { id: "room-1", roomType: "living", name: "Living", areaM2: 20 },
  { id: "room-2", roomType: "bedroom", name: "Bedroom", areaM2: 30 },
] as const;
const TOTAL_AREA_M2 = 50;
const TEMPS = { indoorHeatingC: 21, indoorCoolingC: 24, outdoorHeatingC: -10, outdoorCoolingC: 35 };

function numLeaf(value: number, source: "USER_INPUT" | "SYSTEM_POLICY" | "PILOT_REFERENCE" = "USER_INPUT") {
  return {
    value,
    unit: "°C",
    source,
    sourceReference: "design-ref-1",
    status: "RESOLVED",
    policyReference: source === "USER_INPUT" ? null : { policyId: "ohmx.policy.demo", policyVersion: "1.0.0", entryId: "entry-1" },
  };
}
function textLeaf(value: string, source: "USER_INPUT" | "SYSTEM_POLICY" | "PILOT_REFERENCE" = "USER_INPUT") {
  return {
    value,
    unit: null,
    source,
    sourceReference: "design-ref-1",
    status: "RESOLVED",
    policyReference: source === "USER_INPUT" ? null : { policyId: "ohmx.policy.demo", policyVersion: "1.0.0", entryId: "entry-1" },
  };
}

function makeDesign(): SystemEngineeringDesignInputs {
  return {
    hydronicDesignConditions: {
      heatingWaterSupplyC: numLeaf(45),
      heatingWaterReturnC: numLeaf(35),
      coolingWaterSupplyC: numLeaf(7),
      coolingWaterReturnC: numLeaf(12),
    },
    coolingIndoorDesignCondition: { indoorCoolingWetBulbC: numLeaf(18) },
    fanCoilSizingPolicy: { sizingFanSpeed: textLeaf("MED") },
    // designMargins intentionally absent -> sanctioned 0/NONE for all four groups.
  } as SystemEngineeringDesignInputs;
}

function makeIntent(): CoverageIntent {
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

function makeSystem(objectType: string): AdapterSystemConfiguration {
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
  void objectType;
  return system as unknown as AdapterSystemConfiguration;
}

function makeLoad(objectType: string): AdapterLoadCalculation {
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
      requestedLevel: 2,
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
      objectType,
      region: null,
      defaultCeilingHeightM: 2.7,
      insulationLevel: "average",
      topology: null,
      rooms: ROOMS.map((r) => ({ id: r.id, roomType: r.roomType, name: r.name, areaM2: r.areaM2, floorId: null, ceilingHeightOverrideM: null, insulationOverride: null, conditions: [], windows: { glazingType: null, count: null, areaM2: null } })),
      requestedServices: ["heating", "cooling"],
      servicePreferences: ROOMS.map((r) => ({ roomId: r.id, heating: "required", cooling: "required" })),
      buildingRevision: 1,
      systemsRevision: 1,
      mode: "steady_state",
      methodVersion: "1.0.0",
      calculationConfiguration: { coverageIntent: makeIntent() },
      systemEngineeringDesignInputs: makeDesign(),
    },
  };
  return load as unknown as AdapterLoadCalculation;
}

function makeSnap(objectType: string): AdapterObjectSnapshot {
  return {
    frozenAt: "2024-01-01T00:00:00Z",
    buildingRevision: 1,
    name: "Demo",
    objectType,
    region: null,
    totalAreaM2: TOTAL_AREA_M2,
    defaultCeilingHeightM: 2.7,
    insulationLevel: "average",
    topology: null,
    rooms: ROOMS.map((r) => ({ id: r.id, roomType: r.roomType, name: r.name, areaM2: r.areaM2, floorId: null, extras: { geometry: {}, windows: {}, conditions: [], engineeringUse: "stored_only" } })),
    roomCount: 2,
    sumRoomAreaM2: TOTAL_AREA_M2,
    calculationConfiguration: { coverageIntent: makeIntent() },
  } as unknown as AdapterObjectSnapshot;
}

/** Fresh policy identity object per call — never shared across fixtures. */
function makePolicyIdentities(): AdapterPolicyIdentities {
  return {
    adapterContract: { id: "ohmx.building-project-configurator-adapter.v1", version: "1.0.0" },
    topologyPolicy: { id: "ohmx.engineering-configurator.heat-pump-fan-coil.v1", version: "1.1.0" },
    equipmentRequirementContract: { id: "ohmx.equipment-requirement.v1", version: "1.1.0" },
    genericRequirementPolicy: { id: "ohmx.engineering-configurator-policy.v1", version: "1.0.0" },
    qualityModel: { id: "ohmx.professional-quality.v1", version: "1.0.0" },
    engineeringSchema: { id: "ohmx.engineering-product.v1", version: "1.0.0" },
    matcherModel: { id: "ohmx.catalog-matcher.v1", version: "1.0.0" },
    matcherPolicy: { id: "ohmx.catalog-matcher-policy.v1", version: "1.0.0" },
  };
}

/** Fresh matcher request policy object per call — never shared across fixtures. */
function makeMatcherPolicy(): MatcherRequestPolicySnapshot {
  return {
    matcherModelId: "ohmx.catalog-matcher.v1",
    matcherModelVersion: "1.0.0",
    engineeringSchemaVersion: "1.0.0",
    matcherPolicyId: "ohmx.catalog-matcher-policy.v1",
    matcherPolicyVersion: "1.0.0",
    requiredVerificationTier: "ANY_KNOWN",
    requireExactOperatingPoint: true,
    allowInterpolation: false,
    allowExtrapolation: false,
    maxCandidates: 10,
    maxDiagnosticResults: 20,
  };
}

export interface FixtureOptions {
  objectType?: "apartment" | "private_house";
  selectionIntent?: "PRELIMINARY" | "PROFESSIONAL";
  maximumEligibleLevel?: number;
  commerceStateRevision?: never;
}

export function makeValidInput(options: FixtureOptions = {}): BuildingProjectConfiguratorAdapterInput {
  const objectType = options.objectType ?? "apartment";
  const selectionIntent = options.selectionIntent ?? "PROFESSIONAL";
  const system = makeSystem(objectType);
  const load = makeLoad(objectType);
  if (options.maximumEligibleLevel !== undefined) {
    (load.engineeringQuality as { maximumEligibleLevel: number }).maximumEligibleLevel = options.maximumEligibleLevel;
  }

  const design = materializeMargins(system.engineeringDesignInputs)!;
  const canonicalFacts = projectCanonicalLoadFacts(load, PROJ_ID, objectType, makeIntent(), design);
  const loadReference: LoadRevisionReference = {
    status: "AVAILABLE",
    revision: LOAD_TOKEN,
    sourceCalculationId: LOAD_TOKEN,
    algorithmVersion: "ohmx.building-project-load-canonical-json.v1",
    canonicalFacts,
    errors: [],
  };
  const catalogReference: EngineeringCatalogStateReference = {
    status: "AVAILABLE",
    revision: CATALOG_TOKEN,
    generatedFromPolicyId: "ohmx.engineering-configurator.heat-pump-fan-coil.v1",
    generatedFromPolicyVersion: "1.1.0",
    algorithmVersion: "ohmx.engineering-catalog-state-canonical-json.v1",
    scopeEquipmentTypes: ["FAN_COIL", "HEAT_PUMP"],
    readConsistency: "COMPLETE_COHERENT_SNAPSHOT",
    warnings: [],
    errors: [],
  };

  const project = {
    id: PROJ_ID,
    name: "Demo project",
    status: "systems_configured",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    objectConfirmedAt: "2024-01-01T00:00:00Z",
    objectConfirmedRevision: 1,
    buildingRevision: 1,
    objectType,
    region: null,
    totalAreaM2: TOTAL_AREA_M2,
    defaultCeilingHeightM: 2.7,
    insulationLevel: "average",
    topology: null,
    rooms: ROOMS.map((r) => ({ id: r.id, roomType: r.roomType, name: r.name, areaM2: r.areaM2, floorId: null, extras: { geometry: {}, windows: {}, conditions: [], engineeringUse: "stored_only" } })),
    selectedSystems: [],
    systemsRevision: 1,
    systemsConfiguration: system,
    systemsConfigurationSnapshot: system,
    objectConfirmedSnapshot: makeSnap(objectType),
    loads: load,
    calculationConfiguration: { coverageIntent: makeIntent() },
  } as unknown as AdapterBuildingProject;

  return {
    project,
    loadCalculation: load,
    confirmedSystemSnapshot: system,
    loadRevisionReference: loadReference,
    engineeringCatalogStateReference: catalogReference,
    selectionIntent,
    policyIdentities: makePolicyIdentities(),
    matcherRequestPolicy: makeMatcherPolicy(),
    ...(options.commerceStateRevision ? {} : {}),
  };
}

/** Shared single mutation helper: returns a fresh valid input with `fields` deep-merged at the top. */
export function withOverrides(fields: Partial<BuildingProjectConfiguratorAdapterInput>): BuildingProjectConfiguratorAdapterInput {
  return { ...makeValidInput(), ...fields } as BuildingProjectConfiguratorAdapterInput;
}

/**
 * Recompute the load revision reference canonicalFacts after a test mutates the
 * design inputs or load, so a READY-with-mutation case stays internally consistent.
 */
export function refreshReference(input: BuildingProjectConfiguratorAdapterInput): void {
  const i = input as unknown as { project: { id: string; objectType: string; calculationConfiguration: { coverageIntent: CoverageIntent } }; confirmedSystemSnapshot: AdapterSystemConfiguration; loadCalculation: AdapterLoadCalculation; loadRevisionReference: LoadRevisionReference };
  const design = materializeMargins(i.confirmedSystemSnapshot.engineeringDesignInputs ?? null);
  if (!design) return;
  i.loadRevisionReference.canonicalFacts = projectCanonicalLoadFacts(
    i.loadCalculation,
    i.project.id,
    i.project.objectType,
    i.project.calculationConfiguration.coverageIntent,
    design,
  );
}