/**
 * CM11 adapter — revision, confirmation, topology, load-readiness, quality and
 * served-room validation gates. Frozen CM10 call-gate steps 2–9 and 12–13.
 */
import type {
  BuildingProjectConfiguratorAdapterInput,
  AdapterSystemConfiguration,
  AdapterLoadCalculation,
  CoverageIntent,
} from "./types.js";
import type { EngineeringQualityResult } from "../buildingProjectTypes.js";
import type {
  ConfiguratorSelectionIntent,
  MatcherRequestPolicySnapshot,
} from "../engineeringConfigurator/types.js";
import type { Diagnostics } from "./policy.js";
import {
  block,
  warn,
  finite,
  nonNegative,
  revision,
  nonEmpty,
  strings,
  bothServices,
  canonicalIds,
  compareCodePoints,
  validStableId,
  deepEqual,
  ENGINEERING_CONFIGURATOR_POLICY_ID,
  ENGINEERING_CONFIGURATOR_POLICY_VERSION,
  CM7_GENERIC_CONFIGURATOR_POLICY_ID,
  CM7_GENERIC_CONFIGURATOR_POLICY_VERSION,
  CM8_SYSTEM_TOPOLOGY,
  CM8_SYSTEM_ARCHITECTURE_ID,
  CM8_REVERSIBLE_SOURCE_FAMILY_ID,
  CM8_FAN_COIL_FAMILY_ID,
  CM8_RESIDENTIAL_OBJECT_TYPES,
  EQUIPMENT_REQUIREMENT_CONTRACT_ID,
  EQUIPMENT_REQUIREMENT_CONTRACT_VERSION,
  MATCHER_MODEL_ID,
  MATCHER_MODEL_VERSION,
  MATCHER_POLICY_ID,
  ENGINEERING_SCHEMA_VERSION,
  BUILDING_QUALITY_MODEL_ID,
  BUILDING_QUALITY_MODEL_VERSION,
  MATCHER_POLICY_VERSION,
  VERIFICATION_REQUIREMENTS,
} from "./policy.js";
import { ADAPTER_CONTRACT_ID, ADAPTER_CONTRACT_VERSION } from "./types.js";
import { materializeMargins } from "./operatingInputs.js";

export interface ValidatedProject {
  projectId: string;
  objectType: "apartment" | "private_house";
  projectRevision: number;
  systemConfigurationRevision: number;
  sortedRoomIds: string[];
}

// ---------------------------------------------------------------------------
// Gate 0 — policy bridge + matcher request policy + intent vocab
// ---------------------------------------------------------------------------
export function validatePolicyBridge(input: BuildingProjectConfiguratorAdapterInput, d: Diagnostics): void {
  const ids = input.policyIdentities;
  const expect: Array<[keyof typeof ids, string, string]> = [
    ["adapterContract", ADAPTER_CONTRACT_ID, ADAPTER_CONTRACT_VERSION],
    ["topologyPolicy", ENGINEERING_CONFIGURATOR_POLICY_ID, ENGINEERING_CONFIGURATOR_POLICY_VERSION],
    ["equipmentRequirementContract", EQUIPMENT_REQUIREMENT_CONTRACT_ID, EQUIPMENT_REQUIREMENT_CONTRACT_VERSION],
    ["genericRequirementPolicy", CM7_GENERIC_CONFIGURATOR_POLICY_ID, CM7_GENERIC_CONFIGURATOR_POLICY_VERSION],
    ["qualityModel", BUILDING_QUALITY_MODEL_ID, BUILDING_QUALITY_MODEL_VERSION],
    ["engineeringSchema", "ohmx.engineering-product.v1", ENGINEERING_SCHEMA_VERSION],
    ["matcherModel", MATCHER_MODEL_ID, MATCHER_MODEL_VERSION],
    ["matcherPolicy", MATCHER_POLICY_ID, MATCHER_POLICY_VERSION],
  ];
  for (const [key, id, version] of expect) {
    const leaf = ids?.[key];
    if (!leaf || leaf.id !== id || leaf.version !== version) {
      block(d, "POLICY_ID_VERSION_INVALID", `policyIdentities.${key}`);
    }
  }
  // Generic requirement policy must never overwrite the topology envelope.
  if (ids?.genericRequirementPolicy?.id !== CM7_GENERIC_CONFIGURATOR_POLICY_ID || ids?.genericRequirementPolicy?.version !== CM7_GENERIC_CONFIGURATOR_POLICY_VERSION) {
    block(d, "POLICY_ID_VERSION_INVALID", "policyIdentities.genericRequirementPolicy");
  }
}

export function validateSelectionIntent(input: BuildingProjectConfiguratorAdapterInput, d: Diagnostics): ConfiguratorSelectionIntent | null {
  const intent = input.selectionIntent;
  if (intent !== "PRELIMINARY" && intent !== "PROFESSIONAL") {
    block(d, "CANONICAL_VOCABULARY_INVALID", "selectionIntent");
    return null;
  }
  return intent;
}

export function validateMatcherRequestPolicy(input: BuildingProjectConfiguratorAdapterInput, d: Diagnostics): void {
  const m = input.matcherRequestPolicy as MatcherRequestPolicySnapshot | null | undefined;
  if (!m) {
    block(d, "POLICY_ID_VERSION_INVALID", "matcherRequestPolicy");
    return;
  }
  if (m.matcherModelId !== MATCHER_MODEL_ID || m.matcherModelVersion !== MATCHER_MODEL_VERSION || m.matcherPolicyId !== MATCHER_POLICY_ID || m.matcherPolicyVersion !== MATCHER_POLICY_VERSION || m.engineeringSchemaVersion !== ENGINEERING_SCHEMA_VERSION) {
    block(d, "POLICY_ID_VERSION_INVALID", "matcherRequestPolicy identity");
  }
  if (!(VERIFICATION_REQUIREMENTS as readonly string[]).includes(m.requiredVerificationTier as string) || m.requireExactOperatingPoint !== true || m.allowInterpolation !== false || m.allowExtrapolation !== false || !revision(m.maxCandidates) || m.maxCandidates < 1 || !revision(m.maxDiagnosticResults)) {
    block(d, "CANONICAL_VOCABULARY_INVALID", "matcherRequestPolicy flags/limits");
  }
}

// ---------------------------------------------------------------------------
// Gate 1 — project / object confirmation (§8, §call-gate 2)
// ---------------------------------------------------------------------------
function objectTypeResidential(objectType: unknown): objectType is "apartment" | "private_house" {
  return typeof objectType === "string" && (CM8_RESIDENTIAL_OBJECT_TYPES as readonly string[]).includes(objectType);
}

export function validateProjectObject(input: BuildingProjectConfiguratorAdapterInput, d: Diagnostics): ValidatedProject | null {
  const project = input.project as unknown as {
    id?: unknown;
    status?: unknown;
    buildingRevision?: unknown;
    systemsRevision?: unknown;
    objectType?: unknown;
    objectConfirmedAt?: unknown;
    objectConfirmedRevision?: unknown;
    objectConfirmedSnapshot?: unknown;
    rooms?: readonly unknown[];
  } | null;

  if (!project || !validStableId(project.id)) {
    block(d, "building.object_not_confirmed", "project");
    return null;
  }
  const projectId = project.id as string;

  const missingConfirmation =
    project.status !== "systems_configured" ||
    !nonEmpty(project.objectConfirmedAt) ||
    !revision(project.objectConfirmedRevision) ||
    !project.objectConfirmedSnapshot;
  if (missingConfirmation) {
    block(d, "building.object_not_confirmed", "project.objectConfirmedAt/objectConfirmedRevision/objectConfirmedSnapshot");
    return null;
  }

  const buildingRevision = project.buildingRevision as number;
  if (!revision(buildingRevision)) {
    block(d, "PROJECT_REVISION_STALE", "project.buildingRevision");
    return null;
  }
  if (project.objectConfirmedRevision !== buildingRevision) {
    block(d, "PROJECT_REVISION_STALE", "project.objectConfirmedRevision");
  }

  const snap = project.objectConfirmedSnapshot as { buildingRevision?: unknown; objectType?: unknown };
  if (snap.buildingRevision !== buildingRevision) {
    block(d, "PROJECT_REVISION_STALE", "project.objectConfirmedSnapshot.buildingRevision");
  }

  if (!objectTypeResidential(project.objectType)) {
    block(d, "TOPOLOGY_NOT_SUPPORTED", "project.objectType");
    return null;
  }

  // Snapshot engineering identity parity (objectType, totalArea, region.code, geometry, rooms).
  const p = input.project;
  const s = p.objectConfirmedSnapshot;
  if (s) {
    if (s.objectType !== p.objectType) block(d, "PROJECT_REVISION_STALE", "project.objectConfirmedSnapshot.objectType");
    if (s.totalAreaM2 !== p.totalAreaM2) block(d, "PROJECT_REVISION_STALE", "project.objectConfirmedSnapshot.totalAreaM2");
    if ((s.region?.code ?? null) !== (p.region?.code ?? null)) block(d, "PROJECT_REVISION_STALE", "project.objectConfirmedSnapshot.region");
    if (s.defaultCeilingHeightM !== p.defaultCeilingHeightM) block(d, "PROJECT_REVISION_STALE", "project.objectConfirmedSnapshot.defaultCeilingHeightM");
    if (s.insulationLevel !== p.insulationLevel) block(d, "PROJECT_REVISION_STALE", "project.objectConfirmedSnapshot.insulationLevel");
    if (!roomsParity(p.rooms, s.rooms)) block(d, "PROJECT_REVISION_STALE", "project.objectConfirmedSnapshot.rooms");
  }

  // Canonical stable room inventory.
  const rooms = Array.isArray(p.rooms) ? p.rooms : [];
  if (rooms.length === 0) {
    block(d, "SERVED_ROOM_INVALID", "project.rooms");
    return null;
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const r of rooms) {
    const id = (r as { id?: unknown }).id;
    if (!validStableId(id) || seen.has(id as string)) {
      block(d, "SERVED_ROOM_INVALID", "project.rooms[].id");
      continue;
    }
    seen.add(id as string);
    ids.push(id as string);
  }
  const sortedRoomIds = canonicalIds(ids);

  let systemsRevision = project.systemsRevision as number;
  if (!revision(systemsRevision)) {
    block(d, "SYSTEM_CONFIGURATION_REVISION_STALE", "project.systemsRevision");
    systemsRevision = 0;
  }

  return {
    projectId,
    objectType: project.objectType as "apartment" | "private_house",
    projectRevision: buildingRevision,
    systemConfigurationRevision: systemsRevision,
    sortedRoomIds,
  };
}

function roomsParity(current: readonly unknown[], frozen: readonly unknown[]): boolean {
  if (!Array.isArray(frozen) || current.length !== frozen.length) return false;
  const a = [...(current as Array<{ id: string; roomType: string; areaM2: number | null; floorId?: string | null }>)]
    .map((r) => ({ id: r.id, roomType: r.roomType, areaM2: r.areaM2, floorId: r.floorId ?? null }))
    .sort((x, y) => compareCodePoints(x.id, y.id));
  const b = [...(frozen as Array<{ id: string; roomType: string; areaM2: number | null; floorId?: string | null }>)]
    .map((r) => ({ id: r.id, roomType: r.roomType, areaM2: r.areaM2, floorId: r.floorId ?? null }))
    .sort((x, y) => compareCodePoints(x.id, y.id));
  return deepEqual(a, b);
}

// ---------------------------------------------------------------------------
// Gate 2 — system confirmation + topology (§22, §call-gate 3–4)
// ---------------------------------------------------------------------------
export function validateSystemConfirmation(
  input: BuildingProjectConfiguratorAdapterInput,
  targetProjectId: string | null,
  targetBuildingRevision: number | null,
  targetSystemsRevision: number | null,
  d: Diagnostics,
): AdapterSystemConfiguration | null {
  const system = input.confirmedSystemSnapshot as AdapterSystemConfiguration | null | undefined;
  const current = input.project?.systemsConfiguration as AdapterSystemConfiguration | null | undefined;
  const currentSnapshot = input.project?.systemsConfigurationSnapshot as AdapterSystemConfiguration | null | undefined;

  if (!system || system.configurationStatus !== "confirmed") {
    block(d, "SYSTEM_CONFIGURATION_MISSING", "confirmedSystemSnapshot.configurationStatus");
    return null;
  }
  if (!current || current.configurationStatus !== "confirmed") {
    block(d, "SYSTEM_CONFIGURATION_MISSING", "project.systemsConfiguration.configurationStatus");
    return null;
  }
  if (!currentSnapshot || currentSnapshot.configurationStatus !== "confirmed") {
    block(d, "SYSTEM_CONFIGURATION_MISSING", "project.systemsConfigurationSnapshot.configurationStatus");
    return null;
  }
  if (targetProjectId !== null && system.projectId !== targetProjectId) {
    block(d, "PROJECT_REVISION_STALE", "confirmedSystemSnapshot.projectId");
  }
  if (targetBuildingRevision !== null && system.buildingRevisionAtConfirmation !== targetBuildingRevision) {
    block(d, "PROJECT_REVISION_STALE", "confirmedSystemSnapshot.buildingRevisionAtConfirmation");
  }
  if (targetSystemsRevision !== null) {
    if (system.systemsRevision !== targetSystemsRevision) block(d, "SYSTEM_CONFIGURATION_REVISION_STALE", "confirmedSystemSnapshot.systemsRevision");
    if (system.systemsRevisionAtConfirmation !== targetSystemsRevision) block(d, "SYSTEM_CONFIGURATION_REVISION_STALE", "confirmedSystemSnapshot.systemsRevisionAtConfirmation");
  }
  const validation = system.validation as { ready?: unknown; blockers?: unknown } | null | undefined;
  if (!validation || validation.ready !== true || (Array.isArray(validation.blockers) && validation.blockers.length > 0)) {
    block(d, "SYSTEM_CONFIGURATION_MISSING", "confirmedSystemSnapshot.validation (ready=true, blockers=[])");
  }
  if (Array.isArray(system.warnings)) {
    for (const w of system.warnings) {
      if (typeof w === "string") warn(d, "BUILDING_QUALITY_WARNING", "confirmedSystemSnapshot.warnings", w, "system.warnings");
    }
  }
  // Confirmed snapshot must equal the project frozen snapshot's engineering projection.
  if (!deepEqual(systemProjection(currentSnapshot), systemProjection(system))) {
    block(d, "SYSTEM_CONFIGURATION_REVISION_STALE", "project.systemsConfigurationSnapshot vs confirmedSystemSnapshot");
  }
  return system;
}

function systemProjection(s: AdapterSystemConfiguration | null | undefined): unknown {
  if (!s) return null;
  return {
    projectId: s.projectId,
    requestedServices: canonicalIds(s.requestedServices ?? []),
    simultaneousHeatCoolRequired: s.simultaneousHeatCoolRequired,
    configurationStatus: s.configurationStatus,
    buildingRevisionAtConfirmation: s.buildingRevisionAtConfirmation,
    systemsRevisionAtConfirmation: s.systemsRevisionAtConfirmation,
    systemsRevision: s.systemsRevision,
    architecture: s.architecture
      ? {
          spaceHeatingSourceId: s.architecture.spaceHeatingSourceId,
          spaceCoolingSourceId: s.architecture.spaceCoolingSourceId,
          spaceCombinedSourceId: s.architecture.spaceCombinedSourceId,
          simultaneousHeatCoolSupported: s.architecture.simultaneousHeatCoolSupported,
          distribution: s.architecture.distribution
            ? {
                id: s.architecture.distribution.id,
                circuitKind: s.architecture.distribution.circuitKind,
                simultaneousHeatCool: s.architecture.distribution.simultaneousHeatCool,
              }
            : null,
        }
      : null,
    roomAssignments: [...(s.roomAssignments ?? [])]
      .sort((a, b) => compareCodePoints(a.roomId, b.roomId))
      .map((a) => ({
        roomId: a.roomId,
        sourceSystemIds: { heating: a.sourceSystemIds?.heating ?? null, cooling: a.sourceSystemIds?.cooling ?? null },
        servicePreferences: { heating: a.servicePreferences?.heating ?? null, cooling: a.servicePreferences?.cooling ?? null },
        heatingSystems: canonicalIds((a.heatingSystems ?? []).map((h) => h.familyId)),
        coolingSystems: canonicalIds((a.coolingSystems ?? []).map((c) => c.familyId)),
      })),
    engineeringDesignInputs: materializeMargins(s.engineeringDesignInputs ?? null),
  };
}

export function validateTopology(system: AdapterSystemConfiguration | null, d: Diagnostics): void {
  if (!system) return;
  if (system.simultaneousHeatCoolRequired !== false) block(d, "SIMULTANEOUS_OPERATION_NOT_SUPPORTED", "confirmedSystemSnapshot.simultaneousHeatCoolRequired");
  const arch = system.architecture;
  if (!arch || !bothServices(system.requestedServices)) {
    block(d, "TOPOLOGY_NOT_SUPPORTED", "confirmedSystemSnapshot.requestedServices");
    return;
  }
  const kinds = [arch.spaceHeatingSourceId, arch.spaceCoolingSourceId, arch.spaceCombinedSourceId];
  if (!kinds.every((id) => id === CM8_REVERSIBLE_SOURCE_FAMILY_ID)) {
    block(d, "TOPOLOGY_NOT_SUPPORTED", "confirmedSystemSnapshot.architecture source family");
  }
  if (arch.distribution?.id !== CM8_SYSTEM_ARCHITECTURE_ID || arch.distribution?.circuitKind !== "2pipe") {
    block(d, "TOPOLOGY_NOT_SUPPORTED", "confirmedSystemSnapshot.architecture.distribution");
  }
  if (arch.distribution?.simultaneousHeatCool !== false || arch.simultaneousHeatCoolSupported !== false) {
    block(d, "SIMULTANEOUS_OPERATION_NOT_SUPPORTED", "confirmedSystemSnapshot.architecture simultaneous flags");
  }
}

// ---------------------------------------------------------------------------
// Gate 3 — load readiness (§9, §10, §call-gate 6–7)
// ---------------------------------------------------------------------------
export function validateLoadReadiness(input: BuildingProjectConfiguratorAdapterInput, d: Diagnostics): AdapterLoadCalculation | null {
  const load = input.loadCalculation as AdapterLoadCalculation | null | undefined;
  if (!load) {
    block(d, "LOAD_CALCULATION_NOT_READY", "loadCalculation");
    return null;
  }
  if (load.status !== "calculated" || load.mode !== "steady_state" || load.inputSnapshot?.mode !== load.mode) {
    block(d, "LOAD_CALCULATION_NOT_READY", "loadCalculation.status/mode");
  }
  if (load.methodId !== "ohmx.steady-state.v1" || load.methodVersion !== "1.0.0" || load.inputSnapshot?.methodVersion !== load.methodVersion) {
    block(d, "LOAD_CALCULATION_NOT_READY", "loadCalculation.methodId/methodVersion");
  }
  if (!bothServices(load.inputSnapshot?.requestedServices)) {
    block(d, "LOAD_CALCULATION_NOT_READY", "loadCalculation.inputSnapshot.requestedServices");
  }
  if (Array.isArray(load.missingInputs) && load.missingInputs.length > 0) {
    block(d, "LOAD_CALCULATION_NOT_READY", "loadCalculation.missingInputs");
  }
  if (!nonNegative(load.heatingDemandW) || !nonNegative(load.coolingDemandW)) {
    block(d, "OBJECT_LOAD_MISSING", "loadCalculation object totals");
  }
  if (!nonEmpty(load.climateDatasetId) || !nonEmpty(load.climateDatasetVersion) || !nonEmpty(load.climateLocationId)) {
    block(d, "LOAD_CALCULATION_NOT_READY", "loadCalculation climate identity");
  }
  if (!Array.isArray(load.roomResults) || load.roomResults.length === 0) {
    block(d, "ROOM_LOAD_MISSING", "loadCalculation.roomResults");
    return null;
  }
  const seen = new Set<string>();
  for (const room of load.roomResults) {
    if (!validStableId(room?.roomId) || seen.has(room.roomId)) {
      block(d, "ROOM_LOAD_MISSING", "roomResults[].roomId", { roomId: room?.roomId ?? null });
      continue;
    }
    seen.add(room.roomId);
    for (const service of ["heating", "cooling"] as const) {
      const s = room[service];
      if (!s || s.status !== "calculated" || !nonNegative(s.demandW) || (Array.isArray(s.missingInputs) && s.missingInputs.length > 0)) {
        block(d, "ROOM_LOAD_MISSING", `roomResults.${service}`, { roomId: room.roomId, service: service === "heating" ? "HEATING" : "COOLING" });
      }
    }
  }
  return load;
}

// ---------------------------------------------------------------------------
// Gate 4 — revision consistency (§11, §call-gate 7)
// ---------------------------------------------------------------------------
export function validateRevisions(
  proj: ValidatedProject | null,
  load: AdapterLoadCalculation | null,
  d: Diagnostics,
): void {
  if (!proj || !load) return;
  const inputSnap = load.inputSnapshot;
  if (load.buildingRevisionAtCalculation !== proj.projectRevision) block(d, "PROJECT_REVISION_STALE", "loadCalculation.buildingRevisionAtCalculation");
  if (inputSnap.buildingRevision !== proj.projectRevision) block(d, "PROJECT_REVISION_STALE", "loadCalculation.inputSnapshot.buildingRevision");
  if (inputSnap.projectId !== proj.projectId) block(d, "PROJECT_REVISION_STALE", "loadCalculation.inputSnapshot.projectId");
  if ((inputSnap as { objectType?: unknown }).objectType !== proj.objectType) block(d, "PROJECT_REVISION_STALE", "loadCalculation.inputSnapshot.objectType");
  if (load.systemsRevisionAtCalculation !== proj.systemConfigurationRevision) block(d, "SYSTEM_CONFIGURATION_REVISION_STALE", "loadCalculation.systemsRevisionAtCalculation");
  if (inputSnap.systemsRevision !== proj.systemConfigurationRevision) block(d, "SYSTEM_CONFIGURATION_REVISION_STALE", "loadCalculation.inputSnapshot.systemsRevision");
}

// ---------------------------------------------------------------------------
// Gate 5 — quality (§24, §call-gate 9)
// ---------------------------------------------------------------------------
export function validateQuality(
  load: AdapterLoadCalculation | null,
  selectionIntent: ConfiguratorSelectionIntent | null,
  d: Diagnostics,
): EngineeringQualityResult | null {
  if (!load) return null;
  const quality = load.engineeringQuality as EngineeringQualityResult | null | undefined;
  if (!quality) {
    block(d, "LOAD_QUALITY_INSUFFICIENT", "loadCalculation.engineeringQuality");
    return null;
  }
  const levels = [1, 2, 3] as readonly unknown[];
  const shapeOk =
    quality.qualityModelId === BUILDING_QUALITY_MODEL_ID &&
    quality.qualityModelVersion === BUILDING_QUALITY_MODEL_VERSION &&
    levels.includes(quality.requestedLevel) &&
    levels.includes(quality.maximumEligibleLevel) &&
    ["PASS", "PASS_WITH_WARNINGS", "BLOCKED"].includes(quality.gateStatus) &&
    Array.isArray(quality.blockingFields) &&
    strings(quality.warnings);
  if (!shapeOk) {
    block(d, "LOAD_QUALITY_INSUFFICIENT", "loadCalculation.engineeringQuality (shape/level)");
    return null;
  }

  // CM10 criticalGuard: critical UNRESOLVED / null effectiveValue blocks.
  for (const f of quality.fields ?? []) {
    if (f.criticality === "CRITICAL" && (f.quality === "UNRESOLVED" || f.effectiveValue === null)) {
      block(d, "LOAD_QUALITY_INSUFFICIENT", `loadCalculation.engineeringQuality.fields (critical unresolved: ${f.fieldId})`);
    }
  }

  const professional = selectionIntent === "PROFESSIONAL";
  if (professional) {
    const okMax = quality.maximumEligibleLevel === 3 && ["PASS", "PASS_WITH_WARNINGS"].includes(quality.gateStatus) && quality.blockingFields.length === 0;
    if (!okMax) block(d, "LOAD_QUALITY_INSUFFICIENT", "Professional quality gates");
  } else if (selectionIntent === "PRELIMINARY") {
    if (quality.maximumEligibleLevel !== 3) {
      warn(d, "PRELIMINARY_LOAD_QUALITY", "loadCalculation.engineeringQuality", `Building quality level ${quality.maximumEligibleLevel}; no capacity relaxation.`);
    }
    if (quality.gateStatus === "PASS_WITH_WARNINGS" || quality.gateStatus === "BLOCKED" || quality.blockingFields.length > 0) {
      warn(d, "BUILDING_QUALITY_WARNING", "loadCalculation.engineeringQuality", "Building quality requires review; structural gates remain mandatory.");
    }
  }
  for (const text of canonicalIds(quality.warnings ?? [])) {
    warn(d, "BUILDING_QUALITY_WARNING", "loadCalculation.engineeringQuality.warnings", text);
  }
  return quality;
}

// ---------------------------------------------------------------------------
// Gate 6 — served rooms + cross-inventory (§21, §call-gate 8)
// ---------------------------------------------------------------------------
export function validateServedRooms(
  system: AdapterSystemConfiguration | null,
  load: AdapterLoadCalculation | null,
  sortedRoomIds: readonly string[],
  d: Diagnostics,
): string[] {
  const assignments = system ? Array.isArray(system.roomAssignments) ? system.roomAssignments : [] : [];
  const results = load ? Array.isArray(load.roomResults) ? load.roomResults : [] : [];
  const sorted = canonicalIds(sortedRoomIds as string[]);
  const assignmentIds = canonicalIds(assignments.map((a) => a.roomId));
  const resultIds = canonicalIds(results.map((r) => r.roomId));
  if (!deepEqual(assignmentIds, sorted)) block(d, "SERVED_ROOM_INVALID", "roomAssignments inventory vs project rooms");
  if (!deepEqual(resultIds, sorted)) block(d, "SERVED_ROOM_INVALID", "roomResults inventory vs project rooms");

  const assignmentMap = new Map(assignments.map((a) => [a.roomId, a]));
  for (const roomId of sorted) {
    const assignment = assignmentMap.get(roomId);
    if (!assignment) {
      block(d, "SERVED_ROOM_INVALID", "roomAssignments missing room", { roomId });
      continue;
    }
    for (const service of ["heating", "cooling"] as const) {
      const terminals = service === "heating" ? assignment.heatingSystems : assignment.coolingSystems;
      const pref = assignment.servicePreferences?.[service];
      const source = assignment.sourceSystemIds?.[service];
      const hasFanCoil = Array.isArray(terminals) && terminals.some((t) => t?.familyId === CM8_FAN_COIL_FAMILY_ID);
      const prefOk = pref === "required" || pref === "optional";
      const sourceOk = source === null || source === CM8_REVERSIBLE_SOURCE_FAMILY_ID;
      if (!hasFanCoil) block(d, "SERVED_ROOM_INVALID", `roomAssignments.${service}Systems (fan_coils)`, { roomId, service: service === "heating" ? "HEATING" : "COOLING" });
      if (!prefOk) block(d, "SERVED_ROOM_INVALID", `roomAssignments.servicePreferences.${service}`, { roomId, service: service === "heating" ? "HEATING" : "COOLING" });
      if (!sourceOk) block(d, "SERVED_ROOM_INVALID", `roomAssignments.sourceSystemIds.${service}`, { roomId, service: service === "heating" ? "HEATING" : "COOLING" });
      const terminalIds = Array.isArray(terminals) ? terminals.map((t) => t?.familyId) : [];
      if (new Set(terminalIds).size !== terminalIds.length) block(d, "SERVED_ROOM_INVALID", `roomAssignments.${service}Systems duplicate familyId`, { roomId });
    }
  }
  return sorted;
}