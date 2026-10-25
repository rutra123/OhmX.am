/**
 * Phase 3.2H — Building Project profile registry/audit.
 *
 * This module is documentation-as-code for the numeric profiles already used by
 * `ohmx.steady-state.v1`. It does NOT introduce calculation formulas and it is
 * not a second engine. Runtime formulas remain in their existing modules.
 *
 * Status semantics:
 * - APPROVED_EXISTING: source-backed and already used as an active value.
 * - APPROVED_WITH_LIMITATION: accepted Phase 3.2 engineering baseline/profile;
 *   typical value, never measured/certificate.
 * - SOURCE_TBD: user-facing suggestion may exist, but no hidden calculation
 *   input is allowed until a source/sign-off exists.
 * - MUST_REMAIN_MISSING: no safe default; leave the calculation limited/missing
 *   unless the user/expert provides explicit data.
 */
import { AIRTIGHTNESS_ACH_BASE, ACH50_DIVISOR, APARTMENT_INFILTRATION_FACTOR } from './buildingProjectAir.js';
import { INTERNAL_GAIN_PROFILES, OCCUPANCY_BY_ROOM_TYPE, OCCUPANT_SENSIBLE_W_PER_PERSON } from './buildingProjectInternal.js';
import { quickIndoorDesignC, QUICK_DEFAULT_INDOOR_C } from './buildingProjectQuickLoadV1.js';
import { SHADING_PROFILES, SHGC_GLASS_PROFILES, WINDOW_GLAZING_AREA_FACTOR } from './buildingProjectSolar.js';
import { CONSTRUCTION_U_VALUES, COOLING_INDOOR_DEFAULT_C } from './buildingProjectTransmission.js';

export type ProfileRegistryStatus =
  | 'APPROVED_EXISTING'
  | 'APPROVED_WITH_LIMITATION'
  | 'REFERENCE_PROFILE'
  | 'SOURCE_TBD'
  | 'MUST_REMAIN_MISSING';

export type ProfileDefaultSourceMode =
  | 'certificate'
  | 'measured'
  | 'user_explicit'
  | 'inherited'
  | 'derived'
  | 'profile_default'
  | 'missing';

export interface ProfileRegistryEntry {
  id: string;
  domain: 'transmission' | 'air' | 'solar' | 'internal' | 'indoor_design' | 'glazing';
  label: string;
  units: string | null;
  values: unknown;
  usedIn: string[];
  status: ProfileRegistryStatus;
  defaultSourceMode: ProfileDefaultSourceMode;
  source: string;
  calculationInput: boolean;
  notes: string;
}

const indoorHeatingValues = {
  bedroom: quickIndoorDesignC('bedroom').tempC,
  child_room: quickIndoorDesignC('child_room').tempC,
  living_room: quickIndoorDesignC('living_room').tempC,
  office: quickIndoorDesignC('office').tempC,
  guest_room: quickIndoorDesignC('guest_room').tempC,
  kitchen: quickIndoorDesignC('kitchen').tempC,
  bathroom: quickIndoorDesignC('bathroom').tempC,
  shower: quickIndoorDesignC('shower').tempC,
  corridor: quickIndoorDesignC('corridor').tempC,
  hall: quickIndoorDesignC('hall').tempC,
  dressing_room: quickIndoorDesignC('dressing_room').tempC,
  storage: quickIndoorDesignC('storage').tempC,
  technical: quickIndoorDesignC('technical').tempC,
  boiler_room: quickIndoorDesignC('boiler_room').tempC,
  garage: quickIndoorDesignC('garage').tempC,
  unknown_room_type_default: QUICK_DEFAULT_INDOOR_C,
} as const;

export const BUILDING_PROJECT_PROFILE_REGISTRY: readonly ProfileRegistryEntry[] = [
  {
    id: 'transmission.wall.u_value_by_tier', domain: 'transmission', label: 'Wall U-value by consumer insulation tier', units: 'W/(m²·K)', values: CONSTRUCTION_U_VALUES.wall,
    usedIn: ['computeRoomTransmission wallElements'], status: 'APPROVED_WITH_LIMITATION', defaultSourceMode: 'profile_default', source: 'Phase 3.2B engineering baseline / transmission core', calculationInput: true,
    notes: 'Typical profile values; explicit/certificate U-value always overrides. Not measured construction data.',
  },
  {
    id: 'transmission.window.u_value_by_tier', domain: 'transmission', label: 'Window U-value by thermal tier', units: 'W/(m²·K)', values: CONSTRUCTION_U_VALUES.window,
    usedIn: ['computeRoomTransmission windowElements'], status: 'APPROVED_WITH_LIMITATION', defaultSourceMode: 'profile_default', source: 'Phase 3.2B engineering baseline / transmission core', calculationInput: true,
    notes: 'Thermal-quality tier only. Do not map glazing size type (standard/large/panoramic) to these values.',
  },
  {
    id: 'transmission.door.u_value_by_tier', domain: 'transmission', label: 'Door U-value by construction tier', units: 'W/(m²·K)', values: CONSTRUCTION_U_VALUES.door,
    usedIn: ['computeRoomTransmission doorElements'], status: 'APPROVED_WITH_LIMITATION', defaultSourceMode: 'profile_default', source: 'Phase 3.2B engineering baseline / transmission core', calculationInput: true,
    notes: 'Door profile values are typical; exact certified U-value remains Advanced/certificate.',
  },
  {
    id: 'transmission.roof.u_value_by_tier', domain: 'transmission', label: 'Roof U-value by insulation tier', units: 'W/(m²·K)', values: CONSTRUCTION_U_VALUES.roof,
    usedIn: ['computeRoomTransmission roofElements'], status: 'APPROVED_WITH_LIMITATION', defaultSourceMode: 'profile_default', source: 'Phase 3.2B engineering baseline / transmission core', calculationInput: true,
    notes: 'Only applies when roof/attic exposure is user-selected or derived.',
  },
  {
    id: 'transmission.floor.u_value_by_tier', domain: 'transmission', label: 'Floor U-value by insulation tier', units: 'W/(m²·K)', values: CONSTRUCTION_U_VALUES.floor,
    usedIn: ['computeRoomTransmission floorElements'], status: 'APPROVED_WITH_LIMITATION', defaultSourceMode: 'profile_default', source: 'Phase 3.2B engineering baseline / transmission core', calculationInput: true,
    notes: 'Only applies when ground/basement exposure is user-selected or derived.',
  },
  {
    id: 'transmission.legacy_insulation_seed', domain: 'transmission', label: 'Legacy project insulationLevel → construction tier seed', units: null,
    values: { poor: 'poor', medium: 'average', good: 'good', unknown: null },
    usedIn: ['resolveElementUValue fallback (legacy_insulation_seed)'], status: 'APPROVED_WITH_LIMITATION', defaultSourceMode: 'inherited', source: 'Phase 3.2A §6 / MASTER legacy insulationLevel', calculationInput: true,
    notes: 'Inherited from the Phase 1 project-level insulationLevel (poor/medium/good), visible to the user; unknown maps to null (never promoted). Element explicit U and constructionTier both override this seed. It is NOT derived from glazing size type.',
  },
  {
    id: 'air.airtightness.natural_ach_by_class', domain: 'air', label: 'Natural infiltration ACH by airtightness class', units: '1/h', values: AIRTIGHTNESS_ACH_BASE,
    usedIn: ['resolveInfiltration airtightness_profile'], status: 'APPROVED_WITH_LIMITATION', defaultSourceMode: 'profile_default', source: 'Phase 3.2B air baseline', calculationInput: true,
    notes: 'Typical effective natural ACH profile. Apartment multiplier is applied separately; never measured.',
  },
  {
    id: 'air.airtightness.apartment_factor', domain: 'air', label: 'Apartment infiltration reduction factor', units: 'ratio', values: APARTMENT_INFILTRATION_FACTOR,
    usedIn: ['resolveInfiltration apartment objectType'], status: 'APPROVED_WITH_LIMITATION', defaultSourceMode: 'derived', source: 'Phase 3.2B air baseline', calculationInput: true,
    notes: 'Derived from objectType=apartment; still an engineering limitation, not a measurement.',
  },
  {
    id: 'air.ach50.divisor', domain: 'air', label: 'ACH50 to effective natural ACH divisor', units: 'ratio', values: ACH50_DIVISOR,
    usedIn: ['resolveInfiltration ach50 / divisor'], status: 'APPROVED_WITH_LIMITATION', defaultSourceMode: 'derived', source: 'Phase 3.2B air baseline', calculationInput: true,
    notes: 'Only used when expert/measured ACH50 is supplied.',
  },
  {
    id: 'air.ventilation_balance.model', domain: 'air', label: 'Ventilation balance superposition model', units: null,
    values: { none: 'Vinf', natural: 'Vinf', supply_only: 'Vvent', exhaust_only: 'max(Vvent,Vinf)', balanced: 'Vvent+Vinf', unknown: 'Vvent+Vinf' },
    usedIn: ['resolveOutdoorAirFlow'], status: 'APPROVED_WITH_LIMITATION', defaultSourceMode: 'user_explicit', source: 'Phase 3.2B air baseline', calculationInput: true,
    notes: 'Balance choice is user/system fact; it does not invent a mechanical flow.',
  },
  {
    id: 'air.mechanical_ventilation.flow_default', domain: 'air', label: 'Mechanical ventilation flow default', units: 'm³/h', values: null,
    usedIn: ['supply_only/exhaust_only/balanced when ventilationFlowM3h absent'], status: 'MUST_REMAIN_MISSING', defaultSourceMode: 'missing', source: 'No approved project-specific ventilation-rate source/sign-off', calculationInput: false,
    notes: 'Mechanical flow depends on design/occupancy/equipment. Do not derive hidden flow from area or volume yet.',
  },
  {
    id: 'solar.shgc.by_window_thermal_tier', domain: 'solar', label: 'SHGC by window thermal tier', units: 'ratio', values: SHGC_GLASS_PROFILES,
    usedIn: ['computeRoomSolar resolveShgc'], status: 'APPROVED_WITH_LIMITATION', defaultSourceMode: 'profile_default', source: 'Phase 3.2C solar baseline', calculationInput: true,
    notes: 'Uses window thermal tier, not glazing size type.',
  },
  {
    id: 'solar.shading.profile', domain: 'solar', label: 'Shading multiplier profile', units: 'ratio', values: SHADING_PROFILES,
    usedIn: ['computeRoomSolar resolveShading'], status: 'APPROVED_WITH_LIMITATION', defaultSourceMode: 'profile_default', source: 'Phase 3.2C solar baseline', calculationInput: true,
    notes: 'Absent answer remains missing; no silent none=1.0 default.',
  },
  {
    id: 'solar.glazed_area.frame_factor', domain: 'solar', label: 'Rough opening to glazed area factor', units: 'ratio', values: WINDOW_GLAZING_AREA_FACTOR,
    usedIn: ['computeRoomSolar resolveGlazedArea'], status: 'APPROVED_WITH_LIMITATION', defaultSourceMode: 'derived', source: 'Phase 3.2C solar baseline', calculationInput: true,
    notes: 'Only applied when explicit net glazing area is absent and width×height/gross area exists.',
  },
  {
    id: 'glazing.type.size_to_thermal_quality', domain: 'glazing', label: 'glazingType size category to thermal U/SHGC quality', units: null, values: null,
    usedIn: ['none'], status: 'MUST_REMAIN_MISSING', defaultSourceMode: 'missing', source: 'Phase 3.2H audit: standard/large/panoramic describe size/exposure in QUICK, not glass thermal quality', calculationInput: false,
    notes: 'glazingType is a size/use fact. Thermal quality remains the separate window tier question.',
  },
  {
    id: 'internal.occupant_sensible_gain', domain: 'internal', label: 'Occupant sensible heat gain', units: 'W/person', values: OCCUPANT_SENSIBLE_W_PER_PERSON,
    usedIn: ['computeRoomInternal occupancy × W/person'], status: 'APPROVED_EXISTING', defaultSourceMode: 'profile_default', source: 'Phase 3.2C internal-gains baseline', calculationInput: true,
    notes: 'Sensible-only; not 110 W total/person. Occupancy count itself is not auto-defaulted.',
  },
  {
    id: 'internal.lighting_equipment.by_object_type', domain: 'internal', label: 'Lighting and equipment sensible gains by object type', units: 'W/m²', values: INTERNAL_GAIN_PROFILES,
    usedIn: ['computeRoomInternal lighting/equipment profile × room area'], status: 'APPROVED_WITH_LIMITATION', defaultSourceMode: 'profile_default', source: 'Phase 3.2C internal-gains baseline', calculationInput: true,
    notes: 'ObjectType selects residential/commercial profile. Explicit W overrides.',
  },
  {
    id: 'internal.occupancy.by_room_type', domain: 'internal', label: 'Occupancy reference profile by room type', units: 'people',
    values: OCCUPANCY_BY_ROOM_TYPE,
    usedIn: ['computeRoomInternal residential reference default'], status: 'REFERENCE_PROFILE', defaultSourceMode: 'profile_default', source: 'ASHRAE 62.1 residential dwelling occupancy (2 for studio/1BR, +1 per additional bedroom) + Manual J/ENERGY STAR (bedrooms+1); per-room 2/2/1 split is a product/engineering projection, not a normative constant', calculationInput: true,
    notes: 'RESIDENTIAL ONLY (private_house/apartment); never applied for commercial (density deferred). Applied only when occupancy is null; explicit user value (including 0) always wins and is never re-derived on roomType change. bathroom/shower are suggestion-only (require confirmation). Zero profiles (corridor/storage/etc) mean "no assigned design occupant" — distinct from missing.',
  },
  {
    id: 'indoor_design.heating.by_room_type', domain: 'indoor_design', label: 'Heating indoor design temperature by room type', units: '°C', values: indoorHeatingValues,
    usedIn: ['quickIndoorDesignC used by quick/transmission/air heating'], status: 'APPROVED_EXISTING', defaultSourceMode: 'derived', source: 'Existing QUICK/steady-state design-temperature baseline', calculationInput: true,
    notes: 'Derived from stored roomType; unknown room types fall back to 20°C with warning in QUICK.',
  },
  {
    id: 'indoor_design.cooling.default', domain: 'indoor_design', label: 'Cooling indoor design temperature default', units: '°C', values: COOLING_INDOOR_DEFAULT_C,
    usedIn: ['transmission cooling ΔT', 'air cooling ΔT'], status: 'APPROVED_EXISTING', defaultSourceMode: 'profile_default', source: 'Phase 3.2A/B baseline', calculationInput: true,
    notes: 'No room-level Tin override schema yet; do not add hidden per-room values.',
  },
] as const;

export function profileRegistryAuditRows(): ProfileRegistryEntry[] {
  return BUILDING_PROJECT_PROFILE_REGISTRY.map((entry) => ({ ...entry }));
}

export function getProfileRegistryEntry(id: string): ProfileRegistryEntry | null {
  return BUILDING_PROJECT_PROFILE_REGISTRY.find((entry) => entry.id === id) ?? null;
}
