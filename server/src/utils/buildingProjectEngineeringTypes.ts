/**
 * Building Project Phase 3.2B — Engineering Registry + Input Resolver domain types.
 *
 * Typed foundation ONLY. No resolver behavior, no QUICK v1 integration.
 * Semantics follow the frozen MASTER:
 *   reports/building-project/BUILDING-PROJECT-ENGINEERING-MASTER-SPEC.md
 *
 * - 31 canonical engineering input IDs (§1A.2 / §47)
 * - exact sourceMode / resolutionStatus tokens (§8 / §1B.5)
 * - service applicability (§1A.2)
 * - 11 version axes (§34)
 * - completeness counters (§1A.4 / §39)
 *
 * Single-source-of-truth convention (PART 1A):
 * the readonly const tuple is the canonical list; each union type is DERIVED
 * from it via `(typeof TUPLE)[number]`. The literal list is never duplicated.
 */

/** Canonical engineering input IDs — single source of truth (frozen MASTER §1A.2 / §47, exactly 31). */
export const ENGINEERING_INPUT_IDS = [
  'areaM2',
  'heightM',
  'volumeM3',
  'externalWallAreaM2',
  'windowAreaM2',
  'externalDoorAreaM2',
  'roofExposureAreaM2',
  'groundFloorAreaM2',
  'U_wall',
  'U_roof',
  'U_floor',
  'U_window',
  'U_door',
  'TinHeating',
  'ToutHeatingDesign',
  'ventilationFlowM3h',
  'infiltrationMethod',
  'infiltrationFlowM3h',
  'airChangesPerHour',
  'thermalBridgePsi',
  'thermalBridgeLength',
  'TinCooling',
  'ToutCoolingDesign',
  'SHGC',
  'windowOrientation',
  'shadingFactor',
  'occupancy',
  'lightingGainW',
  'equipmentGainW',
  'operatingSchedule',
  'humidityLatentMethod',
] as const;

/** Canonical engineering input identifier (derived from ENGINEERING_INPUT_IDS). */
export type EngineeringInputId = (typeof ENGINEERING_INPUT_IDS)[number];

/** How a value originated — single source of truth (frozen MASTER, exactly 5 tokens). */
export const ENGINEERING_SOURCE_MODES = [
  'inherited',
  'derived',
  'profile_default',
  'suggested',
  'manual',
] as const;

export type EngineeringSourceMode = (typeof ENGINEERING_SOURCE_MODES)[number];

/** Whether a value is resolved/blocked — single source of truth (frozen MASTER, exactly 6 tokens). */
export const ENGINEERING_RESOLUTION_STATUSES = [
  'resolved',
  'missing',
  'not_applicable',
  'resolved_zero',
  'needs_review',
  'stale_input',
] as const;

export type EngineeringResolutionStatus = (typeof ENGINEERING_RESOLUTION_STATUSES)[number];

/** Service applicability (frozen MASTER §1A.2). */
export type EngineeringServiceApplicability = 'heating' | 'cooling' | 'both';

/** A resolved engineering value. `null` = unresolved (never silently zero). */
export type EngineeringInputValue = number | string | boolean | null;

/** Provenance confidence (frozen MASTER §9 — non-numeric). */
export type EngineeringConfidence = 'high' | 'medium' | 'low';

/**
 * A versioned reference to a profile entity (frozen MASTER "profile references").
 *
 * This is the ONE shared profile-reference shape. It lives here (domain types)
 * so both the engineering input definitions and the profiles module import the
 * same type without any circular runtime import.
 */
export interface EngineeringProfileReference {
  profileId: string;
  profileVersion: string | null;
}

/**
 * Provenance metadata for one resolved input (frozen MASTER §9).
 *
 * `sourceMode` may be `null` when there is no originating value. Invariants
 * (enforced in PART 3 / tests, NOT here):
 *   - `resolved`        → sourceMode exists and is NOT `suggested`.
 *   - `resolved_zero`   → sourceMode exists; normally `derived`.
 *   - `missing`         → sourceMode may be `null`; if a suggestion exists it
 *                         may be `suggested`, but the input stays unresolved.
 *   - `not_applicable`  → sourceMode may be `null`.
 *   - `needs_review` / `stale_input` → preserve the existing value's source when one exists.
 *
 * `resolutionStatus` is the separate authority for resolved/blocking state;
 * a missing/not-applicable input must NOT be given a fabricated sourceMode.
 */
export interface EngineeringInputProvenance {
  sourceMode: EngineeringSourceMode | null;
  resolutionStatus: EngineeringResolutionStatus;
  sourceId: string | null;
  profileId: string | null;
  profileVersion: string | null;
  originalResolvedValue: EngineeringInputValue | null;
  userOverridden: boolean;
  resolvedAt: string | null;
  confidence: EngineeringConfidence | null;
  resolutionRuleId?: string | null;
  dependencies?: readonly EngineeringInputId[];
}

/** One fully resolved engineering input (resolver output). */
export interface ResolvedEngineeringInput {
  inputId: EngineeringInputId;
  value: EngineeringInputValue;
  unit: string | null;
  provenance: EngineeringInputProvenance;
}

/** Static definition of a canonical engineering input (frozen MASTER §47). */
export interface EngineeringInputDefinition {
  inputId: EngineeringInputId;
  unit: string | null;
  serviceApplicability: EngineeringServiceApplicability;
  allowedSourceModes: readonly EngineeringSourceMode[];
  editable: boolean;
  dependencies: readonly EngineeringInputId[];
  profileRefs: readonly EngineeringProfileReference[];
  // requiredWhen + applicability (typed safe structure) are introduced in PART 2.
}

/**
 * The 11 independent version axes (frozen MASTER §34).
 *
 * NOTE on axis 4 (frozen MASTER §34 vs §35):
 *   `formulaVersion`  = the LOGICAL version axis name (listed in ENGINEERING_VERSION_AXES below).
 *   `formulaVersions` = the CONCRETE per-formula snapshot map stored on EngineeringRegistryVersionSet.
 * Do NOT rename one into the other; both are intentional and distinct.
 */
export interface EngineeringRegistryVersionSet {
  registrySchemaVersion: string;
  methodVersion: string;
  parameterSetVersion: string;
  formulaVersions: Record<string, string>;
  climateDatasetVersion: string;
  regionMappingSetVersion: string;
  defaultProfileSetVersion: string;
  objectTypeProfileSetVersion: string;
  uncertaintyBandSetVersion: string;
  inputResolutionRulesVersion: string;
  presentationVersion: string;
}

/**
 * The 11 LOGICAL version-axis names — single source of truth (frozen MASTER §34).
 * Order + names are canonical; the union type is derived from this tuple.
 */
export const ENGINEERING_VERSION_AXES = [
  'registrySchemaVersion',
  'methodVersion',
  'parameterSetVersion',
  'formulaVersion',
  'climateDatasetVersion',
  'regionMappingSetVersion',
  'defaultProfileSetVersion',
  'objectTypeProfileSetVersion',
  'uncertaintyBandSetVersion',
  'inputResolutionRulesVersion',
  'presentationVersion',
] as const;

/** A logical version-axis name (derived from ENGINEERING_VERSION_AXES). */
export type EngineeringVersionAxis = (typeof ENGINEERING_VERSION_AXES)[number];

/** Conditional PROFESSIONAL completeness counters (frozen MASTER §1A.4 / §39). */
export interface EngineeringCompleteness {
  applicableRequiredCount: number;
  resolvedRequiredCount: number;
  missingRequiredCount: number;
}
