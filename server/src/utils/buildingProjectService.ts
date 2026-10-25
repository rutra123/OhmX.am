/**
 * Building Project Phase 1 + Phase 2 service.
 * JSON persistence under data/building-projects — not electro.db, not warm-floor-projects.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { dataRoot } from '../paths.js';
import {
  defaultProjectName,
  getBuildingProjectCatalog,
  insulationLabel,
  objectTypeLabel,
  regionLabel,
  REGIONS,
  ROOM_CONDITIONS,
  ROOM_TYPES,
  WINDOW_TYPES,
  FLOOR_POSITIONS,
  suggestRoomName,
  WET_ROOM_TYPES,
  type InsulationLevel,
  type ObjectType,
} from './buildingProjectCatalog.js';
import {
  applyBulkRoomAssignments,
  buildSuggestedSystemsConfiguration,
  confirmErrorForBlocker,
  createDefaultSystemsConfiguration,
  expandRequestedServices,
  getBuildingProjectSystemsCatalog,
  isSystemsConfigurationStale,
  markSystemsConfigurationStale,
  normalizeSystemsConfiguration,
  suggestionFamilyIdsForPreview,
  validateSystemsConfigurationForConfirmation,
} from './buildingProjectSystems.js';
import {
  checkLoadPrerequisites,
  computeBuildingLoads,
  getLoadMethodStatus,
  isLoadStale,
} from './buildingProjectLoads.js';
import {
  physicalCompletenessBlocksMode,
  projectPhysicalCompleteness,
} from './buildingProjectPhysicalCompleteness.js';
import type {
  AirtightnessClass,
  BasementType,
  BuildingProject,
  BuildingProjectSnapshot,
  BuildingRegion,
  BuildingRoom,
  BuildingRoomInput,
  BuildingSystemArchitectureInput,
  BuildingSystemService,
  BuildingTopology,
  ConstructionTier,
  CreateBuildingProjectInput,
  EngineeringSystemConfiguration,
  EngineeringSystemFamilySelection,
  EnvelopeElement,
  Floor,
  OccupancyInputSource,
  PlantLocationInput,
  PlantLocationKind,
  RoomAir,
  RoomEnvelope,
  RoomEnvelopePatch,
  RoomExtras,
  RoomInternalGains,
  ShadingProfile,
  SystemsBulkTarget,
  TopBoundaryType,
  UpdateBuildingProjectInput,
  UValueSource,
  VentilationBalance,
  WindowOrientation,
} from './buildingProjectTypes.js';

const STORE_DIR = path.join(dataRoot, 'building-projects');
const OBJECT_TYPES = new Set<ObjectType>(['apartment', 'private_house', 'commercial']);
const INSULATION = new Set<InsulationLevel>(['good', 'medium', 'poor', 'unknown']);
const BASEMENT_TYPES = new Set<BasementType>(['none', 'heated', 'unheated']);
const TOP_BOUNDARY_TYPES = new Set<TopBoundaryType>(['direct_roof', 'unheated_attic']);
const PLANT_KINDS = new Set<PlantLocationKind>(['room', 'floor', 'external', 'not_defined']);
const ROOM_TYPE_SET = new Set(ROOM_TYPES.map((t) => t.value));
const CONDITION_SET = new Set(ROOM_CONDITIONS.map((c) => c.value));

function ensureStore() {
  fs.mkdirSync(STORE_DIR, { recursive: true });
}

function projectPath(id: string) {
  return path.join(STORE_DIR, `${id}.json`);
}

function nowIso() {
  return new Date().toISOString();
}

export class BuildingProjectError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function fail(code: string, message: string, details?: unknown): never {
  throw new BuildingProjectError(code, message, details);
}

function normalizeStatus(value: unknown): BuildingProject['status'] {
  const allowed: BuildingProject['status'][] = ['draft', 'object_confirmed', 'systems_configured', 'calculated', 'confirmed'];
  const raw = String(value || 'draft');
  return allowed.includes(raw as BuildingProject['status']) ? (raw as BuildingProject['status']) : 'draft';
}

function resolveRegion(code?: string | null): BuildingRegion | null {
  if (!code) return null;
  const found = REGIONS.find((r) => r.value === code);
  if (!found) fail('building.invalid_region', `Unknown region: ${code}`);
  return { code: found.value, name: found.label };
}

function normalizeObjectType(value: unknown, fallback: ObjectType = 'private_house'): ObjectType {
  const v = String(value || fallback) as ObjectType;
  if (!OBJECT_TYPES.has(v)) fail('building.invalid_object_type', `Unknown object type: ${value}`);
  return v;
}

function normalizeInsulation(value: unknown, fallback: InsulationLevel = 'unknown'): InsulationLevel {
  const v = String(value || fallback) as InsulationLevel;
  if (!INSULATION.has(v)) fail('building.invalid_insulation', `Unknown insulation: ${value}`);
  return v;
}

// ---------- Phase 2.6 topology helpers ----------

function normalizeFloorCount(value: unknown, fallback = 1): number {
  const n = value == null || value === '' ? fallback : Number(value);
  if (!Number.isInteger(n) || n < 1) fail('building.invalid_floor_count', 'Floor count must be an integer >= 1');
  return n;
}

function floorLabel(level: number): string {
  return `Этаж ${level}`;
}

/** Stable deterministic floor ids (`floor-<level>`), so identity survives reloads. */
function buildFloors(floorCount: number): Floor[] {
  const floors: Floor[] = [];
  for (let level = 1; level <= floorCount; level += 1) {
    floors.push({ id: `floor-${level}`, level, label: floorLabel(level) });
  }
  return floors;
}

function normalizeFloor(raw: any): Floor | null {
  if (!raw || typeof raw !== 'object') return null;
  const level = Number(raw.level);
  if (!Number.isInteger(level) || level < 1) return null;
  const id = typeof raw.id === 'string' && raw.id.trim() ? String(raw.id).trim() : `floor-${level}`;
  return { id, level, label: typeof raw.label === 'string' && raw.label.trim() ? String(raw.label).trim() : floorLabel(level) };
}

function normalizePlantLocation(input: any, floors: Floor[], rooms: BuildingRoom[]): BuildingTopology['plantLocation'] {
  const kind: PlantLocationKind = input?.kind && PLANT_KINDS.has(input.kind) ? input.kind : 'not_defined';
  const floorId = typeof input?.floorId === 'string' && input.floorId && floors.some((f) => f.id === input.floorId)
    ? String(input.floorId)
    : null;
  const rawRoomId = typeof input?.roomId === 'string' && input.roomId ? String(input.roomId) : null;

  if (kind === 'external') return { kind: 'external', floorId: null, roomId: null };
  if (kind === 'not_defined') return { kind: 'not_defined', floorId: null, roomId: null };

  if (kind === 'room') {
    // In-progress reference (floor or room not chosen yet) degrades to a floor
    // fact so the UI can build the selection step by step. An EXPLICIT mismatch
    // (room exists but belongs to a different floor) is PRESERVED so that
    // update/confirm validation rejects it (building.plant_location_invalid)
    // instead of silently erasing the user's explicit intent.
    if (!floorId || !rawRoomId) return { kind: 'floor', floorId, roomId: null };
    const room = rooms.find((r) => r.id === rawRoomId);
    if (!room) return { kind: 'floor', floorId, roomId: null };
    return { kind: 'room', floorId, roomId: rawRoomId };
  }
  // kind === 'floor'
  return { kind: 'floor', floorId, roomId: null };
}

/** Strict validation for user-supplied plant location (update path) — throws on inconsistency. */
function validatePlantLocation(plant: BuildingTopology['plantLocation'], floors: Floor[], rooms: BuildingRoom[]) {
  if (plant.kind === 'room') {
    if (!plant.floorId || !plant.roomId) fail('building.plant_location_invalid', 'Помещение для оборудования требует этаж и комнату');
    if (!floors.some((f) => f.id === plant.floorId)) fail('building.plant_location_invalid', 'Указанный этаж не существует');
    const room = rooms.find((r) => r.id === plant.roomId);
    if (!room) fail('building.plant_location_invalid', 'Указанное помещение не найдено');
    if (room.floorId !== plant.floorId) fail('building.plant_location_invalid', 'Помещение не принадлежит указанному этажу');
  }
  if (plant.kind === 'floor' && plant.floorId && !floors.some((f) => f.id === plant.floorId)) {
    fail('building.plant_location_invalid', 'Указанный этаж не существует');
  }
}

/**
 * Normalize spatial topology for private_house. Returns null for other object types.
 * Legacy JSON without topology normalizes deterministically to floorCount = 1 (Floor 1).
 */
function normalizeTopology(
  raw: any,
  objectType: ObjectType,
  opts: {
    floorCount?: number;
    basementType?: BasementType;
    topBoundaryType?: TopBoundaryType;
    plantLocation?: PlantLocationInput;
    rooms?: BuildingRoom[];
  } = {},
): BuildingTopology | null {
  if (objectType !== 'private_house') return null;
  const floorCount = normalizeFloorCount(opts.floorCount ?? raw?.floorCount, 1);

  let floors: Floor[] = [];
  if (Array.isArray(raw?.floors) && raw.floors.length) {
    for (const f of raw.floors) {
      const nf = normalizeFloor(f);
      if (nf && !floors.some((x) => x.id === nf.id)) floors.push(nf);
    }
  }
  if (floors.length !== floorCount) {
    const existing = floors.filter((f) => f.level >= 1 && f.level <= floorCount);
    floors = existing.length === floorCount ? existing : buildFloors(floorCount);
  }

  const basementType: BasementType =
    opts.basementType && BASEMENT_TYPES.has(opts.basementType)
      ? opts.basementType
      : raw?.basementType && BASEMENT_TYPES.has(raw.basementType)
        ? raw.basementType
        : 'none';
  const topBoundaryType: TopBoundaryType =
    opts.topBoundaryType && TOP_BOUNDARY_TYPES.has(opts.topBoundaryType)
      ? opts.topBoundaryType
      : raw?.topBoundaryType && TOP_BOUNDARY_TYPES.has(raw.topBoundaryType)
        ? raw.topBoundaryType
        : 'direct_roof';

  const plantLocation = normalizePlantLocation(raw?.plantLocation || opts.plantLocation || null, floors, opts.rooms || []);
  return { floorCount, floors, basementType, topBoundaryType, plantLocation };
}

/**
 * Assign a floor to rooms of a private_house project. Only a MISSING floorId
 * (legacy pre-2.6 data) defaults to the first floor. An EXPLICIT floorId that
 * does not exist is preserved untouched: confirmation rejects it deterministically
 * (building.room_floor_invalid) instead of silently repairing invalid state —
 * legacy-absent and explicitly-invalid are different states and must not merge.
 */
function assignRoomFloors(project: BuildingProject) {
  if (!project.topology || !project.topology.floors.length) return;
  const firstFloorId = project.topology.floors[0].id;
  for (const room of project.rooms) {
    if (!room.floorId) room.floorId = firstFloorId;
  }
}

function optionalPositive(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) fail('building.invalid_area', 'Area must be a positive number');
  return n;
}

function requiredHeight(value: unknown, fallback = 2.7): number {
  const n = value == null || value === '' ? fallback : Number(value);
  if (!Number.isFinite(n) || n < 1.8 || n > 8) fail('building.invalid_height', 'Ceiling height must be between 1.8 and 8 m');
  return n;
}

function optionalNonNegativeNumber(value: unknown, code: string, message: string): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) fail(code, message);
  return n;
}

function optionalNonNegativeInteger(value: unknown, code: string, message: string): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) fail(code, message);
  return n;
}

function normalizeRoomExtras(partial?: BuildingRoomInput['extras']): RoomExtras {
  const conditions = Array.isArray(partial?.conditions)
    ? [...new Set(partial.conditions.filter((c) => CONDITION_SET.has(c)))]
    : [];
  const floorPositionRaw = partial?.geometry?.floorPosition ?? null;
  if (floorPositionRaw && !FLOOR_POSITIONS.some((item) => item.value === floorPositionRaw)) {
    fail('building.invalid_room_extras', `Unknown floor position: ${floorPositionRaw}`);
  }
  const glazingRaw = partial?.windows?.glazingType ?? null;
  if (glazingRaw && !WINDOW_TYPES.some((item) => item.value === glazingRaw)) {
    fail('building.invalid_room_extras', `Unknown glazing type: ${glazingRaw}`);
  }
  const insulationRaw = partial?.insulationOverride ?? null;
  if (insulationRaw && !INSULATION.has(insulationRaw as InsulationLevel)) {
    fail('building.invalid_room_extras', `Unknown insulation override: ${insulationRaw}`);
  }
  const ceilingHeightM = optionalNonNegativeNumber(
    partial?.geometry?.ceilingHeightM,
    'building.invalid_room_extras',
    'Ceiling height must be a finite number in a reasonable range',
  );
  if (ceilingHeightM != null && (ceilingHeightM < 1.5 || ceilingHeightM > 12)) {
    fail('building.invalid_room_extras', 'Ceiling height must be between 1.5 and 12 m');
  }
  const windowAreaM2 = optionalNonNegativeNumber(
    partial?.windows?.areaM2,
    'building.invalid_room_extras',
    'Window area must be a finite number >= 0',
  );
  return {
    geometry: {
      ceilingHeightM,
      externalWallCount: optionalNonNegativeInteger(
        partial?.geometry?.externalWallCount,
        'building.invalid_room_extras',
        'External wall count must be an integer >= 0',
      ),
      externalDoorCount: optionalNonNegativeInteger(
        partial?.geometry?.externalDoorCount,
        'building.invalid_room_extras',
        'External door count must be an integer >= 0',
      ),
      floorPosition: (floorPositionRaw as any) || null,
      spaceAbove: partial?.geometry?.spaceAbove || null,
      spaceBelow: partial?.geometry?.spaceBelow || null,
    },
    windows: {
      glazingType: (glazingRaw as any) || null,
      count: optionalNonNegativeInteger(
        partial?.windows?.count,
        'building.invalid_room_extras',
        'Window count must be an integer >= 0',
      ),
      areaM2: windowAreaM2,
    },
    insulationOverride: (insulationRaw as InsulationLevel) || null,
    conditions,
    notes: partial?.notes || null,
    engineeringUse: 'stored_only',
  };
}

const CONSTRUCTION_TIERS = new Set(['poor', 'average', 'good', 'high_performance']);
const U_VALUE_SOURCES = new Set(['certificate', 'construction_profile', 'legacy_insulation_seed', 'unknown']);
const WINDOW_ORIENTATIONS = new Set(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
const SHADING_PROFILES = new Set(['none', 'interior', 'exterior']);

/** Phase 3.2a — normalize one envelope element (permissive; drops invalid, never throws). */
function normalizeEnvelopeElement(raw: any): EnvelopeElement | null {
  if (!raw || typeof raw !== 'object') return null;
  const elementId = typeof raw.elementId === 'string' && raw.elementId.trim() ? String(raw.elementId).trim() : null;
  if (!elementId) return null;
  const num = (v: any): number | null => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  const tier = typeof raw.constructionTier === 'string' && CONSTRUCTION_TIERS.has(raw.constructionTier)
    ? (raw.constructionTier as ConstructionTier)
    : null;
  const src = typeof raw.uValueSource === 'string' && U_VALUE_SOURCES.has(raw.uValueSource)
    ? (raw.uValueSource as UValueSource)
    : null;
  const orientation = typeof raw.orientation === 'string' && WINDOW_ORIENTATIONS.has(raw.orientation)
    ? (raw.orientation as WindowOrientation)
    : null;
  const shadingProfile = typeof raw.shadingProfile === 'string' && SHADING_PROFILES.has(raw.shadingProfile)
    ? (raw.shadingProfile as ShadingProfile)
    : null;
  return {
    elementId,
    areaM2: num(raw.areaM2),
    widthM: num(raw.widthM),
    heightM: num(raw.heightM),
    grossAreaM2: num(raw.grossAreaM2),
    openingIds: Array.isArray(raw.openingIds)
      ? raw.openingIds.filter((x: any) => typeof x === 'string' && x.trim()).map((x: any) => String(x).trim())
      : null,
    count: num(raw.count),
    uValue: num(raw.uValue),
    constructionTier: tier,
    uValueSource: src,
    orientation,
    shgc: num(raw.shgc),
    shadingFactor: num(raw.shadingFactor),
    shadingProfile,
    source: typeof raw.source === 'string' ? String(raw.source) : null,
  };
}

/** Phase 3.2a — normalize a room envelope (null when empty/invalid). */
function normalizeEnvelope(raw: any): RoomEnvelope | null {
  if (!raw || typeof raw !== 'object') return null;
  const keys = ['wallElements', 'windowElements', 'doorElements', 'roofElements', 'floorElements'] as const;
  const out: RoomEnvelope = { wallElements: [], windowElements: [], doorElements: [], roofElements: [], floorElements: [] };
  let any = false;
  for (const key of keys) {
    if (Array.isArray(raw[key])) {
      for (const item of raw[key]) {
        const el = normalizeEnvelopeElement(item);
        if (el) {
          out[key].push(el);
          any = true;
        }
      }
    }
  }
  return any ? out : null;
}

const VENTILATION_BALANCES = new Set(['none', 'natural', 'balanced', 'supply_only', 'exhaust_only', 'unknown']);
const AIRTIGHTNESS_CLASSES = new Set(['poor', 'average', 'good', 'high']);
const OCCUPANCY_INPUT_SOURCES = new Set(['user_explicit', 'profile_default', 'missing']);

/** Phase 3.2b — normalize room air inputs (permissive; null when empty/invalid). */
function normalizeAir(raw: any): RoomAir | null {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v: any): number | null => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  const balance = typeof raw.ventilationBalance === 'string' && VENTILATION_BALANCES.has(raw.ventilationBalance)
    ? (raw.ventilationBalance as VentilationBalance)
    : null;
  const airClass = typeof raw.airtightnessClass === 'string' && AIRTIGHTNESS_CLASSES.has(raw.airtightnessClass)
    ? (raw.airtightnessClass as AirtightnessClass)
    : null;
  const ventilationFlowM3h = num(raw.ventilationFlowM3h);
  const infiltrationFlowM3h = num(raw.infiltrationFlowM3h);
  const airChangesPerHour = num(raw.airChangesPerHour);
  const ach50 = num(raw.ach50);
  const any = balance != null || ventilationFlowM3h != null || infiltrationFlowM3h != null || airChangesPerHour != null || ach50 != null || airClass != null;
  if (!any) return null;
  return { ventilationBalance: balance, ventilationFlowM3h, infiltrationFlowM3h, airChangesPerHour, ach50, airtightnessClass: airClass };
}

/** Phase 3.2c — normalize room internal-gain inputs (permissive; null when empty/invalid). */
function normalizeInternalGains(raw: any): RoomInternalGains | null {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v: any): number | null => (v == null || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  const occupancy = num(raw.occupancy);
  const occupancySource = typeof raw.occupancySource === 'string' && OCCUPANCY_INPUT_SOURCES.has(raw.occupancySource)
    ? (raw.occupancySource as OccupancyInputSource)
    : null;
  const occupantSensibleWPerPerson = num(raw.occupantSensibleWPerPerson);
  const peopleW = num(raw.peopleW);
  const lightingGainW = num(raw.lightingGainW);
  const equipmentGainW = num(raw.equipmentGainW);
  const any = occupancy != null || occupantSensibleWPerPerson != null || peopleW != null || lightingGainW != null || equipmentGainW != null;
  if (!any) return null;
  return { occupancy, occupancySource, occupantSensibleWPerPerson, peopleW, lightingGainW, equipmentGainW };
}

const ENVELOPE_ELEMENT_FIELDS = [
  'elementId', 'areaM2', 'widthM', 'heightM', 'grossAreaM2', 'openingIds', 'count',
  'uValue', 'constructionTier', 'uValueSource', 'orientation', 'shgc',
  'shadingFactor', 'shadingProfile', 'source',
] as const;
const ENVELOPE_ARRAY_KEYS = ['wallElements', 'windowElements', 'doorElements', 'roofElements', 'floorElements'] as const;

function own(raw: any, key: string): boolean {
  return raw != null && Object.prototype.hasOwnProperty.call(raw, key);
}

function definedObject(raw: any): Record<string, any> {
  if (!raw || typeof raw !== 'object') return {};
  return Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== undefined));
}

function isCompleteEnvelopeElement(raw: any): boolean {
  return !!raw && typeof raw === 'object' && ENVELOPE_ELEMENT_FIELDS.every((field) => own(raw, field));
}

/**
 * Merge a PATCH envelope without inventing values:
 * - omitted categories/fields remain persisted;
 * - explicit nulls clear the supplied field;
 * - complete element arrays retain their existing replacement semantics;
 * - sparse element arrays merge by elementId, preserving sibling fields.
 */
function mergeEnvelope(existing: RoomEnvelope | null, incoming: RoomEnvelopePatch | null): RoomEnvelope | null {
  if (incoming === null) return null;
  if (!incoming || typeof incoming !== 'object') return normalizeEnvelope(incoming);
  const base: RoomEnvelope = existing ?? { wallElements: [], windowElements: [], doorElements: [], roofElements: [], floorElements: [] };
  const merged: RoomEnvelope = {
    wallElements: [...base.wallElements],
    windowElements: [...base.windowElements],
    doorElements: [...base.doorElements],
    roofElements: [...base.roofElements],
    floorElements: [...base.floorElements],
  };
  for (const key of ENVELOPE_ARRAY_KEYS) {
    const incomingItems = incoming[key];
    if (!own(incoming, key) || !Array.isArray(incomingItems)) continue;
    const next = incomingItems.map((item) => definedObject(item));
    if (next.length === 0) {
      merged[key] = [];
      continue;
    }
    if (next.every(isCompleteEnvelopeElement)) {
      merged[key] = next as EnvelopeElement[];
      continue;
    }
    const byId = new Map(base[key].map((item) => [item.elementId, item]));
    for (const item of next) {
      if (typeof item.elementId !== 'string' || !item.elementId.trim()) continue;
      const previous = byId.get(item.elementId);
      byId.set(item.elementId, previous ? { ...previous, ...item } : item as EnvelopeElement);
    }
    merged[key] = [...byId.values()];
  }
  return normalizeEnvelope(merged);
}

function mergeScalarObject<T>(existing: T | null, incoming: any): T | null {
  if (incoming === null) return null;
  if (!incoming || typeof incoming !== 'object') return incoming == null ? null : (incoming as T);
  return { ...(existing ?? {}), ...definedObject(incoming) } as T;
}

function parseRoomArea(value: unknown, allowEmpty: boolean): number | null {
  if (value == null || value === '') {
    if (!allowEmpty) fail('building.invalid_room_area', 'Room area must be a positive number');
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) fail('building.invalid_room_area', 'Room area must be a positive number');
  return n;
}

function normalizeRoom(raw: Partial<BuildingRoom> & { id?: string }, existing: BuildingRoom[] = [], allowEmptyArea = true): BuildingRoom {
  const roomType = String(raw.roomType || 'bedroom');
  if (!ROOM_TYPE_SET.has(roomType)) fail('building.invalid_room_type', `Unknown room type: ${roomType}`);
  const name = String(raw.name || '').trim() || suggestRoomName(roomType, existing);
  const floorId = typeof raw.floorId === 'string' && raw.floorId.trim() ? String(raw.floorId).trim() : null;
  return {
    id: String(raw.id || randomUUID()),
    roomType,
    name,
    areaM2: parseRoomArea(raw.areaM2, allowEmptyArea),
    floorId,
    extras: normalizeRoomExtras(raw.extras as BuildingRoomInput['extras']),
    envelope: normalizeEnvelope((raw as any).envelope),
    air: normalizeAir((raw as any).air),
    internalGains: normalizeInternalGains((raw as any).internalGains),
  };
}

function normalizeSnapshot(raw: any): BuildingProjectSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const frozenAt = String(raw.frozenAt || nowIso());
  const roomsRaw = Array.isArray(raw.rooms) ? raw.rooms : [];
  const rooms: BuildingRoom[] = [];
  for (const room of roomsRaw) rooms.push(normalizeRoom(room, rooms));
  return {
    frozenAt,
    buildingRevision: Number.isFinite(Number(raw.buildingRevision)) ? Number(raw.buildingRevision) : 1,
    name: String(raw.name || ''),
    objectType: normalizeObjectType(raw.objectType),
    region: raw.region?.code ? resolveRegion(raw.region.code) : null,
    totalAreaM2: optionalPositive(raw.totalAreaM2),
    defaultCeilingHeightM: requiredHeight(raw.defaultCeilingHeightM),
    insulationLevel: normalizeInsulation(raw.insulationLevel),
    topology: normalizeTopology(raw.topology, normalizeObjectType(raw.objectType), { rooms }),
    rooms,
    roomCount: Number.isFinite(Number(raw.roomCount)) ? Number(raw.roomCount) : rooms.length,
    sumRoomAreaM2: Number.isFinite(Number(raw.sumRoomAreaM2))
      ? Number(raw.sumRoomAreaM2)
      : rooms.reduce((s, r) => s + Number(r.areaM2 || 0), 0),
  };
}

function normalizeSystemsConfigLoaded(
  project: BuildingProject,
  raw: any,
  options: { preserveHistoricalSnapshot?: boolean } = {},
): EngineeringSystemConfiguration | null {
  if (!raw || typeof raw !== 'object') return null;
  const normalized = normalizeSystemsConfiguration(project, raw, Array.isArray(raw.requestedServices) ? raw.requestedServices : []);
  normalized.systemsRevision = Number.isFinite(Number(raw.systemsRevision)) ? Number(raw.systemsRevision) : normalized.systemsRevision;
  normalized.configurationStatus = String(raw.configurationStatus || normalized.configurationStatus) as EngineeringSystemConfiguration['configurationStatus'];
  normalized.confirmedAt = raw.confirmedAt ?? normalized.confirmedAt ?? null;
  normalized.buildingRevisionAtConfirmation = raw.buildingRevisionAtConfirmation ?? normalized.buildingRevisionAtConfirmation ?? null;
  normalized.systemsRevisionAtConfirmation = raw.systemsRevisionAtConfirmation ?? normalized.systemsRevisionAtConfirmation ?? null;
  if (options.preserveHistoricalSnapshot) {
    // A CONFIRMED SNAPSHOT is a historical record of the state AT confirmation.
    // It must NOT be re-derived against the CURRENT project (rooms may have
    // been added/removed/changed since confirmation): the full normalize above
    // rebuilds roomAssignments from project.rooms and regenerates architecture /
    // hydronicRequirements / validation timestamps. Restore the raw snapshot's
    // own derived fields when present; legacy fields (missing arrays/objects)
    // keep the normalized back-fill so old Phase 1/2 JSON still loads.
    if (Array.isArray(raw.roomAssignments)) normalized.roomAssignments = raw.roomAssignments;
    if (raw.architecture && typeof raw.architecture === 'object') normalized.architecture = raw.architecture;
    if (raw.hydronicRequirements && typeof raw.hydronicRequirements === 'object') normalized.hydronicRequirements = raw.hydronicRequirements;
    if (raw.validation && typeof raw.validation === 'object') normalized.validation = raw.validation;
  }
  return normalized;
}

function normalizeSelectedFamilies(raw: any): EngineeringSystemFamilySelection[] {
  if (!Array.isArray(raw)) return [];
  const items = raw
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const familyId = String(item.familyId || item.id || '').trim();
      if (!familyId) return null;
      const family = getBuildingProjectSystemsCatalog().systemFamilies.find((f) => f.id === familyId);
      if (!family) return null;
      return {
        ...family,
        selectedAt: String(item.selectedAt || '').trim() || nowIso(),
      } satisfies EngineeringSystemFamilySelection;
    })
    .filter((item): item is EngineeringSystemFamilySelection => Boolean(item));
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function normalizeLoadedProject(raw: any): BuildingProject {
  const objectType = normalizeObjectType(raw?.objectType);
  // Stage 1 — topology skeleton (floors / basement / top boundary). plantLocation
  // here is only provisional (no rooms yet) and is re-derived in Stage 4, so a
  // persisted kind='room' reference survives reload instead of degrading to a floor fact.
  const rawTopology = raw?.topology ?? null;
  const topology: BuildingTopology | null = normalizeTopology(rawTopology, objectType, { floorCount: raw?.floorCount });

  const project: BuildingProject = {
    id: String(raw?.id || randomUUID()),
    name: String(raw?.name || '').trim() || 'Building project',
    status: normalizeStatus(raw?.status),
    createdAt: String(raw?.createdAt || nowIso()),
    updatedAt: String(raw?.updatedAt || nowIso()),
    objectConfirmedAt: raw?.objectConfirmedAt ?? null,
    objectConfirmedRevision: Number.isFinite(Number(raw?.objectConfirmedRevision)) ? Number(raw.objectConfirmedRevision) : null,
    buildingRevision: Number.isFinite(Number(raw?.buildingRevision)) ? Number(raw.buildingRevision) : 1,
    objectType,
    region: raw?.region?.code ? resolveRegion(raw.region.code) : null,
    totalAreaM2: optionalPositive(raw?.totalAreaM2),
    defaultCeilingHeightM: requiredHeight(raw?.defaultCeilingHeightM),
    insulationLevel: normalizeInsulation(raw?.insulationLevel),
    topology,
    rooms: [],
    selectedSystems: [],
    systemsRevision: Number.isFinite(Number(raw?.systemsRevision)) ? Number(raw.systemsRevision) : 0,
    systemsConfiguration: null,
    systemsConfigurationSnapshot: null,
    objectConfirmedSnapshot: normalizeSnapshot(raw?.objectConfirmedSnapshot),
  };

  // Stage 2 — normalize rooms.
  const roomsRaw = Array.isArray(raw?.rooms) ? raw.rooms : [];
  for (const room of roomsRaw) project.rooms.push(normalizeRoom(room, project.rooms));

  // Stage 3 — attach rooms to floors (legacy absent floorId -> Floor 1; an
  // explicitly invalid floorId is preserved so confirmation rejects it).
  if (project.topology) assignRoomFloors(project);

  // Stage 4 — normalize plantLocation now that normalized rooms (with floor
  // assignments) exist. A valid kind='room' reference survives reload; an explicit
  // room/floor mismatch is preserved (not masked) and rejected by confirmObject;
  // only genuinely incomplete (missing floor/room) or stale references degrade to
  // a floor fact. In-memory only — no disk write on read.
  if (project.topology) {
    project.topology.plantLocation = normalizePlantLocation(rawTopology?.plantLocation, project.topology.floors, project.rooms);
  }

  project.selectedSystems = normalizeSelectedFamilies(raw?.selectedSystems);
  const systemsConfig = raw?.systemsConfiguration ?? null;
  const systemsSnapshot = raw?.systemsConfigurationSnapshot ?? null;
  project.systemsConfiguration = normalizeSystemsConfigLoaded(project, systemsConfig);
  project.systemsConfigurationSnapshot = normalizeSystemsConfigLoaded(project, systemsSnapshot, { preserveHistoricalSnapshot: true });
  // Phase 3: the load result is a HISTORICAL record — preserve it verbatim so a
  // reload never re-derives or mutates it. Staleness is derived at read time
  // from the revision stamps, never by rewriting the stored result.
  if (raw?.loads && typeof raw.loads === 'object') {
    project.loads = raw.loads as BuildingProject['loads'];
  }

  if (!project.selectedSystems.length && project.systemsConfiguration) {
    project.selectedSystems = [...project.systemsConfiguration.selectedSystemFamilies];
  }

  if (project.status === 'systems_configured' && project.systemsConfiguration && !project.systemsConfigurationSnapshot) {
    project.systemsConfigurationSnapshot = structuredClone(project.systemsConfiguration);
  }
  if (project.status === 'systems_configured' && project.systemsConfiguration) {
    project.systemsConfiguration.configurationStatus = 'confirmed';
    project.systemsConfiguration.confirmedAt = project.systemsConfiguration.confirmedAt || project.updatedAt;
    project.systemsConfiguration.buildingRevisionAtConfirmation = project.systemsConfiguration.buildingRevisionAtConfirmation ?? project.buildingRevision;
    project.systemsConfiguration.systemsRevisionAtConfirmation = project.systemsConfiguration.systemsRevisionAtConfirmation ?? project.systemsRevision;
  }
  return project;
}

function syncSystemsAfterBuildingChange(project: BuildingProject) {
  if (project.systemsConfigurationSnapshot && !project.systemsConfiguration) {
    project.systemsConfiguration = structuredClone(project.systemsConfigurationSnapshot);
  }
  if (!project.systemsConfiguration) return;
  const normalizedServices = project.systemsConfiguration.requestedServices.filter((service): service is 'heating' | 'cooling' => service === 'heating' || service === 'cooling');
  project.systemsConfiguration = normalizeSystemsConfiguration(project, project.systemsConfiguration, normalizedServices);
  project.selectedSystems = [...project.systemsConfiguration.selectedSystemFamilies];
  if (project.systemsConfigurationSnapshot || project.status === 'systems_configured') {
    markSystemsConfigurationStale(project);
  }
}

function bumpBuildingRevision(project: BuildingProject) {
  project.buildingRevision = Number(project.buildingRevision || 0) + 1;
  syncSystemsAfterBuildingChange(project);
}

function touchSystemsRevision(project: BuildingProject) {
  project.systemsRevision = Number(project.systemsRevision || 0) + 1;
}

function assertDraft(project: BuildingProject) {
  if (project.status !== 'draft') {
    fail('building.object_confirmed_immutable', 'Confirmed object cannot be edited. Reopen it first.');
  }
}

function ensureObjectConfirmed(project: BuildingProject) {
  if (project.status === 'draft') {
    fail('building.object_not_confirmed', 'Confirm the object before configuring systems');
  }
}

function saveProject(project: BuildingProject) {
  ensureStore();
  project.updatedAt = nowIso();
  fs.writeFileSync(projectPath(project.id), JSON.stringify(project, null, 2));
}

export function loadProject(id: string): BuildingProject | null {
  const p = projectPath(id);
  if (!fs.existsSync(p)) return null;
  return normalizeLoadedProject(JSON.parse(fs.readFileSync(p, 'utf8')));
}

export function requireProject(id: string): BuildingProject {
  const project = loadProject(id);
  if (!project) fail('building.not_found', 'Project not found');
  return project;
}

export function listProjects() {
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
        objectType: p.objectType,
        updatedAt: p.updatedAt,
        roomCount: p.rooms.length,
        systemsStatus: p.systemsConfiguration?.configurationStatus || p.systemsConfigurationSnapshot?.configurationStatus || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String((b as any).updatedAt).localeCompare(String((a as any).updatedAt)));
}

export function createProject(input: CreateBuildingProjectInput = {}): BuildingProject {
  ensureStore();
  const objectType = normalizeObjectType(input.objectType);
  const region = resolveRegion(input.regionCode);
  const insulationLevel = normalizeInsulation(input.insulationLevel);
  const totalAreaM2 = optionalPositive(input.totalAreaM2);
  const defaultCeilingHeightM = requiredHeight(input.defaultCeilingHeightM);
  const rooms: BuildingRoom[] = [];
  const topology = normalizeTopology(null, objectType, {
    floorCount: input.floorCount,
    basementType: input.basementType,
    topBoundaryType: input.topBoundaryType,
    plantLocation: input.plantLocation,
  });
  const firstFloorId = topology?.floors[0]?.id || null;
  for (const r of input.rooms || []) {
    const room = normalizeRoom({ ...r, floorId: firstFloorId && !r.floorId ? firstFloorId : r.floorId } as any, rooms);
    rooms.push(room);
  }
  if (topology && firstFloorId) {
    for (const room of rooms) if (!room.floorId) room.floorId = firstFloorId;
    topology.plantLocation = normalizePlantLocation(topology.plantLocation, topology.floors, rooms);
  }
  const project: BuildingProject = {
    id: randomUUID(),
    name: String(input.name || '').trim() || defaultProjectName(objectType, region?.code),
    status: 'draft',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    objectConfirmedAt: null,
    objectConfirmedRevision: null,
    buildingRevision: 1,
    objectType,
    region,
    totalAreaM2,
    defaultCeilingHeightM,
    insulationLevel,
    topology,
    rooms,
    selectedSystems: [],
    systemsRevision: 0,
    systemsConfiguration: null,
    systemsConfigurationSnapshot: null,
    objectConfirmedSnapshot: null,
  };
  saveProject(project);
  return project;
}

export function updateProjectMeta(id: string, patch: UpdateBuildingProjectInput): BuildingProject {
  const project = requireProject(id);
  assertDraft(project);
  if (patch.name !== undefined) project.name = String(patch.name || '').trim() || project.name;
  if (patch.objectType !== undefined) {
    const nextType = normalizeObjectType(patch.objectType);
    if (project.objectType === 'private_house' && nextType !== 'private_house') {
      project.topology = null;
      for (const room of project.rooms) room.floorId = null;
    }
    project.objectType = nextType;
  }
  if (patch.regionCode !== undefined) project.region = resolveRegion(patch.regionCode);
  if (patch.totalAreaM2 !== undefined) project.totalAreaM2 = optionalPositive(patch.totalAreaM2);
  if (patch.defaultCeilingHeightM !== undefined) project.defaultCeilingHeightM = requiredHeight(patch.defaultCeilingHeightM);
  if (patch.insulationLevel !== undefined) project.insulationLevel = normalizeInsulation(patch.insulationLevel);

  // Phase 2.6 topology patch (private_house only; ignored for other object types).
  if (project.objectType === 'private_house') {
    const current: BuildingTopology = project.topology || normalizeTopology(null, 'private_house', {})!;
    let floorCount = current.floorCount;
    let floors = [...current.floors];
    if (patch.floorCount !== undefined) {
      const nextCount = normalizeFloorCount(patch.floorCount);
      if (nextCount > floorCount) {
        // Safe increase: append new empty floors.
        for (let level = floorCount + 1; level <= nextCount; level += 1) {
          floors.push({ id: `floor-${level}`, level, label: floorLabel(level) });
        }
        floorCount = nextCount;
      } else if (nextCount < floorCount) {
        // Data-safety decrease: floors being removed must be empty.
        const removedFloors = floors.filter((f) => f.level > nextCount);
        const removedIds = new Set(removedFloors.map((f) => f.id));
        const occupied = project.rooms.some((r) => r.floorId && removedIds.has(r.floorId));
        if (occupied) {
          const topLevel = Math.max(...removedFloors.map((f) => f.level));
          fail('building.floor_occupied', `На этаже ${topLevel} находятся помещения. Сначала перенесите или удалите их.`, {
            floorLevels: removedFloors.map((f) => f.level),
          });
        }
        floors = floors.filter((f) => f.level <= nextCount);
        floorCount = nextCount;
      }
    }
    const basementType: BasementType = patch.basementType !== undefined && BASEMENT_TYPES.has(patch.basementType)
      ? patch.basementType
      : current.basementType;
    const topBoundaryType: TopBoundaryType = patch.topBoundaryType !== undefined && TOP_BOUNDARY_TYPES.has(patch.topBoundaryType)
      ? patch.topBoundaryType
      : current.topBoundaryType;
    let plantLocation = { ...current.plantLocation };
    if (patch.plantLocation !== undefined) {
      plantLocation = normalizePlantLocation(patch.plantLocation, floors, project.rooms);
      validatePlantLocation(plantLocation, floors, project.rooms);
    } else if (!floors.some((f) => f.id === plantLocation.floorId)) {
      // Removed floor: plant location fact must not reference a missing floor.
      plantLocation = { kind: 'not_defined', floorId: null, roomId: null };
    }
    project.topology = { floorCount, floors, basementType, topBoundaryType, plantLocation };
    assignRoomFloors(project);
  }

  bumpBuildingRevision(project);
  saveProject(project);
  return project;
}

export function setRoomTypeCount(id: string, roomType: string, count: number, floorId?: string | null): BuildingProject {
  const project = requireProject(id);
  assertDraft(project);
  if (!ROOM_TYPE_SET.has(String(roomType))) fail('building.invalid_room_type', `Unknown room type: ${roomType}`);
  const nextCount = Number(count);
  if (!Number.isInteger(nextCount) || nextCount < 0 || nextCount > 30) {
    fail('building.invalid_room_count', 'Room count must be an integer from 0 to 30');
  }
  // Phase 2.6: batch room counters operate on the selected floor (floorId optional).
  let targetFloorId: string | null = null;
  if (project.topology && project.topology.floors.length) {
    const floorIds = new Set(project.topology.floors.map((f) => f.id));
    if (floorId != null && String(floorId).trim() !== '') {
      if (!floorIds.has(String(floorId))) fail('building.invalid_floor', 'Floor not found');
      targetFloorId = String(floorId);
    } else if (project.topology.floors.length > 1) {
      fail('building.floor_required', 'Floor is required for multi-floor house');
    } else {
      targetFloorId = project.topology.floors[0].id;
    }
  }
  const current = project.rooms.filter(
    (room) => room.roomType === roomType && (targetFloorId ? room.floorId === targetFloorId : true),
  );
  if (nextCount === current.length) return project;
  const removeIds = new Set<string>();
  if (nextCount > current.length) {
    for (let i = current.length; i < nextCount; i += 1) {
      project.rooms.push(normalizeRoom({ roomType, areaM2: null, floorId: targetFloorId }, project.rooms, true));
    }
  } else {
    current.slice(nextCount).forEach((room) => removeIds.add(room.id));
    project.rooms = project.rooms.filter((room) => !removeIds.has(room.id));
  }
  // Phase 2.8A: the decrease path removes rooms directly (not via removeRoom),
  // so the plant-location reference must be cleared here too. A plant location
  // pinned to a removed room degrades to the canonical "not defined" fact.
  if (
    project.topology?.plantLocation?.roomId
    && removeIds.has(project.topology.plantLocation.roomId)
  ) {
    project.topology.plantLocation = { kind: 'not_defined', floorId: null, roomId: null };
  }
  bumpBuildingRevision(project);
  saveProject(project);
  return project;
}

export function addRoom(id: string, input: BuildingRoomInput): BuildingProject {
  const project = requireProject(id);
  assertDraft(project);
  const rawFloorId = typeof input.floorId === 'string' && input.floorId ? input.floorId : null;
  // Phase 2.6 multi-floor safety: a private_house room must land on an existing
  // floor. A MISSING floorId is only acceptable for a SINGLE-floor house (the one
  // floor is the implicit default, matching legacy behavior); for a MULTI-floor
  // house the floor is REQUIRED — a missing floorId must not silently drop the
  // room onto Floor 1. An EXPLICIT floorId that does not exist is rejected
  // (aligned with updateRoom); the room is not created.
  let floorId = rawFloorId;
  if (project.topology && project.topology.floors.length) {
    const floorIds = new Set(project.topology.floors.map((f) => f.id));
    if (!floorId) {
      if (project.topology.floors.length === 1) {
        floorId = project.topology.floors[0].id;
      } else {
        fail('building.floor_required', 'Floor is required for multi-floor house');
      }
    } else if (!floorIds.has(floorId)) {
      fail('building.invalid_floor', 'Floor not found');
    }
  }
  const room = normalizeRoom({
    ...input,
    name: input.name || suggestRoomName(String(input.roomType || 'bedroom'), project.rooms),
    areaM2: input.areaM2,
    floorId,
  } as any, project.rooms);
  project.rooms.push(room);
  bumpBuildingRevision(project);
  saveProject(project);
  return project;
}

export function updateRoom(id: string, roomId: string, patch: BuildingRoomInput): BuildingProject {
  const project = requireProject(id);
  assertDraft(project);
  const room = project.rooms.find((r) => r.id === roomId);
  if (!room) fail('building.room_not_found', 'Room not found');
  if (patch.roomType !== undefined) {
    if (!ROOM_TYPE_SET.has(String(patch.roomType))) fail('building.invalid_room_type', `Unknown room type: ${patch.roomType}`);
    room.roomType = String(patch.roomType);
  }
  if (patch.name !== undefined) {
    const name = String(patch.name || '').trim();
    if (!name) fail('building.invalid_room_name', 'Room name is required');
    room.name = name;
  }
  if (patch.areaM2 !== undefined) {
    room.areaM2 = parseRoomArea(patch.areaM2, true);
  }
  // Phase 2.6: moving a room between floors preserves roomId and roomType.
  if (patch.floorId !== undefined) {
    const nextFloorId = patch.floorId ? String(patch.floorId) : null;
    if (project.topology && project.topology.floors.length) {
      const floorIds = new Set(project.topology.floors.map((f) => f.id));
      if (nextFloorId && !floorIds.has(nextFloorId)) fail('building.invalid_floor', 'Floor not found');
    }
    room.floorId = nextFloorId;
  }
  if (patch.extras !== undefined) {
    room.extras = normalizeRoomExtras({
      ...room.extras,
      ...patch.extras,
      geometry: { ...room.extras.geometry, ...(patch.extras.geometry || {}) },
      windows: { ...room.extras.windows, ...(patch.extras.windows || {}) },
      conditions: patch.extras.conditions ?? room.extras.conditions,
    });
  }
  // Phase 3.2a/b/c — engineering inputs (envelope / air / internal gains).
  // Applied through their normalizers; a change here bumps buildingRevision
  // below, so an existing load calculation is correctly marked stale.
  if (patch.envelope !== undefined) {
    room.envelope = mergeEnvelope(room.envelope ?? null, patch.envelope);
  }
  if (patch.air !== undefined) {
    room.air = normalizeAir(mergeScalarObject(room.air, patch.air as any));
  }
  if (patch.internalGains !== undefined) {
    room.internalGains = normalizeInternalGains(mergeScalarObject(room.internalGains, patch.internalGains as any));
  }
  bumpBuildingRevision(project);
  saveProject(project);
  return project;
}

export function removeRoom(id: string, roomId: string): BuildingProject {
  const project = requireProject(id);
  assertDraft(project);
  const next = project.rooms.filter((r) => r.id !== roomId);
  if (next.length === project.rooms.length) fail('building.room_not_found', 'Room not found');
  project.rooms = next;
  if (project.topology?.plantLocation.roomId === roomId) {
    project.topology.plantLocation = { kind: 'not_defined', floorId: null, roomId: null };
  }
  bumpBuildingRevision(project);
  saveProject(project);
  return project;
}

function snapshotOf(project: BuildingProject): BuildingProjectSnapshot {
  const rooms = structuredClone(project.rooms);
  return {
    frozenAt: nowIso(),
    buildingRevision: project.buildingRevision,
    name: project.name,
    objectType: project.objectType,
    region: project.region ? { ...project.region } : null,
    totalAreaM2: project.totalAreaM2,
    defaultCeilingHeightM: project.defaultCeilingHeightM,
    insulationLevel: project.insulationLevel,
    topology: project.topology ? structuredClone(project.topology) : null,
    rooms,
    roomCount: rooms.length,
    sumRoomAreaM2: rooms.reduce((s, r) => s + Number(r.areaM2 || 0), 0),
  };
}

export function confirmObject(id: string): BuildingProject {
  const project = requireProject(id);
  if (!project.rooms.length) fail('building.no_rooms', 'Add at least one room before confirming the object');
  const missingArea = project.rooms.filter((room) => room.areaM2 == null || Number(room.areaM2) <= 0);
  if (missingArea.length) {
    fail('building.room_area_required', 'Set area for every room before confirming the object', {
      roomIds: missingArea.map((room) => room.id),
    });
  }
  // Phase 2.6: private_house rooms must belong to an existing floor; plant location must be consistent.
  if (project.topology && project.topology.floors.length) {
    const floorIds = new Set(project.topology.floors.map((f) => f.id));
    const invalidFloor = project.rooms.filter((room) => !room.floorId || !floorIds.has(room.floorId));
    if (invalidFloor.length) {
      fail('building.room_floor_invalid', 'Every room must belong to an existing floor', {
        roomIds: invalidFloor.map((room) => room.id),
      });
    }
    validatePlantLocation(project.topology.plantLocation, project.topology.floors, project.rooms);
  }
  project.status = 'object_confirmed';
  project.objectConfirmedAt = nowIso();
  project.objectConfirmedRevision = project.buildingRevision;
  project.objectConfirmedSnapshot = snapshotOf(project);
  if (!project.systemsConfiguration) {
    project.systemsConfiguration = createDefaultSystemsConfiguration(project, []);
    project.selectedSystems = [...project.systemsConfiguration.selectedSystemFamilies];
  } else {
    const requestedServices = project.systemsConfiguration.requestedServices.filter((service): service is 'heating' | 'cooling' => service === 'heating' || service === 'cooling');
    project.systemsConfiguration = normalizeSystemsConfiguration(project, project.systemsConfiguration, requestedServices);
    project.selectedSystems = [...project.systemsConfiguration.selectedSystemFamilies];
  }
  saveProject(project);
  return project;
}

export function reopenObject(id: string): BuildingProject {
  const project = requireProject(id);
  project.status = 'draft';
  saveProject(project);
  return project;
}

export function applySuggestedSystemsConfiguration(
  id: string,
  requestedServices: unknown,
  selectedFamilyIds: string[] = [],
): BuildingProject {
  const project = requireProject(id);
  ensureObjectConfirmed(project);
  const familyIds = suggestionFamilyIdsForPreview(selectedFamilyIds);
  const suggested = buildSuggestedSystemsConfiguration(project, requestedServices, familyIds);
  return updateSystemsConfiguration(id, {
    requestedServices: suggested.requestedServices,
    selectedSystemFamilies: suggested.selectedSystemFamilies,
    roomAssignments: suggested.roomAssignments,
  });
}

export function previewSuggestedSystemsConfiguration(
  id: string,
  requestedServices: unknown,
  selectedFamilyIds: string[] = [],
) {
  const project = requireProject(id);
  ensureObjectConfirmed(project);
  const familyIds = suggestionFamilyIdsForPreview(selectedFamilyIds);
  return buildSuggestedSystemsConfiguration(project, requestedServices, familyIds);
}

export function updateSystemsConfiguration(
  id: string,
  input: Partial<Omit<EngineeringSystemConfiguration, 'architecture'>> & {
    architecture?: BuildingSystemArchitectureInput | null;
    requestedService?: BuildingSystemService | 'heating_and_cooling' | null;
    bulk?: { sourceRoomId: string; target: SystemsBulkTarget };
  },
): BuildingProject {
  const project = requireProject(id);
  ensureObjectConfirmed(project);
  const requestedServices = expandRequestedServices(
    Array.isArray(input.requestedServices)
      ? input.requestedServices
      : input.requestedService != null
        ? input.requestedService
        : project.systemsConfiguration?.requestedServices || [],
  );
  const current = project.systemsConfiguration || project.systemsConfigurationSnapshot || createDefaultSystemsConfiguration(project, requestedServices);
  const incomingAssignments = Array.isArray(input.roomAssignments) ? input.roomAssignments : current.roomAssignments;
  const roomAssignments = input.bulk?.sourceRoomId && input.bulk.target
    ? applyBulkRoomAssignments(project, incomingAssignments, input.bulk.sourceRoomId, input.bulk.target, requestedServices)
    : incomingAssignments;

  // Determine if selectedSystemFamilies changed from current
  const currentFamilyIds = new Set((project.systemsConfiguration?.selectedSystemFamilies || current.selectedSystemFamilies).map((f) => f.id));
  const incomingFamilyIds = Array.isArray(input.selectedSystemFamilies)
    ? input.selectedSystemFamilies.map((f: unknown) => typeof f === 'string' ? f : String((f as any)?.familyId || (f as any)?.id || '')).filter(Boolean)
    : [];
  const familiesChanged = incomingFamilyIds.length > 0 && (
    incomingFamilyIds.some((id) => !currentFamilyIds.has(id)) ||
    currentFamilyIds.size !== new Set(incomingFamilyIds).size
  );

  // Only preserve the full architecture when selected families haven't changed.
  const preserveArchitecture = !familiesChanged && Boolean(input.architecture);

  // An explicit distribution choice (e.g. 4-pipe for simultaneous zones) must survive
  // a family change, unlike source ids / dhw which are re-derived from the new families.
  const explicitDistribution = input.architecture?.distribution || null;

  const next = normalizeSystemsConfiguration(project, {
    ...current,
    ...input,
    requestedServices,
    roomAssignments,
    configurationStatus: 'draft',
    confirmedAt: null,
    ...(familiesChanged || !preserveArchitecture
      ? { architecture: explicitDistribution ? { distribution: explicitDistribution } : undefined }
      : {}),
  }, requestedServices, { mode: 'write', bumpRevision: true });
  next.configurationStatus = 'draft';
  next.confirmedAt = null;
  next.buildingRevisionAtConfirmation = project.systemsConfigurationSnapshot?.buildingRevisionAtConfirmation ?? current.buildingRevisionAtConfirmation ?? null;
  next.systemsRevisionAtConfirmation = project.systemsConfigurationSnapshot?.systemsRevisionAtConfirmation ?? current.systemsRevisionAtConfirmation ?? null;
  project.systemsConfiguration = next;
  project.selectedSystems = [...next.selectedSystemFamilies];
  project.systemsRevision = next.systemsRevision;
  if (project.status === 'systems_configured') {
    project.status = 'object_confirmed';
  }
  saveProject(project);
  return project;
}

export function confirmSystemsConfiguration(id: string): BuildingProject {
  const project = requireProject(id);
  ensureObjectConfirmed(project);
  const current = project.systemsConfiguration || project.systemsConfigurationSnapshot || createDefaultSystemsConfiguration(project, []);
  const requestedServicesForNormalize = current.requestedServices.filter((service): service is 'heating' | 'cooling' => service === 'heating' || service === 'cooling');
  const next = normalizeSystemsConfiguration(project, current, requestedServicesForNormalize, { mode: 'load' });
  if (!next.requestedServices.length) {
    fail('building.systems_missing_services', 'Choose heating, cooling, or both before confirming systems');
  }
  if (!next.selectedSystemFamilies.length) {
    fail('building.systems_missing_selection', 'Choose at least one system family before confirming systems');
  }
  const validation = next.validation || validateSystemsConfigurationForConfirmation(project, next);
  next.validation = validation;
  if (!validation.ready) {
    const blocker = validation.blockers[0];
    const err = confirmErrorForBlocker(blocker);
    fail(err.code, err.message, { ...((err.details as object) || {}), blockers: validation.blockers });
  }
  const confirmedAt = nowIso();
  next.configurationStatus = 'confirmed';
  next.confirmedAt = confirmedAt;
  next.buildingRevisionAtConfirmation = project.buildingRevision;
  next.systemsRevisionAtConfirmation = next.systemsRevision;
  project.systemsConfiguration = next;
  project.systemsConfigurationSnapshot = structuredClone(next);
  project.selectedSystems = [...next.selectedSystemFamilies];
  project.status = 'systems_configured';
  project.systemsRevision = next.systemsRevision;
  saveProject(project);
  return project;
}

// ---------- Phase 3 — Loads (demand only, no equipment sizing) ----------

/**
 * Load-state endpoint payload: current result + derived staleness + the
 * prerequisite gate + honest method status. Backend remains the authority;
 * the client never computes engineering numbers.
 */
export function getLoadState(id: string) {
  const project = requireProject(id);
  const systemsSnapshot = project.systemsConfigurationSnapshot;
  const systemsConfirmed = project.status === 'systems_configured' && Boolean(systemsSnapshot);
  const systemsStale = isSystemsConfigurationStale(project);
  const config = project.systemsConfiguration || systemsSnapshot || null;
  const validation = config?.validation || null;
  const loads = project.loads || null;
  return {
    loads,
    isStale: isLoadStale(project, loads),
    prerequisites: {
      objectConfirmed: project.status !== 'draft' && Boolean(project.objectConfirmedAt),
      systemsConfirmed,
      systemsStale,
      systemsReady: Boolean(validation?.ready),
      blockers: validation?.blockers || [],
    },
    gate: checkLoadPrerequisites(project),
    availableModes: ['quick', 'professional', 'steady_state'],
    methodStatus: getLoadMethodStatus(),
  };
}

/**
 * Run/re-run the loads calculation. Structured domain errors (409) instead of
 * a generic 500 for expected prerequisite failures. The calculation is stored
 * revision-stamped; it never mutates building/systems revisions and never
 * deletes a previous (possibly historical) result.
 */
export function calculateLoads(id: string, modeInput?: unknown): BuildingProject {
  const project = requireProject(id);
  const mode = modeInput === 'professional' ? 'professional' : modeInput === 'quick' ? 'quick' : modeInput === 'steady_state' ? 'steady_state' : fail('building.loads_invalid_mode', 'Mode must be "quick", "professional" or "steady_state"');
  const gate = checkLoadPrerequisites(project);
  if (!gate.ok) fail(gate.code || 'building.loads_prerequisite', gate.message || 'Load prerequisites not met', gate.details);
  if (physicalCompletenessBlocksMode(mode)) {
    const incompleteRooms = projectPhysicalCompleteness(project);
    if (incompleteRooms.length > 0) {
      fail(
        'building.loads_physical_inputs_incomplete',
        'Нужно уточнить данные помещения перед профессиональным расчётом',
        { rooms: incompleteRooms },
      );
    }
  }
  project.loads = computeBuildingLoads(project, mode);
  saveProject(project);
  return project;
}

export function deleteProject(id: string): boolean {
  const p = projectPath(id);
  if (!fs.existsSync(p)) return false;
  fs.unlinkSync(p);
  return true;
}

function systemSummaryForProject(project: BuildingProject) {
  const systems = project.status === 'systems_configured' && project.systemsConfigurationSnapshot
    ? project.systemsConfigurationSnapshot
    : project.systemsConfiguration;
  const summary = systems
    ? {
        requestedServices: [...systems.requestedServices],
        selectedSystemFamilies: [...systems.selectedSystemFamilies],
        roomAssignments: structuredClone(systems.roomAssignments),
        configurationStatus: systems.configurationStatus,
        warnings: [...systems.warnings],
        confirmedAt: systems.confirmedAt,
        buildingRevisionAtConfirmation: systems.buildingRevisionAtConfirmation,
        systemsRevisionAtConfirmation: systems.systemsRevisionAtConfirmation,
        systemsRevision: systems.systemsRevision,
        isStale: isSystemsConfigurationStale(project),
      }
    : {
        requestedServices: [] as Array<'heating' | 'cooling'>,
        selectedSystemFamilies: [] as EngineeringSystemFamilySelection[],
        roomAssignments: [] as EngineeringSystemConfiguration['roomAssignments'],
        configurationStatus: 'draft' as const,
        warnings: [] as string[],
        confirmedAt: null,
        buildingRevisionAtConfirmation: null,
        systemsRevisionAtConfirmation: null,
        systemsRevision: 0,
        isStale: false,
      };
  return { systems, summary };
}

export function getProjectView(id: string) {
  const project = requireProject(id);
  const source = project.status === 'object_confirmed' && project.objectConfirmedSnapshot
    ? project.objectConfirmedSnapshot
    : project;
  const rooms = 'rooms' in source ? source.rooms : project.rooms;
  const sumRoomAreaM2 = rooms.reduce((s, r) => s + Number(r.areaM2 || 0), 0);
  const systems = systemSummaryForProject(project);
  return {
    project,
    catalog: getBuildingProjectCatalog(),
    systemsCatalog: getBuildingProjectSystemsCatalog(),
    summary: {
      name: source.name || project.name,
      objectType: project.objectType,
      objectTypeLabel: objectTypeLabel(project.objectType),
      regionCode: project.region?.code || null,
      regionName: project.region?.name || regionLabel(project.region?.code),
      totalAreaM2: project.totalAreaM2,
      defaultCeilingHeightM: project.defaultCeilingHeightM,
      insulationLevel: project.insulationLevel,
      insulationLabel: insulationLabel(project.insulationLevel),
      roomCount: rooms.length,
      sumRoomAreaM2,
      wetRoomCount: rooms.filter((r) => WET_ROOM_TYPES.has(r.roomType)).length,
      status: project.status,
      buildingRevision: project.buildingRevision,
      objectConfirmedRevision: project.objectConfirmedRevision,
      systemsRevision: project.systemsRevision,
    },
    systems: systems.summary,
    systemsConfiguration: systems.systems,
  };
}

export { suggestRoomName, getBuildingProjectCatalog, getBuildingProjectSystemsCatalog };
