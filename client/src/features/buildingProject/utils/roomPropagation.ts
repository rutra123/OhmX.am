/**
 * Building-wide answers entered once are reused for the other rooms.
 *
 * What is shared: "what is above / below the room" (same level only) and the
 * construction / airtightness quality of the building (walls, roof, floor,
 * airtightness). What is NOT shared: room-specific facts such as the number of
 * external sides, wall length, windows or an external door — copying "есть
 * дверь" into every room would distort heat losses.
 *
 * Only empty fields are filled; an explicit answer in another room is never
 * overwritten. Pure helpers: the panel turns the result into updateRoom calls.
 */
import type { AirtightnessClass, BuildingProject, BuildingRoom, BuildingRoomInput, ConstructionTier } from '../types';
import {
  EMPTY_AIR,
  EMPTY_ENVELOPE,
  selectAirtightnessClass,
  selectFloorTier,
  selectRoofTier,
  selectWallTier,
  sparseAirPatch,
  sparseEnvelopePatch,
} from './engineeringSelections';
import { resolveRoomPhysicalBoundaries, type PhysicalSpaceAbove, type PhysicalSpaceBelow } from './professionalCompleteness';

export type RoomPatch = { roomId: string; patch: BuildingRoomInput };

export type SameLevelScope = {
  rooms: BuildingRoom[];
  /** true when the rooms are known to be on the same level (auto-apply); false → offer a manual "apply to all". */
  certain: boolean;
};

/** Rooms that share the source room's level (floor). */
export function sameLevelRooms(project: BuildingProject, room: BuildingRoom): SameLevelScope {
  const others = (project.rooms ?? []).filter((candidate) => candidate.id !== room.id);
  if (room.floorId) return { rooms: others.filter((candidate) => candidate.floorId === room.floorId), certain: true };
  const floorCount = project.topology?.floorCount ?? project.topology?.floors?.length ?? null;
  if (floorCount === 1) return { rooms: others, certain: true };
  if (project.objectType === 'apartment') return { rooms: others, certain: true };
  const position = room.extras?.geometry?.floorPosition;
  if (position && position !== 'unknown') {
    return { rooms: others.filter((candidate) => candidate.extras?.geometry?.floorPosition === position), certain: true };
  }
  return { rooms: others, certain: false };
}

/** Construction quality is a property of the building: every other room, regardless of level. */
function allOtherRooms(project: BuildingProject, room: BuildingRoom): BuildingRoom[] {
  return (project.rooms ?? []).filter((candidate) => candidate.id !== room.id);
}

function geometryPatch(target: BuildingRoom, key: 'spaceAbove' | 'spaceBelow', value: string): BuildingRoomInput['extras'] {
  return { ...target.extras, geometry: { ...target.extras?.geometry, [key]: value } } as BuildingRoomInput['extras'];
}

export function propagateSpaceAbove(project: BuildingProject, room: BuildingRoom, value: PhysicalSpaceAbove | null): { patches: RoomPatch[]; certain: boolean } {
  if (!value) return { patches: [], certain: true };
  const scope = sameLevelRooms(project, room);
  const patches = scope.rooms
    .filter((target) => !resolveRoomPhysicalBoundaries(project, target).above)
    .map((target) => {
      const envelope = target.envelope ?? EMPTY_ENVELOPE;
      const envelopePatch = value === 'conditioned_space' ? sparseEnvelopePatch(envelope, { ...envelope, roofElements: [] }) : {};
      return {
        roomId: target.id,
        patch: { extras: geometryPatch(target, 'spaceAbove', value), ...(Object.keys(envelopePatch).length ? { envelope: envelopePatch } : {}) },
      };
    });
  return { patches, certain: scope.certain };
}

export function propagateSpaceBelow(project: BuildingProject, room: BuildingRoom, value: PhysicalSpaceBelow | null): { patches: RoomPatch[]; certain: boolean } {
  if (!value) return { patches: [], certain: true };
  const scope = sameLevelRooms(project, room);
  const patches = scope.rooms
    .filter((target) => !resolveRoomPhysicalBoundaries(project, target).below)
    .map((target) => {
      const envelope = target.envelope ?? EMPTY_ENVELOPE;
      const envelopePatch = value === 'conditioned_space' ? sparseEnvelopePatch(envelope, { ...envelope, floorElements: [] }) : {};
      return {
        roomId: target.id,
        patch: { extras: geometryPatch(target, 'spaceBelow', value), ...(Object.keys(envelopePatch).length ? { envelope: envelopePatch } : {}) },
      };
    });
  return { patches, certain: scope.certain };
}

/** Wall insulation: rooms that have (or declare) external walls and no wall quality yet. */
export function propagateWallTier(project: BuildingProject, room: BuildingRoom, tier: ConstructionTier | null): RoomPatch[] {
  if (!tier) return [];
  return allOtherRooms(project, room)
    .filter((target) => {
      const wall = target.envelope?.wallElements?.[0];
      if (wall) return !wall.constructionTier && wall.uValue == null;
      const count = target.extras?.geometry?.externalWallCount;
      return count != null && count > 0;
    })
    .map((target) => {
      const envelope = target.envelope ?? EMPTY_ENVELOPE;
      return { roomId: target.id, patch: { envelope: sparseEnvelopePatch(envelope, selectWallTier(envelope, tier)) } };
    });
}

/** Roof / floor insulation: rooms with the same kind of boundary (roof or unheated attic / ground or unheated basement). */
export function propagateBoundaryTier(project: BuildingProject, room: BuildingRoom, kind: 'roof' | 'floor', tier: ConstructionTier | null): RoomPatch[] {
  if (!tier) return [];
  const source = resolveRoomPhysicalBoundaries(project, room);
  const sourceBoundary = kind === 'roof' ? source.above : source.below;
  if (!sourceBoundary || sourceBoundary === 'conditioned_space') return [];
  return allOtherRooms(project, room)
    .filter((target) => {
      const boundaries = resolveRoomPhysicalBoundaries(project, target);
      if ((kind === 'roof' ? boundaries.above : boundaries.below) !== sourceBoundary) return false;
      const element = kind === 'roof' ? target.envelope?.roofElements?.[0] : target.envelope?.floorElements?.[0];
      return !element || (!element.constructionTier && element.uValue == null);
    })
    .map((target) => {
      const envelope = target.envelope ?? EMPTY_ENVELOPE;
      const next = kind === 'roof' ? selectRoofTier(envelope, tier, target.areaM2) : selectFloorTier(envelope, tier, target.areaM2);
      return { roomId: target.id, patch: { envelope: sparseEnvelopePatch(envelope, next) } };
    });
}

/** Airtightness describes the whole building. */
export function propagateAirtightness(project: BuildingProject, room: BuildingRoom, value: AirtightnessClass | null): RoomPatch[] {
  if (!value) return [];
  return allOtherRooms(project, room)
    .filter((target) => !(target.air ?? EMPTY_AIR).airtightnessClass && (target.air ?? EMPTY_AIR).ach50 == null)
    .map((target) => {
      const air = target.air ?? EMPTY_AIR;
      return { roomId: target.id, patch: { air: sparseAirPatch(air, selectAirtightnessClass(air, value)) as BuildingRoomInput['air'] } };
    });
}
