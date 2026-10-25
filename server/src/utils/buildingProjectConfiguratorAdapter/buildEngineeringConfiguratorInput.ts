/**
 * CM11 — pure Building Project → Engineering Configurator input adapter.
 *
 * buildEngineeringConfiguratorInput is synchronous, deterministic and free of
 * filesystem, database, network, clock, randomness, environment or global
 * mutable state. It validates real typed snapshots + explicitly supplied
 * references and returns READY { input } or BLOCKED { blockingReasons, NO input }.
 *
 * It never calls configureHeatPumpFanCoil, the Catalog Matcher, any Building
 * Project service, or any persistence/DB/endpoint.
 */
import type {
  BuildingProjectConfiguratorAdapterInput,
  BuildingProjectConfiguratorAdapterResult,
  AdapterBlockingReason,
  AdapterWarning,
  AdapterRevisionTrace,
  AdapterSourceTraceEntry,
  CanonicalLoadFingerprintFacts,
  DeepReadonly,
} from "./types.js";
import { ADAPTER_CONTRACT_ID, ADAPTER_CONTRACT_VERSION } from "./types.js";
import type {
  ConfiguratorSelectionIntent,
  CommerceStateRevision,
  OperatingConditionPolicyInput,
} from "../engineeringConfigurator/types.js";
import type { MatcherRequestPolicySnapshot } from "../engineeringConfigurator/equipmentRequirementTypes.js";
import type { Diagnostics } from "./policy.js";
import { block, warn, orderedWarnings, orderedBlockers, validCommerceRevision } from "./policy.js";
import {
  validatePolicyBridge,
  validateSelectionIntent,
  validateMatcherRequestPolicy,
  validateProjectObject,
  validateSystemConfirmation,
  validateTopology,
  validateLoadReadiness,
  validateRevisions,
  validateQuality,
  validateServedRooms,
  validateCoverage,
  resolveDesignInputs,
  resolveOperatingConditions,
  validateCapturedDesignParity,
  materializeMargins,
  projectCanonicalLoadFacts,
  validateLoadRevisionReference,
  validateEngineeringCatalogReference,
  type AdapterContext,
  type ValidatedProject,
} from "./validation.js";
import type { AdapterSystemConfiguration, AdapterLoadCalculation, CoverageIntent } from "./types.js";
import { projectConfiguratorInput, buildSourceTrace, buildRevisionTrace } from "./mapping.js";

function resolveCommerce(input: BuildingProjectConfiguratorAdapterInput, d: Diagnostics): CommerceStateRevision | undefined {
  const c = input.commerceStateRevision;
  if (c === undefined) return undefined;
  if (validCommerceRevision(c)) return c;
  warn(d, "COMMERCE_REVISION_IGNORED", "commerceStateRevision", "Malformed optional commerce reference omitted.");
  return undefined;
}

/** READY-only pilot boundary warnings, mandated by frozen §gateClarifications.blockedWarnings. */
function emitReadyWarnings(d: Diagnostics): void {
  warn(d, "PILOT_CORE_SELECTION_ONLY", "completenessState", "Only central heat pump and room fan coils; not a complete installable system.");
  warn(d, "COMPATIBILITY_UNKNOWN", "compatibility", "Compatibility is not established by this pilot.");
}

function buildBlockedRevisionTrace(
  input: BuildingProjectConfiguratorAdapterInput,
  proj: ValidatedProject | null,
  system: AdapterSystemConfiguration | null,
  load: AdapterLoadCalculation | null,
  coverageIntent: CoverageIntent | null,
  loadRevision: string | null,
  sourceCalculationId: string | null,
  loadRevisionAlgorithmVersion: string | null,
  catalogRevision: string | null,
  selectionIntent: ConfiguratorSelectionIntent | null,
  commerce: CommerceStateRevision | undefined,
): DeepReadonly<AdapterRevisionTrace> {
  return {
    projectId: proj?.projectId ?? (typeof input.project?.id === "string" ? input.project.id : null),
    projectRevision: proj?.projectRevision ?? null,
    objectConfirmedRevision: (input.project as unknown as { objectConfirmedRevision?: number | null }).objectConfirmedRevision ?? null,
    systemConfigurationRevision: proj?.systemConfigurationRevision ?? null,
    systemBuildingRevisionAtConfirmation: system?.buildingRevisionAtConfirmation ?? null,
    systemsRevisionAtConfirmation: system?.systemsRevisionAtConfirmation ?? null,
    buildingRevisionAtCalculation: load?.buildingRevisionAtCalculation ?? null,
    systemsRevisionAtCalculation: load?.systemsRevisionAtCalculation ?? null,
    inputSnapshotBuildingRevision: load?.inputSnapshot?.buildingRevision ?? null,
    inputSnapshotSystemsRevision: load?.inputSnapshot?.systemsRevision ?? null,
    coverageBuildingRevisionAtConfirmation: coverageIntent?.buildingRevisionAtConfirmation ?? null,
    loadCalculationRevision: loadRevision,
    sourceCalculationId: sourceCalculationId,
    loadRevisionAlgorithmVersion: loadRevisionAlgorithmVersion,
    engineeringCatalogStateRevision: (catalogRevision as AdapterRevisionTrace["engineeringCatalogStateRevision"]) ?? null,
    engineeringCatalogAlgorithmVersion: catalogRevision ? "ohmx.engineering-catalog-state-canonical-json.v1" : null,
    commerceStateRevision: commerce ?? null,
    policyIdentities: input.policyIdentities,
    selectionIntent,
    matcherRequestPolicy: input.matcherRequestPolicy as DeepReadonly<MatcherRequestPolicySnapshot>,
    engineeringCurrency: "NOT_CERTIFIED",
    commerceComparisonStatus: commerce === undefined ? "NOT_TRACKED" : "NOT_COMPARED",
    liveCurrentCertified: false,
  };
}

function buildBlockedSourceTrace(
  input: BuildingProjectConfiguratorAdapterInput,
  proj: ValidatedProject | null,
  system: AdapterSystemConfiguration | null,
  load: AdapterLoadCalculation | null,
): AdapterSourceTraceEntry[] {
  const trace: AdapterSourceTraceEntry[] = [];
  const add = (targetPath: string, sourceKind: AdapterSourceTraceEntry["sourceKind"], availability: AdapterSourceTraceEntry["availability"]) =>
    trace.push({ targetPath, sourcePaths: [], sourceKind, transformation: "OMIT", revisionOwner: "adapter", availability });
  add("project", "LIVE_PROJECT", proj ? "RESOLVED" : "MISSING");
  add("loadCalculation", "LOAD_SNAPSHOT", load ? "RESOLVED" : "MISSING");
  add("confirmedSystemSnapshot", "CONFIRMED_SYSTEM", system ? "RESOLVED" : "MISSING");
  add("loadRevisionReference", "REVISION_PROVIDER", input.loadRevisionReference?.status === "AVAILABLE" ? "RESOLVED" : "MISSING");
  add("engineeringCatalogStateReference", "REVISION_PROVIDER", input.engineeringCatalogStateReference?.status === "AVAILABLE" ? "RESOLVED" : "MISSING");
  add("selectionIntent", "POLICY", "RESOLVED");
  add("matcherRequestPolicy", "POLICY", "RESOLVED");
  return trace;
}

/**
 * Pure entry point. Returns BLOCKED for any legacy/live state that lacks the
 * mandatory inputs (UNKNOWN/UNCONFIRMED coverage, missing design values or
 * revision references) — this is expected behavior, not an implementation
 * failure (§6).
 */
export function buildEngineeringConfiguratorInput(
  input: BuildingProjectConfiguratorAdapterInput,
): BuildingProjectConfiguratorAdapterResult {
  const d: Diagnostics = { blockingReasons: [], warnings: [] };
  const commerce = resolveCommerce(input, d);

  // Gate 0 — policy bridge / intent / matcher request.
  validatePolicyBridge(input, d);
  const selectionIntent = validateSelectionIntent(input, d);
  validateMatcherRequestPolicy(input, d);

  // Gate 1 — project/object confirmation.
  const proj = validateProjectObject(input, d);

  // Gate 2 — system confirmation + topology.
  const system = validateSystemConfirmation(
    input,
    proj?.projectId ?? null,
    proj?.projectRevision ?? null,
    proj?.systemConfigurationRevision ?? null,
    d,
  );
  validateTopology(system, d);

  // Gate 3 — load readiness.
  const load = validateLoadReadiness(input, d);

  // Gate 4 — revision consistency.
  validateRevisions(proj, load, d);

  // Gate 5 — coverage.
  const sortedRoomIds = proj?.sortedRoomIds ?? [];
  const coverageFacts = validateCoverage(input, sortedRoomIds, d);

  // Gate 5 — quality.
  const quality = validateQuality(load, selectionIntent, d);

  // Gate 6 — served rooms.
  validateServedRooms(system, load, sortedRoomIds, d);

  // Gate 7 — design inputs + captured parity.
  const design = resolveDesignInputs(system?.engineeringDesignInputs ?? null, selectionIntent ?? "PRELIMINARY", d);
  if (system && load) {
    validateCapturedDesignParity(
      system.engineeringDesignInputs ?? null,
      load.inputSnapshot.systemEngineeringDesignInputs ?? null,
      d,
    );
  }

  // Canonical facts projection (for load-reference comparison; skipped when a
  // required parent is missing so no invented child mismatch is emitted).
  const materializedDesign = materializeMargins(system?.engineeringDesignInputs ?? null);
  let projectedFacts: CanonicalLoadFingerprintFacts | null = null;
  if (load && proj && coverageFacts && design && materializedDesign) {
    projectedFacts = projectCanonicalLoadFacts(load, proj.projectId, proj.objectType, coverageFacts.intent, materializedDesign);
  }

  // Gate — load revision reference (validated, not produced).
  const loadToken = validateLoadRevisionReference(input.loadRevisionReference, projectedFacts, d);

  // Gate — engineering catalog state reference.
  const catalogToken = validateEngineeringCatalogReference(input.engineeringCatalogStateReference, d);

  // Operating conditions (consensus + shared design copy + seasonal + wet-bulb).
  let operatingConditions: OperatingConditionPolicyInput | null = null;
  if (load && design && loadToken && sortedRoomIds.length > 0) {
    operatingConditions = resolveOperatingConditions(load, sortedRoomIds, design, loadToken.revision, d);
  }

  const complete =
    proj !== null &&
    system !== null &&
    load !== null &&
    design !== null &&
    coverageFacts !== null &&
    quality !== null &&
    operatingConditions !== null &&
    loadToken !== null &&
    catalogToken !== null &&
    selectionIntent !== null;

  if (d.blockingReasons.length === 0 && !complete) {
    block(d, "CANONICAL_VOCABULARY_INVALID", "validated context unavailable");
  }

  if (d.blockingReasons.length > 0 || !complete) {
    return {
      contractId: ADAPTER_CONTRACT_ID,
      contractVersion: ADAPTER_CONTRACT_VERSION,
      status: "BLOCKED",
      warnings: orderedWarnings(d.warnings),
      sourceTrace: buildBlockedSourceTrace(input, proj, system, load),
      revisionTrace: buildBlockedRevisionTrace(
        input,
        proj,
        system,
        load,
        coverageFacts?.intent ?? null,
        loadToken?.revision ?? null,
        loadToken?.sourceCalculationId ?? null,
        loadToken?.algorithmVersion ?? null,
        catalogToken ?? null,
        selectionIntent,
        commerce,
      ) as DeepReadonly<AdapterRevisionTrace>,
      blockingReasons: orderedBlockers(d.blockingReasons) as [AdapterBlockingReason, ...AdapterBlockingReason[]],
    };
  }

  // READY — emit mandated pilot-boundary warnings then project the full input.
  emitReadyWarnings(d);

  const ctx: AdapterContext = {
    projectId: proj!.projectId,
    objectType: proj!.objectType,
    projectRevision: proj!.projectRevision,
    systemConfigurationRevision: proj!.systemConfigurationRevision,
    sortedRoomIds: proj!.sortedRoomIds,
    load: load as AdapterLoadCalculation,
    system: system as AdapterSystemConfiguration,
    quality: quality as NonNullable<typeof quality>,
    coverage: (load as AdapterLoadCalculation).engineeringQuality!.coverage,
    intent: coverageFacts!.intent,
    design: design as NonNullable<typeof design>,
    totalAreaM2: input.project.totalAreaM2,
    selectionIntent: selectionIntent as ConfiguratorSelectionIntent,
    matcherRequestPolicy: input.matcherRequestPolicy,
    loadRevision: loadToken!.revision,
    sourceCalculationId: loadToken!.sourceCalculationId,
    loadRevisionAlgorithmVersion: loadToken!.algorithmVersion,
    engineeringCatalogStateRevision: catalogToken!,
    ...(commerce === undefined ? {} : { commerceStateRevision: commerce }),
  };

  const projected = projectConfiguratorInput(ctx, operatingConditions as NonNullable<typeof operatingConditions>);

  return {
    contractId: ADAPTER_CONTRACT_ID,
    contractVersion: ADAPTER_CONTRACT_VERSION,
    status: "READY",
    input: projected,
    blockingReasons: [],
    warnings: orderedWarnings(d.warnings),
    sourceTrace: buildSourceTrace(ctx, operatingConditions as NonNullable<typeof operatingConditions>),
    revisionTrace: buildRevisionTrace(ctx, input) as DeepReadonly<AdapterRevisionTrace>,
  };
}