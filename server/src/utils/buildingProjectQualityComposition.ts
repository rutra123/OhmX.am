/**
 * Phase 3.2P-B3 — live steady_state Professional quality composition.
 *
 * This is the only composition boundary between the numeric load engine and
 * the B1/B2 quality model. It receives a completed numeric result, adapts the
 * exact calculation snapshot, evaluates quality, and returns a new result
 * object. It never resolves or recalculates a load component.
 */
import { computeEngineeringQuality } from './buildingProjectQuality.js';
import {
  buildEngineeringQualityFields,
} from './buildingProjectQualityAdapter.js';
import type {
  BuildingLoadCalculation,
  BuildingProject,
  EngineeringQualityService,
  UseLevel,
} from './buildingProjectTypes.js';

/** Current steady_state Professional calculation is the Level 2 use case. */
export const STEADY_STATE_PROFESSIONAL_REQUESTED_LEVEL: UseLevel = 2;

export interface ComposeBuildingProjectEngineeringQualityInput {
  project: BuildingProject;
  /** Complete numeric steady_state result; it is never recomputed here. */
  calculation: BuildingLoadCalculation;
  /** Existing physical-completeness authority; this helper does not recalculate it. */
  physicalCompleteness: boolean;
  /** Optional deterministic clock supplied by tests/replay callers. */
  evaluatedAt?: string;
}

function requestedServicesOf(calculation: BuildingLoadCalculation): EngineeringQualityService[] {
  return calculation.inputSnapshot.requestedServices.filter(
    (service): service is EngineeringQualityService => service === 'heating' || service === 'cooling',
  );
}

function qualityAssumptions(
  adapterAssumptions: readonly string[],
  adapterWarnings: readonly string[],
): string[] {
  const assumptions = [...adapterAssumptions];
  if (adapterWarnings.length > 0) {
    assumptions.push(`B2 adapter diagnostics: ${adapterWarnings.join('; ')}`);
  }
  return assumptions;
}

/**
 * Attach one immutable quality assessment to an already-computed result.
 * Adapter contract errors intentionally propagate; they are programming/data
 * contract failures, not a blocked quality gate and never a PASS downgrade.
 */
export function composeBuildingProjectEngineeringQuality(
  input: ComposeBuildingProjectEngineeringQualityInput,
): BuildingLoadCalculation {
  const { project, calculation } = input;
  const adapterResult = buildEngineeringQualityFields({
    project,
    steadyStateCalculation: calculation,
    physicalCompleteness: input.physicalCompleteness,
  });
  const engineeringQuality = computeEngineeringQuality({
    evaluatedAt: input.evaluatedAt ?? calculation.calculatedAt,
    requestedLevel: STEADY_STATE_PROFESSIONAL_REQUESTED_LEVEL,
    requestedServices: requestedServicesOf(calculation),
    physicalCompleteness: adapterResult.physicalCompleteness,
    legacyUnassessed: false,
    coverage: adapterResult.coverage,
    fields: adapterResult.fields,
    assumptions: qualityAssumptions(adapterResult.assumptions, adapterResult.warnings),
  });

  return {
    ...calculation,
    engineeringQuality,
  };
}
