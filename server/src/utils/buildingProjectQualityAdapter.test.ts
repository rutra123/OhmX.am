/**
 * Phase 3.2P-B2 — live steady_state quality-field adapter tests.
 *
 * Intentionally written but NOT executed. B2 does not integrate with
 * computeBuildingLoads; fixtures provide the already-resolved steady_state
 * snapshot/breakdowns that the live engine exposes.
 */
import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeEngineeringQuality } from './buildingProjectQuality.js';
import {
  AdapterInventoryValidationError,
  buildExpectedQualityFieldPlan,
  buildEngineeringQualityFields,
  KNOWN_AUTHORITATIVE_CLIMATE_DATASET_IDS,
  normalizeCurrentEngineeringProvenance,
  validateQualityFieldInventory,
} from './buildingProjectQualityAdapter.js';
import type {
  ExpectedQualityFieldPlan,
  QualityFieldClassificationIndex,
} from './buildingProjectQualityAdapter.js';
import type {
  AirBreakdown,
  BuildingLoadCalculation,
  BuildingLoadInputSnapshot,
  BuildingProject,
  BuildingRoom,
  BuildingSystemArchitecture,
  EngineeringQualityFieldInput,
  EngineeringSystemConfiguration,
  EnvelopeElement,
  InternalGainsBreakdown,
  RoomLoadResult,
  SolarBreakdown,
  TransmissionBreakdown,
} from './buildingProjectTypes.js';

const EVALUATED_AT = '2026-09-02T00:00:00.000Z';

type ServiceStatus = RoomLoadResult['heating']['status'];

function element(id: string, overrides: Partial<EnvelopeElement> = {}): EnvelopeElement {
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
    ...overrides,
  };
}

function room(overrides: Partial<BuildingRoom> = {}): BuildingRoom {
  return {
    id: 'room-1',
    roomType: 'bedroom',
    name: 'Room 1',
    areaM2: 20,
    floorId: null,
    extras: {
      geometry: {
        ceilingHeightM: 2.5,
        externalWallCount: 1,
        externalDoorCount: 0,
        floorPosition: 'intermediate',
        spaceAbove: 'conditioned_space',
        spaceBelow: 'conditioned_space',
      },
      windows: { glazingType: 'standard', count: 0, areaM2: 0 },
      insulationOverride: null,
      conditions: [],
      notes: null,
      engineeringUse: 'stored_only',
    },
    ...overrides,
  };
}

const ARCHITECTURE: BuildingSystemArchitecture = {
  spaceHeatingSourceId: null,
  spaceCoolingSourceId: null,
  spaceCombinedSourceId: null,
  sources: [],
  distribution: {
    id: 'independent_dx',
    label: 'Independent DX',
    circuitKind: 'independent',
    simultaneousHeatCool: false,
    notes: [],
  },
  dhw: { status: 'not_configured', sourceFamilyId: null, architectureId: null, notes: [] },
  simultaneousHeatCoolSupported: false,
  warnings: [],
};

function configuration(requestedServices: Array<'heating' | 'cooling'>): EngineeringSystemConfiguration {
  return {
    projectId: 'project-1',
    requestedServices,
    simultaneousHeatCoolRequired: false,
    selectedSystemFamilies: [],
    architecture: ARCHITECTURE,
    roomAssignments: [],
    configurationStatus: 'confirmed',
    warnings: [],
    confirmedAt: EVALUATED_AT,
    buildingRevisionAtConfirmation: 1,
    systemsRevisionAtConfirmation: 1,
    systemsRevision: 1,
  };
}

function project(
  rooms: BuildingRoom[],
  overrides: Partial<BuildingProject> = {},
): BuildingProject {
  const requestedServices = overrides.systemsConfiguration?.requestedServices ?? ['heating', 'cooling'];
  return {
    id: 'project-1',
    name: 'Quality adapter fixture',
    status: 'calculated',
    createdAt: EVALUATED_AT,
    updatedAt: EVALUATED_AT,
    objectConfirmedAt: EVALUATED_AT,
    objectConfirmedRevision: 1,
    buildingRevision: 1,
    objectType: 'private_house',
    region: { code: 'AM-ER', name: 'Ереван' },
    totalAreaM2: null,
    defaultCeilingHeightM: 2.7,
    insulationLevel: 'unknown',
    topology: null,
    rooms,
    selectedSystems: [],
    systemsRevision: 1,
    systemsConfiguration: configuration(requestedServices),
    systemsConfigurationSnapshot: null,
    objectConfirmedSnapshot: null,
    ...overrides,
  };
}

function transmission(
  elements: TransmissionBreakdown['elements'] = [],
  overrides: Partial<TransmissionBreakdown> = {},
): TransmissionBreakdown {
  return {
    elements,
    heatingW: 100,
    coolingW: 100,
    indoorHeatingC: 20,
    indoorCoolingC: 24,
    outdoorHeatingC: -18,
    outdoorCoolingC: 33,
    ...overrides,
  };
}

function air(overrides: Partial<AirBreakdown> = {}): AirBreakdown {
  return {
    ventilationBalance: 'natural',
    roomVolumeM3: 50,
    ventilationFlowM3h: null,
    infiltrationFlowM3h: 40,
    effectiveOutdoorAirFlowM3h: 40,
    infiltrationSource: 'airtightness_profile',
    airConstant: 0.34,
    heatingDeltaTK: 38,
    coolingDeltaTK: 9,
    heatingW: 500,
    coolingW: 120,
    warnings: ['profile_default:airtightness_poor_private_house'],
    ...overrides,
  };
}

function solar(overrides: Partial<SolarBreakdown> = {}): SolarBreakdown {
  return {
    windows: [],
    totalCoolingW: 0,
    missingInputs: [],
    warnings: ['solar_dataset:PVGIS (EU JRC) — PVGIS-SARAH3 radiation + ERA5 meteorology:2.0.0'],
    ...overrides,
  };
}

function internal(overrides: Partial<InternalGainsBreakdown> = {}): InternalGainsBreakdown {
  return {
    occupancy: 2,
    occupancySource: 'profile_default',
    occupantSensibleWPerPerson: 75,
    peopleW: 150,
    peopleSource: 'profile',
    lightingW: 100,
    lightingSource: 'profile',
    equipmentW: 100,
    equipmentSource: 'profile',
    totalCoolingW: 350,
    warnings: [],
    ...overrides,
  };
}

function service(status: ServiceStatus = 'calculated'): RoomLoadResult['heating'] {
  return {
    status,
    demandW: status === 'calculated' ? 100 : null,
    demandRangeW: null,
    assumptions: [],
    warnings: [],
    missingInputs: [],
  };
}

function roomResult(
  sourceRoom: BuildingRoom,
  overrides: Partial<RoomLoadResult> = {},
): RoomLoadResult {
  return {
    roomId: sourceRoom.id,
    roomName: sourceRoom.name,
    roomType: sourceRoom.roomType,
    floorId: sourceRoom.floorId ?? null,
    floorLabel: null,
    areaM2: sourceRoom.areaM2,
    effectiveCeilingHeightM: 2.5,
    heating: service(),
    cooling: service(),
    transmissionBreakdown: transmission(),
    airBreakdown: air(),
    solarBreakdown: solar(),
    internalGainsBreakdown: internal(),
    ...overrides,
  };
}

function snapshotFor(p: BuildingProject, requestedServices: Array<'heating' | 'cooling'>): BuildingLoadInputSnapshot {
  return {
    projectId: p.id,
    objectType: p.objectType,
    region: p.region,
    defaultCeilingHeightM: p.defaultCeilingHeightM,
    insulationLevel: p.insulationLevel,
    topology: p.topology,
    rooms: p.rooms.map((r) => ({
      id: r.id,
      roomType: r.roomType,
      name: r.name,
      areaM2: r.areaM2,
      floorId: r.floorId ?? null,
      ceilingHeightOverrideM: r.extras.geometry.ceilingHeightM ?? null,
      externalWallCount: r.extras.geometry.externalWallCount ?? null,
      externalDoorCount: r.extras.geometry.externalDoorCount ?? null,
      floorPosition: r.extras.geometry.floorPosition ?? null,
      spaceAbove: r.extras.geometry.spaceAbove ?? null,
      spaceBelow: r.extras.geometry.spaceBelow ?? null,
      insulationOverride: r.extras.insulationOverride ?? null,
      conditions: [...r.extras.conditions],
      windows: {
        glazingType: r.extras.windows.glazingType ?? null,
        count: r.extras.windows.count ?? null,
        areaM2: r.extras.windows.areaM2 ?? null,
      },
      envelope: r.envelope ?? null,
      air: r.air ?? null,
      internalGains: r.internalGains ?? null,
    })),
    requestedServices,
    servicePreferences: [],
    buildingRevision: p.buildingRevision,
    systemsRevision: p.systemsRevision,
    mode: 'steady_state',
    methodVersion: '1.0.0',
  };
}

function calculation(
  p: BuildingProject,
  results: RoomLoadResult[],
  overrides: Partial<BuildingLoadCalculation> = {},
): BuildingLoadCalculation {
  const requestedServices = p.systemsConfiguration?.requestedServices ?? ['heating', 'cooling'];
  const inputSnapshot = snapshotFor(p, requestedServices);
  return {
    mode: 'steady_state',
    status: 'calculated',
    methodId: 'ohmx.steady-state.v1',
    methodVersion: '1.0.0',
    buildingRevisionAtCalculation: p.buildingRevision,
    systemsRevisionAtCalculation: p.systemsRevision,
    roomResults: results,
    heatingDemandW: 100,
    coolingDemandW: 100,
    warnings: [],
    missingInputs: [],
    assumptions: [],
    inputSnapshot,
    calculatedAt: EVALUATED_AT,
    climateDatasetId: 'armenia-hhsn-22-01-2024',
    climateDatasetVersion: '1.0.0',
    climateLocationId: 'yerevan-agro',
    climateLocationLabel: 'Yerevan Agro',
    ...overrides,
  };
}

function adapt(
  p: BuildingProject,
  results: RoomLoadResult[],
  overrides: Partial<BuildingLoadCalculation> = {},
) {
  return buildEngineeringQualityFields(adapterInput(p, results, overrides));
}

function adapterInput(
  p: BuildingProject,
  results: RoomLoadResult[],
  overrides: Partial<BuildingLoadCalculation> = {},
) {
  return {
    project: p,
    steadyStateCalculation: calculation(p, results, overrides),
    physicalCompleteness: true,
  };
}

function field(result: ReturnType<typeof adapt>, parameter: string, predicate: (f: EngineeringQualityFieldInput) => boolean = () => true) {
  return result.fields.find((f) => f.parameter === parameter && predicate(f));
}

function classificationForIds(
  plan: ExpectedQualityFieldPlan,
  actualIds: ReadonlySet<string>,
): QualityFieldClassificationIndex {
  const retain = (ids: ReadonlySet<string>) => new Set([...ids].filter((id) => actualIds.has(id)));
  return {
    applicableFieldIds: retain(plan.applicableFieldIds),
    irrelevantFieldIds: retain(plan.irrelevantFieldIds),
    supersededFieldIds: retain(plan.supersededFieldIds),
  };
}

function inventoryFieldStub(
  fieldId: string,
  plan: ExpectedQualityFieldPlan,
): EngineeringQualityFieldInput {
  const supersedingFieldId = [...plan.applicableFieldIds][0] ?? fieldId;
  const supersededBy = plan.supersededFieldIds.has(fieldId)
    ? [supersedingFieldId]
    : undefined;
  return {
    fieldId,
    parameter: 'roomType',
    effectiveValue: null,
    effectiveProvenance: 'UNKNOWN',
    userConfirmed: false,
    supersededBy,
    applicability: {
      roomLoadCalculated: true,
      elementExists: true,
      outdoorAirLoadApplicable: true,
      solarExposedGlazingExists: true,
      occupancy: 1,
      roomHasArea: true,
      roomType: 'bedroom',
      livingRoomHasKitchen: false,
      mechanicalVentilationUsed: false,
    },
  };
}

test('globally unique field IDs across two rooms', () => {
  const r1 = room({ id: 'room-1', areaM2: 20 });
  const r2 = room({ id: 'room-2', areaM2: 20 });
  const result = adapt(project([r1, r2]), [roomResult(r1), roomResult(r2)]);
  assert.equal(new Set(result.fields.map((f) => f.fieldId)).size, result.fields.length);
});

test('same parameter in two rooms does not collide', () => {
  const r1 = room({ id: 'room-1' });
  const r2 = room({ id: 'room-2' });
  const result = adapt(project([r1, r2]), [roomResult(r1), roomResult(r2)]);
  const areaIds = result.fields.filter((f) => f.parameter === 'areaM2').map((f) => f.fieldId);
  assert.equal(new Set(areaIds).size, 4);
});

test('heating/cooling service IDs do not collide', () => {
  const r = room();
  const result = adapt(project([r]), [roomResult(r)]);
  const ids = result.fields.filter((f) => f.parameter === 'U_wall').map((f) => f.fieldId);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.some((id) => id.includes(':heating:')));
  assert.ok(ids.some((id) => id.includes(':cooling:')));
});

test('known live Armenian climate dataset maps AUTHORITATIVE_DATASET', () => {
  assert.deepEqual(KNOWN_AUTHORITATIVE_CLIMATE_DATASET_IDS, ['armenia-hhsn-22-01-2024']);
  const r = room();
  const result = adapt(project([r]), [roomResult(r)]);
  const climate = field(result, 'climate', (f) => f.service === 'heating');
  assert.equal(climate?.effectiveProvenance, 'AUTHORITATIVE_DATASET');
  assert.equal(climate?.sourceReference, 'dataset=armenia-hhsn-22-01-2024;version=1.0.0;location=yerevan-agro');
});

test('unknown non-empty climate dataset maps UNKNOWN and emits diagnostic warning', () => {
  const r = room();
  const result = adapt(project([r]), [roomResult(r)], { climateDatasetId: 'future-climate-v9' });
  const climate = field(result, 'climate', (f) => f.service === 'heating');
  const outdoor = field(result, 'ToutHeatingDesign');
  assert.equal(climate?.effectiveProvenance, 'UNKNOWN');
  assert.equal(outdoor?.effectiveProvenance, 'UNKNOWN');
  assert.ok(climate?.sourceReference?.includes('dataset=future-climate-v9'));
  assert.ok(result.warnings.includes('unknown_climate_dataset:future-climate-v9'));
});

test('known climate dataset without location maps UNKNOWN', () => {
  const r = room();
  const result = adapt(project([r]), [roomResult(r)], { climateLocationId: null, climateLocationLabel: null });
  assert.equal(field(result, 'climate', (f) => f.service === 'heating')?.effectiveProvenance, 'UNKNOWN');
  assert.equal(field(result, 'ToutHeatingDesign')?.effectiveProvenance, 'UNKNOWN');
});

test('missing climate dataset maps UNKNOWN', () => {
  const r = room();
  const result = adapt(project([r]), [roomResult(r)], { climateDatasetId: null, climateDatasetVersion: null });
  assert.equal(field(result, 'climate', (f) => f.service === 'heating')?.effectiveProvenance, 'UNKNOWN');
  assert.equal(field(result, 'ToutHeatingDesign')?.effectiveProvenance, 'UNKNOWN');
});

test('unknown non-empty climate dataset cannot permit Level 3', () => {
  const r = room();
  const result = adapt(project([r]), [roomResult(r)], { climateDatasetId: 'future-climate-v9' });
  const composed = computeEngineeringQuality({
    evaluatedAt: EVALUATED_AT,
    requestedLevel: 3,
    requestedServices: ['heating', 'cooling'],
    physicalCompleteness: true,
    legacyUnassessed: false,
    coverage: result.coverage,
    fields: result.fields,
  });
  const climate = composed.fields.find((candidate) => candidate.parameter === 'climate' && candidate.service === 'heating');
  assert.equal(climate?.effectiveProvenance, 'UNKNOWN');
  assert.equal(climate?.quality, 'UNRESOLVED');
  assert.notEqual(composed.maximumEligibleLevel, 3);
});

test('PVGIS maps to AUTHORITATIVE_DATASET', () => {
  const noWindowRoom = room();
  const noWindowResult = adapt(project([noWindowRoom]), [roomResult(noWindowRoom)]);
  const noWindowSentinel = noWindowResult.fields.find(
    (candidate) => candidate.fieldId === 'room:room-1:cooling:solar:window:none:irradiance',
  );
  assert.equal(noWindowSentinel?.applicability.elementExists, false);
  assert.equal(noWindowSentinel?.applicability.solarExposedGlazingExists, false);
  assert.equal(noWindowSentinel?.effectiveValue, null);
  assert.equal(noWindowSentinel?.effectiveProvenance, 'UNKNOWN');
  assert.ok(noWindowSentinel?.sourceReference?.startsWith('PVGIS (EU JRC)'));
  assert.ok(noWindowResult.inventory.irrelevantFieldIds.includes(noWindowSentinel?.fieldId ?? ''));

  const r = room({
    envelope: {
      wallElements: [],
      windowElements: [element('window-1', { areaM2: 2, orientation: 'S' })],
      doorElements: [],
      roofElements: [],
      floorElements: [],
    },
  });
  const rr = roomResult(r, {
    solarBreakdown: solar({
      windows: [{
        elementId: 'window-1',
        areaM2: 2,
        orientation: 'S',
        shgc: 0.7,
        shgcSource: 'glazing_profile',
        shadingFactor: 0.7,
        shadingSource: 'profile',
        irradianceWm2: 500,
        irradianceSource: 'PVGIS (EU JRC)',
        coolingW: 490,
      }],
    }),
  });
  const result = adapt(project([r]), [rr]);
  const irradiance = result.fields.find(
    (candidate) => candidate.parameter === 'solarIrradiance'
      && candidate.applicability.elementExists
      && candidate.applicability.solarExposedGlazingExists,
  );
  assert.equal(irradiance?.fieldId, 'room:room-1:cooling:solar:window:window-1:irradiance');
  assert.equal(irradiance?.effectiveValue, 500);
  assert.equal(irradiance?.effectiveProvenance, 'AUTHORITATIVE_DATASET');
  assert.ok(irradiance?.sourceReference?.startsWith('PVGIS (EU JRC)'));
  assert.ok(result.inventory.applicableFieldIds.includes(irradiance?.fieldId ?? ''));
  assert.equal(normalizeCurrentEngineeringProvenance('solar', 'PVGIS (EU JRC) — PVGIS-SARAH3'), 'AUTHORITATIVE_DATASET');
});

test('certificate U maps CERTIFIED_SPEC', () => {
  const r = room({ envelope: { wallElements: [element('wall-1', { areaM2: 10, uValue: 0.25 })], windowElements: [], doorElements: [], roofElements: [], floorElements: [] } });
  const rr = roomResult(r, { transmissionBreakdown: transmission([{ elementId: 'wall-1', kind: 'wall', areaM2: 10, uValue: 0.25, uValueSource: 'certificate', heatingW: 100, coolingW: 100 }]) });
  const result = adapt(project([r]), [rr]);
  assert.equal(field(result, 'U_wall')?.effectiveProvenance, 'CERTIFIED_SPEC');
});

test('profile U maps PROFILE_DEFAULT', () => {
  const r = room({ envelope: { wallElements: [element('wall-1', { areaM2: 10, constructionTier: 'average' })], windowElements: [], doorElements: [], roofElements: [], floorElements: [] } });
  const rr = roomResult(r, { transmissionBreakdown: transmission([{ elementId: 'wall-1', kind: 'wall', areaM2: 10, uValue: 0.6, uValueSource: 'construction_profile', heatingW: 100, coolingW: 100 }]) });
  const result = adapt(project([r]), [rr]);
  assert.equal(field(result, 'U_wall')?.effectiveProvenance, 'PROFILE_DEFAULT');
});

test('legacy U source maps LEGACY_SEED', () => {
  assert.equal(normalizeCurrentEngineeringProvenance('u_value', 'legacy_insulation_seed'), 'LEGACY_SEED');
});

test('unknown source fails closed and maps UNKNOWN', () => {
  const warnings: string[] = [];
  assert.equal(normalizeCurrentEngineeringProvenance('u_value', 'future_source', warnings), 'UNKNOWN');
  assert.ok(warnings.some((warning) => warning.includes('unknown_source_token')));
});

test('DERIVED volume preserves derivation provenance', () => {
  const r = room({ areaM2: 20 });
  const result = adapt(project([r]), [roomResult(r, { effectiveCeilingHeightM: 2.5, airBreakdown: air({ roomVolumeM3: 50 }) })]);
  const volume = field(result, 'volumeM3', (f) => f.service === 'heating');
  assert.equal(volume?.effectiveValue, 50);
  assert.equal(volume?.effectiveProvenance, 'DERIVED');
  assert.ok(volume?.sourceReference?.includes('areaM2'));
});

test('no windows makes solar/window fields non-blocking after B1 composition', () => {
  const r = room({ envelope: { wallElements: [], windowElements: [], doorElements: [], roofElements: [], floorElements: [] } });
  const p = project([r], { systemsConfiguration: configuration(['cooling']) });
  const result = adapt(p, [roomResult(r, { heating: service('not_requested'), solarBreakdown: solar() })]);
  const composed = computeEngineeringQuality({
    evaluatedAt: EVALUATED_AT,
    requestedLevel: 3,
    requestedServices: ['cooling'],
    physicalCompleteness: true,
    legacyUnassessed: false,
    coverage: result.coverage,
    fields: result.fields,
  });
  assert.ok(composed.fields.filter((f) => f.parameter === 'SHGC').every((f) => f.criticality === 'IRRELEVANT'));
  assert.ok(!composed.blockingFields.some((f) => f.parameter === 'SHGC' || f.parameter === 'windowOrientation'));
});

test('window exists but SHGC missing emits explicit UNKNOWN field', () => {
  const r = room({ envelope: { wallElements: [], windowElements: [element('window-1', { areaM2: 2, orientation: 'S' })], doorElements: [], roofElements: [], floorElements: [] } });
  const rr = roomResult(r, { solarBreakdown: solar({ windows: [{ elementId: 'window-1', areaM2: 2, orientation: 'S', shgc: null, shgcSource: 'missing', shadingFactor: 0.7, shadingSource: 'profile', irradianceWm2: 500, irradianceSource: 'PVGIS', coolingW: null }], missingInputs: ['shgc:missing:window-1'] }) });
  const result = adapt(project([r]), [rr]);
  const shgc = field(result, 'SHGC');
  assert.equal(shgc?.effectiveValue, null);
  assert.equal(shgc?.effectiveProvenance, 'UNKNOWN');
});

test('independent expected plan contains applicable SHGC before field emission', () => {
  const r = room({
    envelope: {
      wallElements: [],
      windowElements: [element('window-1', { areaM2: 2, orientation: 'S' })],
      doorElements: [],
      roofElements: [],
      floorElements: [],
    },
  });
  const p = project([r], { systemsConfiguration: configuration(['cooling']) });
  const rr = roomResult(r, { heating: service('not_requested') });
  const plan = buildExpectedQualityFieldPlan(adapterInput(p, [rr]));
  const expectedShgcId = 'room:room-1:cooling:solar:window:window-1:shgc';
  assert.ok(plan.expectedFieldIds.has(expectedShgcId));
  assert.ok(plan.applicableFieldIds.has(expectedShgcId));
});

test('independent expected plan rejects emitter that never emitted applicable SHGC', () => {
  const r = room({
    envelope: {
      wallElements: [],
      windowElements: [element('window-1', { areaM2: 2, orientation: 'S' })],
      doorElements: [],
      roofElements: [],
      floorElements: [],
    },
  });
  const p = project([r], { systemsConfiguration: configuration(['cooling']) });
  const rr = roomResult(r, { heating: service('not_requested') });
  const plan = buildExpectedQualityFieldPlan(adapterInput(p, [rr]));
  const expectedShgcId = 'room:room-1:cooling:solar:window:window-1:shgc';

  // This is an intentionally incomplete emitter fixture, not a normal adapter
  // result with a field deleted after the fact. The plan already exists first.
  const actualIds = new Set([...plan.expectedFieldIds].filter((id) => id !== expectedShgcId));
  const actualFields = [...actualIds].map((id) => inventoryFieldStub(id, plan));
  const actualClassification = classificationForIds(plan, actualIds);

  assert.ok(plan.applicableFieldIds.has(expectedShgcId));
  assert.throws(
    () => validateQualityFieldInventory(actualFields, plan, actualClassification),
    (error: unknown) => error instanceof AdapterInventoryValidationError
      && error.code === 'missing_expected_field'
      && error.fieldId === expectedShgcId,
  );
});

test('expected applicable classification rejects actual IRRELEVANT classification', () => {
  const r = room({
    envelope: {
      wallElements: [],
      windowElements: [element('window-1', { areaM2: 2, orientation: 'S' })],
      doorElements: [],
      roofElements: [],
      floorElements: [],
    },
  });
  const p = project([r], { systemsConfiguration: configuration(['cooling']) });
  const plan = buildExpectedQualityFieldPlan(adapterInput(p, [roomResult(r, { heating: service('not_requested') })]));
  const shgcId = 'room:room-1:cooling:solar:window:window-1:shgc';
  const actualIds = new Set(plan.expectedFieldIds);
  const actualFields = [...actualIds].map((id) => inventoryFieldStub(id, plan));
  const actualClassification = classificationForIds(plan, actualIds);
  const applicable = new Set(actualClassification.applicableFieldIds);
  const irrelevant = new Set(actualClassification.irrelevantFieldIds);
  applicable.delete(shgcId);
  irrelevant.add(shgcId);

  assert.throws(
    () => validateQualityFieldInventory(actualFields, plan, {
      ...actualClassification,
      applicableFieldIds: applicable,
      irrelevantFieldIds: irrelevant,
    }),
    (error: unknown) => error instanceof AdapterInventoryValidationError
      && error.code === 'inventory_conflict'
      && error.fieldId === shgcId,
  );
});

test('planned superseded field rejects missing supersededBy state', () => {
  const r = room({
    envelope: {
      wallElements: [],
      windowElements: [element('window-1', { areaM2: 2, orientation: 'S' })],
      doorElements: [],
      roofElements: [],
      floorElements: [],
    },
  });
  const p = project([r], { systemsConfiguration: configuration(['cooling']) });
  const plan = buildExpectedQualityFieldPlan(adapterInput(p, [roomResult(r, { heating: service('not_requested') })]));
  const frameId = 'room:room-1:cooling:solar:window:window-1:frame-factor';
  const actualIds = new Set(plan.expectedFieldIds);
  const actualFields = [...actualIds].map((id) => {
    const stub = inventoryFieldStub(id, plan);
    return id === frameId ? { ...stub, supersededBy: undefined } : stub;
  });

  assert.ok(plan.supersededFieldIds.has(frameId));
  assert.throws(
    () => validateQualityFieldInventory(actualFields, plan, classificationForIds(plan, actualIds)),
    (error: unknown) => error instanceof AdapterInventoryValidationError
      && error.code === 'inventory_conflict'
      && error.fieldId === frameId,
  );
});

test('heating-only kitchen has no applicable cooling process blocker', () => {
  const r = room({ roomType: 'kitchen' });
  const p = project([r], { systemsConfiguration: configuration(['heating']) });
  const result = adapt(p, [roomResult(r, { cooling: service('not_requested') })]);
  const composed = computeEngineeringQuality({
    evaluatedAt: EVALUATED_AT,
    requestedLevel: 3,
    requestedServices: ['heating'],
    physicalCompleteness: true,
    legacyUnassessed: false,
    coverage: result.coverage,
    fields: result.fields,
  });
  assert.ok(!composed.blockingFields.some((f) => f.parameter === 'kitchenProcessSchedule'));
});

test('cooling kitchen expects process field', () => {
  const r = room({ roomType: 'kitchen' });
  const p = project([r], { systemsConfiguration: configuration(['cooling']) });
  const result = adapt(p, [roomResult(r, { heating: service('not_requested') })]);
  const process = field(result, 'kitchenProcessSchedule');
  assert.equal(process?.effectiveValue, null);
  assert.equal(process?.effectiveProvenance, 'UNKNOWN');
});

test('natural ventilation marks mechanical flow IRRELEVANT', () => {
  const r = room({ air: { ventilationBalance: 'natural', ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: 0.8, ach50: null, airtightnessClass: 'poor' } });
  const result = adapt(project([r]), [roomResult(r, { airBreakdown: air({ ventilationBalance: 'natural', ventilationFlowM3h: null }) })]);
  const flow = field(result, 'ventilationFlowM3h');
  assert.equal(flow?.applicability.mechanicalVentilationUsed, false);
});

test('mechanical ventilation emits required flow field', () => {
  const r = room({ air: { ventilationBalance: 'balanced', ventilationFlowM3h: 30, infiltrationFlowM3h: 10, airChangesPerHour: null, ach50: null, airtightnessClass: null } });
  const result = adapt(project([r]), [roomResult(r, { airBreakdown: air({ ventilationBalance: 'balanced', ventilationFlowM3h: 30 }) })]);
  const flow = field(result, 'ventilationFlowM3h');
  assert.equal(flow?.effectiveValue, 30);
  assert.equal(flow?.applicability.mechanicalVentilationUsed, true);
});

test('explicit net glazing supersedes frame fallback', () => {
  const r = room({ envelope: { wallElements: [], windowElements: [element('window-1', { areaM2: 2, orientation: 'S' })], doorElements: [], roofElements: [], floorElements: [] } });
  const rr = roomResult(r, { solarBreakdown: solar({ windows: [{ elementId: 'window-1', areaM2: 2, orientation: 'S', shgc: 0.7, shgcSource: 'glazing_profile', shadingFactor: 0.7, shadingSource: 'profile', irradianceWm2: 500, irradianceSource: 'PVGIS', coolingW: 490 }] }) });
  const result = adapt(project([r]), [rr]);
  const frame = field(result, 'frameFactor');
  assert.ok(frame?.supersededBy?.some((id) => id.includes('net-glazing-area')));
});

test('certified U supersedes profile U', () => {
  const r = room({ envelope: { wallElements: [element('wall-1', { areaM2: 10, uValue: 0.25, constructionTier: 'poor' })], windowElements: [], doorElements: [], roofElements: [], floorElements: [] } });
  const rr = roomResult(r, { transmissionBreakdown: transmission([{ elementId: 'wall-1', kind: 'wall', areaM2: 10, uValue: 0.25, uValueSource: 'certificate', heatingW: 100, coolingW: 100 }]) });
  const result = adapt(project([r]), [rr]);
  const uValues = result.fields.filter((f) => f.parameter === 'U_wall');
  const effectiveUValues = uValues.filter((f) => !f.supersededBy?.length);
  const supersededProfileUValues = uValues.filter((f) => f.supersededBy?.length);
  const effectiveIds = ['heating', 'cooling'].map(
    (serviceName) => `room:room-1:${serviceName}:envelope:wall:wall-1:u`,
  ).sort();
  const supersededIds = effectiveIds.map((id) => `${id}:profile-superseded`).sort();

  assert.equal(uValues.length, 4);
  assert.deepEqual(effectiveUValues.map((f) => f.fieldId).sort(), effectiveIds);
  assert.ok(effectiveUValues.every(
    (f) => f.effectiveProvenance === 'CERTIFIED_SPEC'
      && f.effectiveValue === 0.25
      && result.inventory.applicableFieldIds.includes(f.fieldId),
  ));
  assert.deepEqual(supersededProfileUValues.map((f) => f.fieldId).sort(), supersededIds);
  assert.ok(supersededProfileUValues.every((f) => {
    const effectiveId = f.fieldId.replace(/:profile-superseded$/, '');
    const supersededBy = f.supersededBy ?? [];
    return f.effectiveProvenance === 'PROFILE_DEFAULT'
      && f.effectiveValue === null
      && result.inventory.supersededFieldIds.includes(f.fieldId)
      && supersededBy.length === 1
      && supersededBy[0] === effectiveId;
  }));

  const composed = computeEngineeringQuality({
    evaluatedAt: EVALUATED_AT,
    requestedLevel: 3,
    requestedServices: ['heating', 'cooling'],
    physicalCompleteness: true,
    legacyUnassessed: false,
    coverage: result.coverage,
    fields: result.fields,
  });
  const composedUValues = composed.fields.filter((f) => f.parameter === 'U_wall');
  assert.ok(composedUValues.filter((f) => !f.supersededBy?.length).every(
    (f) => f.effectiveProvenance === 'CERTIFIED_SPEC'
      && f.criticality === 'CRITICAL'
      && f.status === 'ok',
  ));
  assert.ok(composedUValues.filter((f) => f.supersededBy?.length).every(
    (f) => f.effectiveProvenance === 'PROFILE_DEFAULT'
      && f.status === 'ok'
      && f.messageCode === 'superseded_input',
  ));
  assert.ok(!composed.blockingFields.some((blocker) => supersededIds.includes(blocker.fieldId)));
});

test('measured ACH supersedes profile ACH', () => {
  const r = room({ air: { ventilationBalance: 'natural', ventilationFlowM3h: null, infiltrationFlowM3h: 40, airChangesPerHour: null, ach50: null, airtightnessClass: 'poor' } });
  const rr = roomResult(r, { airBreakdown: air({ infiltrationSource: 'measured', infiltrationFlowM3h: 40, roomVolumeM3: 50 }) });
  const result = adapt(project([r]), [rr]);
  const airtightness = field(result, 'airtightnessClass');
  assert.ok(airtightness?.supersededBy?.length);
  assert.equal(field(result, 'infiltrationFlowM3h')?.effectiveProvenance, 'MEASURED');
});

test('duplicate fieldId is rejected', () => {
  const r = room();
  const p = project([r]);
  const rr = roomResult(r);
  const input = adapterInput(p, [rr]);
  const plan = buildExpectedQualityFieldPlan(input);
  const result = buildEngineeringQualityFields(input);
  const duplicate = [result.fields[0], result.fields[0]];
  const actualIds = new Set(duplicate.map((candidate) => candidate.fieldId));
  assert.throws(
    () => validateQualityFieldInventory(duplicate, plan, classificationForIds(plan, actualIds)),
    (error: unknown) => error instanceof AdapterInventoryValidationError && error.code === 'duplicate_field_id',
  );
});

test('missing expected applicable field is rejected', () => {
  const r = room();
  const p = project([r]);
  const rr = roomResult(r);
  const input = adapterInput(p, [rr]);
  const plan = buildExpectedQualityFieldPlan(input);
  const result = buildEngineeringQualityFields(input);
  const removed = result.fields.filter((f) => f.fieldId !== result.inventory.applicableFieldIds[0]);
  const actualIds = new Set(removed.map((candidate) => candidate.fieldId));
  assert.throws(
    () => validateQualityFieldInventory(removed, plan, classificationForIds(plan, actualIds)),
    (error: unknown) => error instanceof AdapterInventoryValidationError && error.code === 'missing_expected_field',
  );
});

test('incomplete inventory cannot be composed as Level 3', () => {
  const r = room();
  const p = project([r]);
  const rr = roomResult(r);
  const input = adapterInput(p, [rr]);
  const plan = buildExpectedQualityFieldPlan(input);
  const result = buildEngineeringQualityFields(input);
  const incomplete = result.fields.filter((f) => f.fieldId !== result.inventory.applicableFieldIds[0]);
  const actualIds = new Set(incomplete.map((candidate) => candidate.fieldId));
  assert.throws(() => {
    validateQualityFieldInventory(incomplete, plan, classificationForIds(plan, actualIds));
    return computeEngineeringQuality({
      evaluatedAt: EVALUATED_AT,
      requestedLevel: 3,
      requestedServices: ['heating', 'cooling'],
      physicalCompleteness: true,
      legacyUnassessed: false,
      coverage: result.coverage,
      fields: incomplete,
    });
  }, AdapterInventoryValidationError);
});

test('coverage defaults UNKNOWN and UNCONFIRMED', () => {
  const r = room();
  const result = adapt(project([r]), [roomResult(r)]);
  assert.equal(result.coverage.scope, 'UNKNOWN');
  assert.equal(result.coverage.confirmation, 'UNCONFIRMED');
});

test('coverage ratio is informational only', () => {
  const r = room({ areaM2: 50 });
  const p = project([r], { totalAreaM2: 180 });
  const result = adapt(p, [roomResult(r)]);
  assert.equal(result.coverage.ratio, 50 / 180);
});

test('revision-21 adapter fixture is complete and preserves the known facts', () => {
  const r = room({
    id: 'revision-21-room',
    roomType: 'kitchen',
    areaM2: 50,
    envelope: {
      wallElements: [element('wall-1', { areaM2: 40, constructionTier: 'average' })],
      windowElements: [element('window-1', { areaM2: 5, constructionTier: 'average', orientation: 'S', shadingProfile: 'interior' })],
      doorElements: [],
      roofElements: [element('roof-1', { areaM2: 50, constructionTier: 'average' })],
      floorElements: [element('floor-1', { areaM2: 50, constructionTier: 'average' })],
    },
    air: { ventilationBalance: 'natural', ventilationFlowM3h: null, infiltrationFlowM3h: null, airChangesPerHour: null, ach50: null, airtightnessClass: 'poor' },
    internalGains: { occupancy: null, occupantSensibleWPerPerson: null, peopleW: null, lightingGainW: null, equipmentGainW: null },
  });
  const p = project([r], { totalAreaM2: 180 });
  const rr = roomResult(r, {
    effectiveCeilingHeightM: 2.7,
    transmissionBreakdown: transmission([
      { elementId: 'wall-1', kind: 'wall', areaM2: 40, uValue: 0.6, uValueSource: 'construction_profile', heatingW: 100, coolingW: 100 },
      { elementId: 'window-1', kind: 'window', areaM2: 5, uValue: 2.8, uValueSource: 'construction_profile', heatingW: 100, coolingW: 100 },
      { elementId: 'roof-1', kind: 'roof', areaM2: 50, uValue: 0.38, uValueSource: 'construction_profile', heatingW: 100, coolingW: 100 },
      { elementId: 'floor-1', kind: 'floor', areaM2: 50, uValue: 0.5, uValueSource: 'construction_profile', heatingW: 100, coolingW: 100 },
    ]),
    airBreakdown: air({ roomVolumeM3: 135, infiltrationFlowM3h: 108, effectiveOutdoorAirFlowM3h: 108, infiltrationSource: 'airtightness_profile' }),
    solarBreakdown: solar({ windows: [{ elementId: 'window-1', areaM2: 5, orientation: 'S', shgc: 0.7, shgcSource: 'glazing_profile', shadingFactor: 0.7, shadingSource: 'profile', irradianceWm2: 500, irradianceSource: 'PVGIS (EU JRC)', coolingW: 100 }] }),
    internalGainsBreakdown: internal({ occupancy: 1, occupancySource: 'profile_default', occupantSensibleWPerPerson: 75, peopleW: 75, peopleSource: 'profile', lightingW: 250, lightingSource: 'profile', equipmentW: 250, equipmentSource: 'profile', totalCoolingW: 575 }),
  });
  const input = adapterInput(p, [rr]);
  const plan = buildExpectedQualityFieldPlan(input);
  const result = buildEngineeringQualityFields(input);
  assert.equal(result.coverage.declaredAreaM2, 180);
  assert.equal(result.coverage.modeledAreaM2, 50);
  assert.equal(result.coverage.scope, 'UNKNOWN');
  assert.equal(result.coverage.confirmation, 'UNCONFIRMED');
  assert.equal(field(result, 'U_wall')?.effectiveProvenance, 'PROFILE_DEFAULT');
  assert.equal(field(result, 'U_wall')?.effectiveValue, 0.6);
  assert.equal(field(result, 'airChangesPerHour')?.effectiveValue, 0.8);
  assert.equal(field(result, 'airChangesPerHour')?.effectiveProvenance, 'PROFILE_DEFAULT');
  assert.equal(field(result, 'SHGC')?.effectiveProvenance, 'PROFILE_DEFAULT');
  assert.equal(field(result, 'shadingFactor')?.effectiveProvenance, 'PROFILE_DEFAULT');
  assert.ok(result.fields.some((f) => f.parameter === 'equipmentGainW' && f.effectiveValue === 250));
  validateQualityFieldInventory(
    result.fields,
    plan,
    classificationForIds(plan, new Set(result.fields.map((candidate) => candidate.fieldId))),
  );
});

test('revision-21 composed with B1 has maximum eligible Level 1', () => {
  const r = room({ id: 'revision-21-room', roomType: 'kitchen', areaM2: 50 });
  const p = project([r], { totalAreaM2: 180 });
  const result = adapt(p, [roomResult(r)]);
  const composed = computeEngineeringQuality({
    evaluatedAt: EVALUATED_AT,
    requestedLevel: 3,
    requestedServices: ['heating', 'cooling'],
    physicalCompleteness: true,
    legacyUnassessed: false,
    coverage: result.coverage,
    fields: result.fields,
  });
  assert.equal(composed.maximumEligibleLevel, 1);
});

test('two-room project inventory includes both rooms fully', () => {
  const r1 = room({ id: 'room-1' });
  const r2 = room({ id: 'room-2' });
  const input = adapterInput(project([r1, r2]), [roomResult(r1), roomResult(r2)]);
  const plan = buildExpectedQualityFieldPlan(input);
  const result = buildEngineeringQualityFields(input);
  const idsForRoom = (ids: Iterable<string>, roomId: string) => [...ids]
    .filter((id) => id.startsWith(`room:${encodeURIComponent(roomId)}:`))
    .sort();

  assert.deepEqual(
    input.steadyStateCalculation.inputSnapshot.rooms.map((candidate) => candidate.id).sort(),
    ['room-1', 'room-2'],
  );
  assert.deepEqual(
    input.steadyStateCalculation.roomResults.map((candidate) => candidate.roomId).sort(),
    ['room-1', 'room-2'],
  );
  assert.ok(input.steadyStateCalculation.roomResults.every(
    (candidate) => candidate.heating.status === 'calculated' && candidate.cooling.status === 'calculated',
  ));

  for (const roomId of ['room-1', 'room-2']) {
    const expectedIds = idsForRoom(plan.expectedFieldIds, roomId);
    const actualIds = idsForRoom(result.fields.map((candidate) => candidate.fieldId), roomId);
    const expectedApplicableIds = idsForRoom(plan.applicableFieldIds, roomId);
    const actualApplicableIds = idsForRoom(result.inventory.applicableFieldIds, roomId);
    const expectedIrrelevantIds = idsForRoom(plan.irrelevantFieldIds, roomId);
    const actualIrrelevantIds = idsForRoom(result.inventory.irrelevantFieldIds, roomId);
    const expectedSupersededIds = idsForRoom(plan.supersededFieldIds, roomId);
    const actualSupersededIds = idsForRoom(result.inventory.supersededFieldIds, roomId);

    assert.deepEqual(actualIds, expectedIds);
    assert.deepEqual(actualApplicableIds, expectedApplicableIds);
    assert.deepEqual(actualIrrelevantIds, expectedIrrelevantIds);
    assert.deepEqual(actualSupersededIds, expectedSupersededIds);
    assert.equal(expectedIds.length, 60);
    assert.equal(actualIds.length, 60);
    assert.equal(actualApplicableIds.length, 22);
    assert.equal(actualIrrelevantIds.length, 38);
    assert.equal(actualSupersededIds.length, 0);
  }

  assert.equal(plan.expectedFieldIds.size, 124);
  assert.equal(result.fields.length, 124);
  assert.equal(result.inventory.applicableFieldIds.length, 48);
  assert.equal(result.inventory.irrelevantFieldIds.length, 76);
  assert.equal(result.inventory.supersededFieldIds.length, 0);
});

test('applicable-but-missing is not IRRELEVANT', () => {
  const r = room({ envelope: { wallElements: [element('wall-1')], windowElements: [], doorElements: [], roofElements: [], floorElements: [] } });
  const rr = roomResult(r, { transmissionBreakdown: transmission([]) });
  const result = adapt(project([r]), [rr]);
  const u = field(result, 'U_wall');
  assert.equal(u?.effectiveProvenance, 'UNKNOWN');
  assert.equal(u?.effectiveValue, null);
  assert.equal(result.inventory.irrelevantFieldIds.includes(u?.fieldId ?? ''), false);
});

test('IRRELEVANT fields never substitute a missing applicable field', () => {
  const r = room({ envelope: { wallElements: [element('wall-1')], windowElements: [], doorElements: [], roofElements: [], floorElements: [] } });
  const result = adapt(project([r]), [roomResult(r, { transmissionBreakdown: transmission([]) })]);
  const wallU = field(result, 'U_wall');
  assert.ok(wallU);
  const irrelevant = result.fields.find((f) => result.inventory.irrelevantFieldIds.includes(f.fieldId));
  assert.ok(irrelevant);
  assert.notEqual(irrelevant?.fieldId, wallU?.fieldId);
  assert.ok(result.inventory.applicableFieldIds.includes(wallU?.fieldId ?? ''));
});

test('adapter does not mutate BuildingProject', () => {
  const r = room({ id: 'immutable-room' });
  const p = project([r], { totalAreaM2: 180 });
  const before = JSON.stringify(p);
  adapt(p, [roomResult(r)]);
  assert.equal(JSON.stringify(p), before);
});

