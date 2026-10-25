/**
 * Building Project Phase 3.2b — Air (ventilation + infiltration).
 *
 * Air component of the steady-state load:
 *   Q_air = 0.34 × V_air × ΔT
 *     heating ΔT = max(0, Tin,H − Tout,H)
 *     cooling ΔT = max(0, Tout,C − Tin,C)
 *
 * V_air is the effective outdoor-air flow resolved by the approved
 * ventilation-balance model (Phase 3.2B): NOT a universal sum()/max().
 *
 * Infiltration priority (provenance, never a hidden default):
 *   1 measured infiltrationFlowM3h
 *   2 blower-door derived (ACH50 / N, N=20 APPROVED_WITH_LIMITATION)
 *   3 explicit effective ACH
 *   4 approved airtightness profile (per building type)
 *   5 missing
 *
 * missing ≠ 0: an unresolved air input yields `missing_input`, never a fabricated 0.
 */
import { quickEffectiveHeightM, quickIndoorDesignC, quickRoomAreaM2, type QuickClimateLocation } from './buildingProjectQuickLoadV1.js';
import { COOLING_INDOOR_DEFAULT_C } from './buildingProjectTransmission.js';
import type {
  AirBreakdown,
  AirtightnessClass,
  BuildingProject,
  BuildingRoom,
  InfiltrationSource,
  RoomAir,
  VentilationBalance,
} from './buildingProjectTypes.js';

/** ρ·c_p / 3600 (ρ≈1.2 kg/m³, c_p≈1005 J/(kg·K)), W·h/(m³·K). */
export const AIR_CONSTANT = 0.34;

/** ACH50 → natural ACH divisor (Phase 3.2B baseline, APPROVED_WITH_LIMITATION). */
export const ACH50_DIVISOR = 20;

/** Natural effective infiltration ACH by airtightness class (1/h). */
export const AIRTIGHTNESS_ACH_BASE: Record<AirtightnessClass, number> = {
  poor: 0.8,
  average: 0.5,
  good: 0.3,
  high: 0.15,
};

/** Apartment infiltration reduction (shared conditioned envelope). APPROVED_WITH_LIMITATION. */
export const APARTMENT_INFILTRATION_FACTOR = 0.6;

export interface RoomAirResult {
  status: 'calculated' | 'missing_input';
  heatingW: number | null;
  coolingW: number | null;
  breakdown: AirBreakdown;
  missingInputs: string[];
  warnings: string[];
}

/** Effective room volume (areaM2 × canonical ceiling height). Reuses QUICK height resolution. */
function roomVolumeM3(project: BuildingProject, room: BuildingRoom): number | null {
  const area = quickRoomAreaM2(room);
  const height = quickEffectiveHeightM(project, room);
  if (area == null || height == null) return null;
  return area * height;
}

function resolveInfiltration(
  project: BuildingProject,
  air: RoomAir | null,
  volume: number | null,
): { flowM3h: number | null; source: InfiltrationSource | null; missingInputs: string[]; warnings: string[] } {
  const missingInputs: string[] = [];
  const warnings: string[] = [];
  if (air == null) {
    missingInputs.push('infiltration:missing');
    return { flowM3h: null, source: null, missingInputs, warnings };
  }

  // 1. measured airflow
  if (air.infiltrationFlowM3h != null) {
    if (!Number.isFinite(air.infiltrationFlowM3h) || air.infiltrationFlowM3h <= 0) {
      missingInputs.push('infiltration:invalid');
      return { flowM3h: null, source: null, missingInputs, warnings };
    }
    return { flowM3h: air.infiltrationFlowM3h, source: 'measured', missingInputs, warnings };
  }

  // 2. blower-door derived (ACH50 / N)
  if (air.ach50 != null) {
    if (!Number.isFinite(air.ach50) || air.ach50 <= 0) {
      missingInputs.push('ach50:invalid');
      return { flowM3h: null, source: null, missingInputs, warnings };
    }
    if (volume == null) {
      missingInputs.push('room_height:missing');
      return { flowM3h: null, source: null, missingInputs, warnings };
    }
    const naturalACH = air.ach50 / ACH50_DIVISOR;
    warnings.push(`ach50_converted:natural_ach_${naturalACH.toFixed(3)}_N${ACH50_DIVISOR}`);
    return { flowM3h: naturalACH * volume, source: 'blower_door_derived', missingInputs, warnings };
  }

  // 3. explicit effective ACH
  if (air.airChangesPerHour != null) {
    if (!Number.isFinite(air.airChangesPerHour) || air.airChangesPerHour < 0) {
      missingInputs.push('ach:invalid');
      return { flowM3h: null, source: null, missingInputs, warnings };
    }
    if (volume == null) {
      missingInputs.push('room_height:missing');
      return { flowM3h: null, source: null, missingInputs, warnings };
    }
    return { flowM3h: air.airChangesPerHour * volume, source: 'explicit_ach', missingInputs, warnings };
  }

  // 4. approved airtightness profile (per building type)
  if (air.airtightnessClass != null && air.airtightnessClass in AIRTIGHTNESS_ACH_BASE) {
    if (volume == null) {
      missingInputs.push('room_height:missing');
      return { flowM3h: null, source: null, missingInputs, warnings };
    }
    const baseACH = AIRTIGHTNESS_ACH_BASE[air.airtightnessClass];
    const factor = project.objectType === 'apartment' ? APARTMENT_INFILTRATION_FACTOR : 1.0;
    warnings.push(`profile_default:airtightness_${air.airtightnessClass}_${project.objectType}`);
    return { flowM3h: baseACH * factor * volume, source: 'airtightness_profile', missingInputs, warnings };
  }

  // 5. missing
  missingInputs.push('infiltration:missing');
  return { flowM3h: null, source: null, missingInputs, warnings };
}

function resolveVentilationFlow(air: RoomAir | null): { flowM3h: number | null; missingInputs: string[] } {
  if (air == null || air.ventilationFlowM3h == null) return { flowM3h: null, missingInputs: [] };
  if (!Number.isFinite(air.ventilationFlowM3h) || air.ventilationFlowM3h < 0) {
    return { flowM3h: null, missingInputs: ['ventilation:invalid'] };
  }
  return { flowM3h: air.ventilationFlowM3h, missingInputs: [] };
}

function resolveOutdoorAirFlow(
  balance: VentilationBalance,
  vVent: number | null,
  vInf: number | null,
): { vAir: number | null; missingInputs: string[] } {
  const missingInputs: string[] = [];
  switch (balance) {
    case 'none':
    case 'natural':
      if (vInf == null) {
        missingInputs.push('infiltration:missing');
        return { vAir: null, missingInputs };
      }
      return { vAir: vInf, missingInputs };
    case 'supply_only':
      if (vVent == null) {
        missingInputs.push('ventilation:missing');
        return { vAir: null, missingInputs };
      }
      return { vAir: vVent, missingInputs };
    case 'exhaust_only':
      if (vVent == null) missingInputs.push('ventilation:missing');
      if (vInf == null) missingInputs.push('infiltration:missing');
      if (vVent != null && vInf != null) return { vAir: Math.max(vVent, vInf), missingInputs };
      return { vAir: null, missingInputs };
    case 'balanced':
    case 'unknown':
    default:
      if (vVent == null) missingInputs.push('ventilation:missing');
      if (vInf == null) missingInputs.push('infiltration:missing');
      if (vVent != null && vInf != null) return { vAir: vVent + vInf, missingInputs };
      return { vAir: null, missingInputs };
  }
}

/** Compute a single room's air load (heating + cooling). Pure and deterministic. */
export function computeRoomAir(
  project: BuildingProject,
  room: BuildingRoom,
  location: QuickClimateLocation | null,
): RoomAirResult {
  const air: RoomAir | null = room.air ?? null;
  const balance: VentilationBalance = air?.ventilationBalance ?? 'unknown';

  const warnings: string[] = [];
  const missingInputs: string[] = [];

  const indoorHeatingC = quickIndoorDesignC(room.roomType).tempC;
  const indoorCoolingC = COOLING_INDOOR_DEFAULT_C;
  const outdoorHeatingC = location ? location.heatingOutdoorDesignC : null;
  const outdoorCoolingC = location ? location.coolingOutdoorDesignC : null;
  if (location == null) missingInputs.push('climate_location:missing_climate_location');

  const volume = roomVolumeM3(project, room);
  if (volume == null) missingInputs.push('room_height:missing');

  const inf = resolveInfiltration(project, air, volume);
  const vent = resolveVentilationFlow(air);
  warnings.push(...inf.warnings);
  for (const m of [...inf.missingInputs, ...vent.missingInputs]) {
    if (!missingInputs.includes(m)) missingInputs.push(m);
  }

  const resolved = resolveOutdoorAirFlow(balance, vent.flowM3h, inf.flowM3h);
  for (const m of resolved.missingInputs) {
    if (!missingInputs.includes(m)) missingInputs.push(m);
  }

  const deltaHeat = outdoorHeatingC == null ? null : Math.max(0, indoorHeatingC - outdoorHeatingC);
  const deltaCool = outdoorCoolingC == null ? null : Math.max(0, outdoorCoolingC - indoorCoolingC);

  const vAir = resolved.vAir;
  const heatingW = vAir != null && deltaHeat != null ? AIR_CONSTANT * vAir * deltaHeat : null;
  const coolingW = vAir != null && deltaCool != null ? AIR_CONSTANT * vAir * deltaCool : null;

  const status: RoomAirResult['status'] =
    vAir != null && deltaHeat != null && deltaCool != null && missingInputs.length === 0 ? 'calculated' : 'missing_input';

  const breakdown: AirBreakdown = {
    ventilationBalance: balance,
    roomVolumeM3: volume,
    ventilationFlowM3h: vent.flowM3h,
    infiltrationFlowM3h: inf.flowM3h,
    effectiveOutdoorAirFlowM3h: vAir,
    infiltrationSource: inf.source,
    airConstant: AIR_CONSTANT,
    heatingDeltaTK: deltaHeat,
    coolingDeltaTK: deltaCool,
    heatingW,
    coolingW,
    warnings: [...warnings],
  };

  return { status, heatingW, coolingW, breakdown, missingInputs, warnings };
}
