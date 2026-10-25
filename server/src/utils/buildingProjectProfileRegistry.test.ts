/**
 * Phase 3.2H — profile registry + smart defaults audit tests.
 * These tests lock the current numeric profile facts and the non-fabrication
 * boundaries before implementation.
 */
import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  profileRegistryAuditRows,
  getProfileRegistryEntry,
} from './buildingProjectProfileRegistry.js';
import { computeBuildingLoads } from './buildingProjectLoads.js';
import type { BuildingProject, BuildingRoom, BuildingSystemArchitecture, EngineeringRoomAssignment } from './buildingProjectTypes.js';

function entry(id: string) {
  const found = getProfileRegistryEntry(id);
  assert.ok(found, `missing registry entry ${id}`);
  return found!;
}

test('audit registry exposes existing numeric profiles with status/provenance', () => {
  const wall = entry('transmission.wall.u_value_by_tier');
  assert.equal(wall.status, 'APPROVED_WITH_LIMITATION');
  assert.equal(wall.units, 'W/(m²·K)');
  assert.deepEqual(wall.values, { poor: 1.5, average: 0.6, good: 0.35, high_performance: 0.2 });
  assert.equal(wall.defaultSourceMode, 'profile_default');

  const airtight = entry('air.airtightness.natural_ach_by_class');
  assert.equal(airtight.units, '1/h');
  assert.deepEqual(airtight.values, { poor: 0.8, average: 0.5, good: 0.3, high: 0.15 });
  assert.equal(airtight.status, 'APPROVED_WITH_LIMITATION');

  const shgc = entry('solar.shgc.by_window_thermal_tier');
  assert.equal(shgc.units, 'ratio');
  assert.deepEqual(shgc.values, { poor: 0.8, average: 0.7, good: 0.45, high_performance: 0.35 });

  const internal = entry('internal.lighting_equipment.by_object_type');
  assert.deepEqual(internal.values, {
    residential: { lightingWm2: 5, equipmentWm2: 5 },
    commercial: { lightingWm2: 8, equipmentWm2: 15 },
  });
});

test('MUST_REMAIN_MISSING boundaries are explicit', () => {
  const glazingSize = entry('glazing.type.size_to_thermal_quality');
  assert.equal(glazingSize.status, 'MUST_REMAIN_MISSING');
  assert.equal(glazingSize.calculationInput, false);
  assert.match(glazingSize.notes, /size/i);

  const mechanical = entry('air.mechanical_ventilation.flow_default');
  assert.equal(mechanical.status, 'MUST_REMAIN_MISSING');
  assert.equal(mechanical.calculationInput, false);
});

test('occupancy roomType profile is a REFERENCE_PROFILE (Phase 3.2I.2)', () => {
  const occupancy = entry('internal.occupancy.by_room_type');
  assert.equal(occupancy.status, 'REFERENCE_PROFILE');
  assert.equal(occupancy.calculationInput, true);
  assert.equal(occupancy.defaultSourceMode, 'profile_default');
  assert.equal((occupancy.values as Record<string, number>).living_room, 2);
});

test('profile defaults are never classified as measured/certificate', () => {
  for (const row of profileRegistryAuditRows()) {
    if (row.defaultSourceMode === 'profile_default') {
      assert.notEqual(row.defaultSourceMode, 'measured');
      assert.notEqual(row.defaultSourceMode, 'certificate');
      assert.ok(row.status === 'APPROVED_EXISTING' || row.status === 'APPROVED_WITH_LIMITATION' || row.status === 'REFERENCE_PROFILE');
    }
  }
});

function assignment(roomId: string): EngineeringRoomAssignment {
  return {
    roomId,
    roomName: 'Living',
    roomPurpose: 'living_room',
    sourceSystemId: null,
    sourceSystemIds: { heating: null, cooling: null },
    userPreference: null,
    servicePreferences: { heating: 'required', cooling: 'required' },
    servicePreferenceSource: { heating: 'default', cooling: 'default' },
    towelRadiatorPreference: 'not_required',
    towelRadiatorPreferenceSource: 'default',
    heatingSystems: [],
    coolingSystems: [],
    status: 'allowed',
    warnings: [],
    reasons: [],
  };
}

function room(over: Partial<BuildingRoom> = {}): BuildingRoom {
  return {
    id: 'r1', roomType: 'living_room', name: 'Living', areaM2: 20, floorId: null,
    extras: { geometry: { ceilingHeightM: 2.5, externalWallCount: null, floorPosition: null, spaceAbove: null, spaceBelow: null }, windows: { glazingType: 'panoramic', count: 2, areaM2: null }, insulationOverride: null, conditions: [], notes: null, engineeringUse: 'stored_only' },
    envelope: {
      wallElements: [{ elementId: 'wall-1', areaM2: 12, widthM: null, heightM: null, grossAreaM2: null, openingIds: null, count: null, uValue: null, constructionTier: 'average', uValueSource: 'construction_profile', orientation: null, shgc: null, shadingFactor: null, shadingProfile: null, source: null }],
      windowElements: [{ elementId: 'win-1', areaM2: null, widthM: 1.5, heightM: 1.4, grossAreaM2: null, openingIds: null, count: null, uValue: null, constructionTier: null, uValueSource: null, orientation: 'E', shgc: null, shadingFactor: null, shadingProfile: 'none', source: null }],
      doorElements: [], roofElements: [], floorElements: [],
    },
    air: { ventilationBalance: 'natural', ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: 'average' },
    internalGains: { occupancy: 2, occupancySource: 'user_explicit', occupantSensibleWPerPerson: null, peopleW: null, lightingGainW: null, equipmentGainW: null },
    ...over,
  };
}

function project(r: BuildingRoom): BuildingProject {
  const a = assignment(r.id);
  const arch: BuildingSystemArchitecture = {
    spaceHeatingSourceId: null,
    spaceCoolingSourceId: null,
    spaceCombinedSourceId: null,
    sources: [],
    distribution: { id: 'independent_dx', label: '', circuitKind: 'independent', simultaneousHeatCool: false, notes: [] },
    dhw: { status: 'not_configured', sourceFamilyId: null, architectureId: null, notes: [] },
    simultaneousHeatCoolSupported: false,
    warnings: [],
  };
  return {
    id: 'p', name: 'P', status: 'systems_configured', createdAt: 'x', updatedAt: 'x', objectConfirmedAt: 'x', objectConfirmedRevision: 1,
    objectType: 'private_house', region: { code: 'AM-ER', name: 'Ереван' }, totalAreaM2: 20, defaultCeilingHeightM: 2.5, insulationLevel: 'medium', topology: null, rooms: [r],
    selectedSystems: [], systemsRevision: 1, buildingRevision: 1,
    systemsConfiguration: { projectId: 'p', requestedServices: ['heating', 'cooling'], simultaneousHeatCoolRequired: false, selectedSystemFamilies: [], architecture: arch, roomAssignments: [a], configurationStatus: 'confirmed', warnings: [], confirmedAt: 'x', buildingRevisionAtConfirmation: 1, systemsRevisionAtConfirmation: 1, systemsRevision: 1 },
    systemsConfigurationSnapshot: null, objectConfirmedSnapshot: null,
  };
}

test('glazing size type is not used as a hidden thermal profile', () => {
  const calc = computeBuildingLoads(project(room()), 'steady_state');
  const rr = calc.roomResults[0];
  // glazing size (panoramic) provides neither U nor SHGC:
  // - U is inherited from the project-level insulationLevel seed (legacy_insulation_seed),
  //   NOT from glazingType and NOT from a window thermal tier;
  // - SHGC is missing, so cooling is limited (nothing fabricated).
  assert.equal(rr.cooling.status, 'limited');
  assert.ok(rr.cooling.missingInputs.some((m) => m.startsWith('shgc:missing:win-1')));
  const win = rr.transmissionBreakdown?.elements.find((e) => e.elementId === 'win-1');
  assert.equal(win?.uValueSource, 'legacy_insulation_seed');
  assert.notEqual(win?.uValueSource, 'construction_profile');
  assert.notEqual(win?.uValueSource, 'certificate');
});

test('occupancy provenance distinguishes user explicit from future profile default', () => {
  const calc = computeBuildingLoads(project(room()), 'steady_state');
  const internal = calc.roomResults[0].internalGainsBreakdown!;
  assert.equal(internal.occupancy, 2);
  assert.equal(internal.occupancySource, 'user_explicit');
  assert.equal(internal.peopleSource, 'profile'); // 75 W/person sensible profile, not measured
});
