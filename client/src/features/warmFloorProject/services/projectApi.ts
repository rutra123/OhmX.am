import { api } from '../../../api/client';
import type { ProjectRoomInput, WarmFloorProjectDto } from '../types/project';

const base = '/tools/warm-floor/project';

export async function listWarmFloorProjects() {
  return api<{ projects: Array<Pick<WarmFloorProjectDto, 'id' | 'name' | 'status' | 'updatedAt'>> }>(base);
}

export async function createWarmFloorProject(body: {
  name?: string;
  preferredBundleRole?: string;
  objectType?: string | null;
  objectTotalAreaM2?: number | null;
} = {}) {
  return api<WarmFloorProjectDto>(base, { method: 'POST', body: JSON.stringify(body) });
}

export async function getWarmFloorProject(id: string) {
  return api<WarmFloorProjectDto>(`${base}/${id}`);
}

export async function getWarmFloorProjectView(id: string) {
  return api<any>(`${base}/${id}/view`);
}

export async function updateWarmFloorProjectMeta(
  id: string,
  patch: { name?: string; objectType?: string | null; objectTotalAreaM2?: number | null; preferredBundleRole?: string },
) {
  return api<WarmFloorProjectDto>(`${base}/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export async function addWarmFloorRoom(id: string, room: ProjectRoomInput) {
  return api<WarmFloorProjectDto>(`${base}/${id}/rooms`, { method: 'POST', body: JSON.stringify(room) });
}

export async function updateWarmFloorRoom(id: string, roomId: string, patch: Partial<ProjectRoomInput>) {
  return api<WarmFloorProjectDto>(`${base}/${id}/rooms/${roomId}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export async function removeWarmFloorRoom(id: string, roomId: string) {
  return api<WarmFloorProjectDto>(`${base}/${id}/rooms/${roomId}`, { method: 'DELETE' });
}

export async function recalculateWarmFloorProject(id: string, roomId?: string) {
  return api<WarmFloorProjectDto>(`${base}/${id}/recalculate`, {
    method: 'POST',
    body: JSON.stringify(roomId ? { roomId } : {}),
  });
}

export async function setWarmFloorPreferredRole(id: string, role: string) {
  return api<WarmFloorProjectDto>(`${base}/${id}/preferred-role`, {
    method: 'POST',
    body: JSON.stringify({ role }),
  });
}

export async function confirmWarmFloorProject(id: string) {
  return api<WarmFloorProjectDto>(`${base}/${id}/confirm`, { method: 'POST', body: '{}' });
}

export async function getWarmFloorSpecification(id: string) {
  return api<any>(`${base}/${id}/specification`);
}

export async function getWarmFloorEstimate(id: string) {
  return api<any>(`${base}/${id}/estimate`);
}

export async function lockWarmFloorRoomVariant(id: string, roomId: string, role: string | null) {
  return api<WarmFloorProjectDto>(`${base}/${id}/rooms/${roomId}/lock-variant`, {
    method: 'POST',
    body: JSON.stringify({ role }),
  });
}
