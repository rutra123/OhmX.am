/**
 * Phase 3.2a — Transmission Core regression tests.
 * Pure engine tests (computeRoomTransmission); no build/test pipeline run by the agent.
 * Run: cd server && npx tsx --test src/utils/buildingProjectTransmission.test.ts
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  computeRoomTransmission,
  STEADY_STATE_METHOD_ID,
  STEADY_STATE_METHOD_VERSION,
} from './buildingProjectTransmission.js';
import type { QuickClimateLocation } from './buildingProjectQuickLoadV1.js';
import type { BuildingProject, BuildingRoom, EnvelopeElement, RoomEnvelope } from './buildingProjectTypes.js';

function loc(heatingC: number, coolingC: number): QuickClimateLocation {
  return {
    id: 'synthetic', labelRu: 'Synthetic', labelHy: 'Synthetic', station: 'X', elevationM: 0,
    climateZone: 'X', regionId: null, observationPeriod: 'X',
    heatingOutdoorDesignC: heatingC, coolingOutdoorDesignC: coolingC,
    sourceTableHeating: 'T', sourceRowHeating: 1, sourceTableCooling: 'T', sourceRowCooling: 1,
  };
}

function project(insulationLevel: 'poor' | 'medium' | 'good' | 'unknown' = 'unknown'): BuildingProject {
  return {
    id: 'p1', name: 'p', status: 'calculated', createdAt: '', updatedAt: '',
    objectConfirmedAt: 'x', objectConfirmedRevision: 1, buildingRevision: 1,
    objectType: 'private_house', region: { code: 'AM-ER', name: 'Ереван' },
    totalAreaM2: null, defaultCeilingHeightM: 2.7, insulationLevel, topology: null, rooms: [],
    selectedSystems: [], systemsRevision: 1, systemsConfiguration: null, systemsConfigurationSnapshot: null,
    objectConfirmedSnapshot: null,
  };
}

function el(elementId: string, over: Partial<EnvelopeElement> = {}): EnvelopeElement {
  return {
    elementId, areaM2: null, widthM: null, heightM: null, grossAreaM2: null, openingIds: null,
    count: null, uValue: null, constructionTier: null, uValueSource: null,
    orientation: null, shgc: null, shadingFactor: null, source: null, ...over,
  };
}

function env(over: Partial<RoomEnvelope> = {}): RoomEnvelope {
  return { wallElements: [], windowElements: [], doorElements: [], roofElements: [], floorElements: [], ...over };
}

function room(envelope: RoomEnvelope | null, areaM2 = 20): BuildingRoom {
  return {
    id: 'r1', roomType: 'living_room', name: 'Room 1', areaM2, floorId: null,
    extras: {
      geometry: { ceilingHeightM: 2.7, externalWallCount: null, floorPosition: null, spaceAbove: null, spaceBelow: null },
      windows: { glazingType: null, count: null, areaM2: null },
      insulationOverride: null, conditions: [], notes: null, engineeringUse: 'stored_only',
    },
    envelope,
  };
}

// ΔT_heat = 20 − (−20) = 40 K for a living_room (Tin=20°C).
const D40 = loc(-20, 24);

test('method constants', () => {
  assert.equal(STEADY_STATE_METHOD_ID, 'ohmx.steady-state.v1');
  assert.equal(STEADY_STATE_METHOD_VERSION, '1.0.0');
});

// --- Exact fixtures ---

test('single wall U=0.6 A=10 dT=40 → 240 W heating, 0 W cooling (no negative)', () => {
  const res = computeRoomTransmission(project(), room(env({ wallElements: [el('w1', { areaM2: 10, uValue: 0.6 })] })), D40);
  assert.equal(res.status, 'calculated');
  assert.equal(res.heatingW, 240);
  assert.equal(res.coolingW, 0);
  assert.ok(Number.isFinite(res.heatingW));
  assert.ok(Number.isFinite(res.coolingW));
});

test('wall gross 10 + window 2 → net 8 → 416 W total', () => {
  const res = computeRoomTransmission(
    project(),
    room(env({
      wallElements: [el('wall1', { grossAreaM2: 10, openingIds: ['win1'], uValue: 0.6 })],
      windowElements: [el('win1', { areaM2: 2, uValue: 2.8 })],
    })),
    D40,
  );
  assert.equal(res.status, 'calculated');
  assert.equal(res.heatingW, 416); // 8×0.6×40=192 + 2×2.8×40=224
});

test('width × height gives area (no explicit areaM2)', () => {
  const res = computeRoomTransmission(project(), room(env({ wallElements: [el('w1', { widthM: 5, heightM: 2, uValue: 0.6 })] })), D40);
  assert.equal(res.status, 'calculated');
  assert.equal(res.heatingW, 240); // 5×2=10 → 10×0.6×40
});

// --- Sensitivity ---

test('area ↑ → transmission ↑', () => {
  const a = computeRoomTransmission(project(), room(env({ wallElements: [el('w1', { areaM2: 10, uValue: 0.6 })] })), D40);
  const b = computeRoomTransmission(project(), room(env({ wallElements: [el('w1', { areaM2: 20, uValue: 0.6 })] })), D40);
  assert.ok((b.heatingW as number) > (a.heatingW as number));
});

test('U ↑ → transmission ↑', () => {
  const a = computeRoomTransmission(project(), room(env({ wallElements: [el('w1', { areaM2: 10, uValue: 0.6 })] })), D40);
  const b = computeRoomTransmission(project(), room(env({ wallElements: [el('w1', { areaM2: 10, uValue: 1.5 })] })), D40);
  assert.ok((b.heatingW as number) > (a.heatingW as number));
});

test('colder climate → heating transmission ↑', () => {
  const warm = computeRoomTransmission(project(), room(env({ wallElements: [el('w1', { areaM2: 10, uValue: 0.6 })] })), loc(-10, 24));
  const cold = computeRoomTransmission(project(), room(env({ wallElements: [el('w1', { areaM2: 10, uValue: 0.6 })] })), loc(-30, 24));
  assert.ok((cold.heatingW as number) > (warm.heatingW as number));
});

test('hotter climate → cooling transmission ↑', () => {
  const mild = computeRoomTransmission(project(), room(env({ wallElements: [el('w1', { areaM2: 10, uValue: 0.6 })] })), loc(-20, 28));
  const hot = computeRoomTransmission(project(), room(env({ wallElements: [el('w1', { areaM2: 10, uValue: 0.6 })] })), loc(-20, 38));
  assert.ok((hot.coolingW as number) > (mild.coolingW as number));
});

test('better construction → transmission ↓', () => {
  const poor = computeRoomTransmission(project(), room(env({ wallElements: [el('w1', { areaM2: 10, constructionTier: 'poor' })] })), D40);
  const good = computeRoomTransmission(project(), room(env({ wallElements: [el('w1', { areaM2: 10, constructionTier: 'good' })] })), D40);
  assert.ok((good.heatingW as number) < (poor.heatingW as number));
});

test('larger window with worse U → transmission ↑', () => {
  const small = computeRoomTransmission(project(), room(env({ windowElements: [el('w1', { areaM2: 2, uValue: 2.8 })] })), D40);
  const big = computeRoomTransmission(project(), room(env({ windowElements: [el('w1', { areaM2: 4, uValue: 5.0 })] })), D40);
  assert.ok((big.heatingW as number) > (small.heatingW as number));
});

// --- Safety ---

test('area=0 → 0 contribution (no NaN)', () => {
  const res = computeRoomTransmission(project(), room(env({ wallElements: [el('w1', { areaM2: 0, uValue: 0.6 })] })), D40);
  assert.equal(res.status, 'calculated');
  assert.equal(res.heatingW, 0);
  assert.ok(Number.isFinite(res.heatingW));
});

test('negative area → missing (no negative load)', () => {
  const res = computeRoomTransmission(project(), room(env({ wallElements: [el('w1', { areaM2: -5, uValue: 0.6 })] })), D40);
  assert.equal(res.status, 'missing_input');
  assert.equal(res.heatingW, null);
});

test('NaN area → missing', () => {
  const res = computeRoomTransmission(project(), room(env({ wallElements: [el('w1', { areaM2: NaN, uValue: 0.6 })] })), D40);
  assert.equal(res.status, 'missing_input');
});

test('Infinity area → missing', () => {
  const res = computeRoomTransmission(project(), room(env({ wallElements: [el('w1', { areaM2: Infinity, uValue: 0.6 })] })), D40);
  assert.equal(res.status, 'missing_input');
});

test('missing U (unknown insulation, no tier) → missing (no hidden default)', () => {
  const res = computeRoomTransmission(project('unknown'), room(env({ wallElements: [el('w1', { areaM2: 10 })] })), D40);
  assert.equal(res.status, 'missing_input');
  assert.equal(res.heatingW, null);
  assert.ok(res.missingInputs.some((m) => m.startsWith('u_value:missing')));
});

test('openings > gross wall → missing (never negative net area)', () => {
  const res = computeRoomTransmission(
    project(),
    room(env({
      wallElements: [el('wall1', { grossAreaM2: 5, openingIds: ['win1'], uValue: 0.6 })],
      windowElements: [el('win1', { areaM2: 10, uValue: 2.8 })],
    })),
    D40,
  );
  assert.equal(res.status, 'missing_input');
  assert.ok(res.missingInputs.some((m) => m.startsWith('openings_exceed_wall_area')));
});

test('duplicate elementId → warning + first wins (no double count)', () => {
  const res = computeRoomTransmission(
    project(),
    room(env({ wallElements: [el('w1', { areaM2: 10, uValue: 0.6 }), el('w1', { areaM2: 99, uValue: 0.6 })] })),
    D40,
  );
  assert.ok(res.warnings.some((w) => w.startsWith('duplicate_element_id')));
  assert.equal(res.heatingW, 240); // first wins, second ignored
});

test('empty envelope → missing (envelope:missing)', () => {
  const res = computeRoomTransmission(project(), room(env({})), D40);
  assert.equal(res.status, 'missing_input');
  assert.ok(res.missingInputs.includes('envelope:missing'));
});

test('null envelope → missing (envelope:missing)', () => {
  const res = computeRoomTransmission(project(), room(null), D40);
  assert.equal(res.status, 'missing_input');
  assert.ok(res.missingInputs.includes('envelope:missing'));
});

test('unsupported climate location (null) → missing', () => {
  const res = computeRoomTransmission(project(), room(env({ wallElements: [el('w1', { areaM2: 10, uValue: 0.6 })] })), null);
  assert.equal(res.status, 'missing_input');
  assert.ok(res.missingInputs.includes('climate_location:missing_climate_location'));
});

// --- Determinism ---

test('reorder elements → same total', () => {
  const a = computeRoomTransmission(project(), room(env({ wallElements: [el('w1', { areaM2: 5, uValue: 0.5 }), el('w2', { areaM2: 3, uValue: 0.5 })] })), D40);
  const b = computeRoomTransmission(project(), room(env({ wallElements: [el('w2', { areaM2: 3, uValue: 0.5 }), el('w1', { areaM2: 5, uValue: 0.5 })] })), D40);
  assert.equal(a.heatingW, b.heatingW); // 160 W
});

test('rename room → same engineering result', () => {
  const base = room(env({ wallElements: [el('w1', { areaM2: 10, uValue: 0.6 })] }));
  const a = computeRoomTransmission(project(), base, D40);
  const b = computeRoomTransmission(project(), { ...base, name: 'Renamed' }, D40);
  assert.equal(a.heatingW, b.heatingW);
});

test('legacy insulation seed: medium → average profile (provenance)', () => {
  const res = computeRoomTransmission(project('medium'), room(env({ wallElements: [el('w1', { areaM2: 10 })] })), D40);
  assert.equal(res.status, 'calculated');
  assert.equal(res.heatingW, 240); // average wall U=0.6 → 10×0.6×40
  const contrib = res.breakdown.find((c) => c.elementId === 'w1');
  assert.equal(contrib?.uValueSource, 'legacy_insulation_seed');
  assert.equal(contrib?.uValue, 0.6);
});
