/**
 * CM11 adapter — coverage intent, arithmetic and revision safety.
 * Frozen CM10 §13–15. Never recomputes object/room loads; never infers
 * confirmation from area equality or ratio == 1.
 */
import type { BuildingProjectConfiguratorAdapterInput, CoverageIntent } from "./types.js";
import type { Diagnostics } from "./policy.js";
import {
  block,
  bothServices,
  canonicalIds,
  deepEqual,
  finite,
  nonEmpty,
  revision,
  CM8_COVERAGE_AREA_EPSILON_M2,
  CM8_COVERAGE_RATIO_EPSILON,
} from "./policy.js";

export interface CoverageFacts {
  intent: CoverageIntent;
  declaredAreaM2: number;
  modeledAreaM2: number;
  ratio: number;
}

export function validateCoverage(
  input: BuildingProjectConfiguratorAdapterInput,
  sortedRoomIds: readonly string[],
  d: Diagnostics,
): CoverageFacts | null {
  const project = input.project;
  const load = input.loadCalculation;
  const quality = load?.engineeringQuality;

  const sources: Array<{ path: string; value: CoverageIntent | null | undefined }> = [
    { path: "project.calculationConfiguration.coverageIntent", value: project?.calculationConfiguration?.coverageIntent },
    {
      path: "project.objectConfirmedSnapshot.calculationConfiguration.coverageIntent",
      value: project?.objectConfirmedSnapshot?.calculationConfiguration?.coverageIntent,
    },
    {
      path: "loadCalculation.inputSnapshot.calculationConfiguration.coverageIntent",
      value: load?.inputSnapshot?.calculationConfiguration?.coverageIntent,
    },
  ];

  const primary = sources[0].value;
  if (!primary) {
    block(d, "LOAD_COVERAGE_INCOMPLETE", "project.calculationConfiguration.coverageIntent");
    return null;
  }
  for (const s of sources.slice(1)) {
    if (!s.value || !deepEqual(primary, s.value)) {
      block(d, "LOAD_COVERAGE_INCOMPLETE", s.path);
    }
  }

  const coverage = quality?.coverage;
  if (!coverage) {
    block(d, "LOAD_COVERAGE_INCOMPLETE", "loadCalculation.engineeringQuality.coverage");
    return null;
  }
  if (coverage.scope !== primary.calculationScope || coverage.confirmation !== primary.coverageConfirmation) {
    block(d, "LOAD_COVERAGE_INCOMPLETE", "loadCalculation.engineeringQuality.coverage scope/confirmation vs intent");
  }

  // Pilot scope — exact CM10 vocabulary (§13).
  if (primary.calculationScope !== "WHOLE_OBJECT" || primary.coverageConfirmation !== "WHOLE_OBJECT_CONFIRMED") {
    block(d, "LOAD_COVERAGE_INCOMPLETE", "calculationConfiguration.coverageIntent.calculationScope/coverageConfirmation");
  }

  // Revision safety (§15): old-building confirmation never carried forward.
  if (!revision(primary.buildingRevisionAtConfirmation) || primary.buildingRevisionAtConfirmation !== project.buildingRevision) {
    block(d, "LOAD_COVERAGE_INCOMPLETE", "calculationConfiguration.coverageIntent.buildingRevisionAtConfirmation");
  }
  if (!nonEmpty(primary.sourceReference)) {
    block(d, "LOAD_COVERAGE_INCOMPLETE", "calculationConfiguration.coverageIntent.sourceReference");
  }

  if (!bothServices(primary.requestedServices)) {
    block(d, "LOAD_COVERAGE_INCOMPLETE", "calculationConfiguration.coverageIntent.requestedServices");
  }
  const included = canonicalIds(primary.includedRoomIds as string[]);
  if (!deepEqual(included, canonicalIds(sortedRoomIds as string[]))) {
    block(d, "LOAD_COVERAGE_INCOMPLETE", "calculationConfiguration.coverageIntent.includedRoomIds");
  }
  if ((primary.excludedRoomIds as readonly string[]).length !== 0) {
    block(d, "LOAD_COVERAGE_INCOMPLETE", "calculationConfiguration.coverageIntent.excludedRoomIds");
  }
  // Nonempty zone intent is a pilot topology blocker, not a coverage gap (§coverage.nonPilotScopes).
  if ((primary.includedZoneIds as readonly string[]).length !== 0) {
    block(d, "TOPOLOGY_NOT_SUPPORTED", "calculationConfiguration.coverageIntent.includedZoneIds");
  }

  // Arithmetic (§14). Supplied coverage validated, never recomputed.
  const declared = coverage.declaredAreaM2;
  const modeled = coverage.modeledAreaM2;
  const ratio = coverage.ratio;
  if (!finite(declared) || declared <= 0) block(d, "LOAD_COVERAGE_INCOMPLETE", "coverage.declaredAreaM2");
  if (!finite(modeled) || modeled <= 0) block(d, "LOAD_COVERAGE_INCOMPLETE", "coverage.modeledAreaM2");
  if (!finite(ratio) || ratio <= 0) block(d, "LOAD_COVERAGE_INCOMPLETE", "coverage.ratio");
  if (finite(declared) && finite(modeled)) {
    if (Math.abs(modeled - declared) > CM8_COVERAGE_AREA_EPSILON_M2) {
      block(d, "LOAD_COVERAGE_INCOMPLETE", "coverage area (modeled vs declared)");
    }
    if (finite(project.totalAreaM2) && Math.abs(project.totalAreaM2 - declared) > CM8_COVERAGE_AREA_EPSILON_M2) {
      block(d, "LOAD_COVERAGE_INCOMPLETE", "coverage area (totalAreaM2 vs declared)");
    }
    if (modeled > 0 && finite(ratio) && Math.abs(modeled / declared - ratio) > CM8_COVERAGE_RATIO_EPSILON) {
      block(d, "LOAD_COVERAGE_INCOMPLETE", "coverage ratio arithmetic");
    }
  }
  if (finite(ratio) && Math.abs(ratio - 1) > CM8_COVERAGE_RATIO_EPSILON) {
    block(d, "LOAD_COVERAGE_INCOMPLETE", "coverage ratio == 1");
  }

  // sum(unique calculated room areas) == modeledAreaM2.
  if (finite(modeled) && load && Array.isArray(load.roomResults)) {
    let sum = 0;
    let complete = true;
    for (const room of load.roomResults) {
      if (!finite(room?.areaM2)) {
        complete = false;
        break;
      }
      sum += room.areaM2 as number;
    }
    if (complete && Math.abs(sum - (modeled as number)) > CM8_COVERAGE_AREA_EPSILON_M2) {
      block(d, "LOAD_COVERAGE_INCOMPLETE", "coverage area (sum of room areas vs modeled)");
    }
  }

  return { intent: primary, declaredAreaM2: declared as number, modeledAreaM2: modeled as number, ratio: ratio as number };
}