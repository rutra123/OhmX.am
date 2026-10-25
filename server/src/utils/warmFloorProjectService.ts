/**
 * Multi-room warm-floor project service: draft lifecycle, recompute, confirm.
 * Persistence is isolated JSON files under data/warm-floor-projects (not production DB).
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataRoot } from '../paths.js';
import { calculateRoomEngineering, aggregateEngineeringStatus } from './warmFloorRoomEngineering.js';
import { applySelectionToEngineering, selectRoomEquipment } from './warmFloorRoomSelection.js';
import { buildRoomSpecification, consolidateBom } from './warmFloorSpecification.js';
import { buildEstimate } from './warmFloorEstimate.js';
import type {
  CreateProjectInput,
  EngineeringStatus,
  RoomInput,
  WarmFloorProject,
} from './warmFloorProjectTypes.js';

const STORE_DIR = path.join(dataRoot, 'warm-floor-projects');

function ensureStore() {
  fs.mkdirSync(STORE_DIR, { recursive: true });
}

function projectPath(id: string) {
  return path.join(STORE_DIR, `${id}.json`);
}

function nowIso() {
  return new Date().toISOString();
}

export function defaultRoom(partial: Partial<RoomInput> = {}): RoomInput {
  return {
    id: partial.id || randomUUID(),
    name: partial.name || 'Room',
    roomType: partial.roomType || 'other',
    roomAreaM2: Number(partial.roomAreaM2 || 0),
    installationAreaM2: Number(partial.installationAreaM2 || 0),
    excludedAreaM2: partial.excludedAreaM2,
    heatingPurpose: partial.heatingPurpose || 'comfort_floor',
    floorCovering: partial.floorCovering || 'tile',
    substrateType: partial.substrateType || 'concrete_screed',
    insulationLevel: partial.insulationLevel || 'standard',
    systemPreference: partial.systemPreference || 'auto',
    wetZone: partial.wetZone,
    heatLossW: partial.heatLossW ?? null,
    preferredBrands: partial.preferredBrands || [],
    budgetLevel: partial.budgetLevel || 'premium',
    includeAccessories: partial.includeAccessories !== false,
    regionProfile: partial.regionProfile,
    notes: partial.notes,
    lockedVariantRole: partial.lockedVariantRole ?? null,
    controlZones: partial.controlZones != null ? Math.max(1, Number(partial.controlZones)) : 1,
  };
}

export function createProject(input: CreateProjectInput = {}): WarmFloorProject {
  ensureStore();
  const objectTotal = input.objectTotalAreaM2 == null || input.objectTotalAreaM2 === ('' as any)
    ? null
    : Number(input.objectTotalAreaM2);
  const project: WarmFloorProject = {
    id: randomUUID(),
    name: input.name?.trim() || 'Warm floor project',
    status: 'draft',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    confirmedAt: null,
    regionProfile: input.regionProfile || 'AM',
    preferredBundleRole: input.preferredBundleRole || 'premium',
    objectType: input.objectType ?? null,
    objectTotalAreaM2: Number.isFinite(objectTotal as number) && (objectTotal as number) > 0 ? objectTotal : null,
    rooms: (input.rooms || []).map((r) => defaultRoom({ ...r, regionProfile: r.regionProfile || input.regionProfile || 'AM' })),
    draftResult: null,
    confirmedSnapshot: null,
  };
  saveProject(project);
  return project;
}

export function listProjects(): Array<Pick<WarmFloorProject, 'id' | 'name' | 'status' | 'updatedAt' | 'confirmedAt' | 'rooms'>> {
  ensureStore();
  return fs.readdirSync(STORE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const p = loadProject(f.replace(/\.json$/, ''));
      if (!p) return null;
      return {
        id: p.id,
        name: p.name,
        status: p.status,
        updatedAt: p.updatedAt,
        confirmedAt: p.confirmedAt,
        rooms: p.rooms.map((r) => ({ id: r.id, name: r.name, roomType: r.roomType } as any)),
      };
    })
    .filter(Boolean) as any[];
}

export function loadProject(id: string): WarmFloorProject | null {
  ensureStore();
  const file = projectPath(id);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8')) as WarmFloorProject;
}

export function saveProject(project: WarmFloorProject) {
  ensureStore();
  const tmp = `${projectPath(project.id)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(project, null, 2));
  fs.renameSync(tmp, projectPath(project.id));
}

export function deleteProject(id: string): boolean {
  const file = projectPath(id);
  if (!fs.existsSync(file)) return false;
  fs.unlinkSync(file);
  return true;
}

function assertDraft(project: WarmFloorProject) {
  if (project.status === 'confirmed') {
    const err = new Error('Project is confirmed and immutable. Create a new draft to change parameters.');
    (err as any).code = 'project.confirmed_immutable';
    throw err;
  }
}

export function addRoom(projectId: string, room: Partial<RoomInput>): WarmFloorProject {
  const project = mustLoad(projectId);
  assertDraft(project);
  project.rooms.push(defaultRoom({
    ...room,
    regionProfile: room.regionProfile || project.regionProfile,
  }));
  project.updatedAt = nowIso();
  project.draftResult = null;
  saveProject(project);
  return project;
}

export function updateRoom(projectId: string, roomId: string, patch: Partial<RoomInput>): WarmFloorProject {
  const project = mustLoad(projectId);
  assertDraft(project);
  const idx = project.rooms.findIndex((r) => r.id === roomId);
  if (idx < 0) {
    const err = new Error('Room not found');
    (err as any).code = 'project.room_not_found';
    throw err;
  }
  project.rooms[idx] = defaultRoom({
    ...project.rooms[idx],
    ...patch,
    id: roomId,
    regionProfile: patch.regionProfile || project.rooms[idx].regionProfile || project.regionProfile,
  });
  project.updatedAt = nowIso();
  project.draftResult = null;
  saveProject(project);
  return project;
}

export function removeRoom(projectId: string, roomId: string): WarmFloorProject {
  const project = mustLoad(projectId);
  assertDraft(project);
  project.rooms = project.rooms.filter((r) => r.id !== roomId);
  project.updatedAt = nowIso();
  project.draftResult = null;
  saveProject(project);
  return project;
}

export function setPreferredBundleRole(projectId: string, role: string): WarmFloorProject {
  const project = mustLoad(projectId);
  assertDraft(project);
  project.preferredBundleRole = role;
  project.updatedAt = nowIso();
  project.draftResult = null;
  saveProject(project);
  return project;
}

export function updateProjectMeta(
  projectId: string,
  patch: {
    name?: string;
    objectType?: string | null;
    objectTotalAreaM2?: number | null;
    preferredBundleRole?: string;
  },
): WarmFloorProject {
  const project = mustLoad(projectId);
  // Confirmed projects keep object meta frozen via snapshot; allow only name display? Prefer immutable.
  if (project.status === 'confirmed') {
    if (patch.name != null && String(patch.name).trim()) {
      project.name = String(patch.name).trim();
      project.updatedAt = nowIso();
      saveProject(project);
      return project;
    }
    const err = new Error('Project is confirmed and immutable. Create a new draft to change parameters.');
    (err as any).code = 'project.confirmed_immutable';
    throw err;
  }
  if (patch.name != null && String(patch.name).trim()) {
    project.name = String(patch.name).trim();
  }
  if (patch.objectType !== undefined) {
    project.objectType = patch.objectType || null;
  }
  if (patch.objectTotalAreaM2 !== undefined) {
    const n = patch.objectTotalAreaM2 == null || patch.objectTotalAreaM2 === ('' as any)
      ? null
      : Number(patch.objectTotalAreaM2);
    project.objectTotalAreaM2 = n != null && Number.isFinite(n) && n > 0 ? n : null;
  }
  if (patch.preferredBundleRole != null) {
    project.preferredBundleRole = patch.preferredBundleRole;
    project.draftResult = null;
  }
  project.updatedAt = nowIso();
  saveProject(project);
  return project;
}

export function lockRoomVariant(
  projectId: string,
  roomId: string,
  role: string | null,
): WarmFloorProject {
  return updateRoom(projectId, roomId, { lockedVariantRole: role });
}

function mustLoad(id: string): WarmFloorProject {
  const project = loadProject(id);
  if (!project) {
    const err = new Error('Project not found');
    (err as any).code = 'project.not_found';
    throw err;
  }
  return project;
}

export function computeProject(
  project: WarmFloorProject,
  options: { products?: any[]; roomId?: string } = {},
): WarmFloorProject {
  const rooms = options.roomId
    ? project.rooms.filter((r) => r.id === options.roomId)
    : project.rooms;

  // If partial room recompute, merge into previous draft rooms
  const previousById = new Map((project.draftResult?.rooms || []).map((r) => [r.room.id, r]));
  const computedRooms = (options.roomId ? project.rooms : rooms).map((room) => {
    if (options.roomId && room.id !== options.roomId && previousById.has(room.id)) {
      return previousById.get(room.id)!;
    }
    let engineering = calculateRoomEngineering({
      ...room,
      regionProfile: room.regionProfile || project.regionProfile,
    });
    const selection = selectRoomEquipment(room, engineering, {
      preferredBundleRole: project.preferredBundleRole,
      products: options.products,
      lockedVariantRole: room.lockedVariantRole,
      controlZones: room.controlZones,
    });
    engineering = applySelectionToEngineering(engineering, selection);
    const roomSpecification = buildRoomSpecification(room, selection);
    return { room, engineering, selection, roomSpecification };
  });

  const specificationByRoom = computedRooms.flatMap((r) => r.roomSpecification);
  const consolidatedBom = consolidateBom(specificationByRoom);
  const estimatePreview = buildEstimate(consolidatedBom);
  const overallStatus = aggregateEngineeringStatus(
    computedRooms.map((r) => aggregateEngineeringStatus([r.engineering.status, r.selection.status])),
  ) as EngineeringStatus;

  project.draftResult = {
    computedAt: nowIso(),
    overallStatus,
    rooms: computedRooms,
    specificationByRoom,
    consolidatedBom,
    estimatePreview,
  };
  project.updatedAt = nowIso();
  return project;
}

export function recalculateProject(projectId: string, options: { products?: any[]; roomId?: string } = {}): WarmFloorProject {
  const project = mustLoad(projectId);
  assertDraft(project);
  const next = computeProject(project, options);
  saveProject(next);
  return next;
}

/**
 * Confirm locks the currently computed draft into an immutable snapshot.
 * Requires a computed draft and refuses hard BLOCKED overall status.
 */
export function confirmProject(projectId: string): WarmFloorProject {
  const project = mustLoad(projectId);
  assertDraft(project);

  if (!project.draftResult) {
    computeProject(project);
  }
  if (!project.draftResult) {
    const err = new Error('Nothing to confirm');
    (err as any).code = 'project.empty';
    throw err;
  }
  if (!project.rooms.length) {
    const err = new Error('Add at least one room before confirm');
    (err as any).code = 'project.no_rooms';
    throw err;
  }
  if (project.draftResult.overallStatus === 'BLOCKED') {
    const err = new Error('Cannot confirm a BLOCKED project. Resolve engineering/selection issues first.');
    (err as any).code = 'project.blocked';
    (err as any).details = {
      overallStatus: project.draftResult.overallStatus,
      rooms: project.draftResult.rooms.map((r) => ({
        roomId: r.room.id,
        name: r.room.name,
        engineeringStatus: r.engineering.status,
        selectionStatus: r.selection.status,
        issues: [...r.engineering.issues, ...r.selection.issues].filter((i) => i.severity === 'block'),
      })),
    };
    throw err;
  }

  const confirmedAt = nowIso();
  project.status = 'confirmed';
  project.confirmedAt = confirmedAt;
  project.confirmedSnapshot = {
    confirmedAt,
    overallStatus: project.draftResult.overallStatus,
    rooms: structuredClone(project.draftResult.rooms),
    specificationByRoom: structuredClone(project.draftResult.specificationByRoom),
    consolidatedBom: structuredClone(project.draftResult.consolidatedBom),
    estimate: structuredClone(project.draftResult.estimatePreview),
    roomInputs: structuredClone(project.rooms),
    preferredBundleRole: project.preferredBundleRole,
    objectType: project.objectType ?? null,
    objectTotalAreaM2: project.objectTotalAreaM2 ?? null,
  };
  project.updatedAt = confirmedAt;
  saveProject(project);
  return project;
}

export function getProjectView(projectId: string) {
  const project = mustLoad(projectId);
  if (project.status === 'confirmed' && project.confirmedSnapshot) {
    return {
      id: project.id,
      name: project.name,
      status: project.status,
      confirmedAt: project.confirmedAt,
      objectType: project.confirmedSnapshot.objectType ?? project.objectType ?? null,
      objectTotalAreaM2: project.confirmedSnapshot.objectTotalAreaM2 ?? project.objectTotalAreaM2 ?? null,
      overallStatus: project.confirmedSnapshot.overallStatus,
      rooms: project.confirmedSnapshot.rooms,
      specificationByRoom: project.confirmedSnapshot.specificationByRoom,
      consolidatedBom: project.confirmedSnapshot.consolidatedBom,
      estimate: project.confirmedSnapshot.estimate,
      preferredBundleRole: project.confirmedSnapshot.preferredBundleRole,
      immutable: true,
    };
  }
  return {
    id: project.id,
    name: project.name,
    status: project.status,
    confirmedAt: null,
    objectType: project.objectType ?? null,
    objectTotalAreaM2: project.objectTotalAreaM2 ?? null,
    overallStatus: project.draftResult?.overallStatus || null,
    rooms: project.draftResult?.rooms || project.rooms.map((room) => ({ room })),
    specificationByRoom: project.draftResult?.specificationByRoom || [],
    consolidatedBom: project.draftResult?.consolidatedBom || [],
    estimate: project.draftResult?.estimatePreview || null,
    preferredBundleRole: project.preferredBundleRole,
    immutable: false,
    draftComputedAt: project.draftResult?.computedAt || null,
  };
}
