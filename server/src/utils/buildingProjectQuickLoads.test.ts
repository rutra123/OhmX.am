/**
 * Building Project Phase 3.1 — OhmX QUICK Load v1 numeric tests.
 *
 * QL-01..QL-30 + climate dataset tests. Pure engine + small service-level
 * sections (store-backed gates/persistence follow the same convention as
 * buildingProjectIntegrity.test.ts — created test projects are deleted).
 *
 * Exact formula fixtures (spec §51, §53):
 *   heating: A=20, H=2.7, Tin=20, Tout=-10, average insulation, 1 external
 *            wall, normal floor, normal glazing -> V=54, ΔT=30, K=0.75
 *            -> Q = 54 × 30 × 0.75 = 1215 W (EXACT raw)
 *   cooling: A=20, H=2.7, average insulation, 1 external wall, normal floor,
 *            normal glazing, not sunny, ToutCool=35, TinCool=24
 *            -> base 2000 W, all K=1 -> Q = 2000 W (EXACT raw)
 *
 * The exact fixtures call the pure engine with a synthetic climate location
 * (no persistence) so the FORMULA is pinned; the vendored dataset values are
 * pinned separately by the climate tests (spec §57).
 */
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  QUICK_COOLING_BASE_WM2,
  QUICK_COOLING_GLAZING,
  QUICK_HEATING_ENVELOPE,
  QUICK_HEATING_GLAZING,
  computeQuickCooling,
  computeQuickHeating,
  loadClimateDataset,
  quickServiceResult,
  resolveClimateLocation,
  type QuickClimateLocation,
} from './buildingProjectQuickLoadV1.js';
import {
  LOAD_METHODS,
  computeBuildingLoads,
  isLoadStale,
  sumEligibleRoomLoads,
} from './buildingProjectLoads.js';
import { SYSTEM_FAMILIES } from './buildingProjectSystems.js';
import type {
  BuildingProject,
  BuildingRoom,
  EngineeringRoomAssignment,
  EngineeringSystemFamilySelection,
} from './buildingProjectTypes.js';

function family(id: string): EngineeringSystemFamilySelection {
  const found = SYSTEM_FAMILIES.find((item) => item.id === id);
  if (!found) throw new Error(`unknown family ${id}`);
  return { ...found, selectedAt: '2026-08-17T00:00:00.000Z' };
}

function makeRoom(
  id: string,
  roomType: string,
  name: string,
  areaM2: number | null,
  floorId: string | null = null,
  heightOverrideM: number | null = null,
  extra: {
    externalWallCount?: number | null;
    floorPosition?: 'ground' | 'intermediate' | 'top' | 'basement' | 'unknown' | null;
    glazingType?: 'standard' | 'large' | 'panoramic' | 'stained' | null;
    conditions?: string[];
    insulationOverride?: 'good' | 'medium' | 'poor' | 'unknown' | null;
  } = {},
): BuildingRoom {
  return {
    id,
    roomType,
    name,
    areaM2,
    floorId: floorId ?? undefined,
    extras: {
      geometry: {
        ceilingHeightM: heightOverrideM,
        externalWallCount: extra.externalWallCount ?? null,
        floorPosition: extra.floorPosition ?? null,
        spaceAbove: null,
        spaceBelow: null,
      },
      windows: { glazingType: extra.glazingType ?? null, count: null, areaM2: null },
      insulationOverride: extra.insulationOverride ?? null,
      conditions: extra.conditions ?? [],
      notes: null,
      engineeringUse: 'stored_only',
    },
  };
}

function makeAssignment(room: BuildingRoom, heating: string[], cooling: string[]): EngineeringRoomAssignment {
  return {
    roomId: room.id,
    roomName: room.name,
    roomPurpose: room.roomType,
    sourceSystemId: null,
    sourceSystemIds: { heating: null, cooling: null },
    userPreference: null,
    servicePreferences: {
      heating: heating.length ? 'required' : 'not_required',
      cooling: cooling.length ? 'required' : 'not_required',
    },
    servicePreferenceSource: { heating: 'default', cooling: 'default' },
    towelRadiatorPreference: 'not_required',
    towelRadiatorPreferenceSource: 'default',
    heatingSystems: heating.map((h) => ({ familyId: h, label: h, service: 'heating', kind: 'terminal', scope: 'central', capabilityStatus: 'allowed', sourceSystemId: null, selectedAt: '2026-08-17T00:00:00.000Z', reasons: [] })),
    coolingSystems: cooling.map((c) => ({ familyId: c, label: c, service: 'cooling', kind: 'terminal', scope: 'central', capabilityStatus: 'allowed', sourceSystemId: null, selectedAt: '2026-08-17T00:00:00.000Z', reasons: [] })),
    status: 'allowed',
    warnings: [],
    reasons: [],
  };
}

function makeProject(overrides: Partial<BuildingProject> = {}): BuildingProject {
  const rooms = [
    makeRoom('room-1', 'bedroom', 'Спальня 1', 20, null, 2.7, { externalWallCount: 1, floorPosition: 'intermediate', glazingType: 'standard' }),
    makeRoom('room-2', 'bathroom', 'Ванная', 5, null, 2.7, { externalWallCount: 1, floorPosition: 'intermediate', glazingType: 'standard' }),
  ];
  const assignments = rooms.map((room) => makeAssignment(room, ['aluminum_radiators'], ['fan_coils']));
  const base: BuildingProject = {
    id: 'test-project',
    name: 'Test project',
    status: 'systems_configured',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    objectConfirmedAt: '2026-08-17T00:00:00.000Z',
    objectConfirmedRevision: 1,
    buildingRevision: 3,
    objectType: 'apartment',
    region: { code: 'AM-ER', name: 'Ереван' },
    totalAreaM2: 80,
    defaultCeilingHeightM: 2.7,
    insulationLevel: 'medium',
    topology: null,
    rooms,
    selectedSystems: [family('gas_condensing_boiler'), family('aluminum_radiators')],
    systemsRevision: 5,
    systemsConfiguration: {
      projectId: 'test-project',
      requestedServices: ['heating', 'cooling'],
      simultaneousHeatCoolRequired: false,
      selectedSystemFamilies: [family('gas_condensing_boiler'), family('aluminum_radiators')],
      architecture: {
        spaceHeatingSourceId: 'gas_condensing_boiler',
        spaceCoolingSourceId: null,
        spaceCombinedSourceId: null,
        sources: [],
        distribution: { id: 'hydronic_heating_only', label: 'Гидравлика отопления', circuitKind: '2pipe', simultaneousHeatCool: false, notes: [] },
        dhw: { status: 'not_configured', sourceFamilyId: null, architectureId: null, notes: [] },
        simultaneousHeatCoolSupported: false,
        warnings: [],
      },
      roomAssignments: assignments,
      configurationStatus: 'confirmed',
      warnings: [],
      confirmedAt: '2026-08-17T00:00:00.000Z',
      buildingRevisionAtConfirmation: 3,
      systemsRevisionAtConfirmation: 5,
      systemsRevision: 5,
      hydronicRequirements: null,
      validation: { ready: true, blockers: [], warnings: [], info: [] },
    },
    systemsConfigurationSnapshot: null,
    objectConfirmedSnapshot: null,
  };
  return { ...base, ...overrides };
}

/** Synthetic climate location — used ONLY to pin the pure formula (spec §51/§53). */
function syntheticLocation(heatingC: number, coolingC: number): QuickClimateLocation {
  return {
    id: 'synthetic-fixture',
    labelRu: 'Синтетический фикстур',
    labelHy: 'Synthetic',
    station: 'Synthetic',
    elevationM: 0,
    climateZone: 'warm',
    regionId: 'AM-XX',
    observationPeriod: 'fixture',
    heatingOutdoorDesignC: heatingC,
    coolingOutdoorDesignC: coolingC,
    sourceTableHeating: '25',
    sourceRowHeating: 0,
    sourceTableCooling: '22',
    sourceRowCooling: 0,
  };
}

function engineeringJson(calc: unknown) {
  const copy = JSON.parse(JSON.stringify(calc)) as { calculatedAt?: string };
  delete copy.calculatedAt;
  return JSON.stringify(copy);
}

// ---------------------------------------------------------------------------
// QL-01..03 — valid numeric results, H+C independence
// ---------------------------------------------------------------------------

test('QL-01: valid heating room -> numeric finite W', () => {
  const project = makeProject();
  const room = project.rooms[0];
  const location = resolveClimateLocation('AM-ER')!;
  const outcome = quickServiceResult('heating', room, project, location);
  assert.equal(outcome.result.status, 'calculated');
  assert.ok(Number.isFinite(outcome.result.demandW));
  assert.ok(outcome.result.demandW! > 0);
  assert.equal(outcome.result.demandW, outcome.demandW);
});

test('QL-02: valid cooling room -> numeric finite W', () => {
  const project = makeProject();
  const room = project.rooms[0];
  const location = resolveClimateLocation('AM-ER')!;
  const outcome = quickServiceResult('cooling', room, project, location);
  assert.equal(outcome.result.status, 'calculated');
  assert.ok(Number.isFinite(outcome.result.demandW));
  assert.ok(outcome.result.demandW! > 0);
  assert.ok(outcome.result.warnings.includes('solar_orientation_not_collected'));
});

test('QL-03: H+C are fully independent results', () => {
  const calc = computeBuildingLoads(makeProject(), 'quick');
  const room = calc.roomResults[0];
  assert.equal(room.heating.status, 'calculated');
  assert.equal(room.cooling.status, 'calculated');
  assert.notEqual(room.heating.demandW, room.cooling.demandW);
  // heating uses volume + ΔT; cooling uses area + climate factor — different traces
  assert.ok(room.heating.coefficientTrace?.kEnvelope);
  assert.ok(room.cooling.coefficientTrace?.kClimateCooling);
});

// ---------------------------------------------------------------------------
// QL-04..06 — height semantics
// ---------------------------------------------------------------------------

test('QL-04: height override affects the result', () => {
  const loc = syntheticLocation(-10, 33);
  const p1 = makeProject({ defaultCeilingHeightM: 2.7 });
  const base = computeQuickHeating(p1, p1.rooms[0], loc);
  const tall = makeRoom('room-1', 'bedroom', 'Спальня 1', 20, null, 3.2, { externalWallCount: 1, floorPosition: 'intermediate', glazingType: 'standard' });
  const p2 = makeProject({ rooms: [tall], systemsConfiguration: { ...makeProject().systemsConfiguration!, roomAssignments: [makeAssignment(tall, ['aluminum_radiators'], [])] } });
  const tallCalc = computeQuickHeating(p2, tall, loc);
  assert.ok(tallCalc.demandW > base.demandW);
  // cooling: height factor also changes
  const coolBase = computeQuickCooling(p1, p1.rooms[0], loc);
  const coolTall = computeQuickCooling(p2, tall, loc);
  assert.ok(coolTall.demandW > coolBase.demandW);
});

test('QL-05: object ceiling height fallback works', () => {
  const project = makeProject({ defaultCeilingHeightM: 2.7 });
  const room = makeRoom('room-x', 'bedroom', 'Спальня', 20, null, null, { externalWallCount: 1, floorPosition: 'intermediate', glazingType: 'standard' });
  const loc = syntheticLocation(-10, 33);
  const calc = computeQuickHeating(project, room, loc);
  assert.equal(calc.inputs.effectiveHeightM, 2.7);
  assert.ok(calc.demandW > 0);
});

test('QL-06: missing height -> missing_input (no hidden 2.7 m substitute)', () => {
  const project = makeProject({ defaultCeilingHeightM: null as unknown as number });
  const room = makeRoom('room-x', 'bedroom', 'Спальня', 20, null, null, { externalWallCount: 1, floorPosition: 'intermediate', glazingType: 'standard' });
  const loc = syntheticLocation(-10, 33);
  const outcome = quickServiceResult('heating', room, project, loc);
  assert.equal(outcome.result.status, 'missing_input');
  assert.equal(outcome.result.demandW, null);
  assert.ok(outcome.result.missingInputs.includes('room_height:missing'));
});

// ---------------------------------------------------------------------------
// QL-07..10 — modifier monotonicity / direction
// ---------------------------------------------------------------------------

test('QL-07: good/average/poor insulation order is monotonic', () => {
  const loc = syntheticLocation(-10, 33);
  const base = { externalWallCount: 1, floorPosition: 'intermediate' as const, glazingType: 'standard' as const };
  const rooms = {
    good: makeRoom('a', 'bedroom', 'A', 20, null, 2.7, { ...base, insulationOverride: 'good' }),
    medium: makeRoom('b', 'bedroom', 'B', 20, null, 2.7, { ...base, insulationOverride: 'medium' }),
    poor: makeRoom('c', 'bedroom', 'C', 20, null, 2.7, { ...base, insulationOverride: 'poor' }),
  };
  const project = makeProject();
  const hGood = computeQuickHeating(project, rooms.good, loc).demandW;
  const hMedium = computeQuickHeating(project, rooms.medium, loc).demandW;
  const hPoor = computeQuickHeating(project, rooms.poor, loc).demandW;
  assert.ok(hGood < hMedium && hMedium < hPoor);
  const cGood = computeQuickCooling(project, rooms.good, loc).demandW;
  const cMedium = computeQuickCooling(project, rooms.medium, loc).demandW;
  const cPoor = computeQuickCooling(project, rooms.poor, loc).demandW;
  assert.ok(cGood < cMedium && cMedium < cPoor);
  // coefficients are the approved ones
  assert.equal(QUICK_HEATING_ENVELOPE.good, 0.55);
  assert.equal(QUICK_HEATING_ENVELOPE.medium, 0.75);
  assert.equal(QUICK_HEATING_ENVELOPE.poor, 1.0);
});

test('QL-08: large glazing increases the result', () => {
  const loc = syntheticLocation(-10, 33);
  const base = { externalWallCount: 1, floorPosition: 'intermediate' as const };
  const normal = makeRoom('a', 'bedroom', 'A', 20, null, 2.7, { ...base, glazingType: 'standard' });
  const large = makeRoom('b', 'bedroom', 'B', 20, null, 2.7, { ...base, glazingType: 'large' });
  const project = makeProject();
  assert.ok(computeQuickHeating(project, large, loc).demandW > computeQuickHeating(project, normal, loc).demandW);
  assert.ok(computeQuickCooling(project, large, loc).demandW > computeQuickCooling(project, normal, loc).demandW);
  assert.equal(QUICK_HEATING_GLAZING.large, 1.1);
  assert.equal(QUICK_COOLING_GLAZING.large, 1.15);
  // strongest glazing category applies — never a product of two modifiers
  const pan = makeRoom('c', 'bedroom', 'C', 20, null, 2.7, { ...base, glazingType: 'panoramic' });
  assert.equal(computeQuickHeating(project, pan, loc).demandW / computeQuickHeating(project, normal, loc).demandW, QUICK_HEATING_GLAZING.panoramic);
});

test('QL-09: more external exposure cannot lower heating load', () => {
  const loc = syntheticLocation(-10, 33);
  const base = { floorPosition: 'intermediate' as const, glazingType: 'standard' as const };
  const project = makeProject();
  const d0 = computeQuickHeating(project, makeRoom('a', 'bedroom', 'A', 20, null, 2.7, { ...base, externalWallCount: 0 }), loc).demandW;
  const d1 = computeQuickHeating(project, makeRoom('b', 'bedroom', 'B', 20, null, 2.7, { ...base, externalWallCount: 1 }), loc).demandW;
  const d2 = computeQuickHeating(project, makeRoom('c', 'bedroom', 'C', 20, null, 2.7, { ...base, externalWallCount: 2 }), loc).demandW;
  const d3 = computeQuickHeating(project, makeRoom('d', 'bedroom', 'D', 20, null, 2.7, { ...base, externalWallCount: 3 }), loc).demandW;
  assert.ok(d0 <= d1 && d1 <= d2 && d2 <= d3);
});

test('QL-10: top exposure increases the appropriate load', () => {
  const loc = syntheticLocation(-10, 33);
  const base = { externalWallCount: 1, glazingType: 'standard' as const };
  const middle = makeRoom('a', 'bedroom', 'A', 20, null, 2.7, { ...base, floorPosition: 'intermediate' });
  const top = makeRoom('b', 'bedroom', 'B', 20, null, 2.7, { ...base, floorPosition: 'top' });
  const project = makeProject();
  assert.ok(computeQuickHeating(project, top, loc).demandW > computeQuickHeating(project, middle, loc).demandW);
  assert.ok(computeQuickCooling(project, top, loc).demandW > computeQuickCooling(project, middle, loc).demandW);
});

// ---------------------------------------------------------------------------
// QL-11..13 — service semantics, null vs zero
// ---------------------------------------------------------------------------

test('QL-11: not_requested -> demandW null', () => {
  const rooms = [makeRoom('room-1', 'bedroom', 'Спальня 1', 20)];
  const project = makeProject({
    rooms,
    systemsConfiguration: {
      ...makeProject().systemsConfiguration!,
      requestedServices: ['heating'],
      roomAssignments: [makeAssignment(rooms[0], ['aluminum_radiators'], [])],
    },
  });
  const calc = computeBuildingLoads(project, 'quick');
  assert.equal(calc.roomResults[0].cooling.status, 'not_requested');
  assert.equal(calc.roomResults[0].cooling.demandW, null);
});

test('QL-12: not_required -> demandW null', () => {
  const rooms = [makeRoom('room-1', 'bedroom', 'Спальня 1', 20)];
  const assignment: EngineeringRoomAssignment = {
    ...makeAssignment(rooms[0], ['aluminum_radiators'], []),
    servicePreferences: { heating: 'required', cooling: 'not_required' } as const,
  };
  const project = makeProject({
    rooms,
    systemsConfiguration: {
      ...makeProject().systemsConfiguration!,
      requestedServices: ['heating', 'cooling'],
      roomAssignments: [assignment],
    },
  });
  const calc = computeBuildingLoads(project, 'quick');
  assert.equal(calc.roomResults[0].cooling.status, 'not_required');
  assert.equal(calc.roomResults[0].cooling.demandW, null);
});

test('QL-13: no zero fabricated for semantic absence', () => {
  const rooms = [makeRoom('room-1', 'bedroom', 'Спальня 1', 20)];
  const assignment: EngineeringRoomAssignment = {
    ...makeAssignment(rooms[0], ['aluminum_radiators'], []),
    servicePreferences: { heating: 'required', cooling: 'not_required' } as const,
  };
  const project = makeProject({
    rooms,
    systemsConfiguration: {
      ...makeProject().systemsConfiguration!,
      requestedServices: ['heating', 'cooling'],
      roomAssignments: [assignment],
    },
  });
  const calc = computeBuildingLoads(project, 'quick');
  assert.equal(calc.roomResults[0].cooling.demandW === 0, false);
  assert.equal(calc.roomResults[0].cooling.demandW, null);
});

// ---------------------------------------------------------------------------
// QL-14..15 — exact formula fixtures (regression anchors)
// ---------------------------------------------------------------------------

test('QL-14: exact heating fixture = 1215 W raw', () => {
  const room = makeRoom('room-1', 'bedroom', 'Спальня 1', 20, null, 2.7, { externalWallCount: 1, floorPosition: 'intermediate', glazingType: 'standard' });
  const project = makeProject({ rooms: [room], insulationLevel: 'medium' });
  const loc = syntheticLocation(-10, 33); // Tout,heat = -10, Tin = 20 -> ΔT = 30
  const engine = computeQuickHeating(project, room, loc);
  // V = 54; ΔT = 30; Kenvelope = 0.75; all other factors = 1 -> 1215
  assert.equal(engine.demandW, 1215);
  assert.equal(engine.inputs.volumeM3, 54);
  assert.equal(engine.inputs.indoorDesignC, 20);
  assert.equal(engine.inputs.outdoorDesignC, -10);
});

test('QL-15: exact cooling fixture = 2000 W raw', () => {
  const room = makeRoom('room-1', 'bedroom', 'Спальня 1', 20, null, 2.7, { externalWallCount: 1, floorPosition: 'intermediate', glazingType: 'standard' });
  const project = makeProject({ rooms: [room], insulationLevel: 'medium' });
  const loc = syntheticLocation(-10, 35); // ToutCool = 35, TinCool = 24 -> Kclimate = 1
  const engine = computeQuickCooling(project, room, loc);
  assert.equal(QUICK_COOLING_BASE_WM2, 100);
  assert.equal(engine.demandW, 2000);
  assert.equal(engine.coefficientTrace.kClimateCooling, 1);
});

// ---------------------------------------------------------------------------
// QL-16..20 — totals, identity, system independence
// ---------------------------------------------------------------------------

test('QL-16: room totals sum to the object raw total', () => {
  const calc = computeBuildingLoads(makeProject(), 'quick');
  const sumRoomsH = calc.roomResults.reduce((acc, r) => acc + (r.heating.demandW ?? 0), 0);
  const sumRoomsC = calc.roomResults.reduce((acc, r) => acc + (r.cooling.demandW ?? 0), 0);
  assert.equal(calc.heatingDemandW, sumRoomsH);
  assert.equal(calc.coolingDemandW, sumRoomsC);
  const h = sumEligibleRoomLoads(calc.roomResults, 'heating');
  assert.equal(h.demandW, sumRoomsH);
});

test('QL-17: rounding does not alter the stored total', () => {
  const calc = computeBuildingLoads(makeProject(), 'quick');
  // internal totals are full finite precision, not rounded UI values
  assert.ok(Number.isFinite(calc.heatingDemandW));
  const rawSum = calc.roomResults.reduce((acc, r) => acc + (r.heating.demandW ?? 0), 0);
  assert.equal(calc.heatingDemandW, rawSum);
  // and the total equals the sum of per-room RAW values (not rounded kW)
  const roundedSum = calc.roomResults.reduce((acc, r) => acc + Math.round((r.heating.demandW ?? 0) / 100) * 100, 0);
  assert.notEqual(calc.heatingDemandW, roundedSum);
});

test('QL-18: reorder rooms -> same object total', () => {
  const p1 = makeProject();
  const rooms2 = [p1.rooms[1], p1.rooms[0]];
  const p2 = makeProject({ rooms: rooms2, systemsConfiguration: { ...makeProject().systemsConfiguration!, roomAssignments: rooms2.map((r) => makeAssignment(r, ['aluminum_radiators'], ['fan_coils'])) } });
  const c1 = computeBuildingLoads(p1, 'quick');
  const c2 = computeBuildingLoads(p2, 'quick');
  assert.equal(c1.heatingDemandW, c2.heatingDemandW);
  assert.equal(c1.coolingDemandW, c2.coolingDemandW);
});

test('QL-19: rename room -> same engineering result', () => {
  const p1 = makeProject();
  const renamed = { ...p1.rooms[0], name: 'Спальня (переименована)' };
  const p2 = makeProject({ rooms: [renamed, p1.rooms[1]], systemsConfiguration: { ...makeProject().systemsConfiguration!, roomAssignments: [makeAssignment(renamed, ['aluminum_radiators'], ['fan_coils']), makeAssignment(p1.rooms[1], ['aluminum_radiators'], ['fan_coils'])] } });
  const c1 = computeBuildingLoads(p1, 'quick');
  const c2 = computeBuildingLoads(p2, 'quick');
  assert.equal(c1.heatingDemandW, c2.heatingDemandW);
  assert.equal(c2.roomResults[0].roomName, 'Спальня (переименована)');
});

test('QL-20: changing system terminal only -> physical load unchanged', () => {
  const rooms = [makeRoom('room-1', 'bedroom', 'Спальня 1', 20, null, 2.7, { externalWallCount: 1, floorPosition: 'intermediate', glazingType: 'standard' })];
  // Same engineering inputs and SAME service membership (heating + cooling both
  // required in both assignments); ONLY the heating terminal family changes:
  // radiator -> fan coil. Cooling terminal stays the same.
  const assignmentBefore = makeAssignment(rooms[0], ['aluminum_radiators'], ['fan_coils']);
  const assignmentAfter = makeAssignment(rooms[0], ['fan_coils'], ['fan_coils']);
  const p1 = makeProject({ rooms, systemsConfiguration: { ...makeProject().systemsConfiguration!, requestedServices: ['heating', 'cooling'], roomAssignments: [assignmentBefore] } });
  const p2 = makeProject({ rooms, systemsConfiguration: { ...makeProject().systemsConfiguration!, requestedServices: ['heating', 'cooling'], roomAssignments: [assignmentAfter] } });

  // guard: the ONLY engineering difference is the heating terminal family
  assert.notEqual(
    p1.systemsConfiguration!.roomAssignments[0].heatingSystems[0].familyId,
    p2.systemsConfiguration!.roomAssignments[0].heatingSystems[0].familyId,
  );
  assert.equal(
    p1.systemsConfiguration!.roomAssignments[0].coolingSystems[0].familyId,
    p2.systemsConfiguration!.roomAssignments[0].coolingSystems[0].familyId,
  );
  assert.deepEqual(assignmentBefore.servicePreferences, assignmentAfter.servicePreferences);

  const c1 = computeBuildingLoads(p1, 'quick');
  const c2 = computeBuildingLoads(p2, 'quick');
  const before = c1.roomResults[0].heating;
  const after = c2.roomResults[0].heating;
  // both sides must be real numeric results — never null (not_requested/not_required/missing)
  assert.equal(before.status, 'calculated');
  assert.equal(after.status, 'calculated');
  assert.ok(before.demandW! > 0);
  assert.ok(after.demandW! > 0);
  assert.equal(before.demandW, after.demandW);
  assert.equal(c1.heatingDemandW, c2.heatingDemandW);
  // cooling terminal unchanged -> cooling identical too
  assert.equal(c1.roomResults[0].cooling.status, 'calculated');
  assert.equal(c2.roomResults[0].cooling.status, 'calculated');
  assert.equal(c1.roomResults[0].cooling.demandW, c2.roomResults[0].cooling.demandW);
  assert.equal(c1.coolingDemandW, c2.coolingDemandW);
});

// ---------------------------------------------------------------------------
// QL-21..23 — stale / unsupported climate
// ---------------------------------------------------------------------------

test('QL-21: climate location change makes the load stale (and changes cooling)', () => {
  const p1 = makeProject(); // AM-ER (yerevan-agro: heating -18, cooling 33)
  const calc = computeBuildingLoads(p1, 'quick');
  assert.equal(isLoadStale(p1, calc), false);
  // service bumps buildingRevision when region changes; simulate the new state
  const p2 = makeProject({ region: { code: 'AM-AV', name: 'Армавир' }, buildingRevision: 4 });
  assert.equal(isLoadStale(p2, calc), true);
  const c2 = computeBuildingLoads(p2, 'quick');
  assert.equal(c2.climateLocationId, 'armavir');
  // cooling differs (armavir 32 vs yerevan 33); heating is the same (-18)
  assert.notEqual(c2.coolingDemandW, calc.coolingDemandW);
});

test('QL-22: building input change makes the load stale', () => {
  const p1 = makeProject();
  const calc = computeBuildingLoads(p1, 'quick');
  const p2 = makeProject({ buildingRevision: 4 });
  assert.equal(isLoadStale(p2, calc), true);
});

test('QL-23: unsupported climate location -> no invented numeric result', () => {
  const p = makeProject({ region: { code: 'AM-LO', name: 'Лори' } });
  const calc = computeBuildingLoads(p, 'quick');
  assert.equal(calc.heatingDemandW, null);
  assert.equal(calc.coolingDemandW, null);
  assert.equal(calc.climateLocationId, null);
  assert.ok(calc.roomResults.every((r) => r.heating.demandW === null && r.cooling.demandW === null));
  assert.ok(calc.roomResults[0].heating.missingInputs.includes('climate_location:missing_climate_location'));
});

// ---------------------------------------------------------------------------
// QL-24..27 — professional, Phase 4, numeric sanity, bands
// ---------------------------------------------------------------------------

test('QL-24: professional stays LIMITED (no QUICK coefficients inside)', () => {
  const calc = computeBuildingLoads(makeProject(), 'professional');
  assert.equal(calc.status, 'limited');
  assert.equal(calc.methodId, 'building.loads.professional');
  assert.equal(calc.heatingDemandW, null);
  assert.equal(calc.coolingDemandW, null);
  assert.equal(calc.climateLocationId, null);
  assert.equal(LOAD_METHODS.professional.status, 'limited');
  assert.equal(LOAD_METHODS.quick.status, 'active');
  assert.equal(LOAD_METHODS.quick.id, 'ohmx.quick-load.v1');
  assert.equal(LOAD_METHODS.quick.version, '1.0.0');
});

test('QL-25: no Phase 4 fields in QUICK output', () => {
  const calc = computeBuildingLoads(makeProject(), 'quick');
  const serialized = JSON.stringify(calc).toLowerCase();
  const phase4 = [
    'productid', 'sku', 'boilermodel', 'chillermodel', 'radiatorcount', 'btu',
    'pipedn', 'pumphead', 'flowrate', 'flow_l_s', 'bom', 'estimate', 'price',
  ];
  for (const key of phase4) {
    assert.ok(!serialized.includes(key), `Phase 4 leak: ${key}`);
  }
});

test('QL-26: no NaN/Infinity in any numeric result', () => {
  const calc = computeBuildingLoads(makeProject(), 'quick');
  for (const value of [calc.heatingDemandW, calc.coolingDemandW]) {
    if (value != null) assert.ok(Number.isFinite(value));
  }
  for (const room of calc.roomResults) {
    for (const res of [room.heating, room.cooling]) {
      if (res.demandW != null) assert.ok(Number.isFinite(res.demandW));
      if (res.demandRangeW) {
        assert.ok(Number.isFinite(res.demandRangeW.min));
        assert.ok(Number.isFinite(res.demandRangeW.max));
      }
      if (res.specificLoadWm2 != null) assert.ok(Number.isFinite(res.specificLoadWm2));
    }
  }
});

test('QL-27: indicative range contains the central estimate', () => {
  const calc = computeBuildingLoads(makeProject(), 'quick');
  for (const room of calc.roomResults) {
    for (const res of [room.heating, room.cooling]) {
      if (res.status !== 'calculated') continue;
      assert.ok(res.demandRangeW, 'range present for calculated result');
      assert.ok(res.demandRangeW!.min <= res.demandW! && res.demandW! <= res.demandRangeW!.max);
    }
  }
});

// ---------------------------------------------------------------------------
// QL-28..30 — bands / immutability
// ---------------------------------------------------------------------------

test('QL-28: unknown insulation widens the heating range', () => {
  const loc = syntheticLocation(-10, 33);
  const base = { externalWallCount: 1, floorPosition: 'intermediate' as const, glazingType: 'standard' as const };
  const known = makeRoom('a', 'bedroom', 'A', 20, null, 2.7, { ...base, insulationOverride: 'medium' });
  const unknown = makeRoom('b', 'bedroom', 'B', 20, null, 2.7, { ...base, insulationOverride: 'unknown' });
  const project = makeProject();
  const k = computeQuickHeating(project, known, loc);
  const u = computeQuickHeating(project, unknown, loc);
  assert.equal(k.band.minFactor, 0.8);
  assert.equal(k.band.maxFactor, 1.2);
  assert.equal(u.band.minFactor, 0.7);
  assert.equal(u.band.maxFactor, 1.3);
  assert.ok(u.band.minFactor < k.band.minFactor);
});

test('QL-29: missing solar data widens the cooling range (+ warning)', () => {
  const calc = computeBuildingLoads(makeProject(), 'quick');
  const room = calc.roomResults[0];
  assert.equal(room.cooling.status, 'calculated');
  assert.ok(room.cooling.warnings.includes('solar_orientation_not_collected'));
  assert.ok(room.cooling.demandRangeW!.max / room.cooling.demandW! > 1.3); // wide band ±35%
  assert.equal(room.cooling.coefficientTrace?.kSolar, 1);
});

test('QL-30: historical old result remains immutable after recalculation', () => {
  const p1 = makeProject();
  const calc1 = computeBuildingLoads(p1, 'quick');
  const snapshot1 = engineeringJson(calc1);
  // a later project state (edited) does not mutate the historical result object
  const p2 = makeProject({ buildingRevision: 9, region: { code: 'AM-AV', name: 'Армавир' } });
  computeBuildingLoads(p2, 'quick');
  assert.equal(engineeringJson(calc1), snapshot1);
  assert.equal(calc1.climateLocationId, 'yerevan-agro');
});

// ---------------------------------------------------------------------------
// Climate dataset tests (spec §57) — every vendored entry + exact fixtures
// ---------------------------------------------------------------------------

test('CLIM-01: dataset has valid metadata and stable id', () => {
  const ds = loadClimateDataset();
  assert.equal(ds.datasetId, 'armenia-hhsn-22-01-2024');
  assert.equal(typeof ds.datasetVersion, 'string');
  assert.ok(ds.sourceTitle.includes('22-01-2024'));
  assert.ok(ds.sourceUrl.startsWith('https://www.arlis.am'));
});

test('CLIM-02: every location is finite, unique, and fully sourced', () => {
  const ds = loadClimateDataset();
  const ids = new Set<string>();
  assert.ok(ds.locations.length >= 10);
  for (const loc of ds.locations) {
    assert.ok(!ids.has(loc.id), `duplicate id ${loc.id}`);
    ids.add(loc.id);
    assert.ok(Number.isFinite(loc.heatingOutdoorDesignC), `${loc.id} heating`);
    assert.ok(Number.isFinite(loc.coolingOutdoorDesignC), `${loc.id} cooling`);
    assert.equal(loc.sourceTableHeating, '25');
    assert.equal(loc.sourceTableCooling, '22');
    assert.ok(Number.isInteger(loc.sourceRowHeating) && loc.sourceRowHeating > 0);
    assert.ok(Number.isInteger(loc.sourceRowCooling) && loc.sourceRowCooling > 0);
    assert.ok(loc.labelRu && loc.labelHy);
    assert.ok(loc.heatingOutdoorDesignC < loc.coolingOutdoorDesignC, `${loc.id} H<C sanity`);
  }
});

test('CLIM-03: regionMap entries point to existing locations only', () => {
  const ds = loadClimateDataset();
  const ids = new Set(ds.locations.map((l) => l.id));
  for (const [code, entry] of Object.entries(ds.regionMap)) {
    assert.ok(code.startsWith('AM-'));
    assert.ok(ids.has(entry.locationId), `${code} -> ${entry.locationId}`);
  }
  // no invented region claims: only unambiguous mappings exist
  assert.deepEqual(Object.keys(ds.regionMap).sort(), ['AM-AV', 'AM-ER']);
});

test('CLIM-04: exact official-source fixture (Yerevan) prevents dataset corruption', () => {
  const ds = loadClimateDataset();
  const yerevan = ds.locations.find((l) => l.id === 'yerevan-agro')!;
  assert.equal(yerevan.heatingOutdoorDesignC, -18); // HHSHN 22-01-2024 Table 25, row 23, five-day 0.92
  assert.equal(yerevan.coolingOutdoorDesignC, 33); // Table 22, row 13, hottest-day mean daily 0.95
  assert.equal(yerevan.elevationM, 942);
  const arabkir = ds.locations.find((l) => l.id === 'yerevan-arabkir')!;
  assert.equal(arabkir.heatingOutdoorDesignC, -14);
  const armavir = ds.locations.find((l) => l.id === 'armavir')!;
  assert.equal(armavir.heatingOutdoorDesignC, -18);
  assert.equal(armavir.coolingOutdoorDesignC, 32);
});

test('CLIM-05: resolution is deterministic and honest for uncovered regions', () => {
  assert.equal(resolveClimateLocation('AM-ER')?.id, 'yerevan-agro');
  assert.equal(resolveClimateLocation('AM-AV')?.id, 'armavir');
  assert.equal(resolveClimateLocation('AM-LO'), null);
  assert.equal(resolveClimateLocation('AM-other'), null);
  assert.equal(resolveClimateLocation(null), null);
  assert.equal(resolveClimateLocation(undefined), null);
});

test('CLIM-06: no malformed numeric strings / no NaN in any field', () => {
  const ds = loadClimateDataset();
  const serialized = JSON.stringify(ds);
  assert.ok(!serialized.includes('NaN'));
  assert.ok(!serialized.includes('Infinity'));
  for (const loc of ds.locations) {
    assert.ok(Number.isFinite(loc.elevationM));
  }
});

// ---------------------------------------------------------------------------
// Missing-input integration (partial totals are explicitly marked)
// ---------------------------------------------------------------------------

test('QL-extra: one missing-input room makes the object total incomplete with marked partial', () => {
  const rooms = [
    makeRoom('r1', 'bedroom', 'Спальня 1', 20, null, 2.7, { externalWallCount: 1, floorPosition: 'intermediate', glazingType: 'standard' }),
    makeRoom('r2', 'bedroom', 'Спальня 2', null, null, 2.7, { externalWallCount: 1, floorPosition: 'intermediate', glazingType: 'standard' }),
  ];
  const project = makeProject({
    rooms,
    systemsConfiguration: {
      ...makeProject().systemsConfiguration!,
      roomAssignments: rooms.map((r) => makeAssignment(r, ['aluminum_radiators'], [])),
    },
  });
  const calc = computeBuildingLoads(project, 'quick');
  assert.equal(calc.status, 'incomplete');
  assert.equal(calc.heatingDemandW, null);
  assert.ok(calc.partialHeatingDemandW! > 0); // marked partial sum, never a design load
  assert.ok(calc.roomResults[1].heating.missingInputs.includes('room_area:missing'));
});
