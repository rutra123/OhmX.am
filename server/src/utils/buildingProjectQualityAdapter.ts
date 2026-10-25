/**
 * Phase 3.2P-B2 — live steady_state Professional quality-field adapter.
 *
 * This module only adapts an already-produced steady_state calculation to the
 * frozen B1 field-input contract. It does not resolve loads, call services,
 * mutate a BuildingProject, persist data, or attach quality to load results.
 */
import { baselineEngineeringQuality } from './buildingProjectQuality.js';
import { WINDOW_GLAZING_AREA_FACTOR } from './buildingProjectSolar.js';
import type {
  AirBreakdown,
  BuildingLoadCalculation,
  BuildingProject,
  BuildingRoom,
  EngineeringCoverage,
  EngineeringFieldApplicability,
  EngineeringProvenance,
  EngineeringQuality,
  EngineeringQualityFieldInput,
  EngineeringQualityParameter,
  EngineeringQualityService,
  EnvelopeElement,
  EnvelopeElementKind,
  InternalGainsBreakdown,
  RoomLoadResult,
  SolarWindowContribution,
  TransmissionElementContribution,
} from './buildingProjectTypes.js';

export type CurrentEngineeringSourceDomain =
  | 'climate'
  | 'geometry'
  | 'u_value'
  | 'infiltration'
  | 'shgc'
  | 'shading'
  | 'internal_gain'
  | 'occupancy'
  | 'solar'
  | 'ventilation';

/**
 * One explicit current-source vocabulary map. Runtime strings outside this
 * table are deliberately mapped to UNKNOWN by normalizeCurrentEngineeringProvenance.
 */
export const CURRENT_SOURCE_TO_PROVENANCE: Readonly<
  Record<CurrentEngineeringSourceDomain, Readonly<Record<string, EngineeringProvenance>>>
> = {
  climate: {
    missing: 'UNKNOWN',
  },
  geometry: {
    explicit: 'EXPLICIT_USER',
    derived: 'DERIVED',
    profile_default: 'PROFILE_DEFAULT',
    missing: 'UNKNOWN',
  },
  u_value: {
    certificate: 'CERTIFIED_SPEC',
    construction_profile: 'PROFILE_DEFAULT',
    legacy_insulation_seed: 'LEGACY_SEED',
    unknown: 'UNKNOWN',
  },
  infiltration: {
    measured: 'MEASURED',
    blower_door_derived: 'DERIVED',
    explicit_ach: 'EXPLICIT_USER',
    airtightness_profile: 'PROFILE_DEFAULT',
    missing: 'UNKNOWN',
  },
  shgc: {
    certificate: 'CERTIFIED_SPEC',
    glazing_profile: 'PROFILE_DEFAULT',
    missing: 'UNKNOWN',
  },
  shading: {
    explicit: 'EXPLICIT_USER',
    profile: 'PROFILE_DEFAULT',
    missing: 'UNKNOWN',
  },
  internal_gain: {
    explicit: 'EXPLICIT_USER',
    profile: 'PROFILE_DEFAULT',
  },
  occupancy: {
    user_explicit: 'EXPLICIT_USER',
    profile_default: 'PROFILE_DEFAULT',
    missing: 'UNKNOWN',
  },
  solar: {
    PVGIS: 'AUTHORITATIVE_DATASET',
  },
  ventilation: {
    explicit: 'EXPLICIT_USER',
    unknown: 'UNKNOWN',
  },
};

export type AdapterInventoryValidationCode =
  | 'duplicate_field_id'
  | 'missing_expected_field'
  | 'unaccounted_field'
  | 'inventory_conflict'
  | 'unsupported_load_mode'
  | 'missing_room_result'
  | 'unmatched_room_result'
  | 'duplicate_room_result'
  | 'snapshot_project_mismatch'
  | 'snapshot_revision_mismatch';

export class AdapterInventoryValidationError extends Error {
  readonly code: AdapterInventoryValidationCode;
  readonly fieldId?: string;

  constructor(code: AdapterInventoryValidationCode, fieldId?: string) {
    super(fieldId ? `${code}:${fieldId}` : code);
    this.name = 'AdapterInventoryValidationError';
    this.code = code;
    this.fieldId = fieldId;
  }
}

/** Explicit inventory contract carried beside the normalized fields. */
export interface QualityFieldInventory {
  /** Every field emitted by the adapter must be listed here. */
  expectedFieldIds: readonly string[];
  /** Expected fields that are applicable and must never be omitted. */
  applicableFieldIds: readonly string[];
  /** Expected fields explicitly represented as non-applicable. */
  irrelevantFieldIds: readonly string[];
  /** Expected fields retained only to document an effective override. */
  supersededFieldIds: readonly string[];
}

/** Classification sets produced by the actual emission path. */
export interface QualityFieldClassificationIndex {
  readonly applicableFieldIds: ReadonlySet<string>;
  readonly irrelevantFieldIds: ReadonlySet<string>;
  readonly supersededFieldIds: ReadonlySet<string>;
}

/**
 * Deterministic expected inventory built before and independently of field
 * emission. `addField` never receives or mutates this plan.
 */
export interface ExpectedQualityFieldPlan extends QualityFieldClassificationIndex {
  readonly expectedFieldIds: ReadonlySet<string>;
}

export interface BuildingProjectQualityAdapterResult {
  fields: EngineeringQualityFieldInput[];
  inventory: QualityFieldInventory;
  coverage: EngineeringCoverage;
  physicalCompleteness: boolean;
  warnings: string[];
  assumptions: string[];
}

export interface BuildingProjectQualityAdapterInput {
  project: BuildingProject;
  steadyStateCalculation: BuildingLoadCalculation;
  /** Existing physical-completeness result is authoritative; B2 does not recompute it. */
  physicalCompleteness: boolean;
}

const SERVICES: readonly EngineeringQualityService[] = ['heating', 'cooling'];
const ENVELOPE_KINDS: readonly EnvelopeElementKind[] = ['wall', 'window', 'door', 'roof', 'floor'];

/** Actual steady_state temperature dataset IDs audited from the live runtime. */
export const KNOWN_AUTHORITATIVE_CLIMATE_DATASET_IDS = [
  'armenia-hhsn-22-01-2024',
] as const;

type QualityFieldClassification = 'applicable' | 'irrelevant' | 'superseded';

interface MutableQualityFieldClassificationIndex {
  applicableFieldIds: Set<string>;
  irrelevantFieldIds: Set<string>;
  supersededFieldIds: Set<string>;
}

interface MutableExpectedQualityFieldPlan extends MutableQualityFieldClassificationIndex {
  expectedFieldIds: Set<string>;
}

interface QualityFieldEmission {
  fields: EngineeringQualityFieldInput[];
  classification: MutableQualityFieldClassificationIndex;
}

const AREA_PARAMETER_BY_KIND: Readonly<Record<EnvelopeElementKind, EngineeringQualityParameter>> = {
  wall: 'externalWallAreaM2',
  window: 'windowAreaM2',
  door: 'externalDoorAreaM2',
  roof: 'roofExposureAreaM2',
  floor: 'groundFloorAreaM2',
};

const U_PARAMETER_BY_KIND: Readonly<Record<EnvelopeElementKind, EngineeringQualityParameter>> = {
  wall: 'U_wall',
  window: 'U_window',
  door: 'U_door',
  roof: 'U_roof',
  floor: 'U_floor',
};

const UNIT_BY_PARAMETER: Readonly<Partial<Record<EngineeringQualityParameter, string>>> = {
  areaM2: 'm²',
  heightM: 'm',
  volumeM3: 'm³',
  externalWallAreaM2: 'm²',
  windowAreaM2: 'm²',
  externalDoorAreaM2: 'm²',
  roofExposureAreaM2: 'm²',
  groundFloorAreaM2: 'm²',
  U_wall: 'W/(m²·K)',
  U_roof: 'W/(m²·K)',
  U_floor: 'W/(m²·K)',
  U_window: 'W/(m²·K)',
  U_door: 'W/(m²·K)',
  TinHeating: '°C',
  ToutHeatingDesign: '°C',
  TinCooling: '°C',
  ToutCoolingDesign: '°C',
  ventilationFlowM3h: 'm³/h',
  infiltrationFlowM3h: 'm³/h',
  airChangesPerHour: '1/h',
  ach50: '1/h',
  SHGC: 'ratio',
  shadingFactor: 'ratio',
  occupantSensibleWPerPerson: 'W/person',
  peopleGainW: 'W',
  lightingGainW: 'W',
  equipmentGainW: 'W',
  frameFactor: 'ratio',
};

function encodePart(value: string): string {
  return encodeURIComponent(value);
}

function projectFieldId(service: EngineeringQualityService, suffix: string): string {
  return `project:${service}:${suffix}`;
}

function roomFieldId(roomId: string, service: EngineeringQualityService, suffix: string): string {
  return `room:${encodePart(roomId)}:${service}:${suffix}`;
}

function roomMetaFieldId(roomId: string, suffix: string): string {
  return `room:${encodePart(roomId)}:meta:${suffix}`;
}

function elementFieldId(
  roomId: string,
  service: EngineeringQualityService,
  kind: EnvelopeElementKind,
  elementId: string,
  suffix: string,
): string {
  return `room:${encodePart(roomId)}:${service}:envelope:${kind}:${encodePart(elementId)}:${suffix}`;
}

function solarFieldId(roomId: string, elementId: string, suffix: string): string {
  return `room:${encodePart(roomId)}:cooling:solar:window:${encodePart(elementId)}:${suffix}`;
}

function pushUnique(items: string[], value: string): void {
  if (!items.includes(value)) items.push(value);
}

function isModeledService(result: RoomLoadResult, service: EngineeringQualityService): boolean {
  const status = result[service].status;
  return status !== 'not_requested' && status !== 'not_required';
}

function finiteNumber(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value);
}

function finitePositive(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}

function finiteNonNegative(value: number | null | undefined): value is number {
  return value != null && Number.isFinite(value) && value >= 0;
}

function currentSourceToken(value: string | null | undefined): string | null {
  return value == null || value.trim() === '' ? null : value.trim();
}

/**
 * Normalize all current source tokens through one mapping. This function is
 * intentionally total: an unrecognized runtime token is UNKNOWN plus a stable
 * warning, never an optimistic quality claim.
 */
export function normalizeCurrentEngineeringProvenance(
  domain: CurrentEngineeringSourceDomain,
  sourceToken: string | null | undefined,
  warnings: string[] = [],
): EngineeringProvenance {
  const token = currentSourceToken(sourceToken);
  if (token == null) return CURRENT_SOURCE_TO_PROVENANCE[domain].missing ?? 'UNKNOWN';

  const direct = CURRENT_SOURCE_TO_PROVENANCE[domain][token];
  if (direct) return direct;

  if (domain === 'solar' && token.toUpperCase().startsWith('PVGIS')) return 'AUTHORITATIVE_DATASET';

  pushUnique(warnings, `unknown_source_token:${domain}:${token}`);
  return 'UNKNOWN';
}

function sourceReferenceForElement(element: EnvelopeElement): string | undefined {
  return element.source && element.source.trim() ? element.source.trim() : undefined;
}

function sourceReferenceForClimate(calculation: BuildingLoadCalculation): string | undefined {
  const values = [
    calculation.climateDatasetId ? `dataset=${calculation.climateDatasetId}` : null,
    calculation.climateDatasetVersion ? `version=${calculation.climateDatasetVersion}` : null,
    calculation.climateLocationId ? `location=${calculation.climateLocationId}` : null,
  ].filter((value): value is string => value != null);
  return values.length ? values.join(';') : undefined;
}

function climateDatasetProvenance(
  calculation: BuildingLoadCalculation,
  warnings: string[],
): EngineeringProvenance {
  const datasetId = currentSourceToken(calculation.climateDatasetId);
  const locationId = currentSourceToken(calculation.climateLocationId);
  if (datasetId == null) return 'UNKNOWN';

  const knownAuthoritative = KNOWN_AUTHORITATIVE_CLIMATE_DATASET_IDS.some(
    (knownId) => knownId === datasetId,
  );
  if (!knownAuthoritative) {
    pushUnique(warnings, `unknown_climate_dataset:${datasetId}`);
    return 'UNKNOWN';
  }
  if (locationId == null) return 'UNKNOWN';
  return 'AUTHORITATIVE_DATASET';
}

function sourceReferenceForSolarBreakdown(
  breakdown: RoomLoadResult['solarBreakdown'],
  source: string | null,
): string | undefined {
  const warning = breakdown?.warnings.find((item) => item.startsWith('solar_dataset:'));
  if (warning) return warning.slice('solar_dataset:'.length);
  return source && source.trim() ? source.trim() : undefined;
}

function sourceReferenceForAir(
  roomResult: RoomLoadResult,
  source: string | null,
  rawAir: BuildingRoom['air'] | null | undefined,
): string | undefined {
  const converted = roomResult.airBreakdown?.warnings.find((item) => item.startsWith('ach50_converted:'));
  if (converted) return converted;
  if (source === 'blower_door_derived' && rawAir?.ach50 != null) return `blower-door:ach50=${rawAir.ach50}`;
  if (source === 'airtightness_profile' && rawAir?.airtightnessClass) return `airtightness_class=${rawAir.airtightnessClass}`;
  return undefined;
}

function sourceReferenceForAirBreakdown(
  air: AirBreakdown | null | undefined,
  source: string | null,
  rawAir: BuildingRoom['air'] | null | undefined,
): string | undefined {
  const converted = air?.warnings.find((item) => item.startsWith('ach50_converted:'));
  if (converted) return converted;
  if (source === 'blower_door_derived' && rawAir?.ach50 != null) return `blower-door:ach50=${rawAir.ach50}`;
  if (source === 'airtightness_profile' && rawAir?.airtightnessClass) return `airtightness_class=${rawAir.airtightnessClass}`;
  return undefined;
}

function sourceReferenceForInternal(
  project: BuildingProject,
  source: string | null,
): string | undefined {
  if (source === 'profile') {
    return `internal_gain_profile=${project.objectType === 'commercial' ? 'commercial' : 'residential'}`;
  }
  return undefined;
}

function fieldApplicability(
  roomLoadIsCalculated: boolean,
  overrides: Partial<EngineeringFieldApplicability> = {},
): EngineeringFieldApplicability {
  return {
    roomLoadCalculated: roomLoadIsCalculated,
    elementExists: true,
    outdoorAirLoadApplicable: roomLoadIsCalculated,
    solarExposedGlazingExists: roomLoadIsCalculated,
    occupancy: null,
    roomHasArea: false,
    roomType: null,
    livingRoomHasKitchen: false,
    mechanicalVentilationUsed: false,
    ...overrides,
  };
}

function createClassificationIndex(): MutableQualityFieldClassificationIndex {
  return {
    applicableFieldIds: new Set<string>(),
    irrelevantFieldIds: new Set<string>(),
    supersededFieldIds: new Set<string>(),
  };
}

function addClassification(
  index: MutableQualityFieldClassificationIndex,
  fieldId: string,
  classification: QualityFieldClassification,
): void {
  if (classification === 'applicable') index.applicableFieldIds.add(fieldId);
  if (classification === 'irrelevant') index.irrelevantFieldIds.add(fieldId);
  if (classification === 'superseded') index.supersededFieldIds.add(fieldId);
}

function addPlannedField(
  plan: MutableExpectedQualityFieldPlan,
  fieldId: string,
  classification: QualityFieldClassification,
): void {
  if (plan.expectedFieldIds.has(fieldId)) {
    throw new AdapterInventoryValidationError('inventory_conflict', fieldId);
  }
  plan.expectedFieldIds.add(fieldId);
  addClassification(plan, fieldId, classification);
}

function addField(
  emission: QualityFieldEmission,
  field: EngineeringQualityFieldInput,
  classification: QualityFieldClassification,
): void {
  emission.fields.push(field);
  addClassification(emission.classification, field.fieldId, classification);
}

function makeField(
  fieldId: string,
  parameter: EngineeringQualityParameter,
  effectiveValue: number | string | boolean | null,
  effectiveProvenance: EngineeringProvenance,
  applicability: EngineeringFieldApplicability,
  options: {
    service?: EngineeringQualityService;
    roomId?: string;
    unit?: string;
    sourceReference?: string;
    supersededBy?: readonly string[];
    derivedParentQualities?: readonly EngineeringQuality[];
  } = {},
): EngineeringQualityFieldInput {
  return {
    fieldId,
    roomId: options.roomId,
    parameter,
    service: options.service,
    effectiveValue,
    unit: options.unit ?? UNIT_BY_PARAMETER[parameter],
    effectiveProvenance,
    // The current live schema has no per-field confirmation token. Object/system
    // confirmation is not evidence that a numeric engineering field was confirmed.
    userConfirmed: false,
    sourceReference: options.sourceReference,
    supersededBy: options.supersededBy,
    derivedParentQualities: options.derivedParentQualities,
    applicability,
  };
}

function derivedParentQuality(provenance: EngineeringProvenance): EngineeringQuality {
  return baselineEngineeringQuality(provenance, 'CRITICAL');
}

function areaProvenance(roomAreaM2: number | null, resolvedAreaM2: number | null): EngineeringProvenance {
  return finitePositive(resolvedAreaM2) && roomAreaM2 != null
    ? normalizeCurrentEngineeringProvenance('geometry', 'explicit')
    : normalizeCurrentEngineeringProvenance('geometry', 'missing');
}

function heightProvenance(
  snapshotRoom: BuildingLoadCalculation['inputSnapshot']['rooms'][number],
  effectiveHeight: number | null,
): EngineeringProvenance {
  if (!finitePositive(effectiveHeight)) return 'UNKNOWN';
  return snapshotRoom.ceilingHeightOverrideM != null
    ? normalizeCurrentEngineeringProvenance('geometry', 'explicit')
    : normalizeCurrentEngineeringProvenance('geometry', 'profile_default');
}

function envelopeElements(room: BuildingLoadCalculation['inputSnapshot']['rooms'][number], kind: EnvelopeElementKind): EnvelopeElement[] {
  const envelope = room.envelope;
  if (!envelope) return [];
  switch (kind) {
    case 'wall': return envelope.wallElements;
    case 'window': return envelope.windowElements;
    case 'door': return envelope.doorElements;
    case 'roof': return envelope.roofElements;
    case 'floor': return envelope.floorElements;
  }
}

function transmissionElement(
  breakdown: RoomLoadResult['transmissionBreakdown'],
  elementId: string,
): TransmissionElementContribution | undefined {
  return breakdown?.elements.find((item) => item.elementId === elementId);
}

function solarWindow(
  breakdown: RoomLoadResult['solarBreakdown'],
  elementId: string,
): SolarWindowContribution | undefined {
  return breakdown?.windows.find((item) => item.elementId === elementId);
}

function effectiveGeometryArea(
  element: EnvelopeElement,
  contribution: TransmissionElementContribution | undefined,
): { value: number | null; provenance: EngineeringProvenance } {
  if (contribution && finiteNonNegative(contribution.areaM2)) {
    const provenance = element.areaM2 != null
      ? normalizeCurrentEngineeringProvenance('geometry', 'explicit')
      : normalizeCurrentEngineeringProvenance('geometry', 'derived');
    return { value: contribution.areaM2, provenance };
  }
  if (finiteNonNegative(element.areaM2)) {
    return { value: element.areaM2, provenance: normalizeCurrentEngineeringProvenance('geometry', 'explicit') };
  }
  return { value: null, provenance: normalizeCurrentEngineeringProvenance('geometry', 'missing') };
}

function effectiveUValue(
  element: EnvelopeElement,
  kind: EnvelopeElementKind,
  contribution: TransmissionElementContribution | undefined,
  warnings: string[],
): { value: number | null; provenance: EngineeringProvenance } {
  if (contribution) {
    return {
      value: finitePositive(contribution.uValue) ? contribution.uValue : null,
      provenance: normalizeCurrentEngineeringProvenance('u_value', contribution.uValueSource, warnings),
    };
  }
  // The live transmission result does not expose a resolved U when area is
  // missing. Preserve its source class but do not recompute the profile number.
  if (finitePositive(element.uValue)) {
    return { value: element.uValue, provenance: normalizeCurrentEngineeringProvenance('u_value', 'certificate', warnings) };
  }
  if (element.constructionTier != null) {
    return { value: null, provenance: normalizeCurrentEngineeringProvenance('u_value', 'construction_profile', warnings) };
  }
  if (kind && element.uValueSource != null) {
    return { value: null, provenance: normalizeCurrentEngineeringProvenance('u_value', element.uValueSource, warnings) };
  }
  return { value: null, provenance: normalizeCurrentEngineeringProvenance('u_value', 'unknown', warnings) };
}

function solarIrradianceProvenance(
  source: string | null,
  warnings: string[],
): EngineeringProvenance {
  return normalizeCurrentEngineeringProvenance('solar', source, warnings);
}

function mechanicalVentilationUsed(balance: AirBreakdown['ventilationBalance'], flow: number | null): boolean {
  if (balance === 'balanced' || balance === 'supply_only' || balance === 'exhaust_only') return true;
  return balance === 'unknown' && flow != null;
}

function effectiveAirChanges(
  air: AirBreakdown | null | undefined,
  rawAir: BuildingRoom['air'] | null | undefined,
  warnings: string[],
): { value: number | null; provenance: EngineeringProvenance; sourceReference?: string } {
  const source = air?.infiltrationSource ?? null;
  if (source === 'explicit_ach' && finiteNonNegative(rawAir?.airChangesPerHour)) {
    return {
      value: rawAir.airChangesPerHour,
      provenance: normalizeCurrentEngineeringProvenance('infiltration', source, warnings),
    };
  }
  if (air?.infiltrationFlowM3h != null && finitePositive(air.roomVolumeM3)) {
    const value = air.infiltrationFlowM3h / air.roomVolumeM3;
    if (Number.isFinite(value) && value >= 0) {
      return {
        value,
        provenance: normalizeCurrentEngineeringProvenance('infiltration', source, warnings),
        sourceReference: sourceReferenceForAirBreakdown(air, source, rawAir),
      };
    }
  }
  return {
    value: null,
    provenance: normalizeCurrentEngineeringProvenance('infiltration', source ?? 'missing', warnings),
  };
}

function internalSource(
  source: InternalGainsBreakdown['peopleSource'],
  occupancySource: InternalGainsBreakdown['occupancySource'],
  warnings: string[],
): EngineeringProvenance {
  const normalized = normalizeCurrentEngineeringProvenance('internal_gain', source, warnings);
  if (normalized === 'PROFILE_DEFAULT' && occupancySource === 'user_explicit') return 'DERIVED';
  return normalized;
}

function modeledArea(
  snapshotRooms: BuildingLoadCalculation['inputSnapshot']['rooms'],
  resultByRoom: ReadonlyMap<string, RoomLoadResult>,
  requestedServices: readonly EngineeringQualityService[],
): number | null {
  const included = new Set<string>();
  for (const room of snapshotRooms) {
    const result = resultByRoom.get(room.id);
    if (!result) continue;
    if (requestedServices.some((service) => isModeledService(result, service))) included.add(room.id);
  }
  if (included.size === 0) return null;
  let total = 0;
  for (const roomId of included) {
    const result = resultByRoom.get(roomId);
    if (!result || !finiteNonNegative(result.areaM2)) return null;
    total += result.areaM2;
  }
  return total;
}

function coverageFor(
  project: BuildingProject,
  snapshotRooms: BuildingLoadInputSnapshotRooms,
  resultByRoom: ReadonlyMap<string, RoomLoadResult>,
  requestedServices: readonly EngineeringQualityService[],
): EngineeringCoverage {
  const declaredAreaM2 = finitePositive(project.totalAreaM2) ? project.totalAreaM2 : null;
  const modeledAreaM2 = modeledArea(snapshotRooms, resultByRoom, requestedServices);
  const ratio = declaredAreaM2 != null && modeledAreaM2 != null ? modeledAreaM2 / declaredAreaM2 : null;
  // CM13: consume the newly persisted authoritative coverage intent when present.
  // Area equality / per-room results remain VALIDATION EVIDENCE ONLY and never
  // promote scope. Absent intent => the frozen legacy UNKNOWN / UNCONFIRMED.
  const intent = project.calculationConfiguration?.coverageIntent ?? null;
  return {
    declaredAreaM2,
    modeledAreaM2,
    ratio: ratio != null && Number.isFinite(ratio) ? ratio : null,
    scope: intent?.calculationScope ?? 'UNKNOWN',
    confirmation: intent?.coverageConfirmation ?? 'UNCONFIRMED',
  };
}

type BuildingLoadInputSnapshotRooms = BuildingLoadCalculation['inputSnapshot']['rooms'];

function planProjectFields(
  plan: MutableExpectedQualityFieldPlan,
  requestedServices: readonly EngineeringQualityService[],
): void {
  for (const service of SERVICES) {
    const classification: QualityFieldClassification = requestedServices.includes(service)
      ? 'applicable'
      : 'irrelevant';
    addPlannedField(plan, projectFieldId(service, 'climate:location'), classification);
    addPlannedField(
      plan,
      projectFieldId(service, service === 'heating' ? 'ToutHeatingDesign' : 'ToutCoolingDesign'),
      classification,
    );
  }
}

function planRoomGeometryFields(
  plan: MutableExpectedQualityFieldPlan,
  snapshotRoom: BuildingLoadInputSnapshotRooms[number],
  roomResult: RoomLoadResult,
  requestedServices: readonly EngineeringQualityService[],
): void {
  const roomIsModeled = requestedServices.some((service) => isModeledService(roomResult, service));
  for (const service of SERVICES) {
    const serviceModeled = requestedServices.includes(service) && isModeledService(roomResult, service);
    const classification: QualityFieldClassification = serviceModeled ? 'applicable' : 'irrelevant';
    for (const suffix of [
      'geometry:area',
      'geometry:height',
      'geometry:volume',
      `climate:${service === 'heating' ? 'tin-heating' : 'tin-cooling'}`,
    ]) {
      addPlannedField(plan, roomFieldId(snapshotRoom.id, service, suffix), classification);
    }
  }
  addPlannedField(
    plan,
    roomMetaFieldId(snapshotRoom.id, 'room-type'),
    roomIsModeled ? 'applicable' : 'irrelevant',
  );
}

function resolvedUIsCertified(
  element: EnvelopeElement,
  contribution: TransmissionElementContribution | undefined,
): boolean {
  return contribution != null
    ? contribution.uValueSource === 'certificate'
    : finitePositive(element.uValue);
}

function planEnvelopeFields(
  plan: MutableExpectedQualityFieldPlan,
  snapshotRoom: BuildingLoadInputSnapshotRooms[number],
  roomResult: RoomLoadResult,
  requestedServices: readonly EngineeringQualityService[],
): void {
  for (const kind of ENVELOPE_KINDS) {
    const elements = envelopeElements(snapshotRoom, kind);
    const plannedElements: Array<EnvelopeElement | null> = elements.length ? elements : [null];

    for (const service of SERVICES) {
      const serviceModeled = requestedServices.includes(service) && isModeledService(roomResult, service);
      for (const element of plannedElements) {
        const elementId = element?.elementId ?? 'none';
        const applicable = serviceModeled && element != null;
        const classification: QualityFieldClassification = applicable ? 'applicable' : 'irrelevant';
        addPlannedField(plan, elementFieldId(snapshotRoom.id, service, kind, elementId, 'area'), classification);
        addPlannedField(plan, elementFieldId(snapshotRoom.id, service, kind, elementId, 'u'), classification);

        const contribution = element
          ? transmissionElement(roomResult.transmissionBreakdown, element.elementId)
          : undefined;
        if (applicable && element?.constructionTier != null && resolvedUIsCertified(element, contribution)) {
          addPlannedField(
            plan,
            elementFieldId(snapshotRoom.id, service, kind, elementId, 'u:profile-superseded'),
            'superseded',
          );
        }

        if (kind !== 'window' || service !== 'cooling') continue;

        const solarApplicable = serviceModeled && element != null;
        const solarClassification: QualityFieldClassification = solarApplicable ? 'applicable' : 'irrelevant';
        const netAreaId = solarFieldId(snapshotRoom.id, elementId, 'net-glazing-area');
        addPlannedField(plan, netAreaId, solarClassification);

        const dimensionsApplicable = solarApplicable && element?.areaM2 == null;
        addPlannedField(
          plan,
          solarFieldId(snapshotRoom.id, elementId, 'dimensions'),
          dimensionsApplicable ? 'applicable' : 'irrelevant',
        );
        for (const suffix of ['orientation', 'shgc', 'shading-factor', 'irradiance']) {
          addPlannedField(plan, solarFieldId(snapshotRoom.id, elementId, suffix), solarClassification);
        }

        const frameUsed = element != null && element.areaM2 == null && (
          element.grossAreaM2 != null || (element.widthM != null && element.heightM != null)
        );
        const frameSuperseded = element != null && element.areaM2 != null;
        addPlannedField(
          plan,
          solarFieldId(snapshotRoom.id, elementId, 'frame-factor'),
          solarApplicable && frameUsed ? 'applicable' : frameSuperseded ? 'superseded' : 'irrelevant',
        );
      }
    }
  }
}

function planAirFields(
  plan: MutableExpectedQualityFieldPlan,
  snapshotRoom: BuildingLoadInputSnapshotRooms[number],
  roomResult: RoomLoadResult,
  requestedServices: readonly EngineeringQualityService[],
): void {
  const air = roomResult.airBreakdown ?? null;
  const rawAir = snapshotRoom.air ?? null;
  const balance = air?.ventilationBalance ?? rawAir?.ventilationBalance ?? 'unknown';
  const mechanical = mechanicalVentilationUsed(balance, air?.ventilationFlowM3h ?? null);
  const infiltrationSource = air?.infiltrationSource ?? null;

  for (const service of SERVICES) {
    const serviceModeled = requestedServices.includes(service) && isModeledService(roomResult, service);
    const serviceClassification: QualityFieldClassification = serviceModeled ? 'applicable' : 'irrelevant';
    for (const suffix of ['air:infiltration-method', 'air:infiltration-flow', 'air:ventilation-balance']) {
      addPlannedField(plan, roomFieldId(snapshotRoom.id, service, suffix), serviceClassification);
    }

    const achApplicable = serviceModeled && (
      infiltrationSource === 'blower_door_derived'
      || infiltrationSource === 'explicit_ach'
      || infiltrationSource === 'airtightness_profile'
    );
    addPlannedField(
      plan,
      roomFieldId(snapshotRoom.id, service, 'air:ach'),
      achApplicable ? 'applicable' : 'irrelevant',
    );

    const ach50Applicable = serviceModeled && (
      infiltrationSource === 'blower_door_derived' || rawAir?.ach50 != null
    );
    addPlannedField(
      plan,
      roomFieldId(snapshotRoom.id, service, 'air:ach50'),
      ach50Applicable ? 'applicable' : 'irrelevant',
    );

    const airtightnessApplicable = serviceModeled && rawAir?.airtightnessClass != null;
    const airtightnessSuperseded = airtightnessApplicable && infiltrationSource !== 'airtightness_profile';
    addPlannedField(
      plan,
      roomFieldId(snapshotRoom.id, service, 'air:airtightness-class'),
      airtightnessSuperseded ? 'superseded' : airtightnessApplicable ? 'applicable' : 'irrelevant',
    );

    addPlannedField(
      plan,
      roomFieldId(snapshotRoom.id, service, 'air:mechanical-flow'),
      serviceModeled && mechanical ? 'applicable' : 'irrelevant',
    );
  }
}

function planInternalFields(
  plan: MutableExpectedQualityFieldPlan,
  snapshotRoom: BuildingLoadInputSnapshotRooms[number],
  roomResult: RoomLoadResult,
  requestedServices: readonly EngineeringQualityService[],
): void {
  const internal = roomResult.internalGainsBreakdown ?? null;
  const coolingModeled = requestedServices.includes('cooling') && isModeledService(roomResult, 'cooling');
  const coolingClassification: QualityFieldClassification = coolingModeled ? 'applicable' : 'irrelevant';
  for (const suffix of ['occupancy', 'people-gain', 'lighting', 'equipment']) {
    addPlannedField(plan, roomFieldId(snapshotRoom.id, 'cooling', `internal:${suffix}`), coolingClassification);
  }

  const sensibleUsed = coolingModeled
    && internal?.occupantSensibleWPerPerson != null
    && internal.peopleSource !== 'explicit';
  addPlannedField(
    plan,
    roomFieldId(snapshotRoom.id, 'cooling', 'internal:occupant-sensible'),
    coolingModeled && sensibleUsed ? 'applicable' : coolingModeled ? 'superseded' : 'irrelevant',
  );

  const kitchenApplies = coolingModeled && (
    snapshotRoom.roomType === 'kitchen'
    || snapshotRoom.roomType === 'kitchen_living'
    || (snapshotRoom.roomType === 'living_room' && snapshotRoom.conditions.includes('kitchen'))
  );
  addPlannedField(
    plan,
    roomFieldId(snapshotRoom.id, 'cooling', 'internal:kitchen-process'),
    kitchenApplies ? 'applicable' : 'irrelevant',
  );

  addPlannedField(plan, roomFieldId(snapshotRoom.id, 'cooling', 'internal:schedule'), 'irrelevant');
  addPlannedField(plan, roomFieldId(snapshotRoom.id, 'cooling', 'internal:latent'), 'irrelevant');
  addPlannedField(plan, roomMetaFieldId(snapshotRoom.id, 'thermal-bridge-psi'), 'irrelevant');
  addPlannedField(plan, roomMetaFieldId(snapshotRoom.id, 'thermal-bridge-length'), 'irrelevant');
}

function assertAdapterInput(input: BuildingProjectQualityAdapterInput): void {
  const { project, steadyStateCalculation: calculation } = input;
  if (calculation.mode !== 'steady_state' || calculation.inputSnapshot.mode !== 'steady_state') {
    throw new AdapterInventoryValidationError('unsupported_load_mode');
  }
  if (calculation.inputSnapshot.projectId !== project.id) {
    throw new AdapterInventoryValidationError('snapshot_project_mismatch', calculation.inputSnapshot.projectId);
  }
  if (calculation.inputSnapshot.buildingRevision !== project.buildingRevision
    || calculation.inputSnapshot.systemsRevision !== project.systemsRevision) {
    throw new AdapterInventoryValidationError('snapshot_revision_mismatch');
  }
}

function requestedQualityServices(
  calculation: BuildingLoadCalculation,
): EngineeringQualityService[] {
  return calculation.inputSnapshot.requestedServices.filter(
    (service): service is EngineeringQualityService => service === 'heating' || service === 'cooling',
  );
}

/** Build the complete expected inventory before the field emitter runs. */
export function buildExpectedQualityFieldPlan(
  input: BuildingProjectQualityAdapterInput,
): ExpectedQualityFieldPlan {
  assertAdapterInput(input);
  const calculation = input.steadyStateCalculation;
  const snapshotRooms = calculation.inputSnapshot.rooms;
  const requestedServices = requestedQualityServices(calculation);
  const resultByRoom = validateRoomAlignment(snapshotRooms, calculation.roomResults);
  const classification = createClassificationIndex();
  const plan: MutableExpectedQualityFieldPlan = {
    expectedFieldIds: new Set<string>(),
    ...classification,
  };

  planProjectFields(plan, requestedServices);
  for (const snapshotRoom of snapshotRooms) {
    const roomResult = resultByRoom.get(snapshotRoom.id);
    if (!roomResult) throw new AdapterInventoryValidationError('missing_room_result', snapshotRoom.id);
    planRoomGeometryFields(plan, snapshotRoom, roomResult, requestedServices);
    planEnvelopeFields(plan, snapshotRoom, roomResult, requestedServices);
    planAirFields(plan, snapshotRoom, roomResult, requestedServices);
    planInternalFields(plan, snapshotRoom, roomResult, requestedServices);
  }

  return plan;
}

function addProjectFields(
  emission: QualityFieldEmission,
  calculation: BuildingLoadCalculation,
  requestedServices: readonly EngineeringQualityService[],
  warnings: string[],
): void {
  const climateReference = sourceReferenceForClimate(calculation);
  const climateProvenance = climateDatasetProvenance(calculation, warnings);
  const climateAuthoritative = climateProvenance === 'AUTHORITATIVE_DATASET';
  const referenceRoom = calculation.roomResults.find((room) => room.transmissionBreakdown != null);

  for (const service of SERVICES) {
    const serviceRequested = requestedServices.includes(service);
    const roomLoadIsCalculated = serviceRequested;
    const climate = makeField(
      projectFieldId(service, 'climate:location'),
      'climate',
      climateAuthoritative ? calculation.climateLocationId : null,
      climateProvenance,
      fieldApplicability(roomLoadIsCalculated, { roomType: null }),
      { service, sourceReference: climateReference },
    );
    addField(emission, climate, serviceRequested ? 'applicable' : 'irrelevant');

    const transmission = referenceRoom?.transmissionBreakdown;
    const temperatureParameter = service === 'heating' ? 'ToutHeatingDesign' : 'ToutCoolingDesign';
    const outdoor = service === 'heating' ? transmission?.outdoorHeatingC : transmission?.outdoorCoolingC;
    const outdoorField = makeField(
      projectFieldId(service, temperatureParameter),
      temperatureParameter,
      roomLoadIsCalculated && finiteNumber(outdoor) ? outdoor : null,
      roomLoadIsCalculated && finiteNumber(outdoor) && climateAuthoritative
        ? climateProvenance
        : 'UNKNOWN',
      fieldApplicability(roomLoadIsCalculated),
      { service, sourceReference: climateReference },
    );
    addField(emission, outdoorField, serviceRequested ? 'applicable' : 'irrelevant');
  }

}

function addRoomGeometryFields(
  emission: QualityFieldEmission,
  snapshotRoom: BuildingLoadInputSnapshotRooms[number],
  roomResult: RoomLoadResult,
  requestedServices: readonly EngineeringQualityService[],
): void {
  const roomIsModeled = requestedServices.some((service) => isModeledService(roomResult, service));
  const areaValue = roomIsModeled && finitePositive(roomResult.areaM2) ? roomResult.areaM2 : null;
  const areaProv = areaValue != null ? areaProvenance(snapshotRoom.areaM2, roomResult.areaM2) : 'UNKNOWN';
  const heightValue = roomIsModeled && finitePositive(roomResult.effectiveCeilingHeightM) ? roomResult.effectiveCeilingHeightM : null;
  const heightProv = heightValue != null ? heightProvenance(snapshotRoom, heightValue) : 'UNKNOWN';
  const roomArea = finitePositive(roomResult.areaM2) ? roomResult.areaM2 : null;
  const volumeValue = roomIsModeled && finiteNonNegative(roomResult.airBreakdown?.roomVolumeM3)
    ? roomResult.airBreakdown?.roomVolumeM3 ?? null
    : null;
  const volumeProv: EngineeringProvenance = volumeValue == null ? 'UNKNOWN' : 'DERIVED';
  const volumeParents = [derivedParentQuality(areaProv), derivedParentQuality(heightProv)];

  for (const service of SERVICES) {
    const serviceModeled = requestedServices.includes(service) && isModeledService(roomResult, service);
    const applicability = fieldApplicability(serviceModeled, {
      roomHasArea: roomArea != null,
      roomType: snapshotRoom.roomType,
    });
    const area = makeField(
      roomFieldId(snapshotRoom.id, service, 'geometry:area'),
      'areaM2',
      serviceModeled ? areaValue : null,
      serviceModeled ? areaProv : 'UNKNOWN',
      applicability,
      { service, roomId: snapshotRoom.id },
    );
    addField(emission, area, serviceModeled ? 'applicable' : 'irrelevant');

    const height = makeField(
      roomFieldId(snapshotRoom.id, service, 'geometry:height'),
      'heightM',
      serviceModeled ? heightValue : null,
      serviceModeled ? heightProv : 'UNKNOWN',
      applicability,
      { service, roomId: snapshotRoom.id },
    );
    addField(emission, height, serviceModeled ? 'applicable' : 'irrelevant');

    const volume = makeField(
      roomFieldId(snapshotRoom.id, service, 'geometry:volume'),
      'volumeM3',
      serviceModeled ? volumeValue : null,
      serviceModeled ? volumeProv : 'UNKNOWN',
      applicability,
      {
        service,
        roomId: snapshotRoom.id,
        sourceReference: volumeValue == null ? undefined : 'derived:areaM2×heightM',
        derivedParentQualities: volumeValue == null ? undefined : volumeParents,
      },
    );
    addField(emission, volume, serviceModeled ? 'applicable' : 'irrelevant');

    const tinParameter: EngineeringQualityParameter = service === 'heating' ? 'TinHeating' : 'TinCooling';
    const tinValue = serviceModeled
      ? service === 'heating'
        ? roomResult.transmissionBreakdown?.indoorHeatingC ?? null
        : roomResult.transmissionBreakdown?.indoorCoolingC ?? null
      : null;
    const tinProvenance: EngineeringProvenance = tinValue == null
      ? 'UNKNOWN'
      : service === 'heating'
        ? 'DERIVED'
        : 'PROFILE_DEFAULT';
    const tin = makeField(
      roomFieldId(snapshotRoom.id, service, `climate:${service === 'heating' ? 'tin-heating' : 'tin-cooling'}`),
      tinParameter,
      finiteNumber(tinValue) ? tinValue : null,
      tinProvenance,
      applicability,
      {
        service,
        roomId: snapshotRoom.id,
        sourceReference: service === 'heating' && tinValue != null ? 'derived:roomType' : undefined,
        derivedParentQualities: service === 'heating' && tinValue != null ? ['MEDIUM'] : undefined,
      },
    );
    addField(emission, tin, serviceModeled ? 'applicable' : 'irrelevant');
  }

  const roomType = makeField(
    roomMetaFieldId(snapshotRoom.id, 'room-type'),
    'roomType',
    roomIsModeled ? snapshotRoom.roomType : null,
    roomIsModeled ? 'EXPLICIT_USER' : 'UNKNOWN',
    fieldApplicability(roomIsModeled, { roomType: snapshotRoom.roomType }),
    { roomId: snapshotRoom.id },
  );
  addField(emission, roomType, roomIsModeled ? 'applicable' : 'irrelevant');
}

function addEnvelopeFields(
  emission: QualityFieldEmission,
  snapshotRoom: BuildingLoadInputSnapshotRooms[number],
  roomResult: RoomLoadResult,
  requestedServices: readonly EngineeringQualityService[],
  warnings: string[],
): void {
  for (const kind of ENVELOPE_KINDS) {
    const elements = envelopeElements(snapshotRoom, kind);
    const actualElements = elements.length ? elements : [null];

    for (const service of SERVICES) {
      const serviceModeled = requestedServices.includes(service) && isModeledService(roomResult, service);
      const roomBaseApplicability = fieldApplicability(serviceModeled, {
        roomType: snapshotRoom.roomType,
        roomHasArea: finitePositive(roomResult.areaM2),
        elementExists: elements.length > 0,
        solarExposedGlazingExists: kind === 'window' && elements.length > 0 && service === 'cooling' && serviceModeled,
      });

      for (const element of actualElements) {
        const elementId = element?.elementId ?? 'none';
        const areaParameter = AREA_PARAMETER_BY_KIND[kind];
        const uParameter = U_PARAMETER_BY_KIND[kind];
        const contribution = element ? transmissionElement(roomResult.transmissionBreakdown, element.elementId) : undefined;
        const area = element ? effectiveGeometryArea(element, contribution) : { value: null, provenance: 'UNKNOWN' as const };
        const u = element ? effectiveUValue(element, kind, contribution, warnings) : { value: null, provenance: 'UNKNOWN' as const };
        const applicable = serviceModeled && element != null;
        const applicability = { ...roomBaseApplicability, elementExists: element != null };

        const areaField = makeField(
          elementFieldId(snapshotRoom.id, service, kind, elementId, 'area'),
          areaParameter,
          applicable ? area.value : null,
          applicable ? area.provenance : 'UNKNOWN',
          applicability,
          { service, roomId: snapshotRoom.id, sourceReference: element ? sourceReferenceForElement(element) : undefined },
        );
        addField(emission, areaField, applicable ? 'applicable' : 'irrelevant');

        const uFieldId = elementFieldId(snapshotRoom.id, service, kind, elementId, 'u');
        const uField = makeField(
          uFieldId,
          uParameter,
          applicable ? u.value : null,
          applicable ? u.provenance : 'UNKNOWN',
          applicability,
          { service, roomId: snapshotRoom.id, sourceReference: element ? sourceReferenceForElement(element) : undefined },
        );
        addField(emission, uField, applicable ? 'applicable' : 'irrelevant');

        if (applicable && element?.constructionTier != null && u.provenance === 'CERTIFIED_SPEC') {
          const superseded = makeField(
            elementFieldId(snapshotRoom.id, service, kind, elementId, 'u:profile-superseded'),
            uParameter,
            null,
            'PROFILE_DEFAULT',
            applicability,
            {
              service,
              roomId: snapshotRoom.id,
              sourceReference: `constructionTier=${element.constructionTier}`,
              supersededBy: [uFieldId],
            },
          );
          addField(emission, superseded, 'superseded');
        }

        if (kind !== 'window' || service !== 'cooling') continue;

        const solar = element ? solarWindow(roomResult.solarBreakdown, element.elementId) : undefined;
        const solarApplicable = service === 'cooling' && serviceModeled && element != null;
        const solarApplicability = {
          ...applicability,
          solarExposedGlazingExists: elements.length > 0 && solarApplicable,
        };
        const netAreaId = solarFieldId(snapshotRoom.id, elementId, 'net-glazing-area');
        const netAreaValue = solar?.areaM2 ?? (element?.areaM2 ?? null);
        const netArea = makeField(
          netAreaId,
          'windowAreaM2',
          solarApplicable && finiteNonNegative(netAreaValue) ? netAreaValue : null,
          solarApplicable && finiteNonNegative(netAreaValue)
            ? element?.areaM2 != null ? 'EXPLICIT_USER' : 'DERIVED'
            : 'UNKNOWN',
          solarApplicability,
          { service: 'cooling', roomId: snapshotRoom.id },
        );
        addField(emission, netArea, solarApplicable ? 'applicable' : 'irrelevant');

        const dimensionsValue = element
          ? element.areaM2 != null
            ? null
            : element.widthM != null && element.heightM != null
              ? `widthM=${element.widthM};heightM=${element.heightM}`
              : element.grossAreaM2 != null
                ? `grossAreaM2=${element.grossAreaM2}`
                : null
          : null;
        const dimensionsApplicable = solarApplicable && element != null && element.areaM2 == null;
        const dimensions = makeField(
          solarFieldId(snapshotRoom.id, elementId, 'dimensions'),
          'windowDimensions',
          dimensionsApplicable ? dimensionsValue : null,
          dimensionsApplicable ? dimensionsValue != null ? 'EXPLICIT_USER' : 'UNKNOWN' : 'UNKNOWN',
          solarApplicability,
          { service: 'cooling', roomId: snapshotRoom.id },
        );
        addField(emission, dimensions, dimensionsApplicable ? 'applicable' : 'irrelevant');

        const orientation = makeField(
          solarFieldId(snapshotRoom.id, elementId, 'orientation'),
          'windowOrientation',
          solarApplicable ? solar?.orientation ?? element?.orientation ?? null : null,
          solarApplicable && (solar?.orientation ?? element?.orientation) != null ? 'EXPLICIT_USER' : 'UNKNOWN',
          solarApplicability,
          { service: 'cooling', roomId: snapshotRoom.id },
        );
        addField(emission, orientation, solarApplicable ? 'applicable' : 'irrelevant');

        const shgc = makeField(
          solarFieldId(snapshotRoom.id, elementId, 'shgc'),
          'SHGC',
          solarApplicable ? solar?.shgc ?? null : null,
          solarApplicable
            ? normalizeCurrentEngineeringProvenance('shgc', solar?.shgcSource, warnings)
            : 'UNKNOWN',
          solarApplicability,
          { service: 'cooling', roomId: snapshotRoom.id },
        );
        addField(emission, shgc, solarApplicable ? 'applicable' : 'irrelevant');

        const shading = makeField(
          solarFieldId(snapshotRoom.id, elementId, 'shading-factor'),
          'shadingFactor',
          solarApplicable ? solar?.shadingFactor ?? null : null,
          solarApplicable
            ? normalizeCurrentEngineeringProvenance('shading', solar?.shadingSource, warnings)
            : 'UNKNOWN',
          solarApplicability,
          { service: 'cooling', roomId: snapshotRoom.id },
        );
        addField(emission, shading, solarApplicable ? 'applicable' : 'irrelevant');

        const irradiance = makeField(
          solarFieldId(snapshotRoom.id, elementId, 'irradiance'),
          'solarIrradiance',
          solarApplicable ? solar?.irradianceWm2 ?? null : null,
          solarApplicable ? solarIrradianceProvenance(solar?.irradianceSource, warnings) : 'UNKNOWN',
          solarApplicability,
          {
            service: 'cooling',
            roomId: snapshotRoom.id,
            sourceReference: sourceReferenceForSolarBreakdown(
              roomResult.solarBreakdown,
              solar?.irradianceSource ?? null,
            ),
          },
        );
        addField(emission, irradiance, solarApplicable ? 'applicable' : 'irrelevant');

        const frameId = solarFieldId(snapshotRoom.id, elementId, 'frame-factor');
        const frameUsed = element != null && element.areaM2 == null && (
          element.grossAreaM2 != null || (element.widthM != null && element.heightM != null)
        );
        const frameSuperseded = element != null && element.areaM2 != null;
        const frame = makeField(
          frameId,
          'frameFactor',
          solarApplicable && frameUsed ? WINDOW_GLAZING_AREA_FACTOR : null,
          solarApplicable && frameUsed ? 'FALLBACK' : 'UNKNOWN',
          solarApplicability,
          {
            service: 'cooling',
            roomId: snapshotRoom.id,
            supersededBy: frameSuperseded ? [netAreaId] : undefined,
          },
        );
        addField(
          emission,
          frame,
          solarApplicable && frameUsed ? 'applicable' : frameSuperseded ? 'superseded' : 'irrelevant',
        );
      }
    }
  }
}

function addAirFields(
  emission: QualityFieldEmission,
  snapshotRoom: BuildingLoadInputSnapshotRooms[number],
  roomResult: RoomLoadResult,
  requestedServices: readonly EngineeringQualityService[],
  warnings: string[],
): void {
  const air = roomResult.airBreakdown ?? null;
  const rawAir = snapshotRoom.air ?? null;
  const balance = air?.ventilationBalance ?? rawAir?.ventilationBalance ?? 'unknown';
  const ventilationFlow = air?.ventilationFlowM3h ?? null;
  const mechanical = mechanicalVentilationUsed(balance, ventilationFlow);
  const infiltrationSource = air?.infiltrationSource ?? null;
  const outdoorApplicable = requestedServices.some((service) => isModeledService(roomResult, service));
  const roomApplicability = fieldApplicability(outdoorApplicable, {
    roomType: snapshotRoom.roomType,
    outdoorAirLoadApplicable: outdoorApplicable,
    mechanicalVentilationUsed: mechanical,
    roomHasArea: finitePositive(roomResult.areaM2),
    occupancy: roomResult.internalGainsBreakdown?.occupancy ?? null,
  });
  const ach = effectiveAirChanges(air, rawAir, warnings);
  const sourceReference = sourceReferenceForAir(roomResult, infiltrationSource, rawAir);

  for (const service of SERVICES) {
    const serviceModeled = requestedServices.includes(service) && isModeledService(roomResult, service);
    const applicability = { ...roomApplicability, roomLoadCalculated: serviceModeled, outdoorAirLoadApplicable: serviceModeled && outdoorApplicable };
    const infiltrationMethod = makeField(
      roomFieldId(snapshotRoom.id, service, 'air:infiltration-method'),
      'infiltrationMethod',
      serviceModeled ? infiltrationSource : null,
      serviceModeled ? normalizeCurrentEngineeringProvenance('infiltration', infiltrationSource, warnings) : 'UNKNOWN',
      applicability,
      { service, roomId: snapshotRoom.id, sourceReference },
    );
    addField(emission, infiltrationMethod, serviceModeled ? 'applicable' : 'irrelevant');

    const infiltrationFlow = makeField(
      roomFieldId(snapshotRoom.id, service, 'air:infiltration-flow'),
      'infiltrationFlowM3h',
      serviceModeled ? air?.infiltrationFlowM3h ?? null : null,
      serviceModeled ? normalizeCurrentEngineeringProvenance('infiltration', infiltrationSource, warnings) : 'UNKNOWN',
      applicability,
      { service, roomId: snapshotRoom.id, sourceReference },
    );
    addField(emission, infiltrationFlow, serviceModeled ? 'applicable' : 'irrelevant');

    const achApplicable = serviceModeled && (infiltrationSource === 'blower_door_derived' || infiltrationSource === 'explicit_ach' || infiltrationSource === 'airtightness_profile');
    const airChanges = makeField(
      roomFieldId(snapshotRoom.id, service, 'air:ach'),
      'airChangesPerHour',
      achApplicable ? ach.value : null,
      achApplicable ? ach.provenance : 'UNKNOWN',
      { ...applicability, outdoorAirLoadApplicable: achApplicable },
      { service, roomId: snapshotRoom.id, sourceReference: ach.sourceReference ?? sourceReference },
    );
    addField(emission, airChanges, achApplicable ? 'applicable' : 'irrelevant');

    const ach50Applicable = serviceModeled && (infiltrationSource === 'blower_door_derived' || rawAir?.ach50 != null);
    const ach50 = makeField(
      roomFieldId(snapshotRoom.id, service, 'air:ach50'),
      'ach50',
      ach50Applicable ? rawAir?.ach50 ?? null : null,
      ach50Applicable && rawAir?.ach50 != null ? 'MEASURED' : 'UNKNOWN',
      { ...applicability, outdoorAirLoadApplicable: ach50Applicable },
      { service, roomId: snapshotRoom.id, sourceReference },
    );
    addField(emission, ach50, ach50Applicable ? 'applicable' : 'irrelevant');

    const airtightnessApplicable = serviceModeled && rawAir?.airtightnessClass != null;
    const airtightnessSuperseded = airtightnessApplicable && infiltrationSource !== 'airtightness_profile';
    const airtightness = makeField(
      roomFieldId(snapshotRoom.id, service, 'air:airtightness-class'),
      'airtightnessClass',
      airtightnessApplicable ? rawAir?.airtightnessClass ?? null : null,
      airtightnessApplicable ? 'PROFILE_DEFAULT' : 'UNKNOWN',
      { ...applicability, outdoorAirLoadApplicable: airtightnessApplicable },
      {
        service,
        roomId: snapshotRoom.id,
        sourceReference: airtightnessApplicable ? `airtightness_class=${rawAir?.airtightnessClass}` : undefined,
        supersededBy: airtightnessSuperseded ? [roomFieldId(snapshotRoom.id, service, 'air:infiltration-flow')] : undefined,
      },
    );
    addField(
      emission,
      airtightness,
      airtightnessSuperseded ? 'superseded' : airtightnessApplicable ? 'applicable' : 'irrelevant',
    );

    const balanceField = makeField(
      roomFieldId(snapshotRoom.id, service, 'air:ventilation-balance'),
      'ventilationBalance',
      serviceModeled ? balance : null,
      serviceModeled && balance !== 'unknown' ? 'EXPLICIT_USER' : 'UNKNOWN',
      { ...applicability, mechanicalVentilationUsed: serviceModeled && mechanical },
      { service, roomId: snapshotRoom.id },
    );
    addField(emission, balanceField, serviceModeled ? 'applicable' : 'irrelevant');

    const mechanicalField = makeField(
      roomFieldId(snapshotRoom.id, service, 'air:mechanical-flow'),
      'ventilationFlowM3h',
      serviceModeled && mechanical ? ventilationFlow : null,
      serviceModeled && mechanical && ventilationFlow != null ? 'EXPLICIT_USER' : 'UNKNOWN',
      { ...applicability, mechanicalVentilationUsed: serviceModeled && mechanical },
      { service, roomId: snapshotRoom.id },
    );
    addField(emission, mechanicalField, serviceModeled && mechanical ? 'applicable' : 'irrelevant');
  }
}

function addInternalFields(
  emission: QualityFieldEmission,
  project: BuildingProject,
  snapshotRoom: BuildingLoadInputSnapshotRooms[number],
  roomResult: RoomLoadResult,
  requestedServices: readonly EngineeringQualityService[],
  warnings: string[],
): void {
  const internal = roomResult.internalGainsBreakdown ?? null;
  const coolingModeled = requestedServices.includes('cooling') && isModeledService(roomResult, 'cooling');
  const occupancy = internal?.occupancy ?? null;
  const applicability = fieldApplicability(coolingModeled, {
    roomType: snapshotRoom.roomType,
    livingRoomHasKitchen: snapshotRoom.roomType === 'living_room' && snapshotRoom.conditions.includes('kitchen'),
    occupancy,
    roomHasArea: finitePositive(roomResult.areaM2),
    solarExposedGlazingExists: snapshotRoom.envelope?.windowElements.length ? coolingModeled : false,
  });
  const sourceReference = sourceReferenceForInternal(project, internal?.peopleSource ?? internal?.lightingSource ?? null);
  const occupancyProvenance = coolingModeled
    ? normalizeCurrentEngineeringProvenance('occupancy', internal?.occupancySource, warnings)
    : 'UNKNOWN';
  const sensibleProvenance: EngineeringProvenance = coolingModeled && internal?.occupantSensibleWPerPerson != null
    ? internal.occupantSensibleWPerPerson === 75 ? 'PROFILE_DEFAULT' : 'EXPLICIT_USER'
    : 'UNKNOWN';
  const peopleProvenance = coolingModeled
    ? internalSource(internal?.peopleSource ?? null, internal?.occupancySource ?? null, warnings)
    : 'UNKNOWN';

  const occupancyField = makeField(
    roomFieldId(snapshotRoom.id, 'cooling', 'internal:occupancy'),
    'occupancy',
    coolingModeled ? occupancy : null,
    occupancyProvenance,
    applicability,
    { service: 'cooling', roomId: snapshotRoom.id },
  );
  addField(emission, occupancyField, coolingModeled ? 'applicable' : 'irrelevant');

  const peopleField = makeField(
    roomFieldId(snapshotRoom.id, 'cooling', 'internal:people-gain'),
    'peopleGainW',
    coolingModeled ? internal?.peopleW ?? null : null,
    peopleProvenance,
    applicability,
    {
      service: 'cooling',
      roomId: snapshotRoom.id,
      sourceReference,
      derivedParentQualities: peopleProvenance === 'DERIVED'
        ? [derivedParentQuality(occupancyProvenance), derivedParentQuality(sensibleProvenance)]
        : undefined,
    },
  );
  addField(emission, peopleField, coolingModeled ? 'applicable' : 'irrelevant');

  const sensibleUsed = coolingModeled && internal?.occupantSensibleWPerPerson != null && internal.peopleSource !== 'explicit';
  const sensible = makeField(
    roomFieldId(snapshotRoom.id, 'cooling', 'internal:occupant-sensible'),
    'occupantSensibleWPerPerson',
    sensibleUsed ? internal?.occupantSensibleWPerPerson ?? null : null,
    sensibleUsed ? sensibleProvenance : 'UNKNOWN',
    applicability,
    {
      service: 'cooling',
      roomId: snapshotRoom.id,
      sourceReference,
      supersededBy: coolingModeled && !sensibleUsed ? [peopleField.fieldId] : undefined,
    },
  );
  addField(emission, sensible, coolingModeled && sensibleUsed ? 'applicable' : coolingModeled ? 'superseded' : 'irrelevant');

  const lighting = makeField(
    roomFieldId(snapshotRoom.id, 'cooling', 'internal:lighting'),
    'lightingGainW',
    coolingModeled ? internal?.lightingW ?? null : null,
    coolingModeled ? normalizeCurrentEngineeringProvenance('internal_gain', internal?.lightingSource, warnings) : 'UNKNOWN',
    applicability,
    { service: 'cooling', roomId: snapshotRoom.id, sourceReference },
  );
  addField(emission, lighting, coolingModeled ? 'applicable' : 'irrelevant');

  const equipment = makeField(
    roomFieldId(snapshotRoom.id, 'cooling', 'internal:equipment'),
    'equipmentGainW',
    coolingModeled ? internal?.equipmentW ?? null : null,
    coolingModeled ? normalizeCurrentEngineeringProvenance('internal_gain', internal?.equipmentSource, warnings) : 'UNKNOWN',
    applicability,
    { service: 'cooling', roomId: snapshotRoom.id, sourceReference },
  );
  addField(emission, equipment, coolingModeled ? 'applicable' : 'irrelevant');

  const kitchenApplies = coolingModeled && (
    snapshotRoom.roomType === 'kitchen' ||
    snapshotRoom.roomType === 'kitchen_living' ||
    (snapshotRoom.roomType === 'living_room' && snapshotRoom.conditions.includes('kitchen'))
  );
  const process = makeField(
    roomFieldId(snapshotRoom.id, 'cooling', 'internal:kitchen-process'),
    'kitchenProcessSchedule',
    null,
    'UNKNOWN',
    { ...applicability, roomType: snapshotRoom.roomType },
    { service: 'cooling', roomId: snapshotRoom.id },
  );
  addField(emission, process, kitchenApplies ? 'applicable' : 'irrelevant');

  // These inputs are canonical registry axes but are explicitly outside the
  // current steady_state v1 numeric path (no schedule/diversity or latent model).
  for (const [parameter, suffix] of [
    ['operatingSchedule', 'schedule'],
    ['humidityLatentMethod', 'latent'],
  ] as const) {
    const outOfScope = makeField(
      roomFieldId(snapshotRoom.id, 'cooling', `internal:${suffix}`),
      parameter,
      null,
      'UNKNOWN',
      fieldApplicability(false, { roomType: snapshotRoom.roomType }),
      { service: 'cooling', roomId: snapshotRoom.id },
    );
    addField(emission, outOfScope, 'irrelevant');
  }

  for (const [parameter, suffix] of [
    ['thermalBridgePsi', 'thermal-bridge-psi'],
    ['thermalBridgeLength', 'thermal-bridge-length'],
  ] as const) {
    const outOfScope = makeField(
      roomMetaFieldId(snapshotRoom.id, suffix),
      parameter,
      null,
      'UNKNOWN',
      fieldApplicability(false, { roomType: snapshotRoom.roomType }),
      { roomId: snapshotRoom.id },
    );
    addField(emission, outOfScope, 'irrelevant');
  }
}

/**
 * Pure fail-closed inventory validation. The expected plan is built before the
 * emitter runs; actual classification sets are recorded only by the emitter.
 */
export function validateQualityFieldInventory(
  fields: readonly EngineeringQualityFieldInput[],
  expectedPlan: ExpectedQualityFieldPlan,
  actualClassification: QualityFieldClassificationIndex,
): void {
  const actual = new Set<string>();
  for (const field of fields) {
    if (actual.has(field.fieldId)) throw new AdapterInventoryValidationError('duplicate_field_id', field.fieldId);
    actual.add(field.fieldId);
  }

  const expected = expectedPlan.expectedFieldIds;
  const expectedSets = [
    expectedPlan.applicableFieldIds,
    expectedPlan.irrelevantFieldIds,
    expectedPlan.supersededFieldIds,
  ] as const;
  const actualSets = [
    actualClassification.applicableFieldIds,
    actualClassification.irrelevantFieldIds,
    actualClassification.supersededFieldIds,
  ] as const;

  for (const id of expected) {
    const categories = expectedSets.reduce((count, ids) => count + (ids.has(id) ? 1 : 0), 0);
    if (categories !== 1) throw new AdapterInventoryValidationError('inventory_conflict', id);
    if (!actual.has(id)) throw new AdapterInventoryValidationError('missing_expected_field', id);
  }
  for (const id of actual) {
    if (!expected.has(id)) throw new AdapterInventoryValidationError('unaccounted_field', id);
    const actualCategories = actualSets.reduce((count, ids) => count + (ids.has(id) ? 1 : 0), 0);
    if (actualCategories !== 1) throw new AdapterInventoryValidationError('inventory_conflict', id);
  }

  for (const ids of expectedSets) {
    for (const id of ids) {
      if (!expected.has(id)) throw new AdapterInventoryValidationError('inventory_conflict', id);
    }
  }
  for (const ids of actualSets) {
    for (const id of ids) {
      if (!actual.has(id) || !expected.has(id)) {
        throw new AdapterInventoryValidationError('inventory_conflict', id);
      }
    }
  }

  for (let category = 0; category < expectedSets.length; category += 1) {
    const plannedIds = expectedSets[category];
    const emittedIds = actualSets[category];
    for (const id of plannedIds) {
      if (!emittedIds.has(id)) throw new AdapterInventoryValidationError('inventory_conflict', id);
    }
    for (const id of emittedIds) {
      if (!plannedIds.has(id)) throw new AdapterInventoryValidationError('inventory_conflict', id);
    }
  }

  for (const id of expectedPlan.supersededFieldIds) {
    const field = fields.find((candidate) => candidate.fieldId === id);
    if (!field?.supersededBy?.length) throw new AdapterInventoryValidationError('inventory_conflict', id);
  }
  for (const field of fields) {
    if (field.supersededBy?.length && !expectedPlan.supersededFieldIds.has(field.fieldId)) {
      throw new AdapterInventoryValidationError('inventory_conflict', field.fieldId);
    }
    if (field.supersededBy?.some((id) => !expected.has(id))) {
      throw new AdapterInventoryValidationError('inventory_conflict', field.fieldId);
    }
  }
}

function validateRoomAlignment(
  snapshotRooms: BuildingLoadInputSnapshotRooms,
  roomResults: readonly RoomLoadResult[],
): Map<string, RoomLoadResult> {
  const resultByRoom = new Map<string, RoomLoadResult>();
  for (const result of roomResults) {
    if (resultByRoom.has(result.roomId)) {
      throw new AdapterInventoryValidationError('duplicate_room_result', result.roomId);
    }
    resultByRoom.set(result.roomId, result);
  }
  for (const room of snapshotRooms) {
    if (!resultByRoom.has(room.id)) throw new AdapterInventoryValidationError('missing_room_result', room.id);
  }
  const snapshotIds = new Set(snapshotRooms.map((room) => room.id));
  for (const result of roomResults) {
    if (!snapshotIds.has(result.roomId)) throw new AdapterInventoryValidationError('unmatched_room_result', result.roomId);
  }
  return resultByRoom;
}

/**
 * Build the normalized B1 input from the live steady_state result and its
 * immutable input snapshot. No numerical load resolver is called here.
 */
export function buildEngineeringQualityFields(
  input: BuildingProjectQualityAdapterInput,
): BuildingProjectQualityAdapterResult {
  const { project, steadyStateCalculation: calculation } = input;
  assertAdapterInput(input);
  const expectedPlan = buildExpectedQualityFieldPlan(input);
  const snapshotRooms = calculation.inputSnapshot.rooms;
  const requestedServices = requestedQualityServices(calculation);
  const resultByRoom = validateRoomAlignment(snapshotRooms, calculation.roomResults);
  const emission: QualityFieldEmission = {
    fields: [],
    classification: createClassificationIndex(),
  };
  const warnings: string[] = [...calculation.warnings];
  const assumptions: string[] = [...calculation.assumptions];

  addProjectFields(emission, calculation, requestedServices, warnings);
  for (const snapshotRoom of snapshotRooms) {
    const roomResult = resultByRoom.get(snapshotRoom.id);
    if (!roomResult) throw new AdapterInventoryValidationError('missing_room_result', snapshotRoom.id);
    addRoomGeometryFields(emission, snapshotRoom, roomResult, requestedServices);
    addEnvelopeFields(emission, snapshotRoom, roomResult, requestedServices, warnings);
    addAirFields(emission, snapshotRoom, roomResult, requestedServices, warnings);
    addInternalFields(emission, project, snapshotRoom, roomResult, requestedServices, warnings);
  }

  const coverage = coverageFor(project, snapshotRooms, resultByRoom, requestedServices);
  const hasPersistedIntent = Boolean(project.calculationConfiguration?.coverageIntent);
  if (!hasPersistedIntent) {
    pushUnique(warnings, 'coverage_scope_unknown');
    pushUnique(warnings, 'coverage_unconfirmed');
  }
  assumptions.push('B2 adapts only the resolved steady_state snapshot/breakdowns; it does not recompute Q_tr, Q_air, Q_solar, or Q_internal.');
  if (hasPersistedIntent) {
    assumptions.push('Coverage scope/confirmation sourced from the persisted calculation coverage intent.');
  } else {
    assumptions.push('Coverage scope is UNKNOWN and confirmation is UNCONFIRMED because the live Building Project has no persisted coverage intent.');
  }

  const inventory: QualityFieldInventory = {
    expectedFieldIds: [...expectedPlan.expectedFieldIds],
    applicableFieldIds: [...expectedPlan.applicableFieldIds],
    irrelevantFieldIds: [...expectedPlan.irrelevantFieldIds],
    supersededFieldIds: [...expectedPlan.supersededFieldIds],
  };
  validateQualityFieldInventory(emission.fields, expectedPlan, emission.classification);

  return {
    fields: emission.fields,
    inventory,
    coverage,
    physicalCompleteness: input.physicalCompleteness,
    warnings,
    assumptions,
  };
}
