/**
 * Phase 3.2c — Solar gains regression tests.
 * Run: cd server && npx tsx --test src/utils/buildingProjectSolar.test.ts
 *
 * TEST-ONLY irradiance fixtures: production has NO vaporized solar dataset yet,
 * so every numeric case injects synthetic `solarIrradianceByOrientation` on the
 * location. The production dataset must never inherit these values.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { computeRoomSolar, SHGC_GLASS_PROFILES, SHADING_PROFILES, WINDOW_GLAZING_AREA_FACTOR } from './buildingProjectSolar.js';
import type { QuickClimateLocation } from './buildingProjectQuickLoadV1.js';
import type {
  BuildingProject,
  BuildingRoom,
  EnvelopeElement,
  SolarIrradianceByOrientation,
  SolarIrradianceData,
} from './buildingProjectTypes.js';

type SolarSite = QuickClimateLocation & { solarIrradianceByOrientation: SolarIrradianceData };

function baseLoc(): QuickClimateLocation {
  return {
    id: 'synthetic', labelRu: 'S', labelHy: 'S', station: 'X', elevationM: 0, climateZone: 'X', regionId: null,
    observationPeriod: 'X', heatingOutdoorDesignC: -20, coolingOutdoorDesignC: 30,
    sourceTableHeating: 'T', sourceRowHeating: 1, sourceTableCooling: 'T', sourceRowCooling: 1,
  };
}

function site(irr: Partial<SolarIrradianceByOrientation>): SolarSite {
  const values: SolarIrradianceByOrientation = { N: 0, NE: 0, E: 0, SE: 0, S: 0, SW: 0, W: 0, NW: 0, ...irr };
  return { ...baseLoc(), solarIrradianceByOrientation: { values, source: 'test', datasetVersion: '1.0-test' } };
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

function win(id: string, over: Partial<EnvelopeElement> = {}): EnvelopeElement {
  return {
    elementId: id, areaM2: null, widthM: null, heightM: null, grossAreaM2: null,
    openingIds: null, count: null, uValue: null, constructionTier: null, uValueSource: null,
    orientation: null, shgc: null, shadingFactor: null, shadingProfile: null, source: null,
    ...over,
  };
}

function room(windows: EnvelopeElement[], areaM2 = 20): BuildingRoom {
  return {
    id: 'r1', roomType: 'living_room', name: 'R1', areaM2, floorId: null,
    extras: {
      geometry: { ceilingHeightM: 2.5, externalWallCount: null, floorPosition: null, spaceAbove: null, spaceBelow: null },
      windows: { glazingType: null, count: null, areaM2: null },
      insulationOverride: null, conditions: [], notes: null, engineeringUse: 'stored_only',
    },
    envelope: { wallElements: [], windowElements: windows, doorElements: [], roofElements: [], floorElements: [] },
  };
}

// --- Exact fixture: A=2, SHGC=0.5, I(S)=600, shading=0.5 → 2×0.5×600×0.5 = 300 W ---

test('exact: 2 m² × 0.5 SHGC × 600 × 0.5 = 300 W', () => {
  const w = win('w1', { areaM2: 2, orientation: 'S', shgc: 0.5, shadingFactor: 0.5 });
  const res = computeRoomSolar(project(), room([w]), site({ S: 600 }));
  assert.equal(res.status, 'calculated');
  assert.equal(res.totalCoolingW, 300);
  assert.equal(res.windows[0].coolingW, 300);
  assert.equal(res.windows[0].irradianceSource, 'test');
});

test('area ↑ → solar ↑', () => {
  const a = computeRoomSolar(project(), room([win('a', { areaM2: 2, orientation: 'S', shgc: 0.5, shadingFactor: 0.5 })]), site({ S: 600 }));
  const b = computeRoomSolar(project(), room([win('b', { areaM2: 4, orientation: 'S', shgc: 0.5, shadingFactor: 0.5 })]), site({ S: 600 }));
  assert.equal(a.totalCoolingW, 300);
  assert.equal(b.totalCoolingW, 600);
  assert.ok((b.totalCoolingW as number) > (a.totalCoolingW as number));
});

test('SHGC ↑ → solar ↑', () => {
  const a = computeRoomSolar(project(), room([win('a', { areaM2: 2, orientation: 'S', shgc: 0.4, shadingFactor: 0.5 })]), site({ S: 600 }));
  const b = computeRoomSolar(project(), room([win('b', { areaM2: 2, orientation: 'S', shgc: 0.6, shadingFactor: 0.5 })]), site({ S: 600 }));
  assert.equal(a.totalCoolingW, 240);
  assert.equal(b.totalCoolingW, 360);
  assert.ok((b.totalCoolingW as number) > (a.totalCoolingW as number));
});

test('irradiance ↑ → solar ↑', () => {
  const a = computeRoomSolar(project(), room([win('a', { areaM2: 2, orientation: 'S', shgc: 0.5, shadingFactor: 0.5 })]), site({ S: 500 }));
  const b = computeRoomSolar(project(), room([win('b', { areaM2: 2, orientation: 'S', shgc: 0.5, shadingFactor: 0.5 })]), site({ S: 700 }));
  assert.equal(a.totalCoolingW, 250);
  assert.equal(b.totalCoolingW, 350);
  assert.ok((b.totalCoolingW as number) > (a.totalCoolingW as number));
});

test('stronger shading → solar ↓', () => {
  const a = computeRoomSolar(project(), room([win('a', { areaM2: 2, orientation: 'S', shgc: 0.5, shadingFactor: 0.8 })]), site({ S: 600 }));
  const b = computeRoomSolar(project(), room([win('b', { areaM2: 2, orientation: 'S', shgc: 0.5, shadingFactor: 0.3 })]), site({ S: 600 }));
  assert.equal(a.totalCoolingW, 480);
  assert.equal(b.totalCoolingW, 180);
  assert.ok((b.totalCoolingW as number) < (a.totalCoolingW as number));
});

test('two windows sum independently', () => {
  const a = win('a', { areaM2: 2, orientation: 'S', shgc: 0.5, shadingFactor: 0.5 });
  const b = win('b', { areaM2: 1, orientation: 'E', shgc: 0.5, shadingFactor: 0.5 });
  const res = computeRoomSolar(project(), room([a, b]), site({ S: 600, E: 400 }));
  assert.equal(res.totalCoolingW, 400); // 300 + 1×0.5×400×0.5 = 300 + 100
});

test('different orientations use different irradiance', () => {
  const n = computeRoomSolar(project(), room([win('n', { areaM2: 2, orientation: 'N', shgc: 0.5, shadingFactor: 0.5 })]), site({ N: 200, S: 600 }));
  const s = computeRoomSolar(project(), room([win('s', { areaM2: 2, orientation: 'S', shgc: 0.5, shadingFactor: 0.5 })]), site({ N: 200, S: 600 }));
  assert.equal(n.totalCoolingW, 100); // 2×0.5×200×0.5
  assert.equal(s.totalCoolingW, 300); // 2×0.5×600×0.5
  assert.notEqual(n.totalCoolingW, s.totalCoolingW);
});

test('no windows → calculated 0 W', () => {
  const res = computeRoomSolar(project(), room([]), site({ S: 600 }));
  assert.equal(res.status, 'calculated');
  assert.equal(res.totalCoolingW, 0);
});

// --- Provenance ---

test('SHGC profile (construction tier) with provenance', () => {
  const w = win('w1', { areaM2: 2, orientation: 'S', constructionTier: 'good', shadingFactor: 0.5 });
  const res = computeRoomSolar(project(), room([w]), site({ S: 600 }));
  assert.equal(res.windows[0].shgc, SHGC_GLASS_PROFILES.good);
  assert.equal(res.windows[0].shgcSource, 'glazing_profile');
  assert.equal(res.totalCoolingW, 2 * 0.45 * 600 * 0.5); // 270
  assert.ok(res.warnings.some((w) => w.startsWith('shgc_glazing_profile')));
});

test('shading profile (interior → 0.7) with provenance', () => {
  const w = win('w1', { areaM2: 2, orientation: 'S', shgc: 0.5, shadingProfile: 'interior' });
  const res = computeRoomSolar(project(), room([w]), site({ S: 600 }));
  assert.equal(res.windows[0].shadingFactor, SHADING_PROFILES.interior);
  assert.equal(res.windows[0].shadingSource, 'profile');
  assert.equal(res.totalCoolingW, 2 * 0.5 * 600 * 0.7); // 420
});

test('glazed-area estimate from rough opening (0.8 frame factor, once)', () => {
  const w = win('w1', { grossAreaM2: 2.5, orientation: 'S', shgc: 0.5, shadingFactor: 0.5 });
  const res = computeRoomSolar(project(), room([w]), site({ S: 600 }));
  assert.equal(res.windows[0].areaM2, 2.5 * WINDOW_GLAZING_AREA_FACTOR);
  assert.equal(res.totalCoolingW, 2.0 * 0.5 * 600 * 0.5); // 300
  assert.ok(res.warnings.some((w) => w.startsWith('glazing_area_estimated')));
});

// --- Missing / invalid ---

test('missing orientation → missing', () => {
  const res = computeRoomSolar(project(), room([win('w1', { areaM2: 2, shgc: 0.5, shadingFactor: 0.5 })]), site({ S: 600 }));
  assert.equal(res.status, 'missing_input');
  assert.equal(res.totalCoolingW, null);
  assert.ok(res.missingInputs.some((m) => m.startsWith('orientation:missing')));
});

test('missing irradiance (no solar dataset) → missing', () => {
  const w = win('w1', { areaM2: 2, orientation: 'S', shgc: 0.5, shadingFactor: 0.5 });
  const res = computeRoomSolar(project(), room([w]), baseLoc());
  assert.equal(res.status, 'missing_input');
  assert.equal(res.totalCoolingW, null);
  assert.ok(res.missingInputs.includes('solar_irradiance:missing'));
});

test('missing shading (no hidden 1.0) → missing', () => {
  const w = win('w1', { areaM2: 2, orientation: 'S', shgc: 0.5 });
  const res = computeRoomSolar(project(), room([w]), site({ S: 600 }));
  assert.equal(res.status, 'missing_input');
  assert.ok(res.missingInputs.some((m) => m.startsWith('shading:missing')));
});

test('NaN SHGC → missing', () => {
  const w = win('w1', { areaM2: 2, orientation: 'S', shgc: NaN, shadingFactor: 0.5 });
  const res = computeRoomSolar(project(), room([w]), site({ S: 600 }));
  assert.equal(res.status, 'missing_input');
  assert.ok(res.missingInputs.some((m) => m.startsWith('shgc:invalid')));
});

test('Infinity shading factor → missing', () => {
  const w = win('w1', { areaM2: 2, orientation: 'S', shgc: 0.5, shadingFactor: Infinity });
  const res = computeRoomSolar(project(), room([w]), site({ S: 600 }));
  assert.equal(res.status, 'missing_input');
  assert.ok(res.missingInputs.some((m) => m.startsWith('shading:invalid')));
});

test('negative irradiance → missing (never negative solar)', () => {
  const w = win('w1', { areaM2: 2, orientation: 'S', shgc: 0.5, shadingFactor: 0.5 });
  const res = computeRoomSolar(project(), room([w]), site({ S: -100 }));
  assert.equal(res.status, 'missing_input');
  assert.ok(res.missingInputs.some((m) => m.startsWith('solar_irradiance:invalid')));
});

test('envelope null → missing', () => {
  const r = room([]);
  r.envelope = null;
  const res = computeRoomSolar(project(), r, site({ S: 600 }));
  assert.equal(res.status, 'missing_input');
  assert.ok(res.missingInputs.includes('envelope:missing'));
});

test('deterministic: same input → same result', () => {
  const w = win('w1', { areaM2: 2, orientation: 'SW', shgc: 0.5, shadingFactor: 0.5 });
  const a = computeRoomSolar(project(), room([w]), site({ SW: 450 }));
  const b = computeRoomSolar(project(), room([w]), site({ SW: 450 }));
  assert.equal(a.totalCoolingW, b.totalCoolingW);
  assert.deepEqual(a.windows, b.windows);
});