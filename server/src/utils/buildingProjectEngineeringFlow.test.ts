/**
 * Phase 3.2g — Smart input collection: frontend-shaped payload → steady_state engine.
 * Verifies the full data flow that the RoomEngineeringPanel UI produces (after the
 * service's normalizers), exercising transmission + air + solar + internal gains
 * with a realistic "smart UI" input: envelope elements carry constructionTier /
 * orientation / shadingProfile enums; air carries ventilationBalance + airtightnessClass;
 * internalGains carries occupancy — the backend resolves numbers from its approved
 * profiles. Pure in-memory (no store writes), so safe to run in CI.
 *
 * Run: cd server && npx tsx --test src/utils/buildingProjectEngineeringFlow.test.ts
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { computeBuildingLoads } from './buildingProjectLoads.js';
import type {
  BuildingProject,
  BuildingRoom,
  BuildingSystemArchitecture,
  EnvelopeElement,
  EngineeringRoomAssignment,
} from './buildingProjectTypes.js';

function el(id: string, over: Partial<EnvelopeElement> = {}): EnvelopeElement {
  return { elementId: id, areaM2: null, widthM: null, heightM: null, grossAreaM2: null, openingIds: null, count: null,
    uValue: null, constructionTier: null, uValueSource: null, orientation: null, shgc: null, shadingFactor: null,
    shadingProfile: null, source: null, ...over };
}

function roomWith(over: Partial<BuildingRoom> = {}): BuildingRoom {
  return { id: 'room-1', roomType: 'bedroom', name: 'Спальня', areaM2: 20, floorId: null,
    extras: { geometry: { ceilingHeightM: 2.5, externalWallCount: null, floorPosition: null, spaceAbove: null, spaceBelow: null },
      windows: { glazingType: null, count: null, areaM2: null }, insulationOverride: null, conditions: [], notes: null, engineeringUse: 'stored_only' },
    ...over };
}

function project(rooms: BuildingRoom[]): BuildingProject {
  const assignment: EngineeringRoomAssignment = { roomId: 'room-1', roomName: 'Спальня', roomPurpose: 'bedroom', sourceSystemId: null,
    sourceSystemIds: { heating: null, cooling: null }, userPreference: null,
    servicePreferences: { heating: 'required', cooling: 'required' }, servicePreferenceSource: { heating: 'default', cooling: 'default' },
    towelRadiatorPreference: 'not_required', towelRadiatorPreferenceSource: 'default', heatingSystems: [], coolingSystems: [], status: 'allowed', warnings: [], reasons: [] };
  const arch: BuildingSystemArchitecture = { spaceHeatingSourceId: null, spaceCoolingSourceId: null, spaceCombinedSourceId: null, sources: [],
    distribution: { id: 'independent_dx', label: '', circuitKind: 'independent', simultaneousHeatCool: false, notes: [] },
    dhw: { status: 'not_configured', sourceFamilyId: null, architectureId: null, notes: [] }, simultaneousHeatCoolSupported: false, warnings: [] };
  return { id: 'p', name: 'p', status: 'systems_configured', createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '', objectConfirmedAt: 'x',
    objectConfirmedRevision: 1, buildingRevision: 3, objectType: 'apartment', region: { code: 'AM-ER', name: 'Ереван' }, totalAreaM2: 20,
    defaultCeilingHeightM: 2.5, insulationLevel: 'unknown', topology: null, rooms, selectedSystems: [], systemsRevision: 5,
    systemsConfiguration: { projectId: 'p', requestedServices: ['heating', 'cooling'], simultaneousHeatCoolRequired: false, selectedSystemFamilies: [],
      architecture: arch, roomAssignments: [assignment], configurationStatus: 'confirmed', warnings: [], confirmedAt: 'x',
      buildingRevisionAtConfirmation: 3, systemsRevisionAtConfirmation: 5, systemsRevision: 5 },
    systemsConfigurationSnapshot: null, objectConfirmedSnapshot: null };
}

function smartRoom(): BuildingRoom {
  return roomWith({
    envelope: {
      wallElements: [el('wall-1', { areaM2: 10, constructionTier: 'average' })],
      windowElements: [
        el('win-E', { areaM2: 2, constructionTier: 'average', orientation: 'E', shadingProfile: 'interior' }),
        el('win-W', { areaM2: 2, constructionTier: 'average', orientation: 'W', shadingProfile: 'none' }),
      ],
      doorElements: [el('door-1', { areaM2: 1.9, constructionTier: 'average' })],
      roofElements: [el('roof-1', { areaM2: 20, constructionTier: 'average' })],
      floorElements: [el('floor-1', { areaM2: 20, constructionTier: 'good' })],
    },
    air: { ventilationBalance: 'natural', ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: 'average' },
    internalGains: { occupancy: 2, occupantSensibleWPerPerson: null, peopleW: null, lightingGainW: null, equipmentGainW: null },
  });
}

test('smart payload → steady_state cooling CALCULATED (tr + air + solar + internal)', () => {
  const calc = computeBuildingLoads(project([smartRoom()]), 'steady_state');
  const rr = calc.roomResults[0];
  assert.equal(rr.cooling.status, 'calculated');
  const trC = rr.transmissionBreakdown!.coolingW!;
  const airC = rr.airBreakdown!.coolingW!;
  const solarC = rr.solarBreakdown!.totalCoolingW!;
  const intW = rr.internalGainsBreakdown!.totalCoolingW!;
  assert.ok(trC > 0 && airC > 0 && solarC > 0 && intW > 0, `components ${trC}/${airC}/${solarC}/${intW}`);
  assert.equal(rr.cooling.demandW, trC + airC + solarC + intW);
  // heating never includes solar/internal
  assert.equal(rr.heating.demandW, rr.transmissionBreakdown!.heatingW! + rr.airBreakdown!.heatingW!);
});

test('two windows of different orientation → two separate simultaneous solar contributions', () => {
  const calc = computeBuildingLoads(project([smartRoom()]), 'steady_state');
  const sb = calc.roomResults[0].solarBreakdown!;
  assert.equal(sb.windows.length, 2);
  assert.deepEqual([...sb.windows.map((w) => w.orientation)].sort(), ['E', 'W']);
  assert.ok(sb.warnings.some((w) => w === 'solar_aggregation:simultaneous_room_peak'));
});

test('REUSE: room volume derived from area × ceiling height (air)', () => {
  const calc = computeBuildingLoads(project([smartRoom()]), 'steady_state');
  const ab = calc.roomResults[0].airBreakdown!;
  assert.equal(ab.roomVolumeM3, 20 * 2.5); // 50 m³
  assert.equal(ab.infiltrationSource, 'airtightness_profile');
  assert.ok(ab.warnings.some((w) => w.startsWith('profile_default:airtightness_average')));
});

test('tier → construction_profile provenance on transmission elements', () => {
  const calc = computeBuildingLoads(project([smartRoom()]), 'steady_state');
  const tb = calc.roomResults[0].transmissionBreakdown!;
  const wall = tb.elements.find((e) => e.elementId === 'wall-1')!;
  const window = tb.elements.find((e) => e.elementId === 'win-E')!;
  assert.equal(wall.uValueSource, 'construction_profile');
  assert.equal(window.uValueSource, 'construction_profile');
  assert.equal(window.uValue, 2.8); // window average profile
  assert.equal(wall.uValue, 0.6);   // wall average profile
});

test('Advanced explicit U-value override → certificate provenance and wins over tier', () => {
  const r = roomWith({
    envelope: {
      wallElements: [el('wall-1', { areaM2: 10, uValue: 0.25, constructionTier: 'poor', uValueSource: 'certificate' })],
      windowElements: [el('win-S', { areaM2: 2, uValue: 1.1, constructionTier: 'poor', orientation: 'S', shgc: 0.5, shadingFactor: 0.5 })],
      doorElements: [], roofElements: [], floorElements: [],
    },
    air: { ventilationBalance: 'natural', ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: 0.5, ach50: null, airtightnessClass: null },
    internalGains: { occupancy: 2, occupantSensibleWPerPerson: null, peopleW: null, lightingGainW: null, equipmentGainW: null },
  });
  const calc = computeBuildingLoads(project([r]), 'steady_state');
  const tb = calc.roomResults[0].transmissionBreakdown!;
  const wall = tb.elements.find((e) => e.elementId === 'wall-1')!;
  assert.equal(wall.uValueSource, 'certificate');
  assert.equal(wall.uValue, 0.25); // explicit wins over poor tier (1.5)
});

test('"не знаю" (no tier, no U) → transmission missing (never a fabricated number)', () => {
  const r = roomWith({
    envelope: { wallElements: [el('wall-1', { areaM2: 10 })], windowElements: [], doorElements: [], roofElements: [], floorElements: [] },
    air: { ventilationBalance: 'natural', ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: null },
    internalGains: { occupancy: 2, occupantSensibleWPerPerson: null, peopleW: null, lightingGainW: null, equipmentGainW: null },
  });
  const calc = computeBuildingLoads(project([r]), 'steady_state');
  const rr = calc.roomResults[0];
  assert.equal(rr.transmissionBreakdown!.heatingW, null);
  // an unresolved (no tier/no U) wall is never emitted as a fabricated contribution
  assert.equal(rr.transmissionBreakdown!.elements.length, 0);
});

test('legacy project (no envelope/air/internalGains) → steady_state limited, QUICK still works', () => {
  const r = roomWith(); // no envelope / air / internalGains
  const steady = computeBuildingLoads(project([r]), 'steady_state');
  // transmission limited: no envelope elements
  assert.notEqual(steady.roomResults[0].cooling.status, 'calculated');
  const quick = computeBuildingLoads(project([r]), 'quick');
  assert.equal(quick.methodId, 'ohmx.quick-load.v1');
  assert.equal(quick.roomResults[0].cooling.status, 'calculated');
});

test('snapshot captures engineering inputs for reproducibility', () => {
  const calc = computeBuildingLoads(project([smartRoom()]), 'steady_state');
  const snap = calc.inputSnapshot.rooms[0];
  assert.equal(snap.envelope!.windowElements.length, 2);
  assert.equal(snap.envelope!.windowElements[0].orientation, 'E');
  assert.equal(snap.air!.ventilationBalance, 'natural');
  assert.equal(snap.air!.airtightnessClass, 'average');
  assert.equal(snap.internalGains!.occupancy, 2);
});