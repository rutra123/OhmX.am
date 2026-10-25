/** Translate one frozen CM9 EquipmentRequirement to Catalog Matcher V1 request. */
import type { EquipmentRequirement } from "../engineeringConfigurator/equipmentRequirementTypes.js";
import { validateCatalogMatchRequest } from "../catalogMatcher/index.js";
import type { CatalogMatchRequest } from "../catalogMatcher/types.js";

export type RequirementToMatcherInputResult =
  | { ok: true; request: CatalogMatchRequest }
  | { ok: false; field: string | null; message: string; sourceCode: string | null };

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function requirementToMatcherInput(
  requirement: EquipmentRequirement,
): RequirementToMatcherInputResult {
  if (
    !requirement ||
    !record(requirement.matcherRequestPolicy) ||
    !record(requirement.scopeReference) ||
    requirement.requiredCapacity == null ||
    requirement.designMargin == null ||
    !Number.isFinite(requirement.designMargin.designMarginPercent) ||
    !Array.isArray(requirement.operatingConditions) ||
    !Array.isArray(requirement.requiredParameters) ||
    !Array.isArray(requirement.preferredParameters) ||
    !Array.isArray(requirement.excludedParameters) ||
    !Array.isArray(requirement.compatibilityRequirements) ||
    !requirement.preferredParameters.every((row) => record(row) && Array.isArray(row.conditionContext)) ||
    !requirement.excludedParameters.every(record) ||
    !requirement.compatibilityRequirements.every((row) => record(row) && record(row.target))
  ) {
    return {
      ok: false,
      field: "EquipmentRequirement",
      message: "EquipmentRequirement cannot be represented by CatalogMatchRequest without inventing required values.",
      sourceCode: null,
    };
  }

  const request: CatalogMatchRequest = {
    matcherModelId: requirement.matcherRequestPolicy.matcherModelId,
    matcherModelVersion: requirement.matcherRequestPolicy.matcherModelVersion,
    schemaVersion: requirement.matcherRequestPolicy.engineeringSchemaVersion,
    policyId: requirement.matcherRequestPolicy.matcherPolicyId,
    policyVersion: requirement.matcherRequestPolicy.matcherPolicyVersion,
    selectionMode: requirement.selectionMode,
    equipmentType: requirement.equipmentType,
    service: requirement.service,
    requiredCapacity: { ...requirement.requiredCapacity },
    operatingConditions: requirement.operatingConditions.map((row) => ({ ...row })),
    requiredParameters: requirement.requiredParameters.map((row) => ({ ...row })),
    preferredParameters: requirement.preferredParameters.map((row) => ({
      ...row,
      preferredValue: row.preferredValue == null ? null : { ...row.preferredValue },
      conditionContext: row.conditionContext.map((condition) => ({ ...condition })),
    })),
    excludedParameters: requirement.excludedParameters.map((row) => ({
      ...row,
      excludedValue: row.excludedValue == null ? null : { ...row.excludedValue },
    })),
    compatibilityRequirements: requirement.compatibilityRequirements.map((row) => ({
      ...row,
      target: { ...row.target },
    })),
    requiredVerificationTier: requirement.matcherRequestPolicy.requiredVerificationTier,
    requireExactOperatingPoint: requirement.matcherRequestPolicy.requireExactOperatingPoint,
    allowInterpolation: requirement.matcherRequestPolicy.allowInterpolation,
    allowExtrapolation: requirement.matcherRequestPolicy.allowExtrapolation,
    designMarginPercent: requirement.designMargin.designMarginPercent,
    maxCandidates: requirement.matcherRequestPolicy.maxCandidates,
    maxDiagnosticResults: requirement.matcherRequestPolicy.maxDiagnosticResults,
    projectContext: {
      projectId: requirement.projectId,
      roomId: requirement.scopeReference.roomId,
      systemId: requirement.scopeReference.systemId,
      source: "ENGINEERING_CONFIGURATOR",
    },
  };

  const invalid = validateCatalogMatchRequest(request);
  if (invalid) {
    return {
      ok: false,
      field: invalid.field,
      message: invalid.message,
      sourceCode: invalid.errorCode,
    };
  }
  return { ok: true, request };
}
