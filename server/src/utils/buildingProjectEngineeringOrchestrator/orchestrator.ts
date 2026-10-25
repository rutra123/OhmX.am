/**
 * CM16 — live Building Project → CM11 Adapter → CM9 Configurator orchestration.
 *
 * The FIRST server-side orchestration boundary. It:
 *
 *   1. reads the current Building Project (read-only, no mutation)
 *   2. runs deterministic structural pre-gates (fail-closed, no adapter call)
 *   3. obtains ONE current CM15 catalog state reference (single provider read)
 *   4. builds the CM14-functional load revision reference (no re-hash)
 *   5. assembles the exact CM11 adapter input (assembly, not validation)
 *   6. calls buildEngineeringConfiguratorInput(...) EXACTLY ONCE
 *   7. if READY, calls configureHeatPumpFanCoil(adapter.input) EXACTLY ONCE
 *   8. returns BLOCKED or CONFIGURED
 *
 * STOP THERE — no Catalog Matcher, no product selection, no commerce, no
 * load recalculation, no hash production, no persistence, no route, no client.
 *
 * Determinism: given the same project + load + catalog state, the result is
 * structurally equivalent (no Date.now / Math.random / randomUUID / env order).
 */

import type { BuildingProject } from "../buildingProjectTypes.js";
import { loadProject } from "../buildingProjectService.js";
import { isLoadStale } from "../buildingProjectLoads.js";
import { buildEngineeringConfiguratorInput } from "../buildingProjectConfiguratorAdapter/index.js";
import type {
  BuildingProjectConfiguratorAdapterInput,
  BuildingProjectConfiguratorAdapterResult,
  DeepReadonly,
  EngineeringCatalogStateReference,
  LoadRevisionReference,
} from "../buildingProjectConfiguratorAdapter/types.js";
import { configureHeatPumpFanCoil } from "../engineeringConfigurator/index.js";
import type {
  ConfiguratorSelectionIntent,
  EngineeringCatalogStateRevision,
  EngineeringConfiguratorInput,
  BlockedEngineeringConfiguratorResult,
  SuccessfulEngineeringConfiguratorResult,
} from "../engineeringConfigurator/types.js";
import {
  buildCanonicalLoadFacts,
  loadRevisionIdentityOf,
  loadRevisionAlgorithmMatches,
  LOAD_REVISION_ALGORITHM_VERSION,
} from "../buildingProjectLoadRevision.js";
import { EngineeringCatalogStateProvider } from "../engineeringCatalogState/index.js";
import { assembleAdapterInput } from "./assembleAdapterInput.js";
import {
  LIVE_ORCHESTRATION_CONTRACT_ID,
  LIVE_ORCHESTRATION_CONTRACT_VERSION,
  type BlockedLiveOrchestrationResult,
  type BuildingProjectEngineeringOrchestrationResult,
  type ConfiguredLiveOrchestrationResult,
  type EngineeringCatalogStateProviderLike,
  type OrchestrationBlocker,
  type OrchestrationDiagnostic,
} from "./types.js";
import {
  gateProjectPresence,
  gateProjectConfirmed,
  gateConfirmedSystemSnapshot,
  gateCoverageIntent,
  gateDesignInputs,
  gateLoadPresent,
  loadRevisionIdentityPresent,
} from "./validation.js";

export interface RunBuildingProjectEngineeringConfigurationOptions {
  /** Read the live project by id through the existing Building Project read service. */
  projectId?: string;
  /** Alternatively supply a live project snapshot directly (no read service call). */
  projectSnapshot?: BuildingProject;
  /** Request-level selection intent. Defaults to PROFESSIONAL. */
  selectionIntent?: ConfiguratorSelectionIntent;
  /** Catalog state provider. Defaults to the CM15 production provider. */
  catalogProvider?: EngineeringCatalogStateProviderLike;
  /** Injectable read (defaults to the existing Building Project read service). */
  readProject?: (id: string) => BuildingProject | null;
  /** Test seam: adapter function (defaults to buildEngineeringConfiguratorInput). */
  adapter?: (input: BuildingProjectConfiguratorAdapterInput) => BuildingProjectConfiguratorAdapterResult;
  /** Test seam: configurator function (defaults to configureHeatPumpFanCoil). */
  configurator?: (
    input: EngineeringConfiguratorInput,
  ) => SuccessfulEngineeringConfiguratorResult | BlockedEngineeringConfiguratorResult;
}

function catalogRevisionOf(ref: DeepReadonly<EngineeringCatalogStateReference>): EngineeringCatalogStateRevision | null {
  return ref.status === "AVAILABLE" ? (ref.revision as EngineeringCatalogStateRevision) : null;
}

function diagnostic(code: string, message: string): OrchestrationDiagnostic {
  return { code, message };
}

interface BaseFields {
  projectId: string;
  projectRevision: number | null;
  systemRevision: number | null;
  loadCalculationRevision: string | null;
  sourceCalculationId: string | null;
  engineeringCatalogStateRevision: EngineeringCatalogStateRevision | null;
  loadStale: boolean;
  selectionIntent: ConfiguratorSelectionIntent;
}

function baseFields(
  project: BuildingProject | null,
  loadRevision: string | null,
  sourceCalculationId: string | null,
  catalogRevision: EngineeringCatalogStateRevision | null,
  loadStale: boolean,
  selectionIntent: ConfiguratorSelectionIntent,
): BaseFields {
  return {
    projectId: project?.id ?? "",
    projectRevision: project?.buildingRevision ?? null,
    systemRevision: project?.systemsRevision ?? null,
    loadCalculationRevision: loadRevision,
    sourceCalculationId,
    engineeringCatalogStateRevision: catalogRevision,
    loadStale,
    selectionIntent,
  };
}

function blockedResult(
  base: BaseFields,
  blocker: OrchestrationBlocker | null,
  adapterResult: BuildingProjectConfiguratorAdapterResult | null,
  diagnostics: readonly OrchestrationDiagnostic[],
  configuratorResult: BlockedEngineeringConfiguratorResult | null = null,
): BlockedLiveOrchestrationResult {
  return {
    contractId: LIVE_ORCHESTRATION_CONTRACT_ID,
    contractVersion: LIVE_ORCHESTRATION_CONTRACT_VERSION,
    status: "BLOCKED",
    ...base,
    blocker,
    adapterResult,
    configuratorResult,
    diagnostics,
  };
}

function configuredResult(
  base: BaseFields,
  adapterResult: Extract<BuildingProjectConfiguratorAdapterResult, { status: "READY" }>,
  configuratorResult: SuccessfulEngineeringConfiguratorResult,
): ConfiguredLiveOrchestrationResult {
  return {
    contractId: LIVE_ORCHESTRATION_CONTRACT_ID,
    contractVersion: LIVE_ORCHESTRATION_CONTRACT_VERSION,
    status: "CONFIGURED",
    ...base,
    blocker: null,
    adapterResult,
    configuratorResult,
    diagnostics: [diagnostic("configurator_invoked", "CM9 Configurator returned READY_WITH_WARNINGS.")],
  };
}

function providerUnavailableDiagnostics(ref: DeepReadonly<EngineeringCatalogStateReference>): OrchestrationDiagnostic[] {
  if (ref.status !== "UNAVAILABLE") return [];
  return (ref.errors ?? []).map((e) =>
    diagnostic(e.code ?? "catalog.unavailable", e.message ?? "Catalog state provider unavailable."),
  );
}

function gateDiagnostic(stage: string): OrchestrationDiagnostic {
  return diagnostic("adapter_not_invoked", `${stage} failed before the CM11 adapter; adapter not invoked.`);
}

/**
 * Public orchestration entry point. Exactly one clearly-defined production
 * path: read live project → structural gates → catalog reference → load
 * revision reference → adapter input → adapter → configurator → result.
 */
export async function runBuildingProjectEngineeringConfiguration(
  options: RunBuildingProjectEngineeringConfigurationOptions = {},
): Promise<BuildingProjectEngineeringOrchestrationResult> {
  const selectionIntent: ConfiguratorSelectionIntent = options.selectionIntent ?? "PROFESSIONAL";
  const readProject = options.readProject ?? loadProject;
  const provider: EngineeringCatalogStateProviderLike =
    options.catalogProvider ?? new EngineeringCatalogStateProvider();
  const adapterFn = options.adapter ?? buildEngineeringConfiguratorInput;
  const configuratorFn = options.configurator ?? configureHeatPumpFanCoil;

  // 1 — live project read (read-only, no mutation).
  const project: BuildingProject | null =
    options.projectSnapshot ?? (options.projectId != null ? readProject(options.projectId) ?? null : null);

  const absentBase = baseFields(null, null, null, null, false, selectionIntent);
  const presenceBlocker = gateProjectPresence(project);
  if (presenceBlocker) return blockedResult(absentBase, presenceBlocker, null, []);

  // 2 — structural confirm gates (project / system / coverage / design).
  const confirmedBase = baseFields(project, null, null, null, false, selectionIntent);
  const confirmedBlocker = gateProjectConfirmed(project!);
  if (confirmedBlocker) return blockedResult(confirmedBase, confirmedBlocker, null, [gateDiagnostic("Project confirmation")]);

  const systemBlocker = gateConfirmedSystemSnapshot(project!);
  if (systemBlocker) return blockedResult(confirmedBase, systemBlocker, null, [gateDiagnostic("Confirmed system snapshot")]);

  const coverageBlocker = gateCoverageIntent(project!);
  if (coverageBlocker) return blockedResult(confirmedBase, coverageBlocker, null, [gateDiagnostic("Coverage intent")]);

  const designBlocker = gateDesignInputs(project!);
  if (designBlocker) return blockedResult(confirmedBase, designBlocker, null, [gateDiagnostic("Design inputs")]);

  // 3 — load presence + revision-based staleness (isLoadStale, not hash).
  const loadBlocker = gateLoadPresent(project!);
  if (loadBlocker) return blockedResult(confirmedBase, loadBlocker, null, [gateDiagnostic("Load presence")]);

  const load = project!.loads!;
  const stale = isLoadStale(project!, load);
  if (stale) {
    return blockedResult(
      baseFields(
        project,
        load.loadCalculationRevision ?? null,
        load.sourceCalculationId ?? null,
        null,
        true,
        selectionIntent,
      ),
      { code: "load.stale", message: "Persisted load is stale against current building/systems revisions." },
      null,
      [gateDiagnostic("Load staleness")],
    );
  }

  // 4 — persisted CM14 load identity (both fields, no re-hash, no fabrication).
  if (!loadRevisionIdentityPresent(load)) {
    return blockedResult(
      baseFields(project, null, null, null, false, selectionIntent),
      { code: "load_revision.missing", message: "Persisted load lacks the CM14 loadCalculationRevision/sourceCalculationId identity." },
      null,
      [gateDiagnostic("Load revision identity")],
    );
  }
  if (!loadRevisionAlgorithmMatches(load)) {
    return blockedResult(
      baseFields(project, load.loadCalculationRevision ?? null, load.sourceCalculationId ?? null, null, false, selectionIntent),
      { code: "load_revision.algorithm_mismatch", message: "Persisted load revision was produced by a different algorithm version." },
      null,
      [gateDiagnostic("Load revision algorithm")],
    );
  }
  const identity = loadRevisionIdentityOf(load) as { loadCalculationRevision: string; sourceCalculationId: string };

  // 5 — exactly ONE current catalog state reference (single coherent provider read).
  const catalogReference = await provider.getCurrentReference();
  if (catalogReference.status !== "AVAILABLE") {
    return blockedResult(
      baseFields(project, identity.loadCalculationRevision, identity.sourceCalculationId, null, false, selectionIntent),
      { code: "catalog.unavailable", message: "CM15 catalog state provider returned UNAVAILABLE." },
      null,
      [
        gateDiagnostic("Catalog state unavailable"),
        ...providerUnavailableDiagnostics(catalogReference),
      ],
    );
  }
  const catalogRevision = catalogRevisionOf(catalogReference);

  // 6 — load revision reference from the real persisted CM14 identity + canonical
  // facts. buildCanonicalLoadFacts performs NO hashing in the orchestrator.
  let loadRevisionReference: LoadRevisionReference;
  try {
    const canonicalFacts = buildCanonicalLoadFacts(project!, load);
    loadRevisionReference = {
      status: "AVAILABLE",
      revision: identity.loadCalculationRevision,
      sourceCalculationId: identity.sourceCalculationId,
      algorithmVersion: LOAD_REVISION_ALGORITHM_VERSION,
      canonicalFacts,
      errors: [],
    };
  } catch (err) {
    // Expected incomplete engineering state is an engineering blocker, not a throw.
    return blockedResult(
      baseFields(project, identity.loadCalculationRevision, identity.sourceCalculationId, catalogRevision, false, selectionIntent),
      {
        code: "load_revision.missing",
        message: `Unable to build canonical load facts for the revision reference: ${err instanceof Error ? err.message : String(err)}`,
      },
      null,
      [gateDiagnostic("Canonical load facts")],
    );
  }

  // 7 — assemble the exact CM11 input.
  const adapterInput = assembleAdapterInput({
    project: project!,
    loadRevisionReference,
    engineeringCatalogStateReference: catalogReference,
    selectionIntent,
  });

  // 8 — call the adapter exactly once.
  const adapterResult = adapterFn(adapterInput);
  const base = baseFields(
    project,
    identity.loadCalculationRevision,
    identity.sourceCalculationId,
    catalogRevision,
    false,
    selectionIntent,
  );
  if (adapterResult.status !== "READY") {
    return blockedResult(base, null, adapterResult, [
      diagnostic("configurator_not_invoked", "CM11 adapter returned BLOCKED; CM9 Configurator not called."),
    ]);
  }

  // 9 — call the configurator exactly once, using the exact adapter-produced input.
  const configuratorResult = configuratorFn(
    adapterResult.input as unknown as EngineeringConfiguratorInput,
  );
  if (configuratorResult.status !== "READY_WITH_WARNINGS") {
    return blockedResult(base, null, adapterResult, [
      diagnostic("configurator_blocked", "CM9 Configurator returned BLOCKED."),
    ], configuratorResult);
  }

  // 10 — CONFIGURED: preserve adapter trace + full Configurator result. No Matcher.
  return configuredResult(base, adapterResult, configuratorResult);
}