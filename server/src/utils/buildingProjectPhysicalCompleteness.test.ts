/** Phase 3.2N — backend authority for Professional physical completeness.
 * Intentionally not executed in this corrective pass.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  physicalCompletenessBlocksMode,
  projectPhysicalCompleteness,
  roomPhysicalCompleteness,
} from './buildingProjectPhysicalCompleteness.js';
import type { BuildingProject, BuildingRoom, EnvelopeElement } from './buildingProjectTypes.js';

const el = (elementId: string): EnvelopeElement => ({
  elementId, areaM2: 10, widthM: null, heightM: null, grossAreaM2: null,
  openingIds: null, count: null, uValue: null, constructionTier: 'average',
  uValueSource: 'construction_profile', orientation: null, shgc: null,
  shadingFactor: null, shadingProfile: null, source: null,
});

function room(over: Partial<BuildingRoom> = {}): BuildingRoom {
  return {
    id: 'r1', roomType: 'bedroom', name: 'R1', areaM2: 20, floorId: 'floor-1',
    extras: {
      geometry: { ceilingHeightM: 2.7, externalWallCount: 1, externalDoorCount: 0, floorPosition: null, spaceAbove: null, spaceBelow: null },
      windows: { glazingType: null, count: null, areaM2: null },
      insulationOverride: null, conditions: [], notes: null, engineeringUse: 'stored_only',
    },
    envelope: { wallElements: [el('w1')], windowElements: [], doorElements: [], roofElements: [], floorElements: [el('f1')] },
    ...over,
  };
}

function project(rooms: BuildingRoom[]): BuildingProject {
  return {
    id: 'p1', name: 'P', status: 'systems_configured', createdAt: '', updatedAt: '',
    objectConfirmedAt: '', objectConfirmedRevision: 1, buildingRevision: 1,
    objectType: 'private_house', region: { code: 'AM-ER', name: 'Ереван' }, totalAreaM2: 20,
    defaultCeilingHeightM: 2.7, insulationLevel: 'medium',
    topology: {
      floorCount: 2,
      floors: [{ id: 'floor-1', level: 1, label: 'Этаж 1' }, { id: 'floor-2', level: 2, label: 'Этаж 2' }],
      basementType: 'none', topBoundaryType: 'direct_roof', plantLocation: { kind: 'not_defined', floorId: null, roomId: null },
    },
    rooms, selectedSystems: [], systemsRevision: 1,
    systemsConfiguration: null, systemsConfigurationSnapshot: null, objectConfirmedSnapshot: null,
  };
}

test('3.2N server: empty window array without declaration is incomplete', () => {
  const r = room();
  assert.ok(roomPhysicalCompleteness(project([r]), r).some((issue) => issue.code === 'physical_boundary:windows_unknown'));
});

test('3.2N server: explicit no windows and an intermediate floor do not invent roof', () => {
  const base = room();
  const r = room({ extras: { ...base.extras, windows: { ...base.extras.windows, count: 0 } } });
  assert.deepEqual(projectPhysicalCompleteness(project([r])), []);
});

test('3.2N server: Professional is blocked by incomplete boundaries while QUICK is unchanged', () => {
  assert.equal(physicalCompletenessBlocksMode('steady_state'), true);
  assert.equal(physicalCompletenessBlocksMode('quick'), false);
  assert.equal(physicalCompletenessBlocksMode('professional'), false);
});
