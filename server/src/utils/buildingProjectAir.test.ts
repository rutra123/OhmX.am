/**
 * Phase 3.2b — Air (ventilation + infiltration) regression tests.
 * Run: cd server && npx tsx --test src/utils/buildingProjectAir.test.ts
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { AIR_CONSTANT, ACH50_DIVISOR, computeRoomAir } from './buildingProjectAir.js';
import type { QuickClimateLocation } from './buildingProjectQuickLoadV1.js';
import type { BuildingProject, BuildingRoom, RoomAir } from './buildingProjectTypes.js';

function loc(heatingC: number, coolingC: number): QuickClimateLocation {
  return {
    id: 'synthetic', labelRu: 'S', labelHy: 'S', station: 'X', elevationM: 0, climateZone: 'X', regionId: null,
    observationPeriod: 'X', heatingOutdoorDesignC: heatingC, coolingOutdoorDesignC: coolingC,
    sourceTableHeating: 'T', sourceRowHeating: 1, sourceTableCooling: 'T', sourceRowCooling: 1,
  };
}

function project(objectType: 'apartment' | 'private_house' | 'commercial' = 'private_house'): BuildingProject {
  return {
    id: 'p1', name: 'p', status: 'calculated', createdAt: '', updatedAt: '', objectConfirmedAt: 'x',
    objectConfirmedRevision: 1, buildingRevision: 1, objectType, region: { code: 'AM-ER', name: 'Ереван' },
    totalAreaM2: null, defaultCeilingHeightM: 2.5, insulationLevel: 'unknown', topology: null, rooms: [],
    selectedSystems: [], systemsRevision: 1, systemsConfiguration: null, systemsConfigurationSnapshot: null,
    objectConfirmedSnapshot: null,
  };
}

function air(over: Partial<RoomAir> = {}): RoomAir {
  return {
    ventilationBalance: null, ventilationFlowM3h: null, infiltrationFlowM3h: null,
    airChangesPerHour: null, ach50: null, airtightnessClass: null, ...over,
  };
}

function room(airInput: RoomAir | null, areaM2 = 20, heightM = 2.5): BuildingRoom {
  return {
    id: 'r1', roomType: 'living_room', name: 'R1', areaM2, floorId: null,
    extras: {
      geometry: { ceilingHeightM: heightM, externalWallCount: null, floorPosition: null, spaceAbove: null, spaceBelow: null },
      windows: { glazingType: null, count: null, areaM2: null },
      insulationOverride: null, conditions: [], notes: null, engineeringUse: 'stored_only',
    },
    air: airInput,
  };
}

// living_room Tin=20°C; heating ΔT = 20 − (−20) = 40 K; cooling ΔT = max(0, 24−24) = 0.
const D40 = loc(-20, 24);

// --- Exact fixtures ---

test('A: V=50 ACH=0.5 dT=40 → V_inf=25, Q_air=340 W', () => {
  const res = computeRoomAir(project(), room(air({ ventilationBalance: 'none', airChangesPerHour: 0.5 })), D40);
  assert.equal(res.status, 'calculated');
  assert.equal(res.breakdown.roomVolumeM3, 50);
  assert.equal(res.breakdown.infiltrationFlowM3h, 25);
  assert.equal(res.breakdown.effectiveOutdoorAirFlowM3h, 25);
  assert.equal(res.heatingW, 340); // 0.34 × 25 × 40
  assert.equal(res.coolingW, 0);
  assert.equal(res.breakdown.infiltrationSource, 'explicit_ach');
});

test('B: balanced V_vent=30 V_inf=20 → V_air=50', () => {
  const res = computeRoomAir(project(), room(air({ ventilationBalance: 'balanced', ventilationFlowM3h: 30, infiltrationFlowM3h: 20 })), D40);
  assert.equal(res.breakdown.effectiveOutdoorAirFlowM3h, 50);
  assert.equal(res.heatingW, 0.34 * 50 * 40);
});

test('C: supply_only V_vent=30 V_inf=20 → V_air=30', () => {
  const res = computeRoomAir(project(), room(air({ ventilationBalance: 'supply_only', ventilationFlowM3h: 30, infiltrationFlowM3h: 20 })), D40);
  assert.equal(res.breakdown.effectiveOutdoorAirFlowM3h, 30);
});

test('D: exhaust_only max(V_vent,V_inf)', () => {
  const a = computeRoomAir(project(), room(air({ ventilationBalance: 'exhaust_only', ventilationFlowM3h: 30, infiltrationFlowM3h: 20 })), D40);
  assert.equal(a.breakdown.effectiveOutdoorAirFlowM3h, 30);
  const b = computeRoomAir(project(), room(air({ ventilationBalance: 'exhaust_only', ventilationFlowM3h: 20, infiltrationFlowM3h: 30 })), D40);
  assert.equal(b.breakdown.effectiveOutdoorAirFlowM3h, 30);
});

test('E: unknown V_vent=30 V_inf=20 → V_air=50', () => {
  const res = computeRoomAir(project(), room(air({ ventilationBalance: 'unknown', ventilationFlowM3h: 30, infiltrationFlowM3h: 20 })), D40);
  assert.equal(res.breakdown.effectiveOutdoorAirFlowM3h, 50);
});

test('natural behaves like none (infiltration only)', () => {
  const res = computeRoomAir(project(), room(air({ ventilationBalance: 'natural', airChangesPerHour: 0.5 })), D40);
  assert.equal(res.breakdown.effectiveOutdoorAirFlowM3h, 25);
});

// --- Sensitivity ---

test('ACH ↑ → air heating load ↑', () => {
  const a = computeRoomAir(project(), room(air({ ventilationBalance: 'none', airChangesPerHour: 0.5 })), D40);
  const b = computeRoomAir(project(), room(air({ ventilationBalance: 'none', airChangesPerHour: 1.0 })), D40);
  assert.ok((b.heatingW as number) > (a.heatingW as number));
});

test('volume ↑ → infiltration load ↑ (explicit ACH: V_inf = ACH × V_room)', () => {
  // Only room volume differs (area 20→40, same height 2.5): same ACH, same
  // ventilationBalance, same climate, no higher-priority fixed airflow.
  const a = computeRoomAir(project(), room(air({ ventilationBalance: 'none', airChangesPerHour: 0.5 }), 20, 2.5), D40);
  const b = computeRoomAir(project(), room(air({ ventilationBalance: 'none', airChangesPerHour: 0.5 }), 40, 2.5), D40);
  // Provenance: must be ACH-derived (not a fixed measured flow that would be volume-independent).
  assert.equal(a.breakdown.infiltrationSource, 'explicit_ach');
  assert.equal(b.breakdown.infiltrationSource, 'explicit_ach');
  // V_room doubles 50 → 100 m³, so V_inf = ACH × V_room doubles 25 → 50 m³/h.
  assert.equal(a.breakdown.roomVolumeM3, 50);
  assert.equal(b.breakdown.roomVolumeM3, 100);
  assert.equal(a.breakdown.infiltrationFlowM3h, 25);
  assert.equal(b.breakdown.infiltrationFlowM3h, 50);
  // volume ↑ → V_inf ↑ → Q_air ↑
  assert.ok((b.breakdown.infiltrationFlowM3h as number) > (a.breakdown.infiltrationFlowM3h as number));
  assert.ok((b.heatingW as number) > (a.heatingW as number));
});

test('colder climate → heating air load ↑', () => {
  const warm = computeRoomAir(project(), room(air({ ventilationBalance: 'none', airChangesPerHour: 0.5 })), loc(-10, 24));
  const cold = computeRoomAir(project(), room(air({ ventilationBalance: 'none', airChangesPerHour: 0.5 })), loc(-30, 24));
  assert.ok((cold.heatingW as number) > (warm.heatingW as number));
});

test('hotter climate → cooling air load ↑', () => {
  const mild = computeRoomAir(project(), room(air({ ventilationBalance: 'none', airChangesPerHour: 0.5 })), loc(-20, 28));
  const hot = computeRoomAir(project(), room(air({ ventilationBalance: 'none', airChangesPerHour: 0.5 })), loc(-20, 38));
  assert.ok((hot.coolingW as number) > (mild.coolingW as number));
});

// --- Infiltration priority / provenance ---

test('measured flow overrides profile/derived/ACH', () => {
  const res = computeRoomAir(project(), room(air({
    ventilationBalance: 'none', infiltrationFlowM3h: 40, airChangesPerHour: 0.5, ach50: 10, airtightnessClass: 'high',
  })), D40);
  assert.equal(res.breakdown.infiltrationSource, 'measured');
  assert.equal(res.breakdown.infiltrationFlowM3h, 40);
});

test('blower-door (ACH50/20) overrides explicit ACH', () => {
  const res = computeRoomAir(project(), room(air({ ventilationBalance: 'none', ach50: 10, airChangesPerHour: 0.8 })), D40);
  assert.equal(res.breakdown.infiltrationSource, 'blower_door_derived');
  assert.equal(res.breakdown.infiltrationFlowM3h, 25); // 10/20 × 50
  assert.ok(res.breakdown.warnings.some((w) => w.startsWith('ach50_converted')));
});

test('explicit ACH overrides airtightness profile', () => {
  const res = computeRoomAir(project(), room(air({ ventilationBalance: 'none', airChangesPerHour: 0.5, airtightnessClass: 'high' })), D40);
  assert.equal(res.breakdown.infiltrationSource, 'explicit_ach');
  assert.equal(res.breakdown.infiltrationFlowM3h, 25);
});

test('airtightness profile (private_house) → profile_default provenance', () => {
  const res = computeRoomAir(project('private_house'), room(air({ ventilationBalance: 'none', airtightnessClass: 'average' })), D40);
  assert.equal(res.breakdown.infiltrationSource, 'airtightness_profile');
  assert.equal(res.breakdown.infiltrationFlowM3h, 25); // 0.5 × 50
  assert.ok(res.breakdown.warnings.some((w) => w.startsWith('profile_default')));
});

test('apartment airtightness profile ×0.6', () => {
  const res = computeRoomAir(project('apartment'), room(air({ ventilationBalance: 'none', airtightnessClass: 'average' })), D40);
  assert.equal(res.breakdown.infiltrationFlowM3h, 15); // 0.5 × 0.6 × 50
});

// --- Safety ---

test('negative ACH → missing', () => {
  const res = computeRoomAir(project(), room(air({ ventilationBalance: 'none', airChangesPerHour: -1 })), D40);
  assert.equal(res.status, 'missing_input');
});

test('NaN infiltration → missing', () => {
  const res = computeRoomAir(project(), room(air({ ventilationBalance: 'none', infiltrationFlowM3h: NaN })), D40);
  assert.equal(res.status, 'missing_input');
});

test('Infinity ventilation → missing', () => {
  const res = computeRoomAir(project(), room(air({ ventilationBalance: 'balanced', ventilationFlowM3h: Infinity, infiltrationFlowM3h: 20 })), D40);
  assert.equal(res.status, 'missing_input');
});

test('missing height → missing (no hidden 2.7m)', () => {
  const p = project();
  p.defaultCeilingHeightM = 0; // invalid → height resolution fails
  const r = room(air({ ventilationBalance: 'none', airChangesPerHour: 0.5 }), 20, 0);
  const res = computeRoomAir(p, r, D40);
  assert.equal(res.status, 'missing_input');
  assert.ok(res.missingInputs.includes('room_height:missing'));
});

test('missing ventilation (balanced) → missing', () => {
  const res = computeRoomAir(project(), room(air({ ventilationBalance: 'balanced', infiltrationFlowM3h: 20 })), D40);
  assert.equal(res.status, 'missing_input');
  assert.ok(res.missingInputs.includes('ventilation:missing'));
});

test('missing infiltration (none) → missing', () => {
  const res = computeRoomAir(project(), room(air({ ventilationBalance: 'none' })), D40);
  assert.equal(res.status, 'missing_input');
  assert.ok(res.missingInputs.includes('infiltration:missing'));
});

test('null air → missing (no hidden 0.5 ACH default)', () => {
  const res = computeRoomAir(project(), room(null), D40);
  assert.equal(res.status, 'missing_input');
  assert.ok(res.missingInputs.includes('infiltration:missing'));
});

test('null location → missing', () => {
  const res = computeRoomAir(project(), room(air({ ventilationBalance: 'none', airChangesPerHour: 0.5 })), null);
  assert.equal(res.status, 'missing_input');
  assert.ok(res.missingInputs.includes('climate_location:missing_climate_location'));
});

test('no negative cooling load (ToutC < TinC)', () => {
  const res = computeRoomAir(project(), room(air({ ventilationBalance: 'none', airChangesPerHour: 0.5 })), loc(-20, 20));
  assert.equal(res.coolingW, 0);
  assert.ok(Number.isFinite(res.coolingW));
});

// --- Determinism ---

test('same input → same result', () => {
  const r = room(air({ ventilationBalance: 'none', airChangesPerHour: 0.5 }));
  const a = computeRoomAir(project(), r, D40);
  const b = computeRoomAir(project(), r, D40);
  assert.equal(a.heatingW, b.heatingW);
  assert.equal(a.breakdown.effectiveOutdoorAirFlowM3h, b.breakdown.effectiveOutdoorAirFlowM3h);
});

test('constants', () => {
  assert.equal(AIR_CONSTANT, 0.34);
  assert.equal(ACH50_DIVISOR, 20);
});
