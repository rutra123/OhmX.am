/**
 * Default bathroom towel warmer (one device per bathroom/shower room).
 *
 * A towel warmer is heating EQUIPMENT, never extra building heat loss: it does
 * not change any room load. Its output is unknown until a product is chosen,
 * so it is not subtracted from the load the main heating devices must cover.
 *
 * Persistence:
 *  - include / remove -> existing server field `towelRadiatorPreference`
 *    (source 'user'), which the server keeps across normalisation and
 *    recalculation; one value per room, so duplicates are impossible.
 *  - kind / quantity overrides -> this browser (localStorage), keyed by
 *    project + room, until the server stores these fields.
 */
import type { BuildingProject, BuildingRoom, EngineeringRoomAssignment } from '../types';

export type TowelWarmerKind = 'water' | 'electric';
export type TowelWarmerKindSource = 'user' | 'heating_system' | 'default';

export interface TowelWarmerOverride {
  kind?: TowelWarmerKind;
  quantity?: number;
}

export type TowelWarmerOverrides = Record<string, TowelWarmerOverride>;

export interface TowelWarmerSelection {
  roomId: string;
  roomName: string;
  kind: TowelWarmerKind;
  kindSource: TowelWarmerKindSource;
  quantity: number;
  /** Rated output is unknown until a product is selected. */
  capacityW: null;
}

export const TOWEL_WARMER_ROOM_TYPES = new Set(['bathroom', 'shower']);
export const TOWEL_WARMER_MAX_QUANTITY = 4;

/** Water-based room heating devices (same list the server uses for towel defaults). */
const HYDRONIC_TERMINALS = new Set([
  'hydronic_floor_heating', 'aluminum_radiators', 'bimetal_radiators', 'steel_panel_radiators', 'fan_coils', 'infloor_convectors',
]);
const ELECTRIC_TERMINALS = new Set(['electric_convector', 'heating_cable', 'heating_mat', 'electric_underfloor_heating']);
/** Heat sources that feed a water circuit. */
const HYDRONIC_SOURCES = new Set([
  'gas_boiler', 'gas_condensing_boiler', 'electric_boiler', 'heat_pump_air_to_water', 'reversible_air_to_water_heat_pump',
  'external_building_heating_supply',
]);

export function towelWarmerKindLabel(kind: TowelWarmerKind): string {
  return kind === 'water' ? 'водяной' : 'электрический';
}

export function isTowelWarmerRoom(room: Pick<BuildingRoom, 'roomType'>): boolean {
  return TOWEL_WARMER_ROOM_TYPES.has(room.roomType);
}

export function defaultTowelWarmerKind(
  assignment: EngineeringRoomAssignment | undefined,
  projectHeatingSourceId: string | null | undefined,
): { kind: TowelWarmerKind; source: TowelWarmerKindSource } {
  const terminals = assignment?.heatingSystems?.map((item) => item.familyId) ?? [];
  // A water circuit in the room wins: the warmer can hang on the same loop.
  if (terminals.some((id) => HYDRONIC_TERMINALS.has(id))) return { kind: 'water', source: 'heating_system' };
  if (terminals.some((id) => ELECTRIC_TERMINALS.has(id))) return { kind: 'electric', source: 'heating_system' };
  const source = assignment?.sourceSystemIds?.heating || projectHeatingSourceId || null;
  if (source && HYDRONIC_SOURCES.has(source)) return { kind: 'water', source: 'heating_system' };
  // Heating type does not decide it -> editable default, shown as such in the UI.
  return { kind: 'electric', source: 'default' };
}

function clampQuantity(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, TOWEL_WARMER_MAX_QUANTITY);
}

export function resolveTowelWarmer(input: {
  room: BuildingRoom;
  assignment: EngineeringRoomAssignment | undefined;
  requestedServices: Array<'heating' | 'cooling'>;
  projectHeatingSourceId?: string | null;
  override?: TowelWarmerOverride;
}): TowelWarmerSelection | null {
  const { room, assignment, requestedServices, override } = input;
  if (!isTowelWarmerRoom(room)) return null;
  // Never add heating equipment to a cooling-only project / unheated room.
  if (!requestedServices.includes('heating')) return null;
  if (assignment?.servicePreferences?.heating === 'not_required') return null;
  if (assignment?.towelRadiatorPreferenceSource === 'user' && assignment.towelRadiatorPreference === 'not_required') return null;

  const fallback = defaultTowelWarmerKind(assignment, input.projectHeatingSourceId);
  const userKind = override?.kind === 'water' || override?.kind === 'electric' ? override.kind : null;
  return {
    roomId: room.id,
    roomName: room.name,
    kind: userKind ?? fallback.kind,
    kindSource: userKind ? 'user' : fallback.source,
    quantity: clampQuantity(override?.quantity ?? 1),
    capacityW: null,
  };
}

export function resolveProjectTowelWarmers(project: BuildingProject, overrides: TowelWarmerOverrides = {}): TowelWarmerSelection[] {
  const config = project.systemsConfiguration;
  const requestedServices = config?.requestedServices ?? [];
  const sourceId = config?.architecture?.spaceHeatingSourceId ?? config?.architecture?.spaceCombinedSourceId ?? null;
  const out: TowelWarmerSelection[] = [];
  for (const room of project.rooms) {
    const selection = resolveTowelWarmer({
      room,
      assignment: config?.roomAssignments?.find((item) => item.roomId === room.id),
      requestedServices,
      projectHeatingSourceId: sourceId,
      override: overrides[room.id],
    });
    if (selection) out.push(selection);
  }
  return out;
}

/** Totals by kind for the equipment summary. */
export function towelWarmerTotals(selections: TowelWarmerSelection[]): Record<TowelWarmerKind, number> {
  const totals: Record<TowelWarmerKind, number> = { water: 0, electric: 0 };
  for (const item of selections) totals[item.kind] += item.quantity;
  return totals;
}

// ---- browser persistence of kind/quantity overrides ----

function storageKey(projectId: string): string {
  return `ohmx.bp.towelWarmers.${projectId}`;
}

export function loadTowelWarmerOverrides(projectId: string | null | undefined): TowelWarmerOverrides {
  if (!projectId) return {};
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(projectId));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as TowelWarmerOverrides) : {};
  } catch {
    return {};
  }
}

export function saveTowelWarmerOverrides(projectId: string | null | undefined, overrides: TowelWarmerOverrides): void {
  if (!projectId) return;
  try {
    globalThis.localStorage?.setItem(storageKey(projectId), JSON.stringify(overrides));
  } catch {
    // storage unavailable (private mode) — overrides stay for this session only
  }
}
