import { api } from '../../../api/client';
import type { BuildingCatalog, BuildingLoadMode, BuildingLoadState, BuildingProject, BuildingProjectView, BuildingRoomInput, BuildingSystemsCatalog, InsulationLevel, ObjectType, BasementType, TopBoundaryType, PlantLocationInput } from '../types';

const base = '/tools/building-project';

export async function getBuildingCatalog() {
  return api<BuildingCatalog>(`${base}/catalog`);
}

export async function getBuildingSystemsCatalog() {
  return api<BuildingSystemsCatalog>(`${base}/systems-catalog`);
}

export async function createBuildingProject(body: {
  name?: string;
  objectType?: ObjectType;
  regionCode?: string | null;
  totalAreaM2?: number | null;
  defaultCeilingHeightM?: number;
  insulationLevel?: InsulationLevel;
  floorCount?: number;
  basementType?: BasementType;
  topBoundaryType?: TopBoundaryType;
  plantLocation?: PlantLocationInput;
  /** Initial room rows (existing server contract: POST body `rooms`). */
  rooms?: BuildingRoomInput[];
}) {
  return api<BuildingProject>(base, { method: 'POST', body: JSON.stringify(body) });
}

export async function getBuildingProject(id: string) {
  return api<BuildingProject>(`${base}/${id}`);
}

export async function getBuildingProjectView(id: string) {
  return api<BuildingProjectView>(`${base}/${id}/view`);
}

export async function updateBuildingProject(id: string, patch: Record<string, unknown>) {
  return api<BuildingProject>(`${base}/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export async function addBuildingRoom(id: string, room: BuildingRoomInput) {
  return api<BuildingProject>(`${base}/${id}/rooms`, { method: 'POST', body: JSON.stringify(room) });
}

export async function updateBuildingRoom(id: string, roomId: string, patch: BuildingRoomInput) {
  return api<BuildingProject>(`${base}/${id}/rooms/${roomId}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export async function removeBuildingRoom(id: string, roomId: string) {
  return api<BuildingProject>(`${base}/${id}/rooms/${roomId}`, { method: 'DELETE' });
}

export async function setBuildingRoomTypeCount(id: string, roomType: string, count: number, floorId?: string | null) {
  return api<BuildingProject>(`${base}/${id}/room-counts`, { method: 'PUT', body: JSON.stringify({ roomType, count, floorId: floorId ?? undefined }) });
}

export async function confirmBuildingObject(id: string) {
  return api<BuildingProject>(`${base}/${id}/confirm-object`, { method: 'POST', body: '{}' });
}

export async function reopenBuildingObject(id: string) {
  return api<BuildingProject>(`${base}/${id}/reopen-object`, { method: 'POST', body: '{}' });
}

export async function updateSystemsConfiguration(id: string, patch: Record<string, unknown>) {
  return api<BuildingProject>(`${base}/${id}/systems`, { method: 'PUT', body: JSON.stringify(patch) });
}

export async function suggestSystemsConfiguration(id: string, body: {
  requestedServices?: Array<'heating' | 'cooling'> | 'heating' | 'cooling' | 'heating_and_cooling';
  selectedFamilyIds?: string[];
  apply?: boolean;
}) {
  return api<{ suggestion?: unknown } & Partial<BuildingProject>>(`${base}/${id}/systems/suggest`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function confirmSystemsConfiguration(id: string) {
  return api<BuildingProject>(`${base}/${id}/systems/confirm`, { method: 'POST', body: '{}' });
}

// Phase 3 — Loads (backend stays the calculation authority; the client only displays).
export async function getBuildingLoadState(id: string) {
  return api<BuildingLoadState>(`${base}/${id}/loads`);
}

export async function calculateBuildingLoads(id: string, mode: BuildingLoadMode) {
  return api<BuildingProject>(`${base}/${id}/loads/calculate`, {
    method: 'POST',
    body: JSON.stringify({ mode }),
  });
}
