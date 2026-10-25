/**
 * Phase 3.2d — Snapshot & Reproducibility regression tests.
 * Run: cd server && npx tsx --test src/utils/buildingProjectLoadsSnapshot.test.ts
 */
import * as assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { dataRoot } from '../paths.js';
import { addRoom, createProject, deleteProject, loadProject, updateRoom } from './buildingProjectService.js';
import { buildLoadInputSnapshot } from './buildingProjectLoads.js';
import type {
  BuildingProject,
  BuildingRoom,
  EnvelopeElement,
  RoomAir,
  RoomEnvelope,
  RoomInternalGains,
} from './buildingProjectTypes.js';

const createdIds: string[] = [];
function track<T extends { id: string }>(p: T): T {
  createdIds.push(p.id);
  return p;
}
after(() => {
  for (const id of createdIds) {
    try { deleteProject(id); } catch { /* ignore */ }
  }
});
void dataRoot;

// ---------- pure fixtures ----------

function el(id: string, over: Partial<EnvelopeElement> = {}): EnvelopeElement {
  return {
    elementId: id, areaM2: null, widthM: null, heightM: null, grossAreaM2: null, openingIds: null, count: null,
    uValue: null, constructionTier: null, uValueSource: null, orientation: null, shgc: null, shadingFactor: null,
    shadingProfile: null, source: null, ...over,
  };
}
function envelope(over: Partial<RoomEnvelope> = {}): RoomEnvelope {
  return { wallElements: [], windowElements: [], doorElements: [], roofElements: [], floorElements: [], ...over };
}
function air(over: Partial<RoomAir> = {}): RoomAir {
  return { ventilationBalance: null, ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: null, ...over };
}
function igg(over: Partial<RoomInternalGains> = {}): RoomInternalGains {
  return { occupancy: null, occupantSensibleWPerPerson: null, peopleW: null, lightingGainW: null, equipmentGainW: null, ...over };
}
function room(over: Partial<BuildingRoom> = {}): BuildingRoom {
  return {
    id: 'r1', roomType: 'bedroom', name: 'R1', areaM2: 20, floorId: null,
    extras: {
      geometry: { ceilingHeightM: 2.5, externalWallCount: null, floorPosition: null, spaceAbove: null, spaceBelow: null },
      windows: { glazingType: null, count: null, areaM2: null },
      insulationOverride: null, conditions: [], notes: null, engineeringUse: 'stored_only',
    },
    ...over,
  };
}
function project(rooms: BuildingRoom[]): BuildingProject {
  return {
    id: 'p1', name: 'p', status: 'calculated', createdAt: '', updatedAt: '', objectConfirmedAt: 'x',
    objectConfirmedRevision: 1, buildingRevision: 1, objectType: 'apartment', region: { code: 'AM-ER', name: 'Ереван' },
    totalAreaM2: null, defaultCeilingHeightM: 2.5, insulationLevel: 'unknown', topology: null, rooms,
    selectedSystems: [], systemsRevision: 1, systemsConfiguration: null, systemsConfigurationSnapshot: null,
    objectConfirmedSnapshot: null,
  };
}
const SNAP = (p: BuildingProject) => buildLoadInputSnapshot(p, 'steady_state', '1.0.0');

// ---------- 1..3 — capture ----------

test('snapshot captures envelope (elements + provenance)', () => {
  const snap = SNAP(project([room({ envelope: envelope({ wallElements: [el('w1', { areaM2: 10, uValue: 0.6, uValueSource: 'certificate' })], windowElements: [el('w2', { orientation: 'S', shgc: 0.5, shadingFactor: 0.5 })] }) })]));
  const r = snap.rooms[0];
  assert.equal(r.envelope?.wallElements[0].areaM2, 10);
  assert.equal(r.envelope?.wallElements[0].uValue, 0.6);
  assert.equal(r.envelope?.wallElements[0].uValueSource, 'certificate');
  assert.equal(r.envelope?.windowElements[0].orientation, 'S');
  assert.equal(r.envelope?.windowElements[0].shgc, 0.5);
});

test('snapshot captures air (all input fields)', () => {
  const snap = SNAP(project([room({ air: air({ ventilationBalance: 'balanced', ventilationFlowM3h: 30, infiltrationFlowM3h: 20, airChangesPerHour: 0.5, ach50: 10, airtightnessClass: 'average' }) })]));
  const a = snap.rooms[0].air;
  assert.equal(a?.ventilationBalance, 'balanced');
  assert.equal(a?.ventilationFlowM3h, 30);
  assert.equal(a?.infiltrationFlowM3h, 20);
  assert.equal(a?.airChangesPerHour, 0.5);
  assert.equal(a?.ach50, 10);
  assert.equal(a?.airtightnessClass, 'average');
});

test('snapshot captures internalGains (all input fields)', () => {
  const snap = SNAP(project([room({ internalGains: igg({ occupancy: 2, occupantSensibleWPerPerson: 100, peopleW: null, lightingGainW: 200, equipmentGainW: 150 }) })]));
  const g = snap.rooms[0].internalGains;
  assert.equal(g?.occupancy, 2);
  assert.equal(g?.occupantSensibleWPerPerson, 100);
  assert.equal(g?.lightingGainW, 200);
  assert.equal(g?.equipmentGainW, 150);
});

// ---------- 4 — immutability ----------

test('historical snapshot is not mutated by a later room edit (deep copy)', () => {
  const r = room({ envelope: envelope({ wallElements: [el('w1', { areaM2: 10, uValue: 0.6 })] }), air: air({ airChangesPerHour: 0.5 }), internalGains: igg({ occupancy: 2 }) });
  const snap = SNAP(project([r]));
  // Mutate the live room AFTER snapshot capture.
  r.envelope!.wallElements[0].areaM2 = 999;
  r.envelope!.wallElements.push(el('w2', { areaM2: 5 }));
  r.air!.airChangesPerHour = 9;
  r.internalGains!.occupancy = 9;
  // Snapshot must remain the captured state.
  assert.equal(snap.rooms[0].envelope?.wallElements.length, 1);
  assert.equal(snap.rooms[0].envelope?.wallElements[0].areaM2, 10);
  assert.equal(snap.rooms[0].air?.airChangesPerHour, 0.5);
  assert.equal(snap.rooms[0].internalGains?.occupancy, 2);
});

// ---------- 5..7 — input change → snapshot differs ----------

test('changing envelope produces a different snapshot', () => {
  const s1 = SNAP(project([room({ envelope: envelope({ wallElements: [el('w1', { areaM2: 10, uValue: 0.6 })] }) })]));
  const s2 = SNAP(project([room({ envelope: envelope({ wallElements: [el('w1', { areaM2: 20, uValue: 0.6 })] }) })]));
  assert.notDeepEqual(s1, s2);
});

test('changing air produces a different snapshot', () => {
  const s1 = SNAP(project([room({ air: air({ airChangesPerHour: 0.5 }) })]));
  const s2 = SNAP(project([room({ air: air({ airChangesPerHour: 1.0 }) })]));
  assert.notDeepEqual(s1, s2);
});

test('changing internalGains produces a different snapshot', () => {
  const s1 = SNAP(project([room({ internalGains: igg({ occupancy: 2 }) })]));
  const s2 = SNAP(project([room({ internalGains: igg({ occupancy: 4 }) })]));
  assert.notDeepEqual(s1, s2);
});

// ---------- 8 — legacy compatibility ----------

test('legacy snapshot without envelope/air/internalGains loads safely', () => {
  const snap = SNAP(project([room({ envelope: envelope({ wallElements: [el('w1', { areaM2: 10 })] }) })]));
  const legacy: any = JSON.parse(JSON.stringify(snap));
  delete legacy.rooms[0].envelope;
  delete legacy.rooms[0].air;
  delete legacy.rooms[0].internalGains;
  // New fields are simply absent (undefined) on legacy snapshots — no throw, no fabrication.
  assert.equal(legacy.rooms[0].envelope, undefined);
  assert.equal(legacy.rooms[0].air, undefined);
  assert.equal(legacy.rooms[0].internalGains, undefined);
  assert.equal(legacy.rooms[0].areaM2, 20);
  assert.equal(legacy.rooms[0].roomType, 'bedroom');
});

// ---------- 9 — NaN / Infinity sanitization ----------

test('NaN/Infinity never leak into the snapshot (coerced to null)', () => {
  const r = room({
    envelope: envelope({ windowElements: [el('w1', { areaM2: 2, orientation: 'S', shgc: NaN, shadingFactor: Infinity, uValue: NaN })] }),
    air: air({ airChangesPerHour: NaN, infiltrationFlowM3h: Infinity }),
    internalGains: igg({ occupancy: Infinity }),
  });
  const snap = SNAP(project([r]));
  assert.equal(snap.rooms[0].envelope?.windowElements[0].shgc, null);
  assert.equal(snap.rooms[0].envelope?.windowElements[0].shadingFactor, null);
  assert.equal(snap.rooms[0].envelope?.windowElements[0].uValue, null);
  assert.equal(snap.rooms[0].air?.airChangesPerHour, null);
  assert.equal(snap.rooms[0].air?.infiltrationFlowM3h, null);
  assert.equal(snap.rooms[0].internalGains?.occupancy, null);
});

// ---------- 10 — null / missing honesty ----------

test('null/missing are preserved honestly (no invented defaults)', () => {
  // Room with no engineering inputs at all.
  const snap = SNAP(project([room({})]));
  assert.equal(snap.rooms[0].envelope, null);
  assert.equal(snap.rooms[0].air, null);
  assert.equal(snap.rooms[0].internalGains, null);

  // Room with an explicitly-empty envelope → captured as an empty envelope (not null).
  const snap2 = SNAP(project([room({ envelope: envelope({}) })]));
  assert.deepEqual(snap2.rooms[0].envelope, { wallElements: [], windowElements: [], doorElements: [], roofElements: [], floorElements: [] });
});

// ---------- 11 — stale enabler: updateRoom applies + bumps revision ----------

test('updateRoom applies envelope/air/internalGains and bumps buildingRevision (marks loads stale)', () => {
  const p = track(createProject({ objectType: 'apartment', regionCode: 'AM-ER' }));
  addRoom(p.id, { roomType: 'bedroom', name: 'R', areaM2: 20 });
  const before = loadProject(p.id)!;
  const revBefore = before.buildingRevision;

  updateRoom(p.id, before.rooms[0].id, {
    envelope: { wallElements: [el('w1', { areaM2: 10, uValue: 0.6 })], windowElements: [], doorElements: [], roofElements: [], floorElements: [] },
    air: { ventilationBalance: 'none', ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: 0.5, ach50: null, airtightnessClass: null },
    internalGains: { occupancy: 2, occupantSensibleWPerPerson: null, peopleW: null, lightingGainW: null, equipmentGainW: null },
  });

  const after = loadProject(p.id)!;
  const r = after.rooms[0];
  assert.equal(r.envelope?.wallElements.length, 1);
  assert.equal(r.envelope?.wallElements[0].uValue, 0.6);
  assert.equal(r.air?.ventilationBalance, 'none');
  assert.equal(r.air?.airChangesPerHour, 0.5);
  assert.equal(r.internalGains?.occupancy, 2);
  assert.ok(after.buildingRevision > revBefore, 'buildingRevision must bump on an engineering-input edit');
});