/**
 * Building Project Phase 2.7 — apartment central (external) building supply.
 *
 * Pure, deterministic helpers for the apartment Systems UX. Heating and cooling
 * are INDEPENDENT services — never a single global "central system" boolean.
 *
 * Source modes per service:
 *   external — «Центральное отопление/охлаждение здания» (building plant, no
 *              own generator; equipment of the source is NOT selected by OhmX)
 *   own      — «Собственный источник» (apartment-owned generator / own source)
 *   none     — «Не требуется»
 *
 * The convenience preset «Центральное отопление + охлаждение здания» is just
 * mode external applied to BOTH services independently.
 */
import type { BuildingSystemsCatalog, EngineeringSystemFamily, EngineeringSystemFamilySelection } from './types';

export const EXTERNAL_BUILDING_HEATING_SUPPLY_ID = 'external_building_heating_supply';
export const EXTERNAL_BUILDING_COOLING_SUPPLY_ID = 'external_building_cooling_supply';
export const EXTERNAL_BUILDING_SUPPLY_IDS = [EXTERNAL_BUILDING_HEATING_SUPPLY_ID, EXTERNAL_BUILDING_COOLING_SUPPLY_ID] as const;

export type ApartmentSourceMode = 'external' | 'own' | 'none';

/** Own (apartment-side) heating generator families. Reversible HP serves H+C. */
const OWN_HEATING_SOURCE_IDS = [
  'gas_boiler',
  'gas_condensing_boiler',
  'electric_boiler',
  'heat_pump_air_to_water',
  'reversible_air_to_water_heat_pump',
];

/** Own (apartment-side) cooling generator / DX families. Reversible HP serves H+C. */
const OWN_COOLING_SOURCE_IDS = [
  'chiller_fan_coils',
  'split_wall',
  'multi_split',
  'cassette_ac',
  'ducted_ac',
  'floor_ceiling_ac',
  'column_ac',
  'vrf_vrv',
  'heat_pump_air_to_air',
  'reversible_air_to_water_heat_pump',
];

export function isExternalBuildingSupply(family: EngineeringSystemFamily | null | undefined): boolean {
  return Boolean(family && (EXTERNAL_BUILDING_SUPPLY_IDS as readonly string[]).includes(family.id));
}

export type RoomServiceRole = 'source' | 'terminal';

/**
 * Deterministic presentation role for a family in ONE service section.
 *
 * INVARIANT: for roomId + service + familyId there is at most ONE user-selectable
 * control. Every non-external family that can serve the service receives EXACTLY
 * ONE role:
 *   - kind 'source'              → 'source'  (project/room source selection)
 *   - terminal / combined / solution_template (incl. hybrid-scope combined
 *     families such as heat_pump_air_to_air) → 'terminal' (rendered once as the
 *     room choice)
 *
 * Combined/hybrid families legitimately expose BOTH source and terminal
 * capabilities in the data model, but that must NOT create two controls for the
 * same room/service/family. External building supply is not room equipment and
 * returns null.
 */
export function roomServiceRole(family: EngineeringSystemFamily | null | undefined, service: 'heating' | 'cooling'): RoomServiceRole | null {
  if (!family || family.external) return null;
  const supports = family.service === service || family.service === 'heating_and_cooling';
  if (!supports) return null;
  if (family.kind === 'source') return null;
  if (family.kind === 'combined' && family.scope === 'central') return null;
  return 'terminal';
}

/**
 * Unique per-service room option list (sources first, then terminals). Each
 * family appears at most once; dual-service families (e.g. fan coil) appear once
 * per service they support — which is the allowed cross-service duplication.
 */
export function roomServiceOptions(families: EngineeringSystemFamily[], service: 'heating' | 'cooling'): Array<{ family: EngineeringSystemFamily; role: RoomServiceRole }> {
  const out: Array<{ family: EngineeringSystemFamily; role: RoomServiceRole }> = [];
  for (const family of families) {
    const role = roomServiceRole(family, service);
    if (role) out.push({ family, role });
  }
  out.sort((a, b) => (a.role === b.role ? 0 : a.role === 'source' ? -1 : 1));
  return out;
}

export function apartmentSourceMode(families: EngineeringSystemFamily[], service: 'heating' | 'cooling'): ApartmentSourceMode {
  const externalId = service === 'heating' ? EXTERNAL_BUILDING_HEATING_SUPPLY_ID : EXTERNAL_BUILDING_COOLING_SUPPLY_ID;
  const ids = new Set(families.map((f) => f.id));
  if (ids.has(externalId)) return 'external';
  const ownIds = service === 'heating' ? OWN_HEATING_SOURCE_IDS : OWN_COOLING_SOURCE_IDS;
  if (ownIds.some((id) => ids.has(id))) return 'own';
  return 'none';
}

/**
 * Convert a catalog family into a genuinely NEW user selection. Only a new
 * selection receives a fresh selectedAt — existing selections keep theirs.
 */
function createFamilySelection(family: EngineeringSystemFamily, selectedAt?: string): EngineeringSystemFamilySelection {
  return { ...family, selectedAt: selectedAt ?? new Date().toISOString() };
}

/**
 * Apply a source mode for ONE service, returning the next selectedSystemFamilies
 * list. Only that service's sources are touched; the other service stays intact.
 * mode 'none' removes both the external and own sources for the service.
 */
export function setApartmentSourceMode(
  families: EngineeringSystemFamilySelection[],
  service: 'heating' | 'cooling',
  mode: ApartmentSourceMode,
  requestedServices: Array<'heating' | 'cooling'>,
  catalog: BuildingSystemsCatalog | null,
): EngineeringSystemFamilySelection[] {
  const externalId = service === 'heating' ? EXTERNAL_BUILDING_HEATING_SUPPLY_ID : EXTERNAL_BUILDING_COOLING_SUPPLY_ID;
  const ownIds = service === 'heating' ? OWN_HEATING_SOURCE_IDS : OWN_COOLING_SOURCE_IDS;
  const out = families.filter((f) => f.id !== externalId);

  if (mode === 'none') {
    return out.filter((f) => !ownIds.includes(f.id));
  }

  if (mode === 'external') {
    const withoutOwn = out.filter((f) => !ownIds.includes(f.id));
    const externalFamily = catalog?.systemFamilies.find((f) => f.id === externalId);
    if (!externalFamily) return withoutOwn;
    return [...withoutOwn, createFamilySelection(externalFamily)];
  }

  // mode === 'own': keep existing own sources, add a sensible default when none left.
  const withoutOwn = out.filter((f) => !ownIds.includes(f.id));
  const hasOwn = out.some((f) => ownIds.includes(f.id));
  if (hasOwn) return out;
  const heatingAndCooling = requestedServices.includes('heating') && requestedServices.includes('cooling');
  const defaultId = service === 'heating'
    ? (heatingAndCooling ? 'reversible_air_to_water_heat_pump' : 'gas_condensing_boiler')
    : (heatingAndCooling ? 'reversible_air_to_water_heat_pump' : 'split_wall');
  const defaultFamily = catalog?.systemFamilies.find((f) => f.id === defaultId);
  if (!defaultFamily) return withoutOwn;
  return [...withoutOwn, createFamilySelection(defaultFamily)];
}

export function isProjectSharedSourceFamily(family: EngineeringSystemFamily | null | undefined): boolean {
  return Boolean(family && (family.kind === 'source' || family.kind === 'combined') && family.scope !== 'room_local');
}

export function projectSourceOptions(families: EngineeringSystemFamily[], service: 'heating' | 'cooling'): EngineeringSystemFamily[] {
  // External building supply is PER-SERVICE: heating supply is only a heating
  // source option and cooling supply only a cooling source option. Filtering
  // ALL external families for either service would let setProjectSource drop
  // the OTHER service's external supply when one service's source changes.
  const externalId = service === 'heating' ? EXTERNAL_BUILDING_HEATING_SUPPLY_ID : EXTERNAL_BUILDING_COOLING_SUPPLY_ID;
  return families.filter((family) => {
    if (family.external) return family.id === externalId;
    const supports = family.service === service || family.service === 'heating_and_cooling';
    if (!supports) return false;
    return isProjectSharedSourceFamily(family) && family.kind !== 'solution_template';
  });
}

export function setProjectSource(
  families: EngineeringSystemFamilySelection[],
  service: 'heating' | 'cooling',
  familyId: string | null,
  catalog: BuildingSystemsCatalog | null,
): EngineeringSystemFamilySelection[] {
  const removable = new Set(
    projectSourceOptions(catalog?.systemFamilies || families, service).map((f) => f.id),
  );
  const kept = families.filter((f) => !removable.has(f.id));
  if (!familyId) return kept;
  const next = catalog?.systemFamilies.find((f) => f.id === familyId);
  if (!next) return kept;
  return [...kept, createFamilySelection(next)];
}

export function suggestionSourceFamilyIds(families: EngineeringSystemFamilySelection[]): string[] {
  return families.filter((f) => isProjectSharedSourceFamily(f) || f.kind === 'source').map((f) => f.id);
}
