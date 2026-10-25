/**
 * Building Project — Room Advanced Parameters persistence (Phase 2.6 final UI prep).
 *
 * Focused service-level tests for the Phase 1 advanced/extras room model used by
 * the «…» room panel: height override (nullable, inherits object height when
 * absent), glazing type (standard/large/panoramic/stained), insulation override,
 * conditions, notes. These fields are FACTS ONLY (engineeringUse: stored_only) —
 * no heat-loss coefficients, no kW/BTU, no SKU.
 *
 * Created as a separate suite so the existing counts stay untouched:
 *   building-project: 35, building-project-hydronics: 12, building-project-topology: 27.
 * Script: test:building-project-advanced.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { dataRoot } from '../paths.js';
import {
  addRoom,
  confirmObject,
  createProject,
  deleteProject,
  loadProject,
  updateRoom,
} from './buildingProjectService.js';

const STORE = path.join(dataRoot, 'building-projects');
const createdIds: string[] = [];

function track<T extends { id: string }>(p: T): T {
  createdIds.push(p.id);
  return p;
}

before(() => {
  fs.mkdirSync(STORE, { recursive: true });
});

after(() => {
  for (const id of createdIds) {
    try { deleteProject(id); } catch { /* ignore */ }
  }
});

function house(floorCount = 1, defaultCeilingHeightM = 2.7) {
  return track(createProject({
    objectType: 'private_house',
    regionCode: 'AM-ER',
    totalAreaM2: 300,
    floorCount,
    defaultCeilingHeightM,
  }));
}

test('ADV-A: advanced room extras survive reload', () => {
  const p = house(2);
  addRoom(p.id, {
    roomType: 'bedroom',
    name: 'Спальня',
    areaM2: 16,
    floorId: 'floor-1',
    extras: {
      geometry: { ceilingHeightM: 3.2 },
      windows: { glazingType: 'panoramic', count: 2, areaM2: 8 },
      insulationOverride: 'poor',
      conditions: ['corner_room', 'high_humidity'],
      notes: 'витраж на юг',
    },
  });
  const loaded = loadProject(p.id)!;
  const room = loaded.rooms[0];
  assert.equal(room.extras.geometry.ceilingHeightM, 3.2);
  assert.equal(room.extras.windows.glazingType, 'panoramic');
  assert.equal(room.extras.windows.count, 2);
  assert.equal(room.extras.windows.areaM2, 8);
  assert.equal(room.extras.insulationOverride, 'poor');
  assert.deepEqual(room.extras.conditions, ['corner_room', 'high_humidity']);
  assert.equal(room.extras.notes, 'витраж на юг');
  assert.equal(room.extras.engineeringUse, 'stored_only');
});

test('ADV-B: advanced edit keeps roomId/roomType/floorId', () => {
  const p = house(3);
  addRoom(p.id, { roomType: 'bedroom', name: 'Спальня', areaM2: 16, floorId: 'floor-2' });
  const before = loadProject(p.id)!.rooms[0];
  const updated = updateRoom(p.id, before.id, {
    extras: { ...before.extras, insulationOverride: 'poor', notes: 'утеплить' },
  });
  const after = updated.rooms.find((r) => r.id === before.id)!;
  assert.equal(after.id, before.id);
  assert.equal(after.roomType, 'bedroom');
  assert.equal(after.floorId, 'floor-2');
  assert.equal(after.extras.insulationOverride, 'poor');
  assert.equal(after.extras.notes, 'утеплить');
});

test('ADV-C: absent height override stays null (inherits object height, not written into room)', () => {
  const p = house(1, 2.7);
  addRoom(p.id, { roomType: 'bedroom', name: 'Спальня', areaM2: 16 });
  const loaded = loadProject(p.id)!;
  assert.equal(loaded.rooms[0].extras.geometry.ceilingHeightM, null);
  assert.equal(loaded.defaultCeilingHeightM, 2.7);
  // effective-height semantics is computed client-side as room ?? object
  const effective = loaded.rooms[0].extras.geometry.ceilingHeightM ?? loaded.defaultCeilingHeightM;
  assert.equal(effective, 2.7);
  // the object height must NOT be copied into the room record
  assert.equal(loaded.rooms[0].extras.geometry.ceilingHeightM, null);
});

test('ADV-D: explicit height override persists; clearing returns to inherited semantics', () => {
  const p = house(1, 2.7);
  addRoom(p.id, { roomType: 'bedroom', name: 'Спальня', areaM2: 16 });
  const id = loadProject(p.id)!.rooms[0].id;
  updateRoom(p.id, id, { extras: { geometry: { ceilingHeightM: 3.4 } } });
  assert.equal(loadProject(p.id)!.rooms[0].extras.geometry.ceilingHeightM, 3.4);
  updateRoom(p.id, id, { extras: { geometry: { ceilingHeightM: null } } });
  assert.equal(loadProject(p.id)!.rooms[0].extras.geometry.ceilingHeightM, null);
});

test('ADV-E: large-window/vitrage/poor-insulation are stored facts only (no coefficients)', () => {
  const p = house(2);
  addRoom(p.id, {
    roomType: 'living_room',
    name: 'Гостиная',
    areaM2: 30,
    floorId: 'floor-1',
    extras: { windows: { glazingType: 'stained', count: 3, areaM2: 12 }, insulationOverride: 'poor', conditions: ['high_heat_loss'] },
  });
  addRoom(p.id, {
    roomType: 'bedroom',
    name: 'Спальня',
    areaM2: 16,
    floorId: 'floor-2',
    extras: { windows: { glazingType: 'large', count: 2, areaM2: 6 } },
  });
  confirmObject(p.id);
  const loaded = loadProject(p.id)!;
  const living = loaded.rooms.find((r) => r.name === 'Гостиная')!;
  assert.equal(living.extras.windows.glazingType, 'stained');
  assert.equal(living.extras.insulationOverride, 'poor');
  assert.equal((living as any).heatLossCoefficient, undefined);
  assert.equal((living as any).uValue, undefined);
  // systems config (auto-created at object confirm) must not invent engineering numbers
  const cfg = loaded.systemsConfiguration!;
  const json = JSON.stringify(cfg).toLowerCase();
  assert.ok(!json.includes('heatloss'));
  assert.ok(!json.includes('powerkw'));
  assert.ok(!json.includes('btu'));
});

test('ADV-F: object snapshot freezes room advanced data', () => {
  const p = house(1);
  addRoom(p.id, {
    roomType: 'bedroom',
    name: 'Спальня',
    areaM2: 16,
    extras: { windows: { glazingType: 'panoramic' }, insulationOverride: 'medium', notes: 'snap' },
  });
  confirmObject(p.id);
  const snap = loadProject(p.id)!.objectConfirmedSnapshot!;
  const sroom = snap.rooms[0];
  assert.equal(sroom.extras.windows.glazingType, 'panoramic');
  assert.equal(sroom.extras.insulationOverride, 'medium');
  assert.equal(sroom.extras.notes, 'snap');
});

test('ADV-G: multi-floor advanced data stays with the right floorId after reload', () => {
  const p = house(3);
  addRoom(p.id, { roomType: 'bedroom', name: 'Спальня 1', areaM2: 16, floorId: 'floor-1', extras: { windows: { glazingType: 'large' } } });
  addRoom(p.id, { roomType: 'bedroom', name: 'Спальня 2', areaM2: 18, floorId: 'floor-2', extras: { windows: { glazingType: 'stained' }, insulationOverride: 'poor' } });
  addRoom(p.id, { roomType: 'living_room', name: 'Гостиная', areaM2: 30, floorId: 'floor-3', extras: { notes: 'третий этаж' } });
  const loaded = loadProject(p.id)!;
  const byFloor = Object.fromEntries(loaded.rooms.map((r) => [r.floorId, r]));
  assert.equal(byFloor['floor-1'].extras.windows.glazingType, 'large');
  assert.equal(byFloor['floor-2'].extras.windows.glazingType, 'stained');
  assert.equal(byFloor['floor-2'].extras.insulationOverride, 'poor');
  assert.equal(byFloor['floor-3'].extras.notes, 'третий этаж');
  assert.equal(byFloor['floor-3'].floorId, 'floor-3');
});
