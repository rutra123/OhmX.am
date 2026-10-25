/**
 * CM16 — orchestrator structural read/coherence gates (fail-closed).
 *
 * These are the deterministic PRE-ADAPTER gates only. They check STRUCTURAL
 * readiness (presence + revision-based coherence) so the orchestrator can
 * produce a precise, stable BLOCKED result without invoking the adapter for
 * state it can already see is missing. They do NOT duplicate the CM11 deep
 * validation (coverage semantics, topology, operating conditions, wet bulb,
 * fan speed, quality gates, served rooms, load-readiness details): those are
 * left to buildEngineeringConfiguratorInput and surface verbatim in the
 * returned adapterResult.
 */
import type { BuildingProject } from "../buildingProjectTypes.js";
import type { OrchestrationBlocker } from "./types.js";

/** Frozen orchestrator blocker code vocabulary (pre-adapter gates only). */
export const ORCHESTRATION_BLOCKER_CODES = [
  "project.missing",
  "project.not_confirmed",
  "system.confirmed_snapshot_missing",
  "coverage.intent_missing",
  "design_inputs.missing",
  "load.missing",
  "load.stale",
  "load_revision.missing",
  "load_revision.algorithm_mismatch",
  "catalog.unavailable",
] as const;
export type OrchestrationBlockerCode = (typeof ORCHESTRATION_BLOCKER_CODES)[number];

export function blockOrchestration(code: OrchestrationBlockerCode, message: string): OrchestrationBlocker {
  return { code, message };
}

function isConfirmedSystem(config: unknown): boolean {
  const c = config as { configurationStatus?: unknown } | null | undefined;
  return typeof c?.configurationStatus === "string" && c.configurationStatus === "confirmed";
}

/** Gate 1 — a project must exist (read service returned a real object). */
export function gateProjectPresence(project: BuildingProject | null | undefined): OrchestrationBlocker | null {
  if (project == null) {
    return blockOrchestration("project.missing", "Building project not found (read service returned null).");
  }
  return null;
}

/**
 * Gate 2 — the project must be confirmed-and-frozen per the CM11 object
 * contract: status systems_configured + objectConfirmedAt + numeric
 * objectConfirmedRevision + objectConfirmedSnapshot present. Deeper object
 * revision parity is validated by the adapter.
 */
export function gateProjectConfirmed(project: BuildingProject): OrchestrationBlocker | null {
  const missingConfirmation =
    project.status !== "systems_configured" ||
    !project.objectConfirmedAt ||
    project.objectConfirmedRevision == null ||
    !Number.isFinite(project.objectConfirmedRevision) ||
    project.objectConfirmedSnapshot == null;
  if (missingConfirmation) {
    return blockOrchestration(
      "project.not_confirmed",
      "Project is not confirmed/frozen (status, objectConfirmedAt, objectConfirmedRevision, objectConfirmedSnapshot).",
    );
  }
  return null;
}

/** Gate 3 — exactly one coherent confirmed system snapshot must exist. */
export function gateConfirmedSystemSnapshot(project: BuildingProject): OrchestrationBlocker | null {
  if (!isConfirmedSystem(project.systemsConfigurationSnapshot)) {
    return blockOrchestration(
      "system.confirmed_snapshot_missing",
      "Confirmed system snapshot (systemsConfigurationSnapshot) is missing or not confirmed.",
    );
  }
  return null;
}

/** Gate 4 — an explicit calculation coverage intent must exist (present, not assessed). */
export function gateCoverageIntent(project: BuildingProject): OrchestrationBlocker | null {
  if (project.calculationConfiguration?.coverageIntent == null) {
    return blockOrchestration(
      "coverage.intent_missing",
      "Persisted calculationConfiguration.coverageIntent is missing (legacy UNKNOWN/UNCONFIRMED).",
    );
  }
  return null;
}

/** Gate 5 — confirmed-system engineering design inputs must exist (present, not assessed). */
export function gateDesignInputs(project: BuildingProject): OrchestrationBlocker | null {
  if (project.systemsConfigurationSnapshot?.engineeringDesignInputs == null) {
    return blockOrchestration(
      "design_inputs.missing",
      "Confirmed system snapshot engineeringDesignInputs is missing (legacy/unresolved).",
    );
  }
  return null;
}

/** Gate 6 — a persisted load result must exist. */
export function gateLoadPresent(project: BuildingProject): OrchestrationBlocker | null {
  if (project.loads == null) {
    return blockOrchestration("load.missing", "Persisted BuildingLoadCalculation (project.loads) is missing.");
  }
  return null;
}

/** Extract the persisted load's CM14 identity (both fields or none). */
export function loadRevisionIdentityPresent(load: unknown): boolean {
  const l = load as { loadCalculationRevision?: unknown; sourceCalculationId?: unknown } | null | undefined;
  return (
    typeof l?.loadCalculationRevision === "string" &&
    l.loadCalculationRevision.length > 0 &&
    typeof l?.sourceCalculationId === "string" &&
    l.sourceCalculationId.length > 0
  );
}