/**
 * Unified Building Project — Phase 1 object + rooms.
 * Later phases add systems, loads, selection, spec, PDF.
 * Does not replace Warm Floor Project or AI selector.
 */

import type {
  FloorPosition,
  InsulationLevel,
  ObjectType,
  WindowGlazingType,
} from './buildingProjectCatalog.js';
import type { EngineeringInputId } from './buildingProjectEngineeringTypes.js';

export type BuildingProjectStatus =
  | 'draft'
  | 'object_confirmed'
  | 'systems_configured'
  | 'calculated'
  | 'confirmed';

/** Phase 2.6 — spatial topology for private houses. */
export type BasementType = 'none' | 'heated' | 'unheated';
export type TopBoundaryType = 'direct_roof' | 'unheated_attic';
export type PlantLocationKind = 'room' | 'floor' | 'external' | 'not_defined';

export interface BuildingRegion {
  code: string;
  name: string;
}

/** Stable above-ground floor. `id` is deterministic (`floor-<level>`), NOT a UUID, so it survives reloads. */
export interface Floor {
  id: string;
  level: number;
  label: string;
}

/**
 * Normalized object topology. Only meaningful for private_house; null otherwise.
 * Basement / top boundary / plant location are topology/environment FACTS only —
 * no coefficients, no loads, no automatic pumps or separators.
 */
export interface BuildingTopology {
  floorCount: number;
  floors: Floor[];
  basementType: BasementType;
  topBoundaryType: TopBoundaryType;
  plantLocation: {
    kind: PlantLocationKind;
    floorId: string | null;
    roomId: string | null;
  };
}

export interface PlantLocationInput {
  kind?: PlantLocationKind;
  floorId?: string | null;
  roomId?: string | null;
}

export interface RoomGeometry {
  ceilingHeightM?: number | null;
  externalWallCount?: number | null;
  externalDoorCount?: number | null;
  floorPosition?: FloorPosition | null;
  spaceAbove?: string | null;
  spaceBelow?: string | null;
}

export interface RoomWindows {
  glazingType?: WindowGlazingType | null;
  count?: number | null;
  areaM2?: number | null;
}

export interface RoomExtras {
  geometry: RoomGeometry;
  windows: RoomWindows;
  insulationOverride?: InsulationLevel | null;
  conditions: string[];
  notes?: string | null;
  /** Phase 1: flags are stored only; no invented engineering coefficients. */
  engineeringUse: 'stored_only';
}

export interface BuildingRoom {
  id: string;
  roomType: string;
  name: string;
  areaM2: number | null;
  /** Phase 2.6: owning floor for private_house instances. Null/absent for legacy or non-house. */
  floorId?: string | null;
  extras: RoomExtras;
  /** Phase 3.2a — envelope element collections for the transmission engine. Null/absent until collected. */
  envelope?: RoomEnvelope | null;
  /** Phase 3.2b — air inputs (ventilation balance + infiltration). Null/absent until collected. */
  air?: RoomAir | null;
  /** Phase 3.2c — internal-gain inputs (occupancy/lighting/equipment). Null/absent until collected. */
  internalGains?: RoomInternalGains | null;
}

export interface BuildingProjectMeta {
  objectType: ObjectType;
  region: BuildingRegion | null;
  totalAreaM2: number | null;
  defaultCeilingHeightM: number;
  insulationLevel: InsulationLevel;
}

export interface BuildingProjectSnapshot {
  frozenAt: string;
  buildingRevision: number;
  name: string;
  objectType: ObjectType;
  region: BuildingRegion | null;
  totalAreaM2: number | null;
  defaultCeilingHeightM: number;
  insulationLevel: InsulationLevel;
  /** Phase 2.6: frozen topology (floors/basement/top boundary/plant location). Null for non-house. */
  topology: BuildingTopology | null;
  rooms: BuildingRoom[];
  roomCount: number;
  sumRoomAreaM2: number;
}

export interface CreateBuildingProjectInput {
  name?: string;
  objectType?: ObjectType;
  regionCode?: string | null;
  totalAreaM2?: number | null;
  defaultCeilingHeightM?: number;
  insulationLevel?: InsulationLevel;
  /** Phase 2.6: private_house above-ground floor count (>= 1). */
  floorCount?: number;
  basementType?: BasementType;
  topBoundaryType?: TopBoundaryType;
  plantLocation?: PlantLocationInput;
  rooms?: Array<Partial<BuildingRoom> & { roomType?: string; name?: string; areaM2?: number | null; floorId?: string | null }>;
}

export interface UpdateBuildingProjectInput {
  name?: string;
  objectType?: ObjectType;
  regionCode?: string | null;
  totalAreaM2?: number | null;
  defaultCeilingHeightM?: number;
  insulationLevel?: InsulationLevel;
  /** Phase 2.6 topology patch. */
  floorCount?: number;
  basementType?: BasementType;
  topBoundaryType?: TopBoundaryType;
  plantLocation?: PlantLocationInput;
}

export interface BuildingRoomInput {
  roomType?: string;
  name?: string;
  areaM2?: number | null;
  floorId?: string | null;
  extras?: Partial<RoomExtras> & {
    geometry?: Partial<RoomGeometry>;
    windows?: Partial<RoomWindows>;
    conditions?: string[];
  };
  envelope?: RoomEnvelopePatch | null;
  air?: RoomAir | null;
  internalGains?: RoomInternalGains | null;
}

export type BuildingSystemService = 'heating' | 'cooling' | 'heating_and_cooling';
export type SystemCapabilityStatus = 'allowed' | 'allowed_with_warning' | 'unsupported' | 'not_yet_verified';
export type SystemFamilyKind = 'source' | 'terminal' | 'combined' | 'solution_template';
export type SystemScope = 'central' | 'room_local' | 'hybrid';
export type ServicePreference = 'required' | 'optional' | 'not_required';
export type ServicePreferenceSource = 'default' | 'user';
export type SystemsConfigurationStatus = 'draft' | 'confirmed' | 'stale';
export type SystemsNormalizeMode = 'load' | 'write';
export type ValidationSeverity = 'blocker' | 'warning' | 'info';
export type FanCoilDistributionKind = 'pending_design' | 'home_run_manifold' | 'branch_riser';
export type PendingDesignStatus = 'not_required' | 'pending_design' | 'required';

export interface ValidationIssue {
  code: string;
  message: string;
  roomId?: string;
  service?: 'heating' | 'cooling';
  familyId?: string;
}

export interface SystemsValidationResult {
  ready: boolean;
  blockers: ValidationIssue[];
  warnings: ValidationIssue[];
  info: ValidationIssue[];
}
export type SystemsBulkTarget = 'all_rooms' | 'bedrooms' | 'living_rooms' | 'wet_rooms';
export type BuildingSourceRole = 'space_heating' | 'space_cooling' | 'space_heating_and_cooling';
export type HydronicCircuitKind = 'none' | '2pipe' | '4pipe' | 'independent';
export type BuildingDistributionId =
  | 'hydronic_heating_only'
  | 'hydronic_2pipe_heating_cooling'
  | 'hydronic_4pipe_heating_cooling'
  | 'independent_dx'
  | 'hybrid_hydronic_plus_dx';
export type DhwSubsystemStatus = 'not_configured' | 'draft' | 'configured';

export interface BuildingSourceSelection {
  familyId: string;
  label: string;
  role: BuildingSourceRole;
  kind: SystemFamilyKind;
  scope: SystemScope;
  capabilityStatus: SystemCapabilityStatus;
  selectedAt: string;
}

export interface BuildingDistribution {
  id: BuildingDistributionId;
  label: string;
  circuitKind: HydronicCircuitKind;
  simultaneousHeatCool: boolean;
  notes: string[];
}

export interface DhwSubsystem {
  status: DhwSubsystemStatus;
  sourceFamilyId: string | null;
  architectureId: string | null;
  notes: string[];
}

export interface BuildingSystemArchitecture {
  spaceHeatingSourceId: string | null;
  spaceCoolingSourceId: string | null;
  spaceCombinedSourceId: string | null;
  sources: BuildingSourceSelection[];
  distribution: BuildingDistribution;
  dhw: DhwSubsystem;
  simultaneousHeatCoolSupported: boolean;
  warnings: string[];
}

/**
 * Partial override shape accepted by `buildArchitectureFromSelection`.
 * `distribution` may be a full BuildingDistribution or a partial `{ id }`.
 * Source ids / dhw are honoured only when present; capability fields are re-derived.
 */
export interface BuildingSystemArchitectureInput {
  spaceHeatingSourceId?: string | null;
  spaceCoolingSourceId?: string | null;
  spaceCombinedSourceId?: string | null;
  distribution?: Partial<BuildingDistribution> & { id?: BuildingDistributionId };
  dhw?: DhwSubsystem;
  warnings?: string[];
}

export interface EngineeringSystemFamily {
  id: string;
  label: string;
  service: BuildingSystemService;
  kind: SystemFamilyKind;
  scope: SystemScope;
  capabilityStatus: SystemCapabilityStatus;
  statusLabel: string;
  notes: string[];
  /**
   * Phase 2.7 — external building supply (apartment central system).
   * True when the service source EXISTS but lives OUTSIDE the project (building
   * plant) and its equipment is NOT selected/purchased by OhmX. Distinct from
   * "no source" and from "not required": the source is a valid service source,
   * but outside equipment-selection scope. Never a catalog SKU.
   */
  external?: boolean;
}

export interface EngineeringSystemFamilySelection extends EngineeringSystemFamily {
  selectedAt: string;
}

export interface EngineeringRoomSystemSelection {
  familyId: string;
  label: string;
  service: BuildingSystemService;
  kind: SystemFamilyKind;
  scope: SystemScope;
  capabilityStatus: SystemCapabilityStatus;
  sourceSystemId: string | null;
  selectedAt: string;
  userPreference?: string | null;
  reasons: string[];
}

export interface EngineeringRoomAssignment {
  roomId: string;
  roomName: string;
  roomPurpose: string;
  sourceSystemId: string | null;
  sourceSystemIds: {
    heating: string | null;
    cooling: string | null;
  };
  userPreference: string | null;
  servicePreferences: {
    heating: ServicePreference;
    cooling: ServicePreference;
  };
  /** Distinguishes catalog/default preference from an explicit user decision. */
  servicePreferenceSource: {
    heating: ServicePreferenceSource;
    cooling: ServicePreferenceSource;
  };
  /**
   * Wet-room towel radiator intent. Default for bathroom/shower + hydronic heating
   * is a recommendation (`optional`), never an automatic engineering requirement.
   */
  towelRadiatorPreference: ServicePreference;
  towelRadiatorPreferenceSource: ServicePreferenceSource;
  heatingSystems: EngineeringRoomSystemSelection[];
  coolingSystems: EngineeringRoomSystemSelection[];
  status: SystemCapabilityStatus;
  warnings: string[];
  reasons: string[];
}

export interface EngineeringSystemConfiguration {
  projectId: string;
  requestedServices: Array<'heating' | 'cooling'>;
  /** PROJECT REQUIREMENT: does this project need simultaneous heating and cooling in different zones. Defaults false. */
  simultaneousHeatCoolRequired: boolean;
  selectedSystemFamilies: EngineeringSystemFamilySelection[];
  architecture: BuildingSystemArchitecture;
  roomAssignments: EngineeringRoomAssignment[];
  configurationStatus: SystemsConfigurationStatus;
  warnings: string[];
  confirmedAt: string | null;
  buildingRevisionAtConfirmation: number | null;
  systemsRevisionAtConfirmation: number | null;
  systemsRevision: number;
  /**
   * Phase 2.5: deterministic hydronic completeness requirements (what the hydraulic
   * schematic needs). Computed from the configuration during normalization; present
   * on any normalized config, absent on legacy JSON only until it is re-normalized.
   */
  hydronicRequirements?: HydronicSystemRequirements | null;
  /**
   * Phase 2.8: structured readiness. Recomputed during normalization. Backend is
   * the authority for Confirm; warnings never auto-block.
   */
  validation?: SystemsValidationResult;
  /**
   * CM13 — persisted system engineering design inputs (CM12 hydronic/wet-bulb/
   * fan-speed prerequisite + provenance). Optional; absent = unresolved/legacy.
   */
  engineeringDesignInputs?: SystemEngineeringDesignInputs | null;
}

/**
 * Phase 2.5 — Hydronic System Completeness.
 * What the hydronic schematic requires. No heat loss / kW / BTU / flow / head /
 * pipe sizing / loop count invention and no SKU selection (product matching is a
 * later layer). Fan-coil connection model is explicit: 2-pipe seasonal changeover
 * versus 4-pipe / equivalent independent circuits — never mixed.
 */
export interface FloorHeatingCircuitCount {
  /** 'known' is valid only together with a positive integer count. */
  status: 'known' | 'pending_calculation' | 'pending_design';
  count: number | null;
}

export interface FanCoilCircuitRequirements {
  present: boolean;
  valveSetsRequired: number;
  actuatorCountRequired: number;
}

export interface HydronicSystemRequirements {
  /**
   * Explicitly required water towel radiators only.
   * Bathroom/shower hydronic heating defaults to a recommendation, not this count.
   */
  towelRadiatorsRequired: number;
  /** Default/recommended towel radiators (bathroom/shower + hydronic heating, preference optional). */
  towelRadiatorsRecommended: number;
  /** Physical hydronic fan-coil units (one per room with fan_coils assigned). */
  fanCoilCount: number;
  /** Connection model of the hydronic fan-coil circuits. */
  fanCoilCircuitKind: '2pipe' | '4pipe' | 'none';
  /**
   * Home-run manifold vs branch/riser is a distribution-topology decision.
   * Until that topology exists this stays pending_design and the manifold is not mandatory.
   */
  fanCoilDistribution: FanCoilDistributionKind;
  /** True only when fanCoilDistribution === 'home_run_manifold'. */
  fanCoilManifoldRequired: boolean;
  /** Informational port count if a home-run manifold is later chosen. */
  fanCoilManifoldPortsRequired: number;
  /** Control valve sets: 1 per fan coil for 2-pipe, 2 per fan coil for 4-pipe. */
  fanCoilValveSetsRequired: number;
  /** Valve actuators, matched 1:1 with control valve sets. */
  actuatorCountRequired: number;
  /** 4-pipe models heating and cooling circuits separately; 2-pipe uses one seasonal circuit. */
  fanCoilHeatingCircuit: FanCoilCircuitRequirements;
  fanCoilCoolingCircuit: FanCoilCircuitRequirements;
  /** At least one room uses hydronic_floor_heating. */
  hydronicFloorHeatingPresent: boolean;
  floorHeatingManifoldRequired: boolean;
  /**
   * Legacy compact field. Never 'known' unless floorHeatingCircuits.count is a
   * positive integer. Prefer floorHeatingCircuits for new code.
   */
  floorHeatingCircuitCount: 'known' | 'pending_calculation';
  floorHeatingCircuits: FloorHeatingCircuitCount;
  /** Unconditional required=false until supply temperature / source topology exists. */
  mixingUnitRequired: boolean;
  circulationPumpRequired: boolean;
  mixingUnitStatus: PendingDesignStatus;
  circulationPumpStatus: PendingDesignStatus;
  /** True when the project actually has a water circuit (not pure DX/electric). */
  hydronicCircuitPresent: boolean;
  /** Deterministic items a later phase must resolve; no invented engineering values. */
  unresolvedRequirements: string[];
  /** Phase 2.6: floor-by-floor facts for private_house. Sums agree with the global totals. Empty for non-house. */
  byFloor: FloorHydronicRequirements[];
  computedAt: string;
}

/** Phase 2.6 — per-floor hydronic facts for multi-floor private houses. */
export interface FloorHydronicRequirements {
  floorId: string;
  floorLabel: string;
  fanCoilCount: number;
  fanCoilCircuitKind: '2pipe' | '4pipe' | 'none';
  fanCoilManifoldPortsRequired: number;
  towelRadiatorsRequired: number;
  towelRadiatorsRecommended: number;
  hydronicFloorHeatingPresent: boolean;
  floorHeatingCircuitCount: 'known' | 'pending_calculation';
  unresolvedRequirements: string[];
}

/**
 * Normalization input for a systems configuration. Looser than the persisted
 * EngineeringSystemConfiguration so callers may pass raw/partial payloads.
 */
export interface EngineeringSystemConfigurationInput {
  requestedServices?: unknown;
  selectedSystemFamilies?: unknown;
  roomAssignments?: unknown;
  architecture?: BuildingSystemArchitectureInput | null;
  simultaneousHeatCoolRequired?: boolean;
  configurationStatus?: SystemsConfigurationStatus;
  confirmedAt?: string | null;
  buildingRevisionAtConfirmation?: number | null;
  systemsRevisionAtConfirmation?: number | null;
  warnings?: string[];
  validation?: SystemsValidationResult;
  engineeringDesignInputs?: SystemEngineeringDesignInputs | null;
}

export interface BuildingProject {
  id: string;
  name: string;
  status: BuildingProjectStatus;
  createdAt: string;
  updatedAt: string;
  objectConfirmedAt: string | null;
  objectConfirmedRevision: number | null;
  buildingRevision: number;
  objectType: ObjectType;
  region: BuildingRegion | null;
  totalAreaM2: number | null;
  defaultCeilingHeightM: number;
  insulationLevel: InsulationLevel;
  /** Phase 2.6: normalized spatial topology (private_house). Null for apartment/commercial/legacy until normalized. */
  topology: BuildingTopology | null;
  rooms: BuildingRoom[];
  /** Reserved for Phase 2 compatibility; now mirrors selected system families. */
  selectedSystems: EngineeringSystemFamilySelection[];
  systemsRevision: number;
  systemsConfiguration: EngineeringSystemConfiguration | null;
  systemsConfigurationSnapshot: EngineeringSystemConfiguration | null;
  objectConfirmedSnapshot: BuildingProjectSnapshot | null;
  /**
   * Phase 3 — building loads (heating/cooling demand only, no equipment sizing).
   * Optional so legacy Phase 1 / Phase 2 / Phase 2.8A JSON loads without migration.
   * Never deleted automatically when stale — staleness is derived from the
   * revision stamps; the historical result is preserved and shown as outdated.
   */
  loads?: BuildingLoadCalculation | null;
  /**
   * CM13 — persisted explicit calculation coverage intent (CM12 coverage
   * prerequisite). Optional; absent = legacy UNKNOWN/UNCONFIRMED. Never
   * auto-set; may only be written by an explicit coverage update.
   */
  calculationConfiguration?: BuildingCalculationConfiguration | null;
}

// ---------- Phase 3 — Building Loads (LOADS ENGINE v1) ----------
//
// Loads = heating/cooling DEMAND of the object and its rooms. This layer NEVER
// selects equipment, never sizes boilers/chillers/radiators/pipes/pumps and
// never emits SKUs. Equipment sizing is a downstream (Phase 4) concern.
//
// Phase 3 numeric status:
//   QUICK         — LIMITED (no approved Building Project coefficient set found)
//   PROFESSIONAL  — LIMITED (climate design temperatures / U-values / envelope /
//                   infiltration / solar / internal gains not connected)
// The engine therefore returns honest "limited" results with missingInputs
// instead of inventing W/m² or kW values from memory.

export type BuildingLoadMode = 'quick' | 'professional' | 'steady_state';
export type BuildingLoadStatus = 'calculated' | 'limited' | 'incomplete' | 'stale';
export type ServiceLoadStatus =
  | 'calculated'
  | 'not_requested'
  | 'not_required'
  | 'missing_input'
  | 'limited';

/** Per-service load result for one room. `demandW: null` NEVER means "0 W". */
export interface ServiceLoadResult {
  status: ServiceLoadStatus;
  demandW: number | null;
  demandRangeW?: { min: number; max: number } | null;
  assumptions: string[];
  warnings: string[];
  missingInputs: string[];
  /**
   * Phase 3.1 — presentation-only specific load, W/m² (outlier check; never
   * fed back into a formula).
   */
  specificLoadWm2?: number | null;
  /** Phase 3.1 — exact numeric inputs consumed by QUICK v1 (explainability + reproducibility). */
  methodInputs?: Record<string, number | string | boolean | null>;
  /** Phase 3.1 — coefficient trace for QUICK v1 (which factors produced the result). */
  coefficientTrace?: Record<string, number | string | null>;
  /**
   * Phase 3.2c — sum of KNOWN components when the full demand is incomplete
   * (e.g. cooling = transmission+air+internal computed but solar missing).
   * Always partial, never presented as a complete design load.
   */
  partialDemandW?: number | null;
}

/** One room's load result, tied by stable roomId (never by name). */
export interface RoomLoadResult {
  roomId: string;
  roomName: string;
  roomType: string;
  floorId: string | null;
  floorLabel: string | null;
  areaM2: number | null;
  effectiveCeilingHeightM: number | null;
  heating: ServiceLoadResult;
  cooling: ServiceLoadResult;
  /** Phase 3.2a — transmission breakdown (steady-state method only). */
  transmissionBreakdown?: TransmissionBreakdown | null;
  /** Phase 3.2b — air breakdown (steady-state method only). */
  airBreakdown?: AirBreakdown | null;
  /** Phase 3.2c — solar-gain breakdown (steady-state method only, cooling). */
  solarBreakdown?: SolarBreakdown | null;
  /** Phase 3.2c — internal-gain breakdown (steady-state method only, cooling). */
  internalGainsBreakdown?: InternalGainsBreakdown | null;
}

/**
 * Immutable input snapshot captured at calculation time. Answers "from exactly
 * which inputs was this result produced?". Contains ONLY inputs the Phase 3
 * engine actually consumes (plus stored-not-used facts for transparency).
 */
export interface BuildingLoadInputSnapshot {
  projectId: string;
  objectType: ObjectType;
  region: BuildingRegion | null;
  defaultCeilingHeightM: number;
  insulationLevel: InsulationLevel;
  topology: BuildingTopology | null;
  rooms: Array<{
    id: string;
    roomType: string;
    name: string;
    areaM2: number | null;
    floorId: string | null;
    ceilingHeightOverrideM: number | null;
    /** Phase 3.2N — declarations consumed by the physical-completeness gate. */
    externalWallCount?: number | null;
    externalDoorCount?: number | null;
    floorPosition?: FloorPosition | null;
    spaceAbove?: string | null;
    spaceBelow?: string | null;
    insulationOverride: InsulationLevel | null;
    conditions: string[];
    windows: { glazingType: WindowGlazingType | null; count: number | null; areaM2: number | null };
    /** Phase 3.2a — envelope engineering inputs (deep-copied at capture; absent on legacy snapshots). */
    envelope?: RoomEnvelope | null;
    /** Phase 3.2b — air engineering inputs (deep-copied at capture; absent on legacy snapshots). */
    air?: RoomAir | null;
    /** Phase 3.2c — internal-gain engineering inputs (deep-copied at capture; absent on legacy snapshots). */
    internalGains?: RoomInternalGains | null;
  }>;
  requestedServices: Array<'heating' | 'cooling'>;
  servicePreferences: Array<{
    roomId: string;
    heating: ServicePreference;
    cooling: ServicePreference;
  }>;
  buildingRevision: number;
  systemsRevision: number;
  mode: BuildingLoadMode;
  methodVersion: string;
}

/** Phase 3 — full load calculation result with full provenance. */
export interface BuildingLoadCalculation {
  mode: BuildingLoadMode;
  status: BuildingLoadStatus;
  methodId: string;
  methodVersion: string;
  buildingRevisionAtCalculation: number;
  systemsRevisionAtCalculation: number;
  roomResults: RoomLoadResult[];
  /** Object totals — raw sums of eligible room results only (never a separate
   * independent formula). Null while the method is limited or any eligible
   * room is missing a numeric result.
   */
  heatingDemandW: number | null;
  coolingDemandW: number | null;
  /**
   * Phase 3.1 — object-level indicative bands (raw sum of eligible room
   * demandRangeW min/max; presentation band only, not a confidence interval).
   * Null when the object total is not complete.
   */
  heatingRangeW?: { min: number; max: number } | null;
  coolingRangeW?: { min: number; max: number } | null;
  /**
   * Phase 3.1 — explicitly marked PARTIAL raw sums (eligible rooms with a
   * numeric result only), present only when the object total is incomplete
   * because some eligible room is missing an input. Never presented as a
   * complete design load.
   */
  partialHeatingDemandW?: number | null;
  partialCoolingDemandW?: number | null;
  /**
   * Phase 3.1 — climate provenance for QUICK numeric results (null when the
   * method is limited or no official location was resolved).
   */
  climateDatasetId?: string | null;
  climateDatasetVersion?: string | null;
  climateLocationId?: string | null;
  climateLocationLabel?: string | null;
  warnings: string[];
  missingInputs: string[];
  assumptions: string[];
  inputSnapshot: BuildingLoadInputSnapshot;
  /** Phase 3.2P-B3 — immutable quality assessment attached to new steady_state results. */
  engineeringQuality?: EngineeringQualityResult;
  calculatedAt: string;
  /** Phase 3.2a — explicit model limitations (e.g. "solar/internal gains not modeled"). */
  limitations?: string[];
  /** Phase 3.2a — components not yet implemented in this method version. */
  pendingComponents?: string[];
  /**
   * CM14 — immutable load-result identity (LOAD_RESULT_IDENTITY owner).
   * `load:sha256:<64 lowercase hex>` produced once at persistence time over the
   * CM11 canonical facts (ohmx.building-project-load-canonical-json.v1).
   * Absent on legacy results; never fabricated on read; never re-derived.
   */
  loadCalculationRevision?: string;
  /** CM14 — equals loadCalculationRevision for the current policy (CM12 §17). */
  sourceCalculationId?: string;
}

// ---------- Phase 3.2P-B1 — Professional engineering-quality foundation ----------
//
// Pure metadata contract only. B1 does not attach this result to
// BuildingLoadCalculation or BuildingLoadInputSnapshot; B3 composes the
// already-resolved steady_state result with the adapter and attaches it at the
// service persistence boundary.

export type EngineeringProvenance =
  | 'MEASURED'
  | 'CERTIFIED_SPEC'
  | 'PROJECT_DOCUMENTATION'
  | 'CALCULATED_FROM_LAYERS'
  | 'VERIFIED_ASSEMBLY'
  | 'EXPLICIT_USER'
  | 'AUTHORITATIVE_DATASET'
  | 'NORMATIVE_DEFAULT'
  | 'DERIVED'
  | 'PROFILE_DEFAULT'
  | 'INFERRED'
  | 'LEGACY_SEED'
  | 'FALLBACK'
  | 'UNKNOWN';

export type EngineeringQuality =
  | 'VERIFIED'
  | 'HIGH'
  | 'MEDIUM'
  | 'LOW'
  | 'UNRESOLVED';

export type EngineeringCriticality =
  | 'CRITICAL'
  | 'IMPORTANT'
  | 'SUPPORTING'
  | 'IRRELEVANT';

export type QualityGateStatus =
  | 'PASS'
  | 'PASS_WITH_WARNINGS'
  | 'BLOCKED'
  | 'LEGACY_UNASSESSED';

export type CalculationScope =
  | 'WHOLE_OBJECT'
  | 'SELECTED_ROOMS'
  | 'CONDITIONED_ZONES'
  | 'UNKNOWN';

export type CoverageConfirmation =
  | 'WHOLE_OBJECT_CONFIRMED'
  | 'SELECTED_ROOMS_CONFIRMED'
  | 'CONDITIONED_ZONES_CONFIRMED'
  | 'WHOLE_OBJECT_WITH_EXCLUSIONS'
  | 'UNCONFIRMED';

export type UseLevel = 1 | 2 | 3;

/** A3.1: zero is non-legacy physical incompleteness; null is legacy only. */
export type MaximumEligibleLevel = 0 | UseLevel | null;

export type EngineeringQualityService = 'heating' | 'cooling';

/**
 * Existing canonical 31 engineering input IDs plus the normalized quality
 * fields needed by the current steady-state domains. This does not duplicate
 * the Building Project room-type vocabulary or the existing input-ID tuple.
 */
export type EngineeringQualityParameter =
  | EngineeringInputId
  | 'climate'
  | 'solarIrradiance'
  | 'windowDimensions'
  | 'frameFactor'
  | 'ach50'
  | 'airtightnessClass'
  | 'ventilationBalance'
  | 'peopleGainW'
  | 'occupantSensibleWPerPerson'
  | 'kitchenProcessSchedule'
  | 'calculationScope'
  | 'physicalCompleteness'
  | 'roomType';

/** Centralized machine-readable B1 message/reason catalogue (type-only: no runtime value in the production build). */
export type EngineeringQualityMessageCode =
  | 'physical_completeness_required'
  | 'critical_profile_default'
  | 'critical_low_quality'
  | 'critical_unresolved'
  | 'critical_below_high_quality'
  | 'important_medium_warning'
  | 'important_below_medium'
  | 'coverage_unconfirmed'
  | 'coverage_unknown'
  | 'coverage_invalid_combination'
  | 'profile_default_used'
  | 'inferred_value_used'
  | 'fallback_value_used'
  | 'legacy_seed_used'
  | 'unknown_value_used'
  | 'legacy_unassessed'
  | 'superseded_input';

/**
 * Explicit applicability facts supplied by the future integration adapter.
 * All booleans are required so B1 never invents element existence, air paths,
 * occupancy, room coverage or mechanical-regime state.
 */
export interface EngineeringFieldApplicability {
  roomLoadCalculated: boolean;
  elementExists: boolean;
  outdoorAirLoadApplicable: boolean;
  solarExposedGlazingExists: boolean;
  occupancy: number | null;
  roomHasArea: boolean;
  roomType: string | null;
  livingRoomHasKitchen: boolean;
  mechanicalVentilationUsed: boolean;
}

/** Normalized effective field accepted by the pure B1 engine. */
export interface EngineeringQualityFieldInput {
  fieldId: string;
  roomId?: string;
  parameter: EngineeringQualityParameter;
  service?: EngineeringQualityService;
  effectiveValue: number | string | boolean | null;
  unit?: string;
  effectiveProvenance: EngineeringProvenance;
  userConfirmed: boolean;
  sourceReference?: string;
  supersededBy?: readonly string[];
  derivedParentQualities?: readonly EngineeringQuality[];
  applicability: EngineeringFieldApplicability;
}

export interface EngineeringQualityField {
  fieldId: string;
  roomId?: string;
  parameter: EngineeringQualityParameter;
  service?: EngineeringQualityService;
  effectiveValue: number | string | boolean | null;
  unit?: string;
  effectiveProvenance: EngineeringProvenance;
  userConfirmed: boolean;
  quality: EngineeringQuality;
  criticality: EngineeringCriticality;
  requiredQuality: EngineeringQuality;
  status: 'ok' | 'warning' | 'blocked';
  sourceReference?: string;
  messageCode?: EngineeringQualityMessageCode;
  supersededBy?: string[];
}

export interface EngineeringBlockingField {
  fieldId: string;
  roomId?: string;
  service?: EngineeringQualityService;
  parameter: EngineeringQualityParameter;
  reasonCode: EngineeringQualityMessageCode;
  requiredQuality: EngineeringQuality;
  requiredProvenance?: EngineeringProvenance[];
}

export interface EngineeringCoverage {
  declaredAreaM2: number | null;
  modeledAreaM2: number | null;
  ratio: number | null;
  scope: CalculationScope;
  confirmation: CoverageConfirmation;
}

export interface EngineeringQualityResult {
  qualityModelId: 'ohmx.professional-quality.v1';
  qualityModelVersion: '1.0.0';
  evaluatedAt: string;
  requestedLevel: UseLevel;
  maximumEligibleLevel: MaximumEligibleLevel;
  gateStatus: QualityGateStatus;
  coverage: EngineeringCoverage;
  fields: EngineeringQualityField[];
  blockingFields: EngineeringBlockingField[];
  warnings: EngineeringQualityMessageCode[];
  assumptions: string[];
}

/** Pure-engine input; evaluatedAt is caller-supplied to keep the engine deterministic. */
export interface ComputeEngineeringQualityInput {
  evaluatedAt: string;
  requestedLevel: UseLevel;
  requestedServices: readonly EngineeringQualityService[];
  physicalCompleteness: boolean;
  legacyUnassessed: boolean;
  coverage: EngineeringCoverage;
  fields: readonly EngineeringQualityFieldInput[];
  assumptions?: readonly string[];
}

// ---------- Phase 3.2a — Envelope element model + transmission result ----------

export type ConstructionTier = 'poor' | 'average' | 'good' | 'high_performance';
export type EnvelopeElementKind = 'wall' | 'window' | 'door' | 'roof' | 'floor';
export type UValueSource = 'certificate' | 'construction_profile' | 'legacy_insulation_seed' | 'unknown';
export type WindowOrientation = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

/**
 * One envelope element. `areaM2` is the NET area (for a wall it already
 * excludes hosted openings; no further subtraction). A wall without an explicit
 * net area may instead provide `grossAreaM2` (or widthM×heightM) and list
 * `openingIds`; the engine subtracts those openings exactly once. Construction
 * (U-value) and geometry (area) stay separate (MASTER §1B.6).
 */
export interface EnvelopeElement {
  elementId: string;
  areaM2: number | null;
  widthM: number | null;
  heightM: number | null;
  grossAreaM2: number | null;
  /** Wall only: elementIds of hosted openings (windows/doors) to subtract from gross. */
  openingIds: string[] | null;
  count: number | null;
  uValue: number | null;
  constructionTier: ConstructionTier | null;
  uValueSource: UValueSource | null;
  /** Window future-solar fields (stored only; NOT used by the transmission engine). */
  orientation: WindowOrientation | null;
  shgc: number | null;
  shadingFactor: number | null;
  /** Phase 3.2c — explicit shading profile (none/interior/exterior), resolved by the solar engine. */
  shadingProfile?: ShadingProfile | null;
  source: string | null;
}

export interface RoomEnvelope {
  wallElements: EnvelopeElement[];
  windowElements: EnvelopeElement[];
  doorElements: EnvelopeElement[];
  roofElements: EnvelopeElement[];
  floorElements: EnvelopeElement[];
}

/**
 * PATCH contract implemented by mergeEnvelope(): omitted categories are
 * preserved, [] clears only that category, and partial elements merge by ID.
 */
export type EnvelopeElementPatch = Partial<EnvelopeElement> & Pick<EnvelopeElement, 'elementId'>;
export type RoomEnvelopePatch = {
  [K in keyof RoomEnvelope]?: EnvelopeElementPatch[];
};

export interface TransmissionElementContribution {
  elementId: string;
  kind: EnvelopeElementKind;
  areaM2: number;
  uValue: number;
  uValueSource: UValueSource;
  heatingW: number;
  coolingW: number;
}

export interface TransmissionBreakdown {
  elements: TransmissionElementContribution[];
  heatingW: number | null;
  coolingW: number | null;
  indoorHeatingC: number | null;
  indoorCoolingC: number | null;
  outdoorHeatingC: number | null;
  outdoorCoolingC: number | null;
}

// ---------- Phase 3.2b — Air (ventilation + infiltration) ----------

export type VentilationBalance = 'none' | 'natural' | 'balanced' | 'supply_only' | 'exhaust_only' | 'unknown';
export type AirtightnessClass = 'poor' | 'average' | 'good' | 'high';
export type InfiltrationSource = 'measured' | 'blower_door_derived' | 'explicit_ach' | 'airtightness_profile' | 'missing';

export interface RoomAir {
  ventilationBalance: VentilationBalance | null;
  ventilationFlowM3h: number | null;
  infiltrationFlowM3h: number | null;
  airChangesPerHour: number | null;
  ach50: number | null;
  airtightnessClass: AirtightnessClass | null;
}

export interface AirBreakdown {
  ventilationBalance: VentilationBalance;
  roomVolumeM3: number | null;
  ventilationFlowM3h: number | null;
  infiltrationFlowM3h: number | null;
  effectiveOutdoorAirFlowM3h: number | null;
  infiltrationSource: InfiltrationSource | null;
  airConstant: number;
  heatingDeltaTK: number | null;
  coolingDeltaTK: number | null;
  heatingW: number | null;
  coolingW: number | null;
  warnings: string[];
}

// ---------- Phase 3.2c — Cooling Solar + Internal Gains ----------

/** Explicit shading profile (interior/exterior blinds; none = unobstructed). */
export type ShadingProfile = 'none' | 'interior' | 'exterior';
/** SHGC provenance: explicit/certificate, glazing-profile mapping, or unresolved. */
export type ShgcSource = 'certificate' | 'glazing_profile' | 'missing';
/** Shading-factor provenance: explicit factor, profile mapping, or unresolved. */
export type ShadingSource = 'explicit' | 'profile' | 'missing';
/** Internal-gain provenance: explicit input vs approved profile (W/person, W/m²). */
export type InternalGainSource = 'explicit' | 'profile';
/** Source of the occupancy COUNT itself (separate from the W/person profile). */
export type OccupancyInputSource = 'user_explicit' | 'profile_default' | 'missing';

/** Solar irradiance for the 8 window orientations, W/m². */
export type SolarIrradianceByOrientation = Record<WindowOrientation, number>;

/**
 * Phase 3.2f — hourly design series enabling the simultaneous room design
 * peak (max over time of the summed window gains, not the summed per-orientation
 * maxima). Absent on the legacy v1 peak-only dataset.
 */
export interface SolarHourlySeries {
  /** Column order of `irradianceWm2` (e.g. N NE E SE S SW W NW). */
  orientationOrder: WindowOrientation[];
  /** [timeStep][orientationIndex] = W/m². Shared time axis lives at the dataset level. */
  irradianceWm2: number[][];
}

/**
 * Versioned solar-irradiance dataset attached to a climate location.
 * When only `values` (per-orientation peaks) is present (legacy), the solar
 * component sums independent per-orientation maxima. When `hourly` is present
 * (v2+), room aggregation uses the simultaneous design peak.
 */
export interface SolarIrradianceData {
  values: SolarIrradianceByOrientation;
  /** Phase 3.2f — hourly series; absent on legacy peak-only data. */
  hourly?: SolarHourlySeries | null;
  source: string;
  datasetVersion: string;
}

/** Solar contribution of one resolved window (cooling only). */
export interface SolarWindowContribution {
  elementId: string;
  areaM2: number | null;
  orientation: WindowOrientation | null;
  shgc: number | null;
  shgcSource: ShgcSource | null;
  shadingFactor: number | null;
  shadingSource: ShadingSource | null;
  irradianceWm2: number | null;
  irradianceSource: string | null;
  coolingW: number | null;
}

/** Per-room solar-gain breakdown (cooling only). */
export interface SolarBreakdown {
  windows: SolarWindowContribution[];
  totalCoolingW: number | null;
  missingInputs: string[];
  warnings: string[];
}

/** Room-level internal-gain inputs (Phase 3.2c). */
export interface RoomInternalGains {
  occupancy: number | null;
  /** Phase 3.2H: provenance of the occupancy COUNT, not the W/person profile. */
  occupancySource?: OccupancyInputSource | null;
  /** Editable sensible-gain override (defaults to the 75 W/person profile). */
  occupantSensibleWPerPerson: number | null;
  /** Explicit total people sensible gain (W) — highest priority. */
  peopleW: number | null;
  /** Explicit total lighting gain (W) — highest priority. */
  lightingGainW: number | null;
  /** Explicit total equipment gain (W) — highest priority. */
  equipmentGainW: number | null;
}

/** Per-room internal-gain breakdown (cooling only). */
export interface InternalGainsBreakdown {
  occupancy: number | null;
  /** Source of the occupancy COUNT; typical W/person remains `peopleSource`. */
  occupancySource?: OccupancyInputSource | null;
  occupantSensibleWPerPerson: number | null;
  peopleW: number | null;
  peopleSource: InternalGainSource | null;
  lightingW: number | null;
  lightingSource: InternalGainSource | null;
  equipmentW: number | null;
  equipmentSource: InternalGainSource | null;
  totalCoolingW: number | null;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// CM13 — engineering-selection prerequisites (CM12-frozen vocabulary)
//
// Persisted live prerequisites for the CM11 adapter. Optional at the persistence
// boundary: absence means "unresolved / legacy", never a fabricated engineering
// value. Shapes mirror the frozen CM10/CM12 adapter contract
// (buildingProjectConfiguratorAdapter/types.ts) field-for-field; arrays are
// mutable to match the persisted DTO convention.
// ---------------------------------------------------------------------------

export type EngineeringDesignInputProvenance =
  | 'USER_INPUT'
  | 'SYSTEM_POLICY'
  | 'PILOT_REFERENCE';

/** Provenance plus the explicit unresolved/missing state. */
export type EngineeringDesignInputSource = EngineeringDesignInputProvenance | 'UNRESOLVED';

export type EngineeringDesignInputStatus = 'RESOLVED' | 'REQUIRED_POLICY_INPUT';

export interface EngineeringDesignPolicyReference {
  policyId: string;
  policyVersion: string;
  entryId: string;
}

/** A resolved-or-unresolved numeric design input (°C). */
export interface NumericEngineeringDesignInput {
  value: number | null;      // null = unresolved/missing
  unit: '°C';
  source: EngineeringDesignInputSource;
  sourceReference: string | null;
  policyReference: EngineeringDesignPolicyReference | null;
  status: EngineeringDesignInputStatus;
}

/** A resolved-or-unresolved text design input (unit-less). */
export interface TextEngineeringDesignInput {
  value: string | null;      // null = unresolved/missing
  unit: null;
  source: EngineeringDesignInputSource;
  sourceReference: string | null;
  policyReference: EngineeringDesignPolicyReference | null;
  status: EngineeringDesignInputStatus;
}

export interface HydronicDesignConditions {
  heatingWaterSupplyC: NumericEngineeringDesignInput;
  heatingWaterReturnC: NumericEngineeringDesignInput;
  coolingWaterSupplyC: NumericEngineeringDesignInput;
  coolingWaterReturnC: NumericEngineeringDesignInput;
}

export interface CoolingIndoorDesignCondition {
  indoorCoolingWetBulbC: NumericEngineeringDesignInput;
}

export interface FanCoilSizingPolicyInput {
  sizingFanSpeed: TextEngineeringDesignInput;
}

export interface SystemEngineeringDesignInputs {
  hydronicDesignConditions: HydronicDesignConditions;
  coolingIndoorDesignCondition: CoolingIndoorDesignCondition;
  fanCoilSizingPolicy: FanCoilSizingPolicyInput;
}

export interface CoverageIntent {
  calculationScope: CalculationScope;
  coverageConfirmation: CoverageConfirmation;
  includedRoomIds: string[];
  excludedRoomIds: string[];
  includedZoneIds: string[];
  requestedServices: Array<'heating' | 'cooling'>;
  buildingRevisionAtConfirmation: number | null;
  sourceReference: string | null;
}

export interface BuildingCalculationConfiguration {
  coverageIntent: CoverageIntent;
}
