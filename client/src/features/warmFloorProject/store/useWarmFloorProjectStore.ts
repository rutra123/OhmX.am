import { create } from 'zustand';
import type { ProjectRoomInput, WarmFloorProjectDto } from '../types/project';
import * as api from '../services/projectApi';

type Step =
  | 'project'
  | 'rooms'
  | 'calculate'
  | 'preview'
  | 'confirm'
  | 'specification'
  | 'estimate';

const DRAFT_KEY = 'ohmx:warm-floor-project:active-id';
const STEP_KEY = 'ohmx:warm-floor-project:step';
const PERSIST_VERSION = 1;

function errMessage(err: any, fallback: string) {
  const raw = err?.message || '';
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error) return String(parsed.error);
    if (parsed?.code) return `${parsed.code}: ${parsed.error || fallback}`;
  } catch {
    // plain text
  }
  return raw || fallback;
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
    // ignore quota
  }
}

function readSavedStep(): Step | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STEP_KEY);
    if (!raw) return null;
    const allowed: Step[] = ['project', 'rooms', 'calculate', 'preview', 'confirm', 'specification', 'estimate'];
    return (allowed.includes(raw as Step) ? raw : null) as Step | null;
  } catch {
    return null;
  }
}

function writeSavedStep(step: Step) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STEP_KEY, step);
    window.localStorage.setItem(`${STEP_KEY}:v`, String(PERSIST_VERSION));
  } catch {
    // ignore
  }
}

function resolveStep(project: WarmFloorProjectDto, preferred?: Step | null): Step {
  if (project.status === 'confirmed') {
    if (preferred === 'estimate' || preferred === 'specification' || preferred === 'preview' || preferred === 'confirm') {
      return preferred;
    }
    return 'specification';
  }
  if (preferred && preferred !== 'project') {
    if (preferred === 'specification' || preferred === 'estimate' || preferred === 'confirm' || preferred === 'preview') {
      return project.draftResult ? preferred : (project.rooms?.length ? 'rooms' : 'rooms');
    }
    if (preferred === 'rooms' || preferred === 'calculate') return preferred;
  }
  if (project.draftResult) return 'preview';
  if (project.rooms?.length) return 'rooms';
  return 'rooms';
}

interface WarmFloorProjectStore {
  project: WarmFloorProjectDto | null;
  view: any | null;
  step: Step;
  isLoading: boolean;
  error: string | null;
  hydrated: boolean;
  hydrateFromStorage: () => Promise<void>;
  createProject: (name?: string, meta?: { objectType?: string; objectTotalAreaM2?: number | null }) => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  updateProjectMeta: (patch: { name?: string; objectType?: string | null; objectTotalAreaM2?: number | null }) => Promise<void>;
  addRoom: (room: ProjectRoomInput) => Promise<void>;
  updateRoom: (roomId: string, patch: Partial<ProjectRoomInput>) => Promise<void>;
  removeRoom: (roomId: string) => Promise<void>;
  setPreferredRole: (role: string) => Promise<void>;
  recalculate: (roomId?: string) => Promise<void>;
  confirm: () => Promise<void>;
  setStep: (step: Step) => void;
  /** Clear local selection only — does not delete backend project. */
  clearLocalSelection: () => void;
  /** Start fresh: drop active id and show create screen. Backend project stays until deleted. */
  startNewProject: () => void;
  reset: () => void;
}

export const useWarmFloorProjectStore = create<WarmFloorProjectStore>((set, get) => ({
  project: null,
  view: null,
  step: 'project',
  isLoading: false,
  error: null,
  hydrated: false,

  hydrateFromStorage: async () => {
    const id = readActiveId();
    if (!id) {
      // Keep in-memory project only if it matches nothing cleared intentionally
      if (!get().project) {
        set({ hydrated: true, step: get().step === 'project' ? 'project' : 'project' });
      } else {
        set({ hydrated: true });
      }
      return;
    }
    // Already loaded the same backend project (SPA navigation without full reload)
    if (get().project?.id === id) {
      set({ hydrated: true });
      return;
    }
    set({ isLoading: true, error: null, hydrated: false });
    try {
      const project = await api.getWarmFloorProject(id);
      let view: any = null;
      try {
        view = await api.getWarmFloorProjectView(id);
      } catch {
        view = null;
      }
      const step = resolveStep(project, readSavedStep());
      writeActiveId(project.id);
      writeSavedStep(step);
      set({ project, view, step, isLoading: false, hydrated: true, error: null });
    } catch (err: any) {
      // Stale id — clear and show create/continue screen
      writeActiveId(null);
      set({
        project: null,
        view: null,
        step: 'project',
        isLoading: false,
        hydrated: true,
        error: null,
      });
    }
  },

  createProject: async (name, meta) => {
    set({ isLoading: true, error: null });
    try {
      const project = await api.createWarmFloorProject({
        name: name || 'Новый проект тёплого пола',
        preferredBundleRole: 'premium',
        objectType: meta?.objectType,
        objectTotalAreaM2: meta?.objectTotalAreaM2 ?? null,
      });
      writeActiveId(project.id);
      writeSavedStep('rooms');
      set({ project, view: null, step: 'rooms', isLoading: false, hydrated: true });
    } catch (err: any) {
      set({ error: errMessage(err, 'create failed'), isLoading: false });
    }
  },

  loadProject: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const project = await api.getWarmFloorProject(id);
      let view: any = null;
      try {
        view = await api.getWarmFloorProjectView(id);
      } catch {
        view = null;
      }
      const step = resolveStep(project, readSavedStep());
      writeActiveId(project.id);
      writeSavedStep(step);
      set({ project, view, step, isLoading: false, hydrated: true });
    } catch (err: any) {
      set({ error: errMessage(err, 'load failed'), isLoading: false, hydrated: true });
    }
  },

  updateProjectMeta: async (patch) => {
    const id = get().project?.id;
    if (!id) return;
    set({ isLoading: true, error: null });
    try {
      const project = await api.updateWarmFloorProjectMeta(id, patch);
      set({ project, isLoading: false });
    } catch (err: any) {
      set({ error: errMessage(err, 'meta update failed'), isLoading: false });
    }
  },

  addRoom: async (room) => {
    const id = get().project?.id;
    if (!id) return;
    set({ isLoading: true, error: null });
    try {
      const project = await api.addWarmFloorRoom(id, room);
      writeActiveId(id);
      set({ project, isLoading: false });
    } catch (err: any) {
      set({ error: errMessage(err, 'add room failed'), isLoading: false });
    }
  },

  updateRoom: async (roomId, patch) => {
    const id = get().project?.id;
    if (!id) return;
    set({ isLoading: true, error: null });
    try {
      const project = await api.updateWarmFloorRoom(id, roomId, patch);
      writeActiveId(id);
      set({ project, isLoading: false });
    } catch (err: any) {
      set({ error: errMessage(err, 'update room failed'), isLoading: false });
    }
  },

  removeRoom: async (roomId) => {
    const id = get().project?.id;
    if (!id) return;
    set({ isLoading: true, error: null });
    try {
      const project = await api.removeWarmFloorRoom(id, roomId);
      writeActiveId(id);
      set({ project, isLoading: false });
    } catch (err: any) {
      set({ error: errMessage(err, 'remove room failed'), isLoading: false });
    }
  },

  setPreferredRole: async (role) => {
    const id = get().project?.id;
    if (!id) return;
    set({ isLoading: true, error: null });
    try {
      const project = await api.setWarmFloorPreferredRole(id, role);
      writeActiveId(id);
      set({ project, isLoading: false });
    } catch (err: any) {
      set({ error: errMessage(err, 'role failed'), isLoading: false });
    }
  },

  recalculate: async (roomId) => {
    const id = get().project?.id;
    if (!id) return;
    set({ isLoading: true, error: null });
    try {
      const project = await api.recalculateWarmFloorProject(id, roomId);
      const view = await api.getWarmFloorProjectView(id);
      writeActiveId(id);
      writeSavedStep('preview');
      set({ project, view, step: 'preview', isLoading: false });
    } catch (err: any) {
      set({ error: errMessage(err, 'recalculate failed'), isLoading: false });
    }
  },

  confirm: async () => {
    const id = get().project?.id;
    if (!id) return;
    set({ isLoading: true, error: null });
    try {
      const project = await api.confirmWarmFloorProject(id);
      const view = await api.getWarmFloorProjectView(id);
      writeActiveId(id);
      writeSavedStep('specification');
      set({ project, view, step: 'specification', isLoading: false });
    } catch (err: any) {
      set({ error: errMessage(err, 'confirm failed'), isLoading: false });
    }
  },

  setStep: (step) => {
    writeSavedStep(step);
    set({ step });
  },

  clearLocalSelection: () => {
    writeActiveId(null);
    set({ project: null, view: null, step: 'project', error: null, isLoading: false, hydrated: true });
  },

  startNewProject: () => {
    writeActiveId(null);
    writeSavedStep('project');
    set({ project: null, view: null, step: 'project', error: null, isLoading: false, hydrated: true });
  },

  reset: () => {
    writeActiveId(null);
    writeSavedStep('project');
    set({ project: null, view: null, step: 'project', error: null, isLoading: false, hydrated: true });
  },
}));

export const warmFloorProjectPersistKeys = { DRAFT_KEY, STEP_KEY, PERSIST_VERSION };
