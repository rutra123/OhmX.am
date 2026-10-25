/**
 * Phase 3.2K — engineering-chip payload survives the REAL reload path.
 *
 * Root-cause evidence for the "engineering chips don't save" defect: the
 * current SOURCE round-trips `envelope` / `air` / `internalGains` through
 * updateRoom → saveProject → loadProject. (The live deployed service predates
 * this and drops these fields; see the Phase 3.2K report — that is a deploy
 * step, not a source fix.)
 *
 * Run: cd server && npx tsx --test src/utils/buildingProjectPhase32k.test.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { dataRoot } from '../paths.js';
import { addRoom, createProject, deleteProject, loadProject, updateRoom } from './buildingProjectService.js';
import type { EnvelopeElement } from './buildingProjectTypes.js';

const STORE = path.join(dataRoot, 'building-projects');
const createdIds: string[] = [];
function track<T extends { id: string }>(p: T): T {
  createdIds.push(p.id);
  return p;
}

function el(id: string, extra: Partial<EnvelopeElement> = {}): EnvelopeElement {
  return {
    elementId: id, areaM2: null, widthM: null, heightM: null, grossAreaM2: null, openingIds: null, count: null,
    uValue: null, constructionTier: null, uValueSource: null, orientation: null, shgc: null, shadingFactor: null,
    shadingProfile: null, source: null, ...extra,
  };
}

before(() => fs.mkdirSync(STORE, { recursive: true }));
after(() => {
  for (const id of createdIds) {
    try { deleteProject(id); } catch { /* ignore */ }
  }
});

test('H2: chip payload (tier + air + gains) survives updateRoom → reload', () => {
  const p = track(createProject({ objectType: 'private_house', regionCode: 'AM-ER' }));
  const withRoom = track(addRoom(p.id, { roomType: 'bedroom', name: 'Спальня', areaM2: 14 }));
  const roomId = withRoom.rooms[0].id;

  updateRoom(p.id, roomId, {
    envelope: {
      wallElements: [el('wall-32k', { areaM2: 9.5, constructionTier: 'good', uValueSource: 'construction_profile' })],
      windowElements: [], doorElements: [], roofElements: [], floorElements: [],
    },
    air: { ventilationBalance: 'natural', ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: 'average' },
    internalGains: { occupancy: 2, occupancySource: 'user_explicit', occupantSensibleWPerPerson: null, peopleW: null, lightingGainW: null, equipmentGainW: null },
  });

  const reloaded = loadProject(p.id);
  assert.ok(reloaded, 'project reloads');
  const r = reloaded!.rooms.find((x) => x.id === roomId);
  assert.ok(r?.envelope, 'envelope persisted (not dropped)');
  assert.equal(r!.envelope!.wallElements[0].constructionTier, 'good');
  assert.equal(r!.envelope!.wallElements[0].uValueSource, 'construction_profile');
  assert.equal(r!.air?.ventilationBalance, 'natural');
  assert.equal(r!.air?.airtightnessClass, 'average');
  assert.equal(r!.internalGains?.occupancy, 2);
  assert.equal(r!.internalGains?.occupancySource, 'user_explicit');
});

test('H2: an invalid enum is dropped by the normalizer (never a fabricated default)', () => {
  const p = track(createProject({ objectType: 'private_house', regionCode: 'AM-ER' }));
  const withRoom = track(addRoom(p.id, { roomType: 'living_room', name: 'Гостиная', areaM2: 20 }));
  const roomId = withRoom.rooms[0].id;

  updateRoom(p.id, roomId, {
    envelope: {
      wallElements: [el('wall-bad', { areaM2: 10, constructionTier: 'not_a_tier' as unknown as EnvelopeElement['constructionTier'] })],
      windowElements: [], doorElements: [], roofElements: [], floorElements: [],
    },
  });

  const reloaded = loadProject(p.id);
  const r = reloaded!.rooms.find((x) => x.id === roomId);
  assert.equal(r!.envelope!.wallElements[0].constructionTier, null);
});