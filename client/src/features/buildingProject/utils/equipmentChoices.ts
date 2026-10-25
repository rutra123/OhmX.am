/**
 * Customer equipment choices of a project: fan-coil installation type per room and the selections
 * made in the specification ("нужен выбор" positions).
 *
 * Persistence: the server (`/tools/building-project/:id/equipment-choices`, stored beside the project) is the
 * source of truth; localStorage is a per-browser cache so the UI reacts instantly and survives a failed request.
 * Choices made earlier in this browser only are uploaded on the first sync. A change is broadcast in-page so
 * the systems step and the specification stay in sync.
 */
import { api } from '../../../api/client';
import type { EngineeringRoomAssignment } from '../types';
import { isFanCoilMounting, type FanCoilMounting } from '../equipment/fanCoilMounting';

export type EquipmentChoices = Record<string, string>;

export const EQUIPMENT_CHOICES_EVENT = 'ohmx:equipment-choices';

const storageKey = (projectId: string) => `ohmx.bp.equipmentChoices.${projectId}`;

export function loadEquipmentChoices(projectId: string | null | undefined): EquipmentChoices {
  if (!projectId) return {};
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(projectId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return {};
  }
}

type Fetcher = <T>(path: string, init?: RequestInit) => Promise<T>;
const endpoint = (projectId: string) => `/tools/building-project/${encodeURIComponent(projectId)}/equipment-choices`;

function cacheLocally(projectId: string, value: EquipmentChoices) {
  try { globalThis.localStorage?.setItem(storageKey(projectId), JSON.stringify(value)); } catch { /* storage unavailable */ }
  try { globalThis.dispatchEvent?.(new CustomEvent(EQUIPMENT_CHOICES_EVENT, { detail: { projectId } })); } catch { /* no DOM */ }
}

const pendingPush = new Map<string, ReturnType<typeof setTimeout>>();
const dirtyKey = (projectId: string) => `${storageKey(projectId)}.unsynced`;
function setDirty(projectId: string, dirty: boolean) {
  try { if (dirty) globalThis.localStorage?.setItem(dirtyKey(projectId), '1'); else globalThis.localStorage?.removeItem(dirtyKey(projectId)); } catch { /* storage unavailable */ }
}
function isDirty(projectId: string): boolean {
  try { return globalThis.localStorage?.getItem(dirtyKey(projectId)) === '1'; } catch { return false; }
}

/** Saves locally at once and on the server (debounced; the last value wins). */
export function saveEquipmentChoices(projectId: string | null | undefined, value: EquipmentChoices, fetcher: Fetcher = api): Promise<void> {
  if (!projectId) return Promise.resolve();
  cacheLocally(projectId, value);
  setDirty(projectId, true);
  const prev = pendingPush.get(projectId);
  if (prev) clearTimeout(prev);
  return new Promise((resolve) => {
    pendingPush.set(projectId, setTimeout(() => {
      pendingPush.delete(projectId);
      fetcher(endpoint(projectId), { method: 'PUT', body: JSON.stringify({ choices: value }) })
        .then(() => { setDirty(projectId, false); resolve(); }, () => resolve()); // offline: stays "unsynced"; the next sync uploads it
    }, 300));
  });
}

/**
 * Brings the browser cache in line with the server: server choices win; when the server has none
 * but this browser has (made before server storage existed / offline), they are uploaded.
 */
export async function syncEquipmentChoices(projectId: string | null | undefined, fetcher: Fetcher = api): Promise<EquipmentChoices> {
  if (!projectId) return {};
  const local = loadEquipmentChoices(projectId);
  try {
    const doc = await fetcher<{ choices?: Record<string, unknown>; updatedAt?: string | null }>(endpoint(projectId));
    const server = Object.fromEntries(Object.entries(doc?.choices ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string'));
    if ((isDirty(projectId) || !doc?.updatedAt) && Object.keys(local).length) {
      await fetcher(endpoint(projectId), { method: 'PUT', body: JSON.stringify({ choices: local }) });
      setDirty(projectId, false);
      return local;
    }
    if (JSON.stringify(server) !== JSON.stringify(local)) cacheLocally(projectId, server);
    return server;
  } catch {
    return local;
  }
}

/** Returns a new choices object with `key` set (or removed when `value` is null). */
export function withChoice(choices: EquipmentChoices, key: string, value: string | null): EquipmentChoices {
  const next = { ...choices };
  if (value == null || value === '') delete next[key];
  else next[key] = value;
  return next;
}

export const fanCoilMountingKey = (roomId: string) => `fc-mounting:${roomId}`;

export function fanCoilMountingOf(choices: EquipmentChoices, roomId: string): FanCoilMounting | null {
  const v = choices[fanCoilMountingKey(roomId)];
  return isFanCoilMounting(v) ? v : null;
}

/** A room uses fan coils for heating or cooling (system family id `fan_coils`). */
export function roomUsesFanCoils(assignment: Pick<EngineeringRoomAssignment, 'heatingSystems' | 'coolingSystems'> | null | undefined): boolean {
  if (!assignment) return false;
  return [...(assignment.heatingSystems ?? []), ...(assignment.coolingSystems ?? [])].some((s) => s.familyId === 'fan_coils');
}
