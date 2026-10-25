/**
 * Building Project Phase 3.2c — Cooling Internal Gains.
 *
 *   Q_internal = Q_people + Q_lighting + Q_equipment   (sensible only)
 *
 * Contributes to COOLING ONLY — never added to, or subtracted from, heating.
 *
 * Resolution priorities (honesty: missing ≠ 0; defaults are explicit profile_default):
 *   people:    explicit `peopleW` -> explicit occupancy × 75 W/person -> residential roomType reference default -> missing
 *   lighting:  explicit `lightingGainW` -> profile W/m² × area -> missing(area)
 *   equipment: explicit `equipmentGainW` -> profile W/m² × area -> missing(area)
 *
 * Profiles (APPROVED_WITH_LIMITATION, Phase 3.2C baseline):
 *   residential (apartment/private_house): lighting 5, equipment 5 W/m²
 *   commercial/office:                     lighting 8, equipment 15 W/m²
 */

import { quickRoomAreaM2 } from './buildingProjectQuickLoadV1.js';
import type {
  BuildingProject,
  BuildingRoom,
  InternalGainSource,
  InternalGainsBreakdown,
  OccupancyInputSource,
  RoomInternalGains,
} from './buildingProjectTypes.js';

/** Sensible heat gain per person — residential/office central value. SENSIBLE only (NOT 110 W total). */
export const OCCUPANT_SENSIBLE_W_PER_PERSON = 75;

/** Internal-gain W/m² profiles by object type (APPROVED_WITH_LIMITATION). */
export const INTERNAL_GAIN_PROFILES = {
  residential: { lightingWm2: 5, equipmentWm2: 5 },
  commercial: { lightingWm2: 8, equipmentWm2: 15 },
} as const;

export type InternalGainProfileKind = keyof typeof INTERNAL_GAIN_PROFILES;

/**
 * Phase 3.2I — roomType → typical occupancy profile default (APPROVED_WITH_LIMITATION).
 * Used ONLY when the user did not enter a count (occupancy is null); an explicit
 * user value always wins and is never re-derived on roomType change.
 */
export const OCCUPANCY_BY_ROOM_TYPE: Readonly<Record<string, number>> = {
  living_room: 2,
  bedroom: 2,
  child_room: 1,
  office: 1,
  kitchen: 1,
  bathroom: 1,
  shower: 1,
  guest_room: 1,
  corridor: 0,
  hall: 0,
  dressing_room: 0,
  storage: 0,
  technical: 0,
  boiler_room: 0,
  garage: 0,
};

/** Phase 3.2I.2 — room types whose count is a suggestion only (never auto-applied). */
const OCCUPANCY_SUGGESTION_ONLY: ReadonlySet<string> = new Set(['bathroom', 'shower']);

export interface RoomInternalResult {
  status: 'calculated' | 'missing_input';
  occupancy: number | null;
  /** Source of the occupancy COUNT; W/person profile is `peopleSource`. */
  occupancySource: OccupancyInputSource | null;
  occupantSensibleWPerPerson: number | null;
  peopleW: number | null;
  peopleSource: InternalGainSource | null;
  lightingW: number | null;
  lightingSource: InternalGainSource | null;
  equipmentW: number | null;
  equipmentSource: InternalGainSource | null;
  totalCoolingW: number | null;
  missingInputs: string[];
  warnings: string[];
}

function profileFor(objectType: BuildingProject['objectType']): InternalGainProfileKind {
  return objectType === 'commercial' ? 'commercial' : 'residential';
}

function validNonNegative(n: number): boolean {
  return Number.isFinite(n) && n >= 0;
}

/**
 * Compute a single room's internal cooling gain. Pure and deterministic.
 * `missing_input` (totalCoolingW null) when any required sub-component is
 * unresolved; individual sub-values stay populated for a partial view.
 */
export function computeRoomInternal(project: BuildingProject, room: BuildingRoom): RoomInternalResult {
  const warnings: string[] = [];
  const missingInputs: string[] = [];
  const input: RoomInternalGains | null = room.internalGains ?? null;

  const profile = profileFor(project.objectType);
  const lightingWm2 = INTERNAL_GAIN_PROFILES[profile].lightingWm2;
  const equipmentWm2 = INTERNAL_GAIN_PROFILES[profile].equipmentWm2;

  // --- People (sensible) ---
  let occupancy: number | null = null;
  let occupancySource: OccupancyInputSource | null = null;
  let occupantSensibleWPerPerson: number | null = null;
  let peopleW: number | null = null;
  let peopleSource: InternalGainSource | null = null;

  if (input?.peopleW != null) {
    if (!validNonNegative(input.peopleW)) {
      missingInputs.push('people_gain:invalid');
    } else {
      peopleW = input.peopleW;
      peopleSource = 'explicit';
      occupancy = input.occupancy ?? null;
      occupancySource = input.occupancySource ?? null;
    }
  } else if (input?.occupancy != null) {
    if (!Number.isInteger(input.occupancy) || input.occupancy < 0) {
      missingInputs.push('occupancy:invalid');
    } else {
      const senseW = input.occupantSensibleWPerPerson ?? OCCUPANT_SENSIBLE_W_PER_PERSON;
      if (!Number.isFinite(senseW) || senseW <= 0) {
        missingInputs.push('occupant_sensible_w:invalid');
      } else {
        occupancy = input.occupancy;
        // A stored occupancy count is an explicit user value unless the client
        // recorded an approved profile default (none approved yet — SOURCE_TBD).
        occupancySource = input.occupancySource ?? 'user_explicit';
        occupantSensibleWPerPerson = senseW;
        peopleW = input.occupancy * senseW;
        peopleSource = 'profile';
        if (senseW === OCCUPANT_SENSIBLE_W_PER_PERSON) {
          warnings.push(`occupant_profile:${OCCUPANT_SENSIBLE_W_PER_PERSON}W_person`);
        }
      }
    }
  } else {
    // No explicit people/occupancy input → residential roomType reference default (Phase 3.2I.2).
    // RESIDENTIAL ONLY; bathroom/shower are suggestion-only (never auto-applied); commercial fixed
    // occupancy is not supported. Only fills a missing count; never replaces an explicit value.
    const isResidential = project.objectType === 'private_house' || project.objectType === 'apartment';
    const dflt = OCCUPANCY_BY_ROOM_TYPE[room.roomType];
    if (isResidential && dflt != null && !OCCUPANCY_SUGGESTION_ONLY.has(room.roomType)) {
      occupancy = dflt;
      occupancySource = 'profile_default';
      occupantSensibleWPerPerson = OCCUPANT_SENSIBLE_W_PER_PERSON;
      peopleW = dflt * OCCUPANT_SENSIBLE_W_PER_PERSON;
      peopleSource = 'profile';
      warnings.push(`occupant_default:${room.roomType}:${dflt}people`);
    } else {
      missingInputs.push('occupancy:missing');
    }
  }

  // --- Lighting ---
  let lightingW: number | null = null;
  let lightingSource: InternalGainSource | null = null;
  if (input?.lightingGainW != null) {
    if (!validNonNegative(input.lightingGainW)) {
      missingInputs.push('lighting_gain:invalid');
    } else {
      lightingW = input.lightingGainW;
      lightingSource = 'explicit';
    }
  } else {
    const area = quickRoomAreaM2(room);
    if (area == null) {
      missingInputs.push('lighting:missing_area');
    } else {
      lightingW = lightingWm2 * area;
      lightingSource = 'profile';
      warnings.push(`lighting_profile:${profile}:${lightingWm2}Wm2`);
    }
  }

  // --- Equipment ---
  let equipmentW: number | null = null;
  let equipmentSource: InternalGainSource | null = null;
  if (input?.equipmentGainW != null) {
    if (!validNonNegative(input.equipmentGainW)) {
      missingInputs.push('equipment_gain:invalid');
    } else {
      equipmentW = input.equipmentGainW;
      equipmentSource = 'explicit';
    }
  } else {
    const area = quickRoomAreaM2(room);
    if (area == null) {
      missingInputs.push('equipment:missing_area');
    } else {
      equipmentW = equipmentWm2 * area;
      equipmentSource = 'profile';
      warnings.push(`equipment_profile:${profile}:${equipmentWm2}Wm2`);
    }
  }

  const allResolved = peopleW != null && lightingW != null && equipmentW != null;
  const totalCoolingW = allResolved ? peopleW! + lightingW! + equipmentW! : null;

  return {
    status: allResolved ? 'calculated' : 'missing_input',
    occupancy,
    occupancySource,
    occupantSensibleWPerPerson,
    peopleW,
    peopleSource,
    lightingW,
    lightingSource,
    equipmentW,
    equipmentSource,
    totalCoolingW,
    missingInputs,
    warnings,
  };
}

/** Assemble the persisted internal-gain breakdown. */
export function roomInternalBreakdown(result: RoomInternalResult): InternalGainsBreakdown {
  return {
    occupancy: result.occupancy,
    occupancySource: result.occupancySource ?? null,
    occupantSensibleWPerPerson: result.occupantSensibleWPerPerson,
    peopleW: result.peopleW,
    peopleSource: result.peopleSource,
    lightingW: result.lightingW,
    lightingSource: result.lightingSource,
    equipmentW: result.equipmentW,
    equipmentSource: result.equipmentSource,
    totalCoolingW: result.totalCoolingW,
    warnings: [...result.warnings],
  };
}