/**
 * CM16 — assemble the exact CM11 BuildingProjectConfiguratorAdapterInput from
 * live persisted data.
 *
 * Pure assembly only: it PROJECTS the persisted Building Project into the
 * adapter-friendly view (overlaying the CM13/CM14 "proposed extension fields"
 * that the persisted DTO does not itself store on every nested snapshot) and
 * returns ONE coherent input object. It validates nothing, calls nothing, and
 * mutates nothing — the persisted project/load/snapshot objects are deep-copied
 * structurally via spread (no shared-nested mutation).
 */
import type { BuildingProject } from "../buildingProjectTypes.js";
import type {
  AdapterBuildingProject,
  AdapterLoadCalculation,
  AdapterObjectSnapshot,
  AdapterSystemConfiguration,
  BuildingProjectConfiguratorAdapterInput,
  DeepReadonly,
  EngineeringCatalogStateReference,
  LoadRevisionReference,
} from "../buildingProjectConfiguratorAdapter/types.js";
import type { ConfiguratorSelectionIntent } from "../engineeringConfigurator/types.js";
import { buildMatcherRequestPolicy, buildPolicyIdentities } from "./policy.js";

export interface AssembleAdapterInputArgs {
  /** Live, read-only Building Project snapshot (already normalized on read). */
  project: BuildingProject;
  /** CM14-functional load revision reference (persisted identity + canonical facts). */
  loadRevisionReference: LoadRevisionReference;
  /** One coherent CM15 catalog state reference (single provider read). */
  engineeringCatalogStateReference: DeepReadonly<EngineeringCatalogStateReference>;
  selectionIntent: ConfiguratorSelectionIntent;
}

/**
 * Project the persisted load's inputSnapshot into the adapter load view:
 * overlay the coverage intent (from project.calculationConfiguration) and the
 * confirmed engineering design inputs (from the confirmed system snapshot).
 * The persisted `project.loads` is NOT mutated.
 */
function toAdapterLoad(project: BuildingProject): AdapterLoadCalculation | null {
  const load = project.loads ?? null;
  if (load == null) return null;
  const coverage = project.calculationConfiguration ?? null;
  const design = project.systemsConfigurationSnapshot?.engineeringDesignInputs ?? null;
  return {
    ...load,
    inputSnapshot: {
      ...load.inputSnapshot,
      calculationConfiguration: coverage,
      systemEngineeringDesignInputs: design,
    },
  } as unknown as AdapterLoadCalculation;
}

/** Overlay the coverage intent onto the frozen object snapshot view. */
function toAdapterObjectSnapshot(project: BuildingProject): AdapterObjectSnapshot | null {
  const snap = project.objectConfirmedSnapshot ?? null;
  if (snap == null) return null;
  const coverage = project.calculationConfiguration ?? null;
  return {
    ...snap,
    calculationConfiguration: coverage,
  } as unknown as AdapterObjectSnapshot;
}

/** Project the whole live project into the AdapterBuildingProject view. */
function toAdapterProject(project: BuildingProject, adapterLoad: AdapterLoadCalculation | null): AdapterBuildingProject {
  return {
    ...project,
    calculationConfiguration: project.calculationConfiguration ?? null,
    systemsConfiguration: project.systemsConfiguration as AdapterSystemConfiguration | null,
    systemsConfigurationSnapshot: project.systemsConfigurationSnapshot as AdapterSystemConfiguration | null,
    objectConfirmedSnapshot: toAdapterObjectSnapshot(project),
    loads: adapterLoad,
  } as unknown as AdapterBuildingProject;
}

/**
 * Single public assembly entry point. CM16 owns only the ASSEMBLY; the CM11
 * adapter owns validation. No second adapter, no Matcher, no `configure...`.
 */
export function assembleAdapterInput(args: AssembleAdapterInputArgs): BuildingProjectConfiguratorAdapterInput {
  const { project, loadRevisionReference, engineeringCatalogStateReference, selectionIntent } = args;
  const load = toAdapterLoad(project);
  const adapterProject = toAdapterProject(project, load);
  return {
    project: adapterProject,
    loadCalculation: load,
    confirmedSystemSnapshot: project.systemsConfigurationSnapshot as AdapterSystemConfiguration | null,
    loadRevisionReference,
    engineeringCatalogStateReference,
    selectionIntent,
    policyIdentities: buildPolicyIdentities(),
    matcherRequestPolicy: buildMatcherRequestPolicy(),
  };
}