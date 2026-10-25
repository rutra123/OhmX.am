/**
 * Phase 3.2P-B3 — live steady_state Professional quality composition tests.
 *
 * Written for the B3 composition boundary. Per the phase instructions these
 * tests are intentionally not executed in this handoff.
 */
import * as assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { dataRoot } from '../paths.js';
import {
  calculateLoads,
  deleteProject,
  loadProject,
} from './buildingProjectService.js';
import { computeBuildingLoads } from './buildingProjectLoads.js';
import { projectPhysicalCompleteness } from './buildingProjectPhysicalCompleteness.js';
import {
  AdapterInventoryValidationError,
} from './buildingProjectQualityAdapter.js';
import {
  composeBuildingProjectEngineeringQuality,
} from './buildingProjectQualityComposition.js';
import type {
  BuildingLoadCalculation,
  BuildingProject,
  EngineeringQualityResult,
} from './buildingProjectTypes.js';

const REVISION_21_ID = '5a040566-38d7-49db-bb0d-cf2d68a70a53';
const EVALUATED_AT = '2026-09-02T00:00:00.000Z';
const STORE = path.join(dataRoot, 'building-projects');
const temporaryProjectIds: string[] = [];

function revision21Project(): BuildingProject {
  const project = loadProject(REVISION_21_ID);
  assert.ok(project, 'revision-21 fixture must be present');
  assert.equal(project.buildingRevision, 21);
  assert.equal(project.totalAreaM2, 180);
  assert.equal(project.rooms[0]?.areaM2, 50);
  return structuredClone(project);
}

function composeRevision21FromNumericBase(
  project: BuildingProject,
  numericResult: BuildingLoadCalculation,
): BuildingLoadCalculation {
  const physicalCompleteness = projectPhysicalCompleteness(project).length === 0;
  assert.equal(physicalCompleteness, true);
  return composeBuildingProjectEngineeringQuality({
    project,
    calculation: numericResult,
    physicalCompleteness,
    evaluatedAt: EVALUATED_AT,
  });
}

function composeRevision21(): BuildingLoadCalculation {
  const project = revision21Project();
  return composeRevision21FromNumericBase(
    project,
    computeBuildingLoads(project, 'steady_state'),
  );
}

function qualityOf(calculation: BuildingLoadCalculation): EngineeringQualityResult {
  const quality = calculation.engineeringQuality;
  assert.ok(quality, 'B3 quality must be attached');
  return quality;
}

function temporaryRevision21Project(): string {
  const source = revision21Project();
  const id = `b3-test-${randomUUID()}`;
  source.id = id;
  if (source.systemsConfiguration) source.systemsConfiguration.projectId = id;
  if (source.systemsConfigurationSnapshot) source.systemsConfigurationSnapshot.projectId = id;
  fs.mkdirSync(STORE, { recursive: true });
  fs.writeFileSync(path.join(STORE, `${id}.json`), JSON.stringify(source, null, 2));
  temporaryProjectIds.push(id);
  return id;
}

after(() => {
  for (const id of temporaryProjectIds) {
    try { deleteProject(id); } catch { /* best-effort test cleanup */ }
  }
});

test('B3-01: live steady_state service calculation includes engineeringQuality', () => {
  const id = temporaryRevision21Project();
  const calculated = calculateLoads(id, 'steady_state');
  assert.ok(calculated.loads?.engineeringQuality);
  assert.equal(calculated.loads?.mode, 'steady_state');
  assert.equal(calculated.loads?.heatingDemandW, 4866.280000000001);
  assert.equal(calculated.loads?.coolingDemandW, 2624.3599999999997);
});

test('B3-02: current steady_state Professional requests Level 2', () => {
  assert.equal(qualityOf(composeRevision21()).requestedLevel, 2);
});

test('B3-03: revision-21 maximum eligibility remains Level 1', () => {
  assert.equal(qualityOf(composeRevision21()).maximumEligibleLevel, 1);
});

test('B3-04: revision-21 requested Level 2 is BLOCKED', () => {
  assert.equal(qualityOf(composeRevision21()).gateStatus, 'BLOCKED');
});

test('B3-05: BLOCKED quality still returns a numeric heating total', () => {
  const calculation = composeRevision21();
  assert.equal(qualityOf(calculation).gateStatus, 'BLOCKED');
  assert.equal(calculation.heatingDemandW, 4866.280000000001);
});

test('B3-06: BLOCKED quality still returns a numeric cooling total', () => {
  const calculation = composeRevision21();
  assert.equal(qualityOf(calculation).gateStatus, 'BLOCKED');
  assert.equal(calculation.coolingDemandW, 2624.3599999999997);
});

test('B3-07: revision-21 heating total is unchanged', () => {
  assert.equal(composeRevision21().heatingDemandW, 4866.280000000001);
});

test('B3-08: revision-21 cooling total is unchanged', () => {
  assert.equal(composeRevision21().coolingDemandW, 2624.3599999999997);
});

test('B3-09: revision-21 transmission components are unchanged', () => {
  const breakdown = composeRevision21().roomResults[0]?.transmissionBreakdown;
  assert.equal(breakdown?.heatingW, 3470.92);
  assert.equal(breakdown?.coolingW, 822.06);
});

test('B3-10: revision-21 air components are unchanged', () => {
  const project = revision21Project();
  const numericBase = computeBuildingLoads(project, 'steady_state');
  const baselineHeatingW = numericBase.roomResults[0]?.airBreakdown?.heatingW;
  const baselineCoolingW = numericBase.roomResults[0]?.airBreakdown?.coolingW;
  assert.equal(typeof baselineHeatingW, 'number');
  assert.equal(typeof baselineCoolingW, 'number');
  const composed = composeRevision21FromNumericBase(project, numericBase);
  assert.equal(composed.roomResults[0]?.airBreakdown?.heatingW, baselineHeatingW);
  assert.equal(composed.roomResults[0]?.airBreakdown?.coolingW, baselineCoolingW);
});

test('B3-11: revision-21 solar component is unchanged', () => {
  const project = revision21Project();
  const numericBase = computeBuildingLoads(project, 'steady_state');
  const baselineCoolingW = numericBase.roomResults[0]?.solarBreakdown?.totalCoolingW;
  assert.equal(typeof baselineCoolingW, 'number');
  const composed = composeRevision21FromNumericBase(project, numericBase);
  assert.equal(composed.roomResults[0]?.solarBreakdown?.totalCoolingW, baselineCoolingW);
});

test('B3-12: revision-21 internal component is unchanged', () => {
  assert.equal(composeRevision21().roomResults[0]?.internalGainsBreakdown?.totalCoolingW, 875);
});

test('B3-13: adapter fields use the calculation input snapshot', () => {
  const calculation = composeRevision21();
  const quality = qualityOf(calculation);
  const area = quality.fields.find((field) => field.parameter === 'areaM2' && field.service === 'heating');
  assert.ok(area);
  assert.equal(area.roomId, calculation.inputSnapshot.rooms[0]?.id);
  assert.equal(area.effectiveValue, calculation.inputSnapshot.rooms[0]?.areaM2);
});

test('B3-14: declared 180 m² and modeled 50 m² stay coverage metadata', () => {
  const calculation = composeRevision21();
  assert.equal(calculation.inputSnapshot.rooms[0]?.areaM2, 50);
  assert.equal(qualityOf(calculation).coverage.declaredAreaM2, 180);
  assert.equal(qualityOf(calculation).coverage.modeledAreaM2, 50);
  assert.equal(calculation.heatingDemandW, 4866.280000000001);
  assert.equal(calculation.coolingDemandW, 2624.3599999999997);
});

test('B3-15: revision-21 coverage remains UNKNOWN and UNCONFIRMED', () => {
  const coverage = qualityOf(composeRevision21()).coverage;
  assert.equal(coverage.scope, 'UNKNOWN');
  assert.equal(coverage.confirmation, 'UNCONFIRMED');
});

test('B3-16: quality result includes the frozen qualityModelId', () => {
  assert.equal(qualityOf(composeRevision21()).qualityModelId, 'ohmx.professional-quality.v1');
});

test('B3-17: quality result includes the frozen qualityModelVersion', () => {
  assert.equal(qualityOf(composeRevision21()).qualityModelVersion, '1.0.0');
});

test('B3-18: legacy calculation without engineeringQuality remains readable', () => {
  const readHistorical = () => loadProject(REVISION_21_ID);
  assert.doesNotThrow(readHistorical);
  const historical = readHistorical();
  assert.ok(historical);
  const loads = historical.loads;
  assert.ok(loads);
  assert.equal(loads.engineeringQuality, undefined);
  assert.notEqual(loads.engineeringQuality?.maximumEligibleLevel, 1);
  assert.equal(loads.mode, 'steady_state');
  assert.equal(loads.methodId, 'ohmx.steady-state.v1');
  assert.equal(loads.methodVersion, '1.0.0');
  assert.equal(loads.heatingDemandW, 4866.280000000001);
  assert.equal(loads.coolingDemandW, 2624.3599999999997);
});

test('B3-19: historical missing quality is not silently Level 1', () => {
  const historical = loadProject(REVISION_21_ID);
  assert.ok(historical?.loads);
  assert.equal(historical?.loads?.engineeringQuality, undefined);
  assert.notEqual(historical?.loads?.engineeringQuality?.maximumEligibleLevel, 1);
});

test('B3-20: persisted load snapshot keeps engineeringQuality', () => {
  const id = temporaryRevision21Project();
  calculateLoads(id, 'steady_state');
  const reloaded = loadProject(id);
  assert.ok(reloaded?.loads?.engineeringQuality);
  assert.equal(reloaded?.loads?.engineeringQuality?.qualityModelId, 'ohmx.professional-quality.v1');
  assert.equal(reloaded?.loads?.engineeringQuality?.requestedLevel, 2);
});

test('B3-21: snapshot quality is not mutated by later source-project edits', () => {
  const project = revision21Project();
  const calculation = composeBuildingProjectEngineeringQuality({
    project,
    calculation: computeBuildingLoads(project, 'steady_state'),
    physicalCompleteness: true,
    evaluatedAt: EVALUATED_AT,
  });
  const before = JSON.stringify(qualityOf(calculation));
  project.totalAreaM2 = 999;
  project.rooms[0]!.areaM2 = 999;
  project.rooms[0]!.envelope!.wallElements[0]!.areaM2 = 999;
  assert.equal(JSON.stringify(qualityOf(calculation)), before);
});

test('B3-22: a BLOCKED quality result does not throw', () => {
  assert.doesNotThrow(() => composeRevision21());
});

test('B3-23: quality composition does not switch the calculation method', () => {
  const calculation = composeRevision21();
  assert.equal(calculation.mode, 'steady_state');
  assert.equal(calculation.methodId, 'ohmx.steady-state.v1');
  assert.equal(calculation.methodVersion, '1.0.0');
});

test('B3-24: QUICK/non-steady_state behavior remains unchanged', () => {
  const project = revision21Project();
  const quick = computeBuildingLoads(project, 'quick');
  assert.equal(quick.mode, 'quick');
  assert.equal(quick.methodId, 'ohmx.quick-load.v1');
  assert.equal(quick.engineeringQuality, undefined);
});

test('B3-25: adapter inventory errors fail closed without false quality', () => {
  const project = revision21Project();
  const numeric = computeBuildingLoads(project, 'steady_state');
  const broken = { ...numeric, roomResults: [] };
  assert.throws(
    () => composeBuildingProjectEngineeringQuality({
      project,
      calculation: broken,
      physicalCompleteness: true,
      evaluatedAt: EVALUATED_AT,
    }),
    (error: unknown) => error instanceof AdapterInventoryValidationError
      && error.code === 'missing_room_result',
  );
  assert.equal((broken as BuildingLoadCalculation).engineeringQuality, undefined);
});

test('B3-26: identical inputs produce deterministic engineeringQuality', () => {
  const project = revision21Project();
  const a = composeBuildingProjectEngineeringQuality({
    project,
    calculation: computeBuildingLoads(project, 'steady_state'),
    physicalCompleteness: true,
    evaluatedAt: EVALUATED_AT,
  });
  const b = composeBuildingProjectEngineeringQuality({
    project,
    calculation: computeBuildingLoads(project, 'steady_state'),
    physicalCompleteness: true,
    evaluatedAt: EVALUATED_AT,
  });
  assert.deepEqual(a.engineeringQuality, b.engineeringQuality);
});

test('B3-27: quality composition has no circular serialization/reference', () => {
  const calculation = composeRevision21();
  assert.doesNotThrow(() => JSON.stringify(calculation));
  assert.notEqual(calculation.engineeringQuality, calculation.inputSnapshot);
});

test('B3-28: physical incompleteness produces zero eligibility without changing numeric base', () => {
  const project = revision21Project();
  const numeric = computeBuildingLoads(project, 'steady_state');
  const calculation = composeBuildingProjectEngineeringQuality({
    project,
    calculation: numeric,
    physicalCompleteness: false,
    evaluatedAt: EVALUATED_AT,
  });
  assert.equal(calculation.engineeringQuality?.maximumEligibleLevel, 0);
  assert.equal(calculation.engineeringQuality?.gateStatus, 'BLOCKED');
  assert.equal(calculation.heatingDemandW, numeric.heatingDemandW);
  assert.equal(calculation.coolingDemandW, numeric.coolingDemandW);
});
