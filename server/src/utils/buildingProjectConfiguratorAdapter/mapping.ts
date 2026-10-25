/**
 * CM11 adapter — projection of a fully validated context into the exact CM9
 * EngineeringConfiguratorInput leaf tree, plus deterministic source and
 * revision traces. Frozen CM10 §18–19, §29–30, §35.
 */
import type {
  AdapterSourceTraceEntry,
  AdapterSourceKind,
  AdapterRevisionTrace,
  AdapterLoadCalculation,
  AdapterSystemConfiguration,
  DeepReadonly,
  BuildingProjectConfiguratorAdapterInput,
} from "./types.js";
import type {
  EngineeringConfiguratorInput,
  BuildingProjectPolicySnapshot,
  BuildingLoadCalculationPolicySnapshot,
  SystemConfigurationPolicySnapshot,
  RoomLoadPolicySnapshot,
  ServedRoomInput,
  OperatingConditionPolicyInput,
  DesignMarginPolicyInput,
  EngineeringQualitySnapshot,
  ConfiguratorSelectionIntent,
  EngineeringCatalogStateRevision,
  CommerceStateRevision,
} from "../engineeringConfigurator/types.js";
import type { MatcherRequestPolicySnapshot } from "../engineeringConfigurator/equipmentRequirementTypes.js";
import {
  ENGINEERING_CONFIGURATOR_POLICY_ID,
  ENGINEERING_CONFIGURATOR_POLICY_VERSION,
  CM8_SYSTEM_TOPOLOGY,
} from "./policy.js";
import { ADAPTER_CONTRACT_ID, ADAPTER_CONTRACT_VERSION } from "./types.js";
import { canonicalIds, canonicalNumber, compareCodePoints } from "./policy.js";
import type { AdapterContext } from "./validation.js";

function optionalPartial(p: number | null | undefined): { partialDemandW: number | null } | Record<string, never> {
  return p === undefined ? {} : { partialDemandW: p };
}

function roomProjection(load: AdapterLoadCalculation): RoomLoadPolicySnapshot[] {
  return [...load.roomResults]
    .sort((a, b) => compareCodePoints(a.roomId, b.roomId))
    .map((r) => ({
      roomId: r.roomId,
      roomName: r.roomName,
      roomType: r.roomType,
      areaM2: r.areaM2,
      heating: {
        status: r.heating.status,
        demandW: canonicalNumber(r.heating.demandW as number),
        ...optionalPartial(r.heating.partialDemandW),
        warnings: canonicalIds(r.heating.warnings ?? []),
        missingInputs: canonicalIds(r.heating.missingInputs ?? []),
      },
      cooling: {
        status: r.cooling.status,
        demandW: canonicalNumber(r.cooling.demandW as number),
        ...optionalPartial(r.cooling.partialDemandW),
        warnings: canonicalIds(r.cooling.warnings ?? []),
        missingInputs: canonicalIds(r.cooling.missingInputs ?? []),
      },
      transmissionBreakdown: r.transmissionBreakdown
        ? {
            indoorHeatingC: r.transmissionBreakdown.indoorHeatingC,
            indoorCoolingC: r.transmissionBreakdown.indoorCoolingC,
            outdoorHeatingC: r.transmissionBreakdown.outdoorHeatingC,
            outdoorCoolingC: r.transmissionBreakdown.outdoorCoolingC,
          }
        : null,
    }));
}

function systemProjection(system: AdapterSystemConfiguration): SystemConfigurationPolicySnapshot {
  return {
    projectId: system.projectId,
    requestedServices: canonicalIds(system.requestedServices ?? []) as ("heating" | "cooling")[],
    simultaneousHeatCoolRequired: system.simultaneousHeatCoolRequired,
    architecture: {
      spaceHeatingSourceId: system.architecture?.spaceHeatingSourceId ?? null,
      spaceCoolingSourceId: system.architecture?.spaceCoolingSourceId ?? null,
      spaceCombinedSourceId: system.architecture?.spaceCombinedSourceId ?? null,
      simultaneousHeatCoolSupported: system.architecture?.simultaneousHeatCoolSupported ?? false,
      distribution: {
        id: system.architecture?.distribution?.id ?? "hydronic_2pipe_heating_cooling",
        circuitKind: system.architecture?.distribution?.circuitKind ?? "2pipe",
        simultaneousHeatCool: system.architecture?.distribution?.simultaneousHeatCool ?? false,
      },
    },
    roomAssignments: [...(system.roomAssignments ?? [])]
      .sort((a, b) => compareCodePoints(a.roomId, b.roomId))
      .map((a) => ({
        roomId: a.roomId,
        sourceSystemIds: { heating: a.sourceSystemIds?.heating ?? null, cooling: a.sourceSystemIds?.cooling ?? null },
        servicePreferences: {
          heating: a.servicePreferences?.heating ?? "required",
          cooling: a.servicePreferences?.cooling ?? "required",
        },
        heatingSystems: canonicalIds((a.heatingSystems ?? []).map((h) => h.familyId)).map((familyId) => ({ familyId })),
        coolingSystems: canonicalIds((a.coolingSystems ?? []).map((c) => c.familyId)).map((familyId) => ({ familyId })),
      })),
    configurationStatus: system.configurationStatus,
    buildingRevisionAtConfirmation: system.buildingRevisionAtConfirmation,
    systemsRevisionAtConfirmation: system.systemsRevisionAtConfirmation,
    systemsRevision: system.systemsRevision,
  };
}

export function projectConfiguratorInput(ctx: AdapterContext, operatingConditions: OperatingConditionPolicyInput): EngineeringConfiguratorInput {
  const load = ctx.load;
  const quality = ctx.quality;
  const qualitySnapshot: EngineeringQualitySnapshot = {
    qualityModelId: quality.qualityModelId,
    qualityModelVersion: quality.qualityModelVersion,
    requestedLevel: quality.requestedLevel,
    maximumEligibleLevel: quality.maximumEligibleLevel,
    gateStatus: quality.gateStatus,
    coverage: {
      declaredAreaM2: quality.coverage.declaredAreaM2,
      modeledAreaM2: quality.coverage.modeledAreaM2,
      ratio: quality.coverage.ratio,
      scope: quality.coverage.scope,
      confirmation: quality.coverage.confirmation,
    },
    blockingFields: [...quality.blockingFields].slice().sort((a, b) => compareCodePoints(a.fieldId, b.fieldId)) as unknown[],
    warnings: canonicalIds(quality.warnings ?? []),
  };

  const projectSnapshot: BuildingProjectPolicySnapshot = {
    id: ctx.projectId,
    objectType: ctx.objectType,
    buildingRevision: ctx.projectRevision,
    systemsRevision: ctx.systemConfigurationRevision,
    totalAreaM2: ctx.totalAreaM2,
  };

  const loadPolicy: BuildingLoadCalculationPolicySnapshot = {
    mode: load.mode,
    status: load.status,
    methodId: load.methodId,
    methodVersion: load.methodVersion,
    buildingRevisionAtCalculation: load.buildingRevisionAtCalculation,
    systemsRevisionAtCalculation: load.systemsRevisionAtCalculation,
    roomResults: roomProjection(load),
    heatingDemandW: load.heatingDemandW,
    coolingDemandW: load.coolingDemandW,
    ...(load.partialHeatingDemandW === undefined ? {} : { partialHeatingDemandW: load.partialHeatingDemandW }),
    ...(load.partialCoolingDemandW === undefined ? {} : { partialCoolingDemandW: load.partialCoolingDemandW }),
    inputSnapshot: {
      projectId: load.inputSnapshot.projectId,
      requestedServices: canonicalIds(load.inputSnapshot.requestedServices ?? []) as ("heating" | "cooling")[],
      buildingRevision: load.inputSnapshot.buildingRevision,
      systemsRevision: load.inputSnapshot.systemsRevision,
      mode: load.inputSnapshot.mode,
      methodVersion: load.inputSnapshot.methodVersion,
    },
    engineeringQuality: qualitySnapshot,
    climateDatasetId: load.climateDatasetId ?? null,
    climateDatasetVersion: load.climateDatasetVersion ?? null,
    climateLocationId: load.climateLocationId ?? null,
    calculatedAt: load.calculatedAt,
  };

  const servedRooms: ServedRoomInput[] = ctx.sortedRoomIds.map((roomId) => ({ roomId, servedZoneIds: [] }));

  const input: EngineeringConfiguratorInput = {
    policyId: ENGINEERING_CONFIGURATOR_POLICY_ID,
    policyVersion: ENGINEERING_CONFIGURATOR_POLICY_VERSION,
    projectId: ctx.projectId,
    projectRevision: ctx.projectRevision,
    loadCalculationRevision: ctx.loadRevision,
    sourceCalculationId: ctx.sourceCalculationId,
    systemTopology: CM8_SYSTEM_TOPOLOGY,
    systemConfigurationRevision: ctx.systemConfigurationRevision,
    selectionIntent: ctx.selectionIntent,
    projectSnapshot,
    loadCalculation: loadPolicy,
    systemConfigurationSnapshot: systemProjection(ctx.system),
    servedRooms,
    operatingConditions,
    designMargins: ctx.design.designMargins,
    matcherRequestPolicy: matcherCopy(ctx.matcherRequestPolicy),
    engineeringCatalogStateRevision: ctx.engineeringCatalogStateRevision,
    ...(ctx.commerceStateRevision === undefined ? {} : { commerceStateRevision: ctx.commerceStateRevision }),
  };
  return input;
}

function matcherCopy(m: MatcherRequestPolicySnapshot): MatcherRequestPolicySnapshot {
  return {
    matcherModelId: m.matcherModelId,
    matcherModelVersion: m.matcherModelVersion,
    engineeringSchemaVersion: m.engineeringSchemaVersion,
    matcherPolicyId: m.matcherPolicyId,
    matcherPolicyVersion: m.matcherPolicyVersion,
    requiredVerificationTier: m.requiredVerificationTier,
    requireExactOperatingPoint: m.requireExactOperatingPoint,
    allowInterpolation: m.allowInterpolation,
    allowExtrapolation: m.allowExtrapolation,
    maxCandidates: m.maxCandidates,
    maxDiagnosticResults: m.maxDiagnosticResults,
  };
}

// ---------------------------------------------------------------------------
// Deterministic source trace (category-complete; per-leaf concrete pointers)
// ---------------------------------------------------------------------------
export function buildSourceTrace(ctx: AdapterContext, operatingConditions: OperatingConditionPolicyInput): AdapterSourceTraceEntry[] {
  const trace: AdapterSourceTraceEntry[] = [];
  const roomIds = ctx.sortedRoomIds as string[];
  const roomIndex = (roomId: string) => roomIds.indexOf(roomId);
  const add = (
    targetPath: string,
    sourcePaths: readonly string[],
    sourceKind: AdapterSourceKind,
    transformation: AdapterSourceTraceEntry["transformation"],
    revisionOwner: string,
    availability: AdapterSourceTraceEntry["availability"] = "RESOLVED",
  ) => trace.push({ targetPath, sourcePaths, sourceKind, transformation, revisionOwner, availability });

  const P = (v: string) => `policyIdentities.${v}`;
  add("policyId", [P("topologyPolicy.id")], "POLICY", "COPY", "policyIdentities");
  add("policyVersion", [P("topologyPolicy.version")], "POLICY", "COPY", "policyIdentities");
  add("projectId", ["project.id"], "LIVE_PROJECT", "COPY", "project/building/system/load revisions");
  add("projectRevision", ["project.buildingRevision"], "LIVE_PROJECT", "COPY", "project/building/system/load revisions");
  add("systemConfigurationRevision", ["project.systemsRevision"], "LIVE_PROJECT", "COPY", "project/building/system/load revisions");
  add("loadCalculationRevision", ["loadRevisionReference.revision"], "REVISION_PROVIDER", "COPY", "loadCalculationRevision");
  add("sourceCalculationId", ["loadRevisionReference.sourceCalculationId"], "REVISION_PROVIDER", "COPY", "loadCalculationRevision");
  add("systemTopology", ["validated system architecture"], "CONFIRMED_SYSTEM", "POLICY_CONSTANT", "topologyPolicy");
  add("selectionIntent", ["selectionIntent"], "POLICY", "COPY", "caller selection request");
  add("engineeringCatalogStateRevision", ["engineeringCatalogStateReference.revision"], "REVISION_PROVIDER", "COPY", "engineeringCatalogStateRevision");
  if (ctx.commerceStateRevision !== undefined) {
    add("commerceStateRevision", ["commerceStateRevision"], "REVISION_PROVIDER", "COPY", "commerceStateRevision");
  }

  for (const k of ["id", "objectType", "buildingRevision", "systemsRevision", "totalAreaM2"] as const) {
    add(`projectSnapshot.${k}`, [`project.${k === "id" ? "id" : k === "buildingRevision" ? "buildingRevision" : k === "systemsRevision" ? "systemsRevision" : k}`], "LIVE_PROJECT", "PROJECT", "buildingRevision/systemsRevision");
  }

  add("loadCalculation.mode", ["loadCalculation.mode"], "LOAD_SNAPSHOT", "COPY", "loadCalculationRevision");
  add("loadCalculation.status", ["loadCalculation.status"], "LOAD_SNAPSHOT", "COPY", "loadCalculationRevision");
  add("loadCalculation.methodId", ["loadCalculation.methodId"], "LOAD_SNAPSHOT", "COPY", "loadCalculationRevision");
  add("loadCalculation.methodVersion", ["loadCalculation.methodVersion"], "LOAD_SNAPSHOT", "COPY", "loadCalculationRevision");
  add("loadCalculation.heatingDemandW", ["loadCalculation.heatingDemandW"], "LOAD_SNAPSHOT", "COPY", "loadCalculationRevision");
  add("loadCalculation.coolingDemandW", ["loadCalculation.coolingDemandW"], "LOAD_SNAPSHOT", "COPY", "loadCalculationRevision");
  add("loadCalculation.inputSnapshot.projectId", ["loadCalculation.inputSnapshot.projectId"], "LOAD_SNAPSHOT", "COPY", "loadCalculationRevision");
  add("loadCalculation.inputSnapshot.requestedServices", ["loadCalculation.inputSnapshot.requestedServices"], "LOAD_SNAPSHOT", "SORT", "loadCalculationRevision");

  for (const roomId of roomIds) {
    const i = roomIndex(roomId);
    add(`loadCalculation.roomResults[${i}].roomId`, [`loadCalculation.roomResults/${roomId}/roomId`], "LOAD_SNAPSHOT", "SORT", "loadCalculationRevision");
    add(`loadCalculation.roomResults[${i}].heating.demandW`, [`loadCalculation.roomResults/${roomId}/heating/demandW`], "LOAD_SNAPSHOT", "COPY", "loadCalculationRevision");
    add(`loadCalculation.roomResults[${i}].cooling.demandW`, [`loadCalculation.roomResults/${roomId}/cooling/demandW`], "LOAD_SNAPSHOT", "COPY", "loadCalculationRevision");
    add(`loadCalculation.roomResults[${i}].transmissionBreakdown.indoorHeatingC`, [`loadCalculation.roomResults/${roomId}/transmissionBreakdown/indoorHeatingC`], "LOAD_SNAPSHOT", "COPY", "loadCalculationRevision");
    add(`loadCalculation.roomResults[${i}].transmissionBreakdown.outdoorCoolingC`, [`loadCalculation.roomResults/${roomId}/transmissionBreakdown/outdoorCoolingC`], "LOAD_SNAPSHOT", "COPY", "loadCalculationRevision");
  }

  add("loadCalculation.engineeringQuality.qualityModelId", ["loadCalculation.engineeringQuality.qualityModelId"], "LOAD_SNAPSHOT", "COPY", "loadCalculationRevision");
  add("loadCalculation.engineeringQuality.coverage.scope", ["loadCalculation.engineeringQuality.coverage.scope"], "LOAD_SNAPSHOT", "COPY", "buildingRevision + loadCalculationRevision");

  add("systemConfigurationSnapshot.projectId", ["confirmedSystemSnapshot.projectId"], "CONFIRMED_SYSTEM", "COPY", "systemsRevision");
  add("systemConfigurationSnapshot.requestedServices", ["confirmedSystemSnapshot.requestedServices"], "CONFIRMED_SYSTEM", "SORT", "systemsRevision");
  add("systemConfigurationSnapshot.architecture.distribution.id", ["confirmedSystemSnapshot.architecture.distribution.id"], "CONFIRMED_SYSTEM", "COPY", "systemsRevision");
  for (const roomId of roomIds) {
    const i = roomIndex(roomId);
    add(`systemConfigurationSnapshot.roomAssignments[${i}].roomId`, [`confirmedSystemSnapshot.roomAssignments/${roomId}/roomId`], "CONFIRMED_SYSTEM", "SORT", "systemsRevision");
    add(`systemConfigurationSnapshot.roomAssignments[${i}].heatingSystems[].familyId`, [`confirmedSystemSnapshot.roomAssignments/${roomId}/heatingSystems/*/familyId`], "CONFIRMED_SYSTEM", "SORT", "systemsRevision");
    add(`servedRooms[${i}].roomId`, [`confirmedSystemSnapshot.roomAssignments/${roomId}/roomId`, `coverage inventory`], "CONFIRMED_SYSTEM", "SORT", "buildingRevision/systemsRevision/loadCalculationRevision");
  }

  for (const group of ["heatPumpHeating", "heatPumpCooling", "fanCoilHeating", "fanCoilCooling"] as const) {
    const g = operatingConditions[group] as unknown as Record<string, unknown>;
    for (const key of Object.keys(g)) {
      add(`operatingConditions.${group}.${key}`, [`confirmedSystemSnapshot.engineeringDesignInputs`, `loadCalculation.roomResults/*/transmissionBreakdown`], "LOAD_SNAPSHOT", "CONSENSUS", "loadCalculationRevision");
    }
  }

  for (const group of ["heatPumpHeating", "heatPumpCooling", "fanCoilHeating", "fanCoilCooling"] as const) {
    add(`designMargins.${group}.designMarginPercent`, [`confirmedSystemSnapshot.engineeringDesignInputs.designMargins.${group}`], "CONFIRMED_SYSTEM", "PROJECT", "systemsRevision/topologyPolicy");
  }

  add("matcherRequestPolicy.matcherModelId", ["matcherRequestPolicy.matcherModelId"], "POLICY", "COPY", "matcherModel/matcherPolicy/engineeringSchema + caller request");
  return trace;
}

// ---------------------------------------------------------------------------
// Revision trace (§30)
// ---------------------------------------------------------------------------
export function buildRevisionTrace(ctx: AdapterContext, input: BuildingProjectConfiguratorAdapterInput): AdapterRevisionTrace {
  const load = ctx.load;
  return {
    projectId: ctx.projectId,
    projectRevision: ctx.projectRevision,
    objectConfirmedRevision: (input.project as unknown as { objectConfirmedRevision?: number | null }).objectConfirmedRevision ?? null,
    systemConfigurationRevision: ctx.systemConfigurationRevision,
    systemBuildingRevisionAtConfirmation: ctx.system.buildingRevisionAtConfirmation,
    systemsRevisionAtConfirmation: ctx.system.systemsRevisionAtConfirmation,
    buildingRevisionAtCalculation: load.buildingRevisionAtCalculation,
    systemsRevisionAtCalculation: load.systemsRevisionAtCalculation,
    inputSnapshotBuildingRevision: load.inputSnapshot.buildingRevision,
    inputSnapshotSystemsRevision: load.inputSnapshot.systemsRevision,
    coverageBuildingRevisionAtConfirmation: ctx.intent.buildingRevisionAtConfirmation,
    loadCalculationRevision: ctx.loadRevision,
    sourceCalculationId: ctx.sourceCalculationId,
    loadRevisionAlgorithmVersion: ctx.loadRevisionAlgorithmVersion,
    engineeringCatalogStateRevision: ctx.engineeringCatalogStateRevision,
    engineeringCatalogAlgorithmVersion: "ohmx.engineering-catalog-state-canonical-json.v1",
    commerceStateRevision: ctx.commerceStateRevision ?? null,
    policyIdentities: input.policyIdentities,
    selectionIntent: ctx.selectionIntent,
    matcherRequestPolicy: matcherCopy(ctx.matcherRequestPolicy) as DeepReadonly<MatcherRequestPolicySnapshot>,
    engineeringCurrency: "VALIDATED_SUPPLIED_SNAPSHOT",
    commerceComparisonStatus: ctx.commerceStateRevision === undefined ? "NOT_TRACKED" : "NOT_COMPARED",
    liveCurrentCertified: false,
  };
}