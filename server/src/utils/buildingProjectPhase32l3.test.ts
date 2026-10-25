/**
 * Phase 3.2L.3 RED regressions for room engineering persistence.
 *
 * These tests intentionally exercise PATCH-like partial room payloads. Before
 * the fix, updateRoom replaces the entire normalized sub-object, so a second
 * field update erases the first one.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { dataRoot } from '../paths.js';
import {
  addRoom,
  createProject,
  deleteProject,
  loadProject,
  updateRoom,
} from './buildingProjectService.js';
import type { EnvelopeElement } from './buildingProjectTypes.js';
import { AIR_CONSTANT, AIRTIGHTNESS_ACH_BASE } from './buildingProjectAir.js';

const STORE = path.join(dataRoot, 'building-projects');
const createdIds: string[] = [];

function track<T extends { id: string }>(project: T): T {
  createdIds.push(project.id);
  return project;
}

function element(id: string, extra: Partial<EnvelopeElement> = {}): EnvelopeElement {
  return {
    elementId: id,
    areaM2: null,
    widthM: null,
    heightM: null,
    grossAreaM2: null,
    openingIds: null,
    count: null,
    uValue: null,
    constructionTier: null,
    uValueSource: null,
    orientation: null,
    shgc: null,
    shadingFactor: null,
    shadingProfile: null,
    source: null,
    ...extra,
  };
}

function roomProject() {
  const project = track(createProject({ objectType: 'apartment', regionCode: 'AM-ER' }));
  const withRoom = addRoom(project.id, { roomType: 'living_room', name: 'L3 room', areaM2: 20 });
  return { projectId: project.id, roomId: withRoom.rooms[0].id };
}

function persistedRoom(projectId: string, roomId: string) {
  const loaded = loadProject(projectId);
  assert.ok(loaded, 'project reloads');
  const room = loaded!.rooms.find((item) => item.id === roomId);
  assert.ok(room, 'room reloads');
  return room!;
}

before(() => fs.mkdirSync(STORE, { recursive: true }));
after(() => {
  for (const id of createdIds) {
    try { deleteProject(id); } catch { /* best-effort disposable cleanup */ }
  }
});

test('L3.1: ventilationBalance survives a later airtightnessClass update', () => {
  const { projectId, roomId } = roomProject();
  updateRoom(projectId, roomId, { air: { ventilationBalance: 'natural' } as any });
  updateRoom(projectId, roomId, { air: { airtightnessClass: 'average' } as any });
  const air = persistedRoom(projectId, roomId).air;
  assert.equal(air?.ventilationBalance, 'natural');
  assert.equal(air?.airtightnessClass, 'average');
});

test('L3.2: airtightnessClass survives a later ventilationBalance update', () => {
  const { projectId, roomId } = roomProject();
  updateRoom(projectId, roomId, { air: { airtightnessClass: 'good' } as any });
  updateRoom(projectId, roomId, { air: { ventilationBalance: 'balanced' } as any });
  const air = persistedRoom(projectId, roomId).air;
  assert.equal(air?.ventilationBalance, 'balanced');
  assert.equal(air?.airtightnessClass, 'good');
});

test('L3.3: constructionTier survives a later partial wall dimension update', () => {
  const { projectId, roomId } = roomProject();
  updateRoom(projectId, roomId, {
    envelope: { wallElements: [element('wall-1', { areaM2: 20, constructionTier: 'good', uValueSource: 'construction_profile' })] },
  } as any);
  updateRoom(projectId, roomId, {
    envelope: { wallElements: [{ elementId: 'wall-1', widthM: 5, heightM: 4 }] },
  } as any);
  const wall = persistedRoom(projectId, roomId).envelope?.wallElements[0];
  assert.equal(wall?.constructionTier, 'good');
  assert.equal(wall?.uValueSource, 'construction_profile');
  assert.equal(wall?.widthM, 5);
});

test('L3.4: window orientation update preserves sibling window fields and wall data', () => {
  const { projectId, roomId } = roomProject();
  updateRoom(projectId, roomId, {
    envelope: {
      wallElements: [element('wall-1', { areaM2: 20, constructionTier: 'average' })],
      windowElements: [element('window-1', { areaM2: 2, widthM: 1.5, heightM: 1.33, constructionTier: 'good', shadingProfile: 'interior', orientation: 'E' })],
      doorElements: [], roofElements: [], floorElements: [],
    },
  });
  updateRoom(projectId, roomId, {
    envelope: { windowElements: [{ elementId: 'window-1', orientation: 'S' }] },
  } as any);
  const envelope = persistedRoom(projectId, roomId).envelope;
  assert.equal(envelope?.windowElements[0].orientation, 'S');
  assert.equal(envelope?.windowElements[0].constructionTier, 'good');
  assert.equal(envelope?.windowElements[0].shadingProfile, 'interior');
  assert.equal(envelope?.wallElements[0].constructionTier, 'average');
});

test('L3.5: occupancy and occupancySource survive a later lighting update', () => {
  const { projectId, roomId } = roomProject();
  updateRoom(projectId, roomId, {
    internalGains: { occupancy: 2, occupancySource: 'user_explicit' } as any,
  });
  updateRoom(projectId, roomId, {
    internalGains: { lightingGainW: 120 } as any,
  });
  const gains = persistedRoom(projectId, roomId).internalGains;
  assert.equal(gains?.occupancy, 2);
  assert.equal(gains?.occupancySource, 'user_explicit');
  assert.equal(gains?.lightingGainW, 120);
});

test('L3.6: partial PATCH → persisted GET keeps all air fields', () => {
  const { projectId, roomId } = roomProject();
  updateRoom(projectId, roomId, { air: { ventilationBalance: 'natural' } as any });
  updateRoom(projectId, roomId, { air: { airtightnessClass: 'average', ventilationFlowM3h: 30 } as any });
  const air = persistedRoom(projectId, roomId).air;
  assert.deepEqual(
    { ventilationBalance: air?.ventilationBalance, airtightnessClass: air?.airtightnessClass, ventilationFlowM3h: air?.ventilationFlowM3h },
    { ventilationBalance: 'natural', airtightnessClass: 'average', ventilationFlowM3h: 30 },
  );
});

test('L3.7: partial PATCH → persisted GET keeps envelope categories', () => {
  const { projectId, roomId } = roomProject();
  updateRoom(projectId, roomId, {
    envelope: {
      wallElements: [element('wall-1', { areaM2: 20, constructionTier: 'good' })],
      windowElements: [element('window-1', { areaM2: 2, orientation: 'E', constructionTier: 'average', shadingProfile: 'none' })],
    },
  } as any);
  updateRoom(projectId, roomId, { envelope: { windowElements: [{ elementId: 'window-1', orientation: 'W' }] } } as any);
  const envelope = persistedRoom(projectId, roomId).envelope;
  assert.equal(envelope?.wallElements[0].constructionTier, 'good');
  assert.equal(envelope?.windowElements[0].orientation, 'W');
  assert.equal(envelope?.windowElements[0].shadingProfile, 'none');
});

test('L3.8: partial PATCH → persisted GET keeps internalGains categories', () => {
  const { projectId, roomId } = roomProject();
  updateRoom(projectId, roomId, { internalGains: { occupancy: 3, occupancySource: 'user_explicit' } as any });
  updateRoom(projectId, roomId, { internalGains: { equipmentGainW: 200 } as any });
  const gains = persistedRoom(projectId, roomId).internalGains;
  assert.equal(gains?.occupancy, 3);
  assert.equal(gains?.occupancySource, 'user_explicit');
  assert.equal(gains?.equipmentGainW, 200);
});

test('L3.14: explicit null clears only the explicitly cleared air field', () => {
  const { projectId, roomId } = roomProject();
  updateRoom(projectId, roomId, { air: { ventilationBalance: 'natural', airtightnessClass: 'average' } as any });
  updateRoom(projectId, roomId, { air: { ventilationBalance: null } as any });
  const air = persistedRoom(projectId, roomId).air;
  assert.equal(air?.ventilationBalance, null);
  assert.equal(air?.airtightnessClass, 'average');
});

test('L3.16: steady-state air constants remain unchanged', () => {
  assert.equal(AIR_CONSTANT, 0.34);
  assert.deepEqual(AIRTIGHTNESS_ACH_BASE, { poor: 0.8, average: 0.5, good: 0.3, high: 0.15 });
});

test('L3.19: legacy rooms without engineering objects still load and accept a sparse update', () => {
  const { projectId, roomId } = roomProject();
  const file = path.join(STORE, `${projectId}.json`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete raw.rooms[0].envelope;
  delete raw.rooms[0].air;
  delete raw.rooms[0].internalGains;
  fs.writeFileSync(file, JSON.stringify(raw, null, 2));

  const loaded = loadProject(projectId);
  assert.equal(loaded?.rooms[0].envelope, null);
  assert.equal(loaded?.rooms[0].air, null);
  assert.equal(loaded?.rooms[0].internalGains, null);
  updateRoom(projectId, roomId, { air: { ventilationBalance: 'natural' } as any });
  assert.equal(persistedRoom(projectId, roomId).air?.ventilationBalance, 'natural');
});
