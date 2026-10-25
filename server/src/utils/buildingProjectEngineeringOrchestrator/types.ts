/**
 * CM16 — Building Project → Engineering Configurator live-orchestration boundary.
 *
 * This module declares the deterministic orchestration result contract and the
 * structural provider dependency used by the orchestrator. It imports ONLY the
 * frozen CM9/CM11 contract vocabulary (types + constant literals) and the
 * persisted Building Project DTO shape. No runtime body, no fs/db/network, no
 * clock/random, no Matcher, no mutation.
 */

import type {
  BuildingProjectConfiguratorAdapterResult,
  EngineeringCatalogStateReference,
  DeepReadonly,
} from "../buildingProjectConfiguratorAdapter/types.js";
import type {
  ConfiguratorSelectionIntent,
  EngineeringCatalogStateRevision,
  BlockedEngineeringConfiguratorResult,
  SuccessfulEngineeringConfiguratorResult,
} from "../engineeringConfigurator/types.js";

/**
 * Orchestration contract identity (frozen CM16 literal). Versioned separately
 * from the CM9 policy / CM11 adapter contract.
 */
export const LIVE_ORCHESTRATION_CONTRACT_ID =
  "ohmx.building-project-engineering-orchestrator.v1" as const;
export const LIVE_ORCHESTRATION_CONTRACT_VERSION = "1.0.0" as const;

/**
 * The two deterministic orchestration terminal states. DELIBERATELY NOT
 * "MATCHED" / "COMPLETE": product resolution and commerce remain downstream
 * (CM17+). A Configurator that returns READY_WITH_WARNINGS lands in CONFIGURED;
 * every other terminal condition lands in BLOCKED.
 */
export type OrchestrationStatus = "BLOCKED" | "CONFIGURED";

/** A single deterministic orchestration diagnostic (stable code + message). */
export interface OrchestrationDiagnostic {
  code: string;
  message: string;
}

/**
 * Orchestrator-level fail-closed reason. Non-null ONLY when the pipeline was
 * stopped BEFORE the CM11 adapter was invoked (structural read/coherence gate).
 * Adapter / Configurator blockers are carried inside `adapterResult` /
 * `configuratorResult` instead of being re-interpreted here.
 */
export interface OrchestrationBlocker {
  code: string;
  message: string;
}

/**
 * Minimal structural provider dependency. Satisfied by the CM15 production
 * provider (EngineeringCatalogStateProvider.getCurrentReference) and by any
 * test double returning the frozen CM11 reference shape. The orchestrator reads
 * the reference exactly once per execution.
 */
export interface EngineeringCatalogStateProviderLike {
  getCurrentReference(): Promise<DeepReadonly<EngineeringCatalogStateReference>>;
}

/** Shared identity surface present on both terminal states. */
export interface LiveOrchestrationResultBase {
  contractId: typeof LIVE_ORCHESTRATION_CONTRACT_ID;
  contractVersion: typeof LIVE_ORCHESTRATION_CONTRACT_VERSION;
  projectId: string;
  /** Building Project buildingRevision. Null only when the project is missing. */
  projectRevision: number | null;
  /** Building Project systemsRevision. Null only when the project is missing. */
  systemRevision: number | null;
  /** Persisted CM14 load identity (null when the project/load lacks one). */
  loadCalculationRevision: string | null;
  sourceCalculationId: string | null;
  /** Current CM15 catalog state revision (null when unavailable/not-yet-read). */
  engineeringCatalogStateRevision: EngineeringCatalogStateRevision | null;
  /** Derived revision-based staleness (isLoadStale). False when load absent. */
  loadStale: boolean;
  /** The request-level selection intent this execution was run with. */
  selectionIntent: ConfiguratorSelectionIntent;
  /** Orchestrator-level diagnostics (provenance of why a stage was skipped). */
  diagnostics: readonly OrchestrationDiagnostic[];
}

/**
 * BLOCKED — deterministic fail-closed terminal state.
 *
 * Three sub-cases, discriminated by which stage stopped the pipeline:
 *   - pre-adapter gate  : `blocker` non-null, `adapterResult` null,
 *                         `configuratorResult` null.
 *   - adapter BLOCKED   : `blocker` null, `adapterResult.status === "BLOCKED"`,
 *                         `configuratorResult` null.
 *   - configurator BLOCKED: `blocker` null, `adapterResult.status === "READY"`,
 *                         `configuratorResult.status === "BLOCKED"`.
 */
export interface BlockedLiveOrchestrationResult extends LiveOrchestrationResultBase {
  status: "BLOCKED";
  blocker: OrchestrationBlocker | null;
  adapterResult: BuildingProjectConfiguratorAdapterResult | null;
  configuratorResult: BlockedEngineeringConfiguratorResult | null;
}

/**
 * CONFIGURED — the adapter produced READY input and the Configurator produced a
 * READY_WITH_WARNINGS result. No product resolution, no commerce, no Matcher.
 * The full CM11 adapter trace (sourceTrace + revisionTrace) and the CM9
 * Configurator result are preserved verbatim.
 */
export interface ConfiguredLiveOrchestrationResult extends LiveOrchestrationResultBase {
  status: "CONFIGURED";
  blocker: null;
  adapterResult: Extract<BuildingProjectConfiguratorAdapterResult, { status: "READY" }>;
  configuratorResult: SuccessfulEngineeringConfiguratorResult;
}

export type BuildingProjectEngineeringOrchestrationResult =
  | BlockedLiveOrchestrationResult
  | ConfiguredLiveOrchestrationResult;