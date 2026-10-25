/** CM17: CM16 EquipmentRequirements -> Catalog Matcher -> SAME_PRODUCT composition. */
import {
  runBuildingProjectEngineeringConfiguration,
  type BuildingProjectEngineeringOrchestrationResult,
  type RunBuildingProjectEngineeringConfigurationOptions,
} from "../buildingProjectEngineeringOrchestrator/index.js";
import { SqliteCatalogMatchingSnapshotProvider } from "./catalogSnapshot.js";
import { requirementToMatcherInput } from "./requirementToMatcherInput.js";
import { composeSameProductGroups } from "./sameProductComposition.js";
import type {
  BlockedCatalogMatchingResult,
  BuildingProjectCatalogMatchingResult,
  CatalogMatchingBlocker,
  CatalogMatchingSnapshotProvider,
  CatalogMatchingSnapshotSession,
  MatchedCatalogMatchingResult,
  RequirementMatcherResult,
} from "./types.js";
import {
  CATALOG_MATCHING_ORCHESTRATION_CONTRACT_ID,
  CATALOG_MATCHING_ORCHESTRATION_CONTRACT_VERSION,
} from "./types.js";
import {
  catalogMatchingBlocker,
  isValidatedRequirementInventory,
  validateConfiguredRequirementInventory,
} from "./validation.js";

export interface RunBuildingProjectCatalogMatchingOptions {
  cm16Options?: RunBuildingProjectEngineeringConfigurationOptions;
  runCm16?: (
    options: RunBuildingProjectEngineeringConfigurationOptions,
  ) => Promise<BuildingProjectEngineeringOrchestrationResult>;
  snapshotProvider?: CatalogMatchingSnapshotProvider;
}

function blockedResult(
  cm16Result: BuildingProjectEngineeringOrchestrationResult,
  blocker: CatalogMatchingBlocker,
  requirementMatches: readonly RequirementMatcherResult[] = [],
): BlockedCatalogMatchingResult {
  const configured = cm16Result.status === "CONFIGURED" ? cm16Result.configuratorResult : null;
  return {
    contractId: CATALOG_MATCHING_ORCHESTRATION_CONTRACT_ID,
    contractVersion: CATALOG_MATCHING_ORCHESTRATION_CONTRACT_VERSION,
    status: "BLOCKED",
    projectId: cm16Result.projectId,
    buildingRevision: cm16Result.projectRevision,
    systemsRevision: cm16Result.systemRevision,
    loadCalculationRevision: cm16Result.loadCalculationRevision,
    engineeringCatalogStateRevision: cm16Result.engineeringCatalogStateRevision,
    cm16Result,
    physicalComponents: configured?.physicalComponents ?? [],
    equipmentRequirements: configured?.equipmentRequirements ?? [],
    requirementMatches,
    sameProductGroups: [],
    blocker,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runBuildingProjectCatalogMatching(
  options: RunBuildingProjectCatalogMatchingOptions = {},
): Promise<BuildingProjectCatalogMatchingResult> {
  const runCm16 = options.runCm16 ?? runBuildingProjectEngineeringConfiguration;
  const cm16Result = await runCm16(options.cm16Options ?? {});
  if (cm16Result.status !== "CONFIGURED") {
    return blockedResult(
      cm16Result,
      catalogMatchingBlocker("CM16_BLOCKED", "CM16 did not produce CONFIGURED EquipmentRequirements."),
    );
  }

  const inventory = validateConfiguredRequirementInventory(cm16Result);
  if (!isValidatedRequirementInventory(inventory)) {
    return blockedResult(cm16Result, inventory);
  }

  const mapped = [] as Array<{
    requirement: (typeof inventory.equipmentRequirements)[number];
    request: Extract<ReturnType<typeof requirementToMatcherInput>, { ok: true }>["request"];
  }>;
  for (const requirement of inventory.equipmentRequirements) {
    const conversion = requirementToMatcherInput(requirement);
    if (!conversion.ok) {
      return blockedResult(
        cm16Result,
        catalogMatchingBlocker(
          "UNSUPPORTED_MATCHER_REQUEST_CONVERSION",
          conversion.message,
          { requirementId: requirement.requirementId, sourceCode: conversion.sourceCode },
        ),
      );
    }
    mapped.push({ requirement, request: conversion.request });
  }

  const snapshotProvider = options.snapshotProvider ?? new SqliteCatalogMatchingSnapshotProvider();
  let session: CatalogMatchingSnapshotSession;
  try {
    session = snapshotProvider.openSession();
  } catch (err) {
    return blockedResult(
      cm16Result,
      catalogMatchingBlocker("ENGINEERING_CATALOG_STATE_UNAVAILABLE", `Unable to open coherent catalog snapshot: ${messageOf(err)}`),
    );
  }

  const rollback = () => {
    try { session.rollback(); } catch { /* preserve the engineering blocker */ }
  };

  if (session.revision !== cm16Result.engineeringCatalogStateRevision) {
    rollback();
    return blockedResult(
      cm16Result,
      catalogMatchingBlocker(
        "ENGINEERING_CATALOG_STATE_CHANGED",
        "The Matcher snapshot engineering revision differs from the CM16 configuration revision.",
        {
          expectedEngineeringCatalogStateRevision: cm16Result.engineeringCatalogStateRevision,
          observedEngineeringCatalogStateRevision: session.revision,
        },
      ),
    );
  }

  const requirementMatches: RequirementMatcherResult[] = [];
  try {
    for (const entry of mapped) {
      const match = session.match(entry.request);
      if (!match.ok) {
        rollback();
        return blockedResult(
          cm16Result,
          catalogMatchingBlocker(
            match.kind === "REQUEST_ERROR"
              ? "UNSUPPORTED_MATCHER_REQUEST_CONVERSION"
              : "MATCHER_TECHNICAL_FAILURE",
            match.error.message,
            {
              requirementId: entry.requirement.requirementId,
              sourceCode: match.kind === "REQUEST_ERROR" ? match.error.errorCode : null,
              matcherFailureKind: match.kind,
            },
          ),
          requirementMatches,
        );
      }
      if (match.response.candidates.length === 0) {
        rollback();
        return blockedResult(
          cm16Result,
          catalogMatchingBlocker(
            "NO_ELIGIBLE_CANDIDATE",
            "Catalog Matcher returned no technically eligible candidate for a required EquipmentRequirement.",
            {
              requirementId: entry.requirement.requirementId,
              componentInstanceId: entry.requirement.physicalComponentRef?.componentInstanceId ?? null,
            },
          ),
          requirementMatches,
        );
      }
      requirementMatches.push({
        requirement: entry.requirement,
        request: entry.request,
        response: match.response,
      });
    }

    const composition = composeSameProductGroups(requirementMatches);
    if (!composition.ok) {
      rollback();
      return blockedResult(cm16Result, composition.blocker, requirementMatches);
    }

    session.commit();
    const result: MatchedCatalogMatchingResult = {
      contractId: CATALOG_MATCHING_ORCHESTRATION_CONTRACT_ID,
      contractVersion: CATALOG_MATCHING_ORCHESTRATION_CONTRACT_VERSION,
      status: "MATCHED",
      projectId: cm16Result.projectId,
      buildingRevision: cm16Result.projectRevision,
      systemsRevision: cm16Result.systemRevision,
      loadCalculationRevision: cm16Result.loadCalculationRevision,
      engineeringCatalogStateRevision: cm16Result.engineeringCatalogStateRevision,
      cm16Result,
      physicalComponents: inventory.physicalComponents,
      equipmentRequirements: inventory.equipmentRequirements,
      requirementMatches,
      sameProductGroups: composition.groups,
      blocker: null,
    };
    return result;
  } catch (err) {
    rollback();
    return blockedResult(
      cm16Result,
      catalogMatchingBlocker("MATCHER_TECHNICAL_FAILURE", `Unexpected matching failure: ${messageOf(err)}`),
      requirementMatches,
    );
  }
}
