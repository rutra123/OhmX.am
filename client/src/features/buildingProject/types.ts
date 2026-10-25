export type ObjectType = 'apartment' | 'private_house' | 'commercial';
export type InsulationLevel = 'good' | 'medium' | 'poor' | 'unknown';
export type WindowGlazingType = 'standard' | 'large' | 'panoramic' | 'stained';
export type FloorPosition = 'ground' | 'intermediate' | 'top' | 'basement' | 'unknown';
export type BuildingProjectStatus = 'draft' | 'object_confirmed' | 'systems_configured' | 'calculated' | 'confirmed';
export type BuildingSystemService = 'heating' | 'cooling' | 'heating_and_cooling';
export type SystemCapabilityStatus = 'allowed' | 'allowed_with_warning' | 'unsupported' | 'not_yet_verified';
export type SystemFamilyKind = 'source' | 'terminal' | 'combined' | 'solution_template';
export type SystemScope = 'central' | 'room_local' | 'hybrid';
export type ServicePreference = 'required' | 'optional' | 'not_required';
export type ServicePreferenceSource = 'default' | 'user';
export type SystemsConfigurationStatus = 'draft' | 'confirmed' | 'stale';
export type BuildingSourceRole = 'space_heating' | 'space_cooling' | 'space_heating_and_cooling';
export type HydronicCircuitKind = 'none' | '2pipe' | '4pipe' | 'independent';
/** Phase 2.6 topology types. */
export type BasementType = 'none' | 'heated' | 'unheated';
export type TopBoundaryType = 'direct_roof' | 'unheated_attic';
export type PlantLocationKind = 'room' | 'floor' | 'external' | 'not_defined';
export type BuildingDistributionId =
  | 'hydronic_heating_only'
  | 'hydronic_2pipe_heating_cooling'
  | 'hydronic_4pipe_heating_cooling'
  | 'independent_dx'
  | 'hybrid_hydronic_plus_dx';
export type DhwSubsystemStatus = 'not_configured' | 'draft' | 'configured';

export interface Floor {
  id: string;
  level: number;
  label: string;
}

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

export interface BuildingRegion {
  code: string;
  name: string;
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
  floorId?: string | null;
  extras: RoomExtras;
  /** Phase 3.2a–c — engineering inputs (absent on legacy rooms). */
  envelope?: RoomEnvelope | null;
  air?: RoomAir | null;
  internalGains?: RoomInternalGains | null;
}

// ---------- Phase 3.2a–c — Engineering inputs (client mirror of server types) ----------

export type ConstructionTier = 'poor' | 'average' | 'good' | 'high_performance';
export type UValueSource = 'certificate' | 'construction_profile' | 'legacy_insulation_seed' | 'unknown';
export type WindowOrientation = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';
export type ShadingProfile = 'none' | 'interior' | 'exterior';
export type VentilationBalance = 'none' | 'natural' | 'balanced' | 'supply_only' | 'exhaust_only' | 'unknown';
export type AirtightnessClass = 'poor' | 'average' | 'good' | 'high';

export interface EnvelopeElement {
  elementId: string;
  areaM2: number | null;
  widthM: number | null;
  heightM: number | null;
  grossAreaM2: number | null;
  openingIds: string[] | null;
  count: number | null;
  uValue: number | null;
  constructionTier: ConstructionTier | null;
  uValueSource: UValueSource | null;
  orientation: WindowOrientation | null;
  shgc: number | null;
  shadingFactor: number | null;
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
 * PATCH contract implemented by server mergeEnvelope(): omitted categories are
 * preserved, [] clears only that category, and partial elements merge by ID.
 */
export type EnvelopeElementPatch = Partial<EnvelopeElement> & Pick<EnvelopeElement, 'elementId'>;
export type RoomEnvelopePatch = {
  [K in keyof RoomEnvelope]?: EnvelopeElementPatch[];
};

export interface RoomAir {
  ventilationBalance: VentilationBalance | null;
  ventilationFlowM3h: number | null;
  infiltrationFlowM3h: number | null;
  airChangesPerHour: number | null;
  ach50: number | null;
  airtightnessClass: AirtightnessClass | null;
}

/** Source of the occupancy COUNT itself (Phase 3.2H). `profile_default` is reserved and currently unused. */
export type OccupancyInputSource = 'user_explicit' | 'profile_default' | 'missing';

export interface RoomInternalGains {
  occupancy: number | null;
  /** Provenance of the occupation count (not the W/person profile). */
  occupancySource?: OccupancyInputSource | null;
  occupantSensibleWPerPerson: number | null;
  peopleW: number | null;
  lightingGainW: number | null;
  equipmentGainW: number | null;
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
  /** Phase 2.7 — external building (central) supply: source exists but is OUTSIDE the project; never a catalog SKU. */
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
  servicePreferenceSource?: {
    heating: ServicePreferenceSource;
    cooling: ServicePreferenceSource;
  };
  towelRadiatorPreference?: ServicePreference;
  towelRadiatorPreferenceSource?: ServicePreferenceSource;
  heatingSystems: EngineeringRoomSystemSelection[];
  coolingSystems: EngineeringRoomSystemSelection[];
  status: SystemCapabilityStatus;
  warnings: string[];
  reasons: string[];
}

export interface EngineeringSystemConfiguration {
  projectId: string;
  requestedServices: Array<'heating' | 'cooling'>;
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
  /** Phase 2.5: deterministic hydronic completeness requirements (nullable for legacy configs). */
  hydronicRequirements?: HydronicSystemRequirements | null;
  validation?: SystemsValidationResult;
}

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

/**
 * Phase 2.5 — Hydronic System Completeness (client mirror of server type).
 * What the hydronic schematic requires. No heat loss / kW / BTU / flow / head /
 * pipe sizing / loop count invention and no SKU selection yet.
 */
export interface HydronicSystemRequirements {
  towelRadiatorsRequired: number;
  towelRadiatorsRecommended?: number;
  fanCoilCount: number;
  fanCoilCircuitKind: '2pipe' | '4pipe' | 'none';
  fanCoilDistribution?: 'pending_design' | 'home_run_manifold' | 'branch_riser';
  fanCoilManifoldRequired: boolean;
  fanCoilManifoldPortsRequired: number;
  fanCoilValveSetsRequired: number;
  actuatorCountRequired: number;
  fanCoilHeatingCircuit?: { present: boolean; valveSetsRequired: number; actuatorCountRequired: number };
  fanCoilCoolingCircuit?: { present: boolean; valveSetsRequired: number; actuatorCountRequired: number };
  hydronicFloorHeatingPresent: boolean;
  floorHeatingManifoldRequired: boolean;
  floorHeatingCircuitCount: 'known' | 'pending_calculation';
  floorHeatingCircuits?: { status: 'known' | 'pending_calculation' | 'pending_design'; count: number | null };
  mixingUnitRequired: boolean;
  circulationPumpRequired: boolean;
  mixingUnitStatus?: 'not_required' | 'pending_design' | 'required';
  circulationPumpStatus?: 'not_required' | 'pending_design' | 'required';
  hydronicCircuitPresent?: boolean;
  unresolvedRequirements: string[];
  /** Phase 2.6: floor-by-floor facts (private_house). Sums agree with totals. */
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
  towelRadiatorsRecommended?: number;
  hydronicFloorHeatingPresent: boolean;
  floorHeatingCircuitCount: 'known' | 'pending_calculation';
  unresolvedRequirements: string[];
}

export interface BuildingSystemsCatalog {
  serviceOptions: Array<{ value: 'heating' | 'cooling' | 'heating_and_cooling'; label: string; description: string }>;
  capabilityStates: Array<{ value: SystemCapabilityStatus; label: string }>;
  systemFamilies: EngineeringSystemFamily[];
  groups: Array<{
    id: string;
    label: string;
    service: BuildingSystemService | 'heating_and_cooling';
    kind: SystemFamilyKind | 'mixed';
    familyIds: string[];
    description: string;
  }>;
  roomPurposeGuidance: Array<{
    roomType: string;
    label: string;
    defaultHeating: ServicePreference;
    defaultCooling: ServicePreference;
  }>;
  dhw: { available: boolean; status: 'not_configured'; label: string; description: string };
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
  topology: BuildingTopology | null;
  rooms: BuildingRoom[];
  roomCount: number;
  sumRoomAreaM2: number;
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
  topology: BuildingTopology | null;
  rooms: BuildingRoom[];
  selectedSystems: EngineeringSystemFamilySelection[];
  systemsRevision: number;
  systemsConfiguration: EngineeringSystemConfiguration | null;
  systemsConfigurationSnapshot: EngineeringSystemConfiguration | null;
  objectConfirmedSnapshot: BuildingProjectSnapshot | null;
  /** Phase 3 — loads result (optional; absent on legacy projects). */
  loads?: BuildingLoadCalculation | null;
}

// ---------- Phase 3 — Building Loads (LOAD ENGINE v1) ----------
// Client mirror of the server Phase 3 types. The client NEVER computes load
// numbers itself — the backend is the authority; these types are display only.

export type BuildingLoadMode = 'quick' | 'professional' | 'steady_state';
export type BuildingLoadStatus = 'calculated' | 'limited' | 'incomplete' | 'stale';
export type ServiceLoadStatus =
  | 'calculated'
  | 'not_requested'
  | 'not_required'
  | 'missing_input'
  | 'limited';

export interface ServiceLoadResult {
  status: ServiceLoadStatus;
  demandW: number | null;
  demandRangeW?: { min: number; max: number } | null;
  assumptions: string[];
  warnings: string[];
  missingInputs: string[];
  /** Phase 3.1 — presentation-only specific load, W/m² (outlier check). */
  specificLoadWm2?: number | null;
  /** Phase 3.1 — exact numeric inputs consumed by QUICK v1 (explainability). */
  methodInputs?: Record<string, number | string | boolean | null>;
  /** Phase 3.1 — coefficient trace for QUICK v1. */
  coefficientTrace?: Record<string, number | string | null>;
}

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
}

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
    externalWallCount?: number | null;
    externalDoorCount?: number | null;
    floorPosition?: FloorPosition | null;
    spaceAbove?: string | null;
    spaceBelow?: string | null;
    insulationOverride: InsulationLevel | null;
    conditions: string[];
    windows: { glazingType: WindowGlazingType | null; count: number | null; areaM2: number | null };
  }>;
  requestedServices: Array<'heating' | 'cooling'>;
  servicePreferences: Array<{ roomId: string; heating: ServicePreference; cooling: ServicePreference }>;
  buildingRevision: number;
  systemsRevision: number;
  mode: BuildingLoadMode;
  methodVersion: string;
}

// ---------- Phase 3.2P-B4A — server-authored engineering-quality DTO ----------
// Presentation mirror only. The client does not derive levels, gate status,
// criticality, provenance, coverage or blocking fields.

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

export type EngineeringQuality = 'VERIFIED' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNRESOLVED';
export type EngineeringCriticality = 'CRITICAL' | 'IMPORTANT' | 'SUPPORTING' | 'IRRELEVANT';
export type QualityGateStatus = 'PASS' | 'PASS_WITH_WARNINGS' | 'BLOCKED' | 'LEGACY_UNASSESSED';
export type CalculationScope = 'WHOLE_OBJECT' | 'SELECTED_ROOMS' | 'CONDITIONED_ZONES' | 'UNKNOWN';
export type CoverageConfirmation =
  | 'WHOLE_OBJECT_CONFIRMED'
  | 'SELECTED_ROOMS_CONFIRMED'
  | 'CONDITIONED_ZONES_CONFIRMED'
  | 'WHOLE_OBJECT_WITH_EXCLUSIONS'
  | 'UNCONFIRMED';
export type UseLevel = 1 | 2 | 3;
export type MaximumEligibleLevel = 0 | UseLevel | null;
export type EngineeringQualityService = 'heating' | 'cooling';

export type EngineeringQualityParameter =
  | 'areaM2'
  | 'heightM'
  | 'volumeM3'
  | 'externalWallAreaM2'
  | 'windowAreaM2'
  | 'externalDoorAreaM2'
  | 'roofExposureAreaM2'
  | 'groundFloorAreaM2'
  | 'U_wall'
  | 'U_roof'
  | 'U_floor'
  | 'U_window'
  | 'U_door'
  | 'TinHeating'
  | 'ToutHeatingDesign'
  | 'ventilationFlowM3h'
  | 'infiltrationMethod'
  | 'infiltrationFlowM3h'
  | 'airChangesPerHour'
  | 'thermalBridgePsi'
  | 'thermalBridgeLength'
  | 'TinCooling'
  | 'ToutCoolingDesign'
  | 'SHGC'
  | 'windowOrientation'
  | 'shadingFactor'
  | 'occupancy'
  | 'lightingGainW'
  | 'equipmentGainW'
  | 'operatingSchedule'
  | 'humidityLatentMethod'
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

export interface BuildingLoadCalculation {
  mode: BuildingLoadMode;
  status: BuildingLoadStatus;
  methodId: string;
  methodVersion: string;
  buildingRevisionAtCalculation: number;
  systemsRevisionAtCalculation: number;
  roomResults: RoomLoadResult[];
  heatingDemandW: number | null;
  coolingDemandW: number | null;
  /** Phase 3.1 — object-level indicative bands (presentation only). */
  heatingRangeW?: { min: number; max: number } | null;
  coolingRangeW?: { min: number; max: number } | null;
  /** Phase 3.1 — explicitly marked PARTIAL raw sums when the total is incomplete. */
  partialHeatingDemandW?: number | null;
  partialCoolingDemandW?: number | null;
  /** Phase 3.1 — climate provenance for QUICK numeric results. */
  climateDatasetId?: string | null;
  climateDatasetVersion?: string | null;
  climateLocationId?: string | null;
  climateLocationLabel?: string | null;
  warnings: string[];
  missingInputs: string[];
  assumptions: string[];
  inputSnapshot: BuildingLoadInputSnapshot;
  /** Phase 3.2P-B3 — immutable server-authored assessment for new steady_state results. */
  engineeringQuality?: EngineeringQualityResult;
  calculatedAt: string;
}

export interface BuildingLoadState {
  loads: BuildingLoadCalculation | null;
  isStale: boolean;
  prerequisites: {
    objectConfirmed: boolean;
    systemsConfirmed: boolean;
    systemsStale: boolean;
    systemsReady: boolean;
    blockers: ValidationIssue[];
  };
  gate: { ok: boolean; code: string | null; message: string | null };
  availableModes: BuildingLoadMode[];
  methodStatus: {
    quick: { status: string; methodId: string; methodVersion: string; reason: string; missingInputs: string[] };
    professional: { status: string; methodId: string; methodVersion: string; reason: string; missingInputs: string[] };
    steadyState: { status: string; methodId: string; methodVersion: string; reason: string; missingInputs: string[] };
  };
}

export interface BuildingProjectView {
  project: BuildingProject;
  catalog: BuildingCatalog;
  systemsCatalog: BuildingSystemsCatalog;
  summary: {
    name: string;
    objectType: ObjectType;
    objectTypeLabel: string;
    regionCode: string | null;
    regionName: string;
    totalAreaM2: number | null;
    defaultCeilingHeightM: number;
    insulationLevel: InsulationLevel;
    insulationLabel: string;
    roomCount: number;
    sumRoomAreaM2: number;
    wetRoomCount: number;
    status: BuildingProjectStatus;
    buildingRevision: number;
    objectConfirmedRevision: number | null;
    systemsRevision: number;
  };
  systems: {
    requestedServices: Array<'heating' | 'cooling'>;
    selectedSourceFamilies: EngineeringSystemFamilySelection[];
    roomAssignments: EngineeringRoomAssignment[];
    configurationStatus: SystemsConfigurationStatus;
    warnings: string[];
    isStale: boolean;
  };
  systemsConfiguration: EngineeringSystemConfiguration | null;
}

export interface BuildingCatalog {
  objectTypes: Array<{ value: ObjectType; label: string }>;
  regions: Array<{ value: string; label: string }>;
  insulationLevels: Array<{ value: InsulationLevel; label: string }>;
  windowTypes: Array<{ value: WindowGlazingType; label: string }>;
  floorPositions: Array<{ value: FloorPosition; label: string }>;
  roomConditions: Array<{ value: string; label: string }>;
  roomTypes: Array<{ value: string; label: string; group: string }>;
  /** Phase 2.6 topology options (facts only). */
  basementTypes?: Array<{ value: BasementType; label: string }>;
  topBoundaryTypes?: Array<{ value: TopBoundaryType; label: string }>;
  plantLocationKinds?: Array<{ value: PlantLocationKind; label: string }>;
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
