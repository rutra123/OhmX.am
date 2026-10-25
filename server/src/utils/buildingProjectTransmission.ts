/**
 * Building Project Phase 3.2a — Transmission Core (ohmx.steady-state.v1).
 *
 * Steady-state heat transfer through the envelope, per room:
 *   Q_tr,H = Σ (U_e × A_e) × max(0, Tin,H − Tout,H)   [heating]
 *   Q_tr,C = Σ (U_e × A_e) × max(0, Tout,C − Tin,C)   [cooling]
 *
 * Elements: external walls, windows, external doors, exposed roof/ceiling,
 * exposed floor. Internal partitions are NOT treated as external envelope.
 *
 * NOT in this module (later phases): ventilation/infiltration, solar gains,
 * internal gains, latent load, thermal bridges, heat recovery, equipment
 * reserve/sizing.
 *
 * Honesty rule: missing ≠ 0 W. An unresolved area / U-value / climate
 * temperature yields `missing_input`, never a fabricated number.
 *
 * U-value profiles are APPROVED_WITH_LIMITATION (Phase 3.2B) — typical/profile
 * values with provenance, NOT measured construction values. Explicit/certificate
 * U always wins over a construction profile.
 */
import { quickIndoorDesignC, type QuickClimateLocation } from './buildingProjectQuickLoadV1.js';
import type {
  BuildingProject,
  BuildingRoom,
  ConstructionTier,
  EnvelopeElement,
  EnvelopeElementKind,
  RoomEnvelope,
  TransmissionBreakdown,
  TransmissionElementContribution,
  UValueSource,
} from './buildingProjectTypes.js';

export const STEADY_STATE_METHOD_ID = 'ohmx.steady-state.v1';
export const STEADY_STATE_METHOD_VERSION = '1.0.0';

/** Cooling indoor design temperature baseline (MASTER §19.2; editable in a later phase). */
export const COOLING_INDOOR_DEFAULT_C = 24;

/** U-value profiles by construction tier, W/(m²·K) — Phase 3.2B baseline (APPROVED_WITH_LIMITATION). */
export const CONSTRUCTION_U_VALUES: Record<EnvelopeElementKind, Record<ConstructionTier, number>> = {
  wall: { poor: 1.5, average: 0.6, good: 0.35, high_performance: 0.2 },
  window: { poor: 5.0, average: 2.8, good: 1.5, high_performance: 0.9 },
  door: { poor: 3.5, average: 2.2, good: 1.4, high_performance: 1.0 },
  roof: { poor: 1.0, average: 0.38, good: 0.22, high_performance: 0.15 },
  floor: { poor: 1.2, average: 0.5, good: 0.3, high_performance: 0.2 },
};

/**
 * Legacy `insulationLevel` → construction tier seed. `unknown` maps to `null`
 * (never silently promoted to a trusted profile) — MASTER/Phase 3.2A §6.
 */
const LEGACY_INSULATION_TIER: Record<string, ConstructionTier | null> = {
  poor: 'poor',
  medium: 'average',
  good: 'good',
  unknown: null,
};

const ENVELOPE_KINDS: readonly EnvelopeElementKind[] = ['wall', 'window', 'door', 'roof', 'floor'];

export interface ResolvedElement {
  elementId: string;
  kind: EnvelopeElementKind;
  areaM2: number | null;
  uValue: number | null;
  uValueSource: UValueSource | null;
  missing: string[];
}

function elementsOf(envelope: RoomEnvelope | null | undefined, kind: EnvelopeElementKind): EnvelopeElement[] {
  if (!envelope) return [];
  switch (kind) {
    case 'wall': return envelope.wallElements || [];
    case 'window': return envelope.windowElements || [];
    case 'door': return envelope.doorElements || [];
    case 'roof': return envelope.roofElements || [];
    case 'floor': return envelope.floorElements || [];
    default: return [];
  }
}

/** Resolve an element's area (m²). Walls subtract their hosted openings; never negative. */
function resolveElementArea(
  element: EnvelopeElement,
  kind: EnvelopeElementKind,
  openingAreaById: ReadonlyMap<string, number>,
): { areaM2: number | null; missing: string[] } {
  const missing: string[] = [];
  const bad = () => missing.push(`area:invalid:${element.elementId}`);

  // 1. Explicit areaM2 — authoritative (already net for walls; no further subtraction).
  if (element.areaM2 != null) {
    if (!Number.isFinite(element.areaM2) || element.areaM2 < 0) {
      bad();
      return { areaM2: null, missing };
    }
    return { areaM2: element.areaM2, missing };
  }

  // 2. width × height (wall: treated as gross face → subtract openings).
  if (element.widthM != null && element.heightM != null) {
    if (!Number.isFinite(element.widthM) || !Number.isFinite(element.heightM) || element.widthM < 0 || element.heightM < 0) {
      bad();
      return { areaM2: null, missing };
    }
    const gross = element.widthM * element.heightM;
    if (kind === 'wall') return subtractOpenings(element, gross, openingAreaById, missing);
    return { areaM2: gross, missing };
  }

  // 3. grossAreaM2 (wall: subtract openings).
  if (element.grossAreaM2 != null) {
    if (!Number.isFinite(element.grossAreaM2) || element.grossAreaM2 < 0) {
      bad();
      return { areaM2: null, missing };
    }
    if (kind === 'wall') return subtractOpenings(element, element.grossAreaM2, openingAreaById, missing);
    return { areaM2: element.grossAreaM2, missing };
  }

  missing.push(`area:missing:${element.elementId}`);
  return { areaM2: null, missing };
}

function subtractOpenings(
  element: EnvelopeElement,
  gross: number,
  openingAreaById: ReadonlyMap<string, number>,
  missing: string[],
): { areaM2: number | null; missing: string[] } {
  const ids = element.openingIds || [];
  let openings = 0;
  for (const id of ids) {
    const a = openingAreaById.get(id);
    if (a == null) {
      // Opening referenced but its area is unresolved — cannot compute net reliably.
      missing.push(`opening_area_missing:${id}`);
      continue;
    }
    openings += a;
  }
  if (missing.some((m) => m.startsWith('opening_area_missing'))) {
    return { areaM2: null, missing };
  }
  if (openings > gross) {
    missing.push(`openings_exceed_wall_area:${element.elementId}`);
    return { areaM2: null, missing };
  }
  return { areaM2: gross - openings, missing };
}

/** Resolve an element's U-value (W/(m²·K)) with provenance. */
function resolveElementUValue(
  element: EnvelopeElement,
  kind: EnvelopeElementKind,
  insulationLevel: string | null | undefined,
): { uValue: number | null; uValueSource: UValueSource | null; missing: string[] } {
  // 1. Explicit / certificate U-value.
  if (element.uValue != null) {
    if (!Number.isFinite(element.uValue) || element.uValue <= 0) {
      return { uValue: null, uValueSource: null, missing: [`u_value:invalid:${element.elementId}`] };
    }
    return { uValue: element.uValue, uValueSource: 'certificate', missing: [] };
  }
  // 2. Selected construction profile (tier).
  if (element.constructionTier != null) {
    const profile = CONSTRUCTION_U_VALUES[kind]?.[element.constructionTier];
    if (profile != null) {
      return { uValue: profile, uValueSource: 'construction_profile', missing: [] };
    }
  }
  // 3. Legacy insulationLevel seed (explicit provenance; unknown → null → missing).
  const tier = insulationLevel ? LEGACY_INSULATION_TIER[insulationLevel] ?? null : null;
  if (tier != null) {
    const profile = CONSTRUCTION_U_VALUES[kind]?.[tier];
    if (profile != null) {
      return { uValue: profile, uValueSource: 'legacy_insulation_seed', missing: [] };
    }
  }
  return { uValue: null, uValueSource: 'unknown', missing: [`u_value:missing:${element.elementId}`] };
}

export interface RoomTransmissionResult {
  status: 'calculated' | 'missing_input';
  heatingW: number | null;
  coolingW: number | null;
  breakdown: TransmissionElementContribution[];
  indoorHeatingC: number | null;
  indoorCoolingC: number | null;
  outdoorHeatingC: number | null;
  outdoorCoolingC: number | null;
  missingInputs: string[];
  warnings: string[];
}

/**
 * Compute a single room's transmission load (heating + cooling). Pure and
 * deterministic. Returns `missing_input` (demandW null) when any required
 * element area/U-value or a climate temperature is unresolved.
 */
export function computeRoomTransmission(
  project: BuildingProject,
  room: BuildingRoom,
  location: QuickClimateLocation | null,
): RoomTransmissionResult {
  const warnings: string[] = [];
  const missingInputs: string[] = [];

  const indoorHeatingC = quickIndoorDesignC(room.roomType).tempC;
  const indoorCoolingC = COOLING_INDOOR_DEFAULT_C;
  const outdoorHeatingC = location ? location.heatingOutdoorDesignC : null;
  const outdoorCoolingC = location ? location.coolingOutdoorDesignC : null;

  if (location == null) missingInputs.push('climate_location:missing_climate_location');

  const envelope = room.envelope ?? null;
  const hasEnvelope = envelope && ENVELOPE_KINDS.some((k) => elementsOf(envelope, k).length > 0);
  if (!hasEnvelope) missingInputs.push('envelope:missing');

  const insulationLevel = project.insulationLevel ?? 'unknown';

  // Pass 1: resolve non-wall elements (windows/doors/roof/floors) area + U.
  const resolved = new Map<string, ResolvedElement>();
  const openingAreaById = new Map<string, number>();
  const seenIds = new Set<string>();
  const nonWall: EnvelopeElementKind[] = ['window', 'door', 'roof', 'floor'];
  for (const kind of nonWall) {
    for (const element of elementsOf(envelope, kind)) {
      if (seenIds.has(element.elementId)) {
        warnings.push(`duplicate_element_id:${element.elementId}`);
        continue;
      }
      seenIds.add(element.elementId);
      const a = resolveElementArea(element, kind, openingAreaById);
      const u = resolveElementUValue(element, kind, insulationLevel);
      resolved.set(element.elementId, {
        elementId: element.elementId,
        kind,
        areaM2: a.areaM2,
        uValue: u.uValue,
        uValueSource: u.uValueSource,
        missing: [...a.missing, ...u.missing],
      });
      if (a.areaM2 != null) openingAreaById.set(element.elementId, a.areaM2);
    }
  }

  // Pass 2: resolve walls (subtract their hosted openings).
  for (const element of elementsOf(envelope, 'wall')) {
    if (seenIds.has(element.elementId)) {
      warnings.push(`duplicate_element_id:${element.elementId}`);
      continue;
    }
    seenIds.add(element.elementId);
    const a = resolveElementArea(element, 'wall', openingAreaById);
    const u = resolveElementUValue(element, 'wall', insulationLevel);
    resolved.set(element.elementId, {
      elementId: element.elementId,
      kind: 'wall',
      areaM2: a.areaM2,
      uValue: u.uValue,
      uValueSource: u.uValueSource,
      missing: [...a.missing, ...u.missing],
    });
  }

  const deltaHeat = outdoorHeatingC == null ? null : Math.max(0, indoorHeatingC - outdoorHeatingC);
  const deltaCool = outdoorCoolingC == null ? null : Math.max(0, outdoorCoolingC - indoorCoolingC);

  const breakdown: TransmissionElementContribution[] = [];
  let heatingW = 0;
  let coolingW = 0;
  let anyMissing = missingInputs.length > 0;

  for (const r of resolved.values()) {
    if (r.areaM2 == null || r.uValue == null) {
      anyMissing = true;
      for (const m of r.missing) if (!missingInputs.includes(m)) missingInputs.push(m);
      continue;
    }
    const h = deltaHeat == null ? 0 : r.uValue * r.areaM2 * deltaHeat;
    const c = deltaCool == null ? 0 : r.uValue * r.areaM2 * deltaCool;
    heatingW += h;
    coolingW += c;
    breakdown.push({
      elementId: r.elementId,
      kind: r.kind,
      areaM2: r.areaM2,
      uValue: r.uValue,
      uValueSource: r.uValueSource ?? 'unknown',
      heatingW: h,
      coolingW: c,
    });
  }

  if (deltaHeat == null) anyMissing = true;
  if (deltaCool == null) anyMissing = true;

  const status: RoomTransmissionResult['status'] = anyMissing ? 'missing_input' : 'calculated';

  return {
    status,
    heatingW: status === 'calculated' ? heatingW : null,
    coolingW: status === 'calculated' ? coolingW : null,
    breakdown,
    indoorHeatingC,
    indoorCoolingC,
    outdoorHeatingC,
    outdoorCoolingC,
    missingInputs,
    warnings,
  };
}

/** Assemble the persisted per-room breakdown (totals + provenance). */
export function roomTransmissionBreakdown(result: RoomTransmissionResult): TransmissionBreakdown {
  return {
    elements: result.breakdown,
    heatingW: result.heatingW,
    coolingW: result.coolingW,
    indoorHeatingC: result.indoorHeatingC,
    indoorCoolingC: result.indoorCoolingC,
    outdoorHeatingC: result.outdoorHeatingC,
    outdoorCoolingC: result.outdoorCoolingC,
  };
}
