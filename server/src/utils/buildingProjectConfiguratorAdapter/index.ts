/**
 * CM11 — Building Project → Engineering Configurator adapter public surface.
 * DESIGN ONLY: imports nothing that mutates, queries, persists, generates or
 * connects to a live system.
 */
export { buildEngineeringConfiguratorInput } from "./buildEngineeringConfiguratorInput.js";
export { ADAPTER_CONTRACT_ID, ADAPTER_CONTRACT_VERSION } from "./types.js";
export type {
  BuildingProjectConfiguratorAdapterInput,
  BuildingProjectConfiguratorAdapterResult,
  AdapterBlockingReason,
  AdapterBlockingReasonCode,
  AdapterWarning,
  AdapterWarningCode,
  CoverageIntent,
  HydronicDesignConditions,
  FanCoilSizingPolicyInput,
  CoolingIndoorDesignCondition,
  SystemEngineeringDesignInputs,
  LoadRevisionReference,
  EngineeringCatalogStateReference,
  EngineeringCatalogStateProvider,
  LoadRevisionProducer,
  AdapterPolicyIdentities,
  AdapterSourceTraceEntry,
  AdapterRevisionTrace,
  CanonicalLoadFingerprintFacts,
  CanonicalRoomLoadFacts,
  CanonicalServiceLoadFacts,
  CanonicalQualityFacts,
  CanonicalDesignInputs,
  ProviderDiagnostic,
} from "./types.js";