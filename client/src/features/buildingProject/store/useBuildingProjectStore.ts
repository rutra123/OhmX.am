import { create } from 'zustand';
import type { BuildingCatalog, BuildingLoadMode, BuildingLoadState, BuildingProject, BuildingRoomInput, BuildingSystemsCatalog, InsulationLevel, ObjectType, BasementType, TopBoundaryType, PlantLocationInput } from '../types';
import * as api from '../services/buildingProjectApi';
import { mergeOptimisticAirPatch } from '../utils/engineeringSelections';

export type Step = 'object' | 'rooms' | 'systems' | 'review' | 'loads';

const DRAFT_KEY = 'ohmx:building-project:active-id';
const STEP_KEY = 'ohmx:building-project:step';

// Air chips are independent sparse PATCHes. Keep them ordered per room and
// ignore stale responses so fast Android taps cannot roll the Zustand project
// back to an older room.air snapshot.
const roomAirUpdateQueues = new Map<string, Promise<void>>();
const roomAirUpdateVersions = new Map<string, number>();

// Quick area entry (Enter → next room) fires several non-air room PATCHes in a
// row. Serialize them so an older response can never replace the project
// snapshot that already contains a newer value.
let roomUpdateQueue: Promise<void> = Promise.resolve();

function withOptimisticRoomAir(
  project: BuildingProject,
  roomId: string,
  airPatch: NonNullable<BuildingRoomInput['air']> | null,
): BuildingProject {
  return {
    ...project,
    rooms: project.rooms.map((room) => room.id === roomId
      ? { ...room, air: mergeOptimisticAirPatch(room.air, airPatch) }
      : room),
  };
}

function errMessage(err: any, fallback: string) {
  const raw = err?.message || '';
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error) return String(parsed.error);
  } catch {
    // plain text
  }
  return raw || fallback;
}

function errCode(err: any): string | null {
  try {
    const parsed = JSON.parse(err?.message || '');
    return typeof parsed?.code === 'string' ? parsed.code : null;
  } catch {
    return null;
  }
}

function readActiveId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const id = window.localStorage.getItem(DRAFT_KEY);
    return id && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

function writeActiveId(id: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (id) window.localStorage.setItem(DRAFT_KEY, id);
    else window.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // ignore
  }
}

function readSavedStep(): Step | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STEP_KEY);
    return raw === 'object' || raw === 'rooms' || raw === 'systems' || raw === 'review' || raw === 'loads' ? raw : null;
  } catch {
    return null;
  }
}

function writeSavedStep(step: Step) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STEP_KEY, step);
  } catch {
    // ignore
  }
}

function resolveStep(project: BuildingProject, preferred?: Step | null): Step {
  const objectReady = project.status !== 'draft';
  if (preferred === 'object') return 'object';
  if (preferred === 'rooms') return 'rooms';
  if (preferred === 'systems') return objectReady ? 'systems' : 'rooms';
  if (preferred === 'review') return objectReady ? 'review' : 'rooms';
  // Phase 3: the Loads stage is reachable only after systems confirmation.
  if (preferred === 'loads') return project.status === 'systems_configured' ? 'loads' : objectReady ? 'review' : 'rooms';
  if (project.status === 'systems_configured') return 'review';
  if (objectReady || project.systemsConfiguration || project.systemsConfigurationSnapshot) return 'systems';
  if (project.rooms?.length) return 'rooms';
  return 'object';
}

interface BuildingProjectStore {
  project: BuildingProject | null;
  catalog: BuildingCatalog | null;
  systemsCatalog: BuildingSystemsCatalog | null;
  loadState: BuildingLoadState | null;
  step: Step;
  isLoading: boolean;
  error: string | null;
  hydrated: boolean;
  /** The saved project could not be loaded (network/server error). The active
   *  id is KEPT so a retry reopens the same project instead of a blank form. */
  loadFailed: boolean;
  hydrateFromStorage: () => Promise<void>;
  loadCatalogs: () => Promise<void>;
  createProject: (input: {
    name?: string;
    objectType: ObjectType;
    regionCode?: string | null;
    totalAreaM2?: number | null;
    defaultCeilingHeightM?: number;
    insulationLevel?: InsulationLevel;
    floorCount?: number;
    basementType?: BasementType;
    topBoundaryType?: TopBoundaryType;
    plantLocation?: PlantLocationInput;
    rooms?: BuildingRoomInput[];
  }) => Promise<void>;
  updateMeta: (patch: Record<string, unknown>) => Promise<void>;
  addRoom: (room: BuildingRoomInput) => Promise<void>;
  setRoomTypeCount: (roomType: string, count: number, floorId?: string | null) => Promise<void>;
  updateRoom: (roomId: string, patch: BuildingRoomInput) => Promise<void>;
  removeRoom: (roomId: string) => Promise<void>;
  confirmObject: () => Promise<void>;
  reopenObject: () => Promise<void>;
  saveSystemsConfiguration: (patch: Record<string, unknown>) => Promise<void>;
  applySuggestedSystems: (requestedServices: Array<'heating' | 'cooling'>, selectedFamilyIds?: string[]) => Promise<void>;
  confirmSystemsConfiguration: () => Promise<void>;
  fetchLoadState: () => Promise<void>;
  calculateLoads: (mode: BuildingLoadMode) => Promise<void>;
  setStep: (step: Step) => void;
  startNewProject: () => void;
}

export const useBuildingProjectStore = create<BuildingProjectStore>((set, get) => ({
  project: null,
  catalog: null,
  systemsCatalog: null,
  loadState: null,
  step: 'object',
  isLoading: false,
  error: null,
  hydrated: false,
  loadFailed: false,

  loadCatalogs: async () => {
    if (get().catalog && get().systemsCatalog) return;
    try {
      const [catalog, systemsCatalog] = await Promise.all([
        get().catalog ? Promise.resolve(get().catalog) : api.getBuildingCatalog(),
        get().systemsCatalog ? Promise.resolve(get().systemsCatalog) : api.getBuildingSystemsCatalog(),
      ]);
      set({ catalog, systemsCatalog });
    } catch {
      set({ catalog: get().catalog, systemsCatalog: get().systemsCatalog });
    }
  },

  hydrateFromStorage: async () => {
    await get().loadCatalogs();
    const id = readActiveId();
    if (!id) {
      set({ hydrated: true });
      return;
    }
    if (get().project?.id === id) {
      set({ hydrated: true });
      return;
    }
    set({ isLoading: true, error: null, hydrated: false });
    try {
      const project = await api.getBuildingProject(id);
      const preferred = readSavedStep();
      const step = resolveStep(project, preferred);
      writeActiveId(project.id);
      writeSavedStep(step);
      set({ project, step, loadState: null, isLoading: false, hydrated: true, error: null, loadFailed: false });
    } catch (err: any) {
      if (errCode(err) === 'building.not_found') {
        // The project really no longer exists: start clean.
        writeActiveId(null);
        writeSavedStep('object');
        set({ project: null, step: 'object', isLoading: false, hydrated: true, error: null, loadFailed: false });
        return;
      }
      // Transient failure: never forget which project the user had open.
      set({ project: null, isLoading: false, hydrated: true, error: null, loadFailed: true });
    }
  },

  createProject: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const project = await api.createBuildingProject(input);
      writeActiveId(project.id);
      writeSavedStep('rooms');
      set({ project, step: 'rooms', isLoading: false, hydrated: true });
    } catch (err: any) {
      set({ error: errMessage(err, 'create failed'), isLoading: false });
    }
  },

  updateMeta: async (patch) => {
    const id = get().project?.id;
    if (!id) return;
    set({ isLoading: true, error: null });
    try {
      const project = await api.updateBuildingProject(id, patch);
      writeActiveId(id);
      set({ project, step: resolveStep(project, get().step), isLoading: false });
    } catch (err: any) {
      set({ error: errMessage(err, 'update failed'), isLoading: false });
    }
  },

  addRoom: async (room) => {
    const id = get().project?.id;
    if (!id) return;
    set({ isLoading: true, error: null });
    try {
      const project = await api.addBuildingRoom(id, room);
      writeActiveId(id);
      set({ project, step: resolveStep(project, get().step), isLoading: false });
    } catch (err: any) {
      set({ error: errMessage(err, 'add room failed'), isLoading: false });
    }
  },

  setRoomTypeCount: async (roomType, count, floorId) => {
    const id = get().project?.id;
    if (!id) return;
    set({ isLoading: true, error: null });
    try {
      const project = await api.setBuildingRoomTypeCount(id, roomType, count, floorId);
      writeActiveId(id);
      set({ project, step: resolveStep(project, get().step), isLoading: false });
    } catch (err: any) {
      set({ error: errMessage(err, 'update rooms failed'), isLoading: false });
    }
  },

  updateRoom: async (roomId, patch) => {
    const id = get().project?.id;
    if (!id) return;

    // Air controls must acknowledge the tap immediately. The API remains the
    // persistence authority, but the store applies the exact sparse scalar
    // patch optimistically and serializes requests for this room. Only the
    // newest response may replace project state; older responses are stale.
    if (patch.air !== undefined) {
      const before = get().project;
      if (!before) return;
      const key = `${id}:${roomId}`;
      const version = (roomAirUpdateVersions.get(key) ?? 0) + 1;
      roomAirUpdateVersions.set(key, version);
      set({
        project: withOptimisticRoomAir(before, roomId, patch.air),
        isLoading: true,
        error: null,
      });

      const previous = roomAirUpdateQueues.get(key) ?? Promise.resolve();
      const job = previous.catch(() => undefined).then(async () => {
        try {
          const project = await api.updateBuildingRoom(id, roomId, patch);
          writeActiveId(id);
          if (roomAirUpdateVersions.get(key) === version) {
            set({ project, step: resolveStep(project, get().step), isLoading: false });
          }
        } catch (err: any) {
          if (roomAirUpdateVersions.get(key) === version) {
            set({ project: before, error: errMessage(err, 'update room failed'), isLoading: false });
          }
        } finally {
          if (roomAirUpdateVersions.get(key) === version) {
            roomAirUpdateQueues.delete(key);
            roomAirUpdateVersions.delete(key);
          }
        }
      });
      roomAirUpdateQueues.set(key, job);
      await job;
      return;
    }

    set({ isLoading: true, error: null });
    const job = roomUpdateQueue.catch(() => undefined).then(async () => {
      try {
        const project = await api.updateBuildingRoom(id, roomId, patch);
        writeActiveId(id);
        if (get().project?.id === id) set({ project, step: resolveStep(project, get().step), isLoading: false });
      } catch (err: any) {
        set({ error: errMessage(err, 'update room failed'), isLoading: false });
      }
    });
    roomUpdateQueue = job;
    await job;
  },

  removeRoom: async (roomId) => {
    const id = get().project?.id;
    if (!id) return;
    set({ isLoading: true, error: null });
    try {
      const project = await api.removeBuildingRoom(id, roomId);
      writeActiveId(id);
      set({ project, step: resolveStep(project, get().step), isLoading: false });
    } catch (err: any) {
      set({ error: errMessage(err, 'remove room failed'), isLoading: false });
    }
  },

  confirmObject: async () => {
    const id = get().project?.id;
    if (!id) return;
    set({ isLoading: true, error: null });
    try {
      const project = await api.confirmBuildingObject(id);
      writeActiveId(id);
      writeSavedStep('systems');
      set({ project, step: 'systems', isLoading: false });
    } catch (err: any) {
      set({ error: errMessage(err, 'confirm failed'), isLoading: false });
    }
  },

  reopenObject: async () => {
    const id = get().project?.id;
    if (!id) return;
    set({ isLoading: true, error: null });
    try {
      const project = await api.reopenBuildingObject(id);
      writeActiveId(id);
      writeSavedStep('rooms');
      set({ project, step: 'rooms', isLoading: false });
    } catch (err: any) {
      set({ error: errMessage(err, 'reopen failed'), isLoading: false });
    }
  },

  saveSystemsConfiguration: async (patch) => {
    const id = get().project?.id;
    if (!id) return;
    set({ isLoading: true, error: null });
    try {
      const project = await api.updateSystemsConfiguration(id, patch);
      writeActiveId(id);
      const nextStep = resolveStep(project, 'systems');
      writeSavedStep(nextStep);
      set({ project, step: nextStep, isLoading: false });
    } catch (err: any) {
      set({ error: errMessage(err, 'save systems failed'), isLoading: false });
    }
  },

  applySuggestedSystems: async (requestedServices, selectedFamilyIds = []) => {
    const id = get().project?.id;
    if (!id) return;
    set({ isLoading: true, error: null });
    try {
      const project = await api.suggestSystemsConfiguration(id, {
        requestedServices,
        selectedFamilyIds,
        apply: true,
      }) as any;
      writeActiveId(id);
      writeSavedStep('systems');
      set({ project, step: 'systems', isLoading: false });
    } catch (err: any) {
      set({ error: errMessage(err, 'suggest systems failed'), isLoading: false });
    }
  },

  confirmSystemsConfiguration: async () => {
    const id = get().project?.id;
    if (!id) return;
    set({ isLoading: true, error: null });
    try {
      const project = await api.confirmSystemsConfiguration(id);
      writeActiveId(id);
      writeSavedStep('review');
      set({ project, step: 'review', loadState: null, isLoading: false });
    } catch (err: any) {
      set({ error: errMessage(err, 'confirm systems failed'), isLoading: false });
    }
  },

  fetchLoadState: async () => {
    const id = get().project?.id;
    if (!id) return;
    set({ isLoading: true, error: null });
    try {
      const loadState = await api.getBuildingLoadState(id);
      set({ loadState, isLoading: false });
    } catch (err: any) {
      set({ error: errMessage(err, 'load state failed'), isLoading: false });
    }
  },

  calculateLoads: async (mode) => {
    const id = get().project?.id;
    if (!id) return;
    set({ isLoading: true, error: null });
    try {
      const project = await api.calculateBuildingLoads(id, mode);
      writeActiveId(id);
      writeSavedStep('loads');
      const loadState = await api.getBuildingLoadState(id);
      set({ project, loadState, step: 'loads', isLoading: false });
    } catch (err: any) {
      set({ error: errMessage(err, 'load calculation failed'), isLoading: false });
    }
  },

  setStep: (step) => {
    const project = get().project;
    const next = project ? resolveStep(project, step) : 'object';
    writeSavedStep(next);
    set({ step: next });
  },

  startNewProject: () => {
    writeActiveId(null);
    writeSavedStep('object');
    set({ project: null, step: 'object', loadState: null, error: null, isLoading: false, hydrated: true, loadFailed: false });
  },
}));

export const buildingProjectPersistKeys = { DRAFT_KEY, STEP_KEY };
