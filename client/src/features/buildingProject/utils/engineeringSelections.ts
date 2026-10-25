/**
 * Phase 3.2K — pure, framework-free engineering SELECTION helpers.
 *
 * These hold the exact state→payload transitions the RoomEngineeringPanel
 * chips produce. Keeping them framework-free means the chip behaviour is
 * unit-testable without a React renderer: select a tier / ventilation /
 * airtightness / occupancy and assert the resulting BuildingRoomInput patch
 * is exactly what `updateRoom` should receive.
 *
 * No engineering numbers are computed here. `Reuse → Derive → Profile →
 * Question → Advanced → Missing` precedence stays on the backend; this module
 * only records the USER CHOICE (enum) plus provenance, exactly like the
 * pre-existing inline helpers it replaces.
 */
import type {
  AirtightnessClass,
  ConstructionTier,
  EnvelopeElement,
  RoomAir,
  RoomEnvelope,
  RoomEnvelopePatch,
  RoomInternalGains,
  ShadingProfile,
  VentilationBalance,
  WindowOrientation,
} from '../types';

export const EMPTY_ENVELOPE: RoomEnvelope = { wallElements: [], windowElements: [], doorElements: [], roofElements: [], floorElements: [] };
export const EMPTY_AIR: RoomAir = { ventilationBalance: null, ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: null };
export const EMPTY_GAINS: RoomInternalGains = { occupancy: null, occupancySource: null, occupantSensibleWPerPerson: null, peopleW: null, lightingGainW: null, equipmentGainW: null };

let _seq = 0;
export function newElementId(prefix: string): string {
  _seq += 1;
  const rnd = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 8);
  return `${prefix}-${rnd}-${_seq}`;
}

export function baseElement(kind: string): EnvelopeElement {
  return {
    elementId: newElementId(kind),
    areaM2: null, widthM: null, heightM: null, grossAreaM2: null, openingIds: null,
    count: null, uValue: null, constructionTier: null, uValueSource: null, orientation: null,
    shgc: null, shadingFactor: null, shadingProfile: null, source: null,
  };
}

export type RoomAirPatch = Partial<RoomAir>;
export type RoomInternalGainsPatch = Partial<RoomInternalGains>;

const ENVELOPE_ELEMENT_FIELDS: Array<keyof EnvelopeElement> = [
  'areaM2', 'widthM', 'heightM', 'grossAreaM2', 'openingIds', 'count', 'uValue',
  'constructionTier', 'uValueSource', 'orientation', 'shgc', 'shadingFactor',
  'shadingProfile', 'source',
];

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sparseElementPatch(before: EnvelopeElement, after: EnvelopeElement): Partial<EnvelopeElement> & Pick<EnvelopeElement, 'elementId'> | null {
  const patch: Partial<EnvelopeElement> & Pick<EnvelopeElement, 'elementId'> = { elementId: after.elementId };
  let changed = false;
  for (const field of ENVELOPE_ELEMENT_FIELDS) {
    if (!sameValue(before[field], after[field])) {
      patch[field] = after[field] as never;
      changed = true;
    }
  }
  return changed ? patch : null;
}

/** Build an envelope PATCH that carries only changed elements/fields. */
export function sparseEnvelopePatch(before: RoomEnvelope, after: RoomEnvelope): RoomEnvelopePatch {
  const patch: RoomEnvelopePatch = {};
  const keys: Array<keyof RoomEnvelope> = ['wallElements', 'windowElements', 'doorElements', 'roofElements', 'floorElements'];
  for (const key of keys) {
    const beforeItems = before[key];
    const afterItems = after[key];
    const idsMatch = beforeItems.length === afterItems.length
      && beforeItems.every((item, index) => item.elementId === afterItems[index]?.elementId);
    if (beforeItems.length !== afterItems.length || !idsMatch) {
      if (!sameValue(beforeItems, afterItems)) patch[key] = afterItems;
      continue;
    }
    const changed = afterItems
      .map((item, index) => sparseElementPatch(beforeItems[index], item))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    if (changed.length) patch[key] = changed;
  }
  return patch;
}

/** Build a scalar air PATCH with explicit nulls preserved as clears. */
export function sparseAirPatch(before: RoomAir, after: RoomAir): RoomAirPatch {
  const patch: RoomAirPatch = {};
  const fields: Array<keyof RoomAir> = [
    'ventilationBalance', 'ventilationFlowM3h', 'infiltrationFlowM3h',
    'airChangesPerHour', 'ach50', 'airtightnessClass',
  ];
  for (const field of fields) {
    if (!sameValue(before[field], after[field])) patch[field] = after[field] as never;
  }
  return patch;
}

/**
 * Client-only optimistic merge for the scalar Air PATCH.
 *
 * This mirrors the server's `mergeScalarObject(room.air, patch.air)` semantics:
 * omitted sibling fields survive, while an explicit null field remains a clear.
 * It computes no engineering values and never substitutes ACH/flow defaults.
 */
export function mergeOptimisticAirPatch(
  before: RoomAir | null | undefined,
  patch: RoomAirPatch | null,
): RoomAir | null {
  if (patch === null) return null;
  return { ...EMPTY_AIR, ...(before ?? {}), ...patch };
}

/** Build a scalar internal-gains PATCH with explicit nulls preserved as clears. */
export function sparseGainsPatch(before: RoomInternalGains, after: RoomInternalGains): RoomInternalGainsPatch {
  const patch: RoomInternalGainsPatch = {};
  const fields: Array<keyof RoomInternalGains> = [
    'occupancy', 'occupancySource', 'occupantSensibleWPerPerson',
    'peopleW', 'lightingGainW', 'equipmentGainW',
  ];
  for (const field of fields) {
    if (!sameValue(before[field], after[field])) patch[field] = after[field] as never;
  }
  return patch;
}

/** Selecting a tier stores the enum and clears any explicit (certificate) U-value. */
export function withTier(el: EnvelopeElement, tier: ConstructionTier | null): EnvelopeElement {
  return {
    ...el,
    constructionTier: tier,
    uValue: tier != null ? null : el.uValue,
    uValueSource: tier != null ? 'construction_profile' : (el.uValue != null ? 'certificate' : null),
  };
}

/** Explicit (certificate) U-value clears the tier (advanced override precedence). */
export function withUValue(el: EnvelopeElement, u: number | null): EnvelopeElement {
  return {
    ...el,
    uValue: u,
    constructionTier: u != null ? null : el.constructionTier,
    uValueSource: u != null ? 'certificate' : (el.constructionTier != null ? 'construction_profile' : null),
  };
}

/** Chip → wall tier. Returns the full envelope so callers pass `{ envelope }` verbatim. */
export function selectWallTier(envelope: RoomEnvelope, tier: ConstructionTier | null): RoomEnvelope {
  const wall = envelope.wallElements[0] ?? baseElement('wall');
  return { ...envelope, wallElements: [withTier(wall, tier)] };
}

/** Advanced override → wall U-value. Returns the full envelope. */
export function selectWallUValue(envelope: RoomEnvelope, u: number | null): RoomEnvelope {
  const wall = envelope.wallElements[0] ?? baseElement('wall');
  return { ...envelope, wallElements: [withUValue(wall, u)] };
}

/** Chip → roof tier ('null' removes the roof element). */
export function selectRoofTier(envelope: RoomEnvelope, tier: ConstructionTier | null, fallbackAreaM2: number | null): RoomEnvelope {
  if (!tier) return { ...envelope, roofElements: [] };
  const roof = envelope.roofElements[0] ?? baseElement('roof');
  return { ...envelope, roofElements: [{ ...withTier(roof, tier), areaM2: roof.areaM2 ?? fallbackAreaM2 ?? null }] };
}

/** Chip → floor tier ('null' removes the floor element). */
export function selectFloorTier(envelope: RoomEnvelope, tier: ConstructionTier | null, fallbackAreaM2: number | null): RoomEnvelope {
  if (!tier) return { ...envelope, floorElements: [] };
  const floor = envelope.floorElements[0] ?? baseElement('floor');
  return { ...envelope, floorElements: [{ ...withTier(floor, tier), areaM2: floor.areaM2 ?? fallbackAreaM2 ?? null }] };
}

/** Chip → exterior door present/absent. */
export function selectDoor(envelope: RoomEnvelope, on: boolean): RoomEnvelope {
  if (!on) return { ...envelope, doorElements: [] };
  const door = envelope.doorElements[0] ?? baseElement('door');
  return { ...envelope, doorElements: [{ ...door, areaM2: door.areaM2 ?? 1.9 }] };
}

/** Chip → window tier. */
export function selectWindowTier(envelope: RoomEnvelope, elementId: string, tier: ConstructionTier | null): RoomEnvelope {
  return {
    ...envelope,
    windowElements: envelope.windowElements.map((w) => (w.elementId === elementId ? withTier(w, tier) : w)),
  };
}

/** Chip → window orientation. */
export function selectWindowOrientation(envelope: RoomEnvelope, elementId: string, o: WindowOrientation | null): RoomEnvelope {
  return {
    ...envelope,
    windowElements: envelope.windowElements.map((w) => (w.elementId === elementId ? { ...w, orientation: o } : w)),
  };
}

/** Chip → window shading profile (clears explicit shading factor). */
export function selectWindowShading(envelope: RoomEnvelope, elementId: string, s: ShadingProfile | null): RoomEnvelope {
  return {
    ...envelope,
    windowElements: envelope.windowElements.map((w) => (w.elementId === elementId ? { ...w, shadingProfile: s, shadingFactor: null } : w)),
  };
}

/** Chip → ventilation balance. */
export function selectVentilationBalance(air: RoomAir, balance: VentilationBalance | null): RoomAir {
  return { ...air, ventilationBalance: balance };
}

/** Chip → airtightness class. */
export function selectAirtightnessClass(air: RoomAir, cls: AirtightnessClass | null): RoomAir {
  return { ...air, airtightnessClass: cls };
}

/** Numeric input → occupancy count (explicit user value). */
export function selectOccupancyCount(gains: RoomInternalGains, occ: number | null): RoomInternalGains {
  return { ...gains, occupancy: occ, occupancySource: occ != null ? 'user_explicit' : null };
}

/** Numeric input (advanced) → a scalar air/gain numeric field. */
export function selectAirNumber(air: RoomAir, field: 'ach50' | 'airChangesPerHour' | 'ventilationFlowM3h' | 'infiltrationFlowM3h', v: number | null): RoomAir {
  return { ...air, [field]: v };
}
export function selectGainNumber(gains: RoomInternalGains, field: 'peopleW' | 'lightingGainW' | 'equipmentGainW' | 'occupantSensibleWPerPerson', v: number | null): RoomInternalGains {
  return { ...gains, [field]: v };
}