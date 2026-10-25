import assert from 'node:assert/strict';
import {
  DEFAULT_WARM_FLOOR_SETTINGS,
  calculateCableCandidate,
  calculateMatCandidate,
  calculateWarmFloorBase,
  nearestAllowedStep,
  normalizeWarmFloorInput,
  type WarmFloorCableCalculation,
  type WarmFloorMatCalculation,
} from './warmFloorCalculator.js';

const input = normalizeWarmFloorInput({
  roomPurpose: 'bathroom',
  heatingGoal: 'comfort_floor',
  totalAreaM2: 8,
  excludedZones: [
    { type: 'bath', label: 'Ванна', areaM2: 1.2 },
    { type: 'furniture_no_gap', label: 'Мебель без зазора', areaM2: 0.8 },
  ],
  heatedAreaM2: 6,
  substrateType: 'concrete_screed',
  floorCovering: 'tile',
  wetZone: true,
  targetPowerMode: 'preset',
  systemPreference: 'cable',
});

assert.equal(input.heatedAreaM2, 6);
assert.equal(input.excludedAreaM2, 2);

const base = calculateWarmFloorBase(input, DEFAULT_WARM_FLOOR_SETTINGS);
assert.equal(base.targetPowerWm2, 150);
assert.equal(base.requiredPowerW, 900);
assert.equal(base.heatedAreaM2, 6);
assert.ok(base.warnings.some((warning) => warning.code === 'NO_STATIONARY_FURNITURE'));
assert.ok(base.warnings.some((warning) => warning.code === 'ELECTRICIAN_REQUIRED'));

const cable = calculateCableCandidate({
  id: 1,
  slug: 'test-cable',
  sku: 'CAB-900',
  name: 'Test cable 900W 60m',
  brand: 'Test',
  price: 100,
  availabilityStatus: 'in_stock',
  availabilityLabel: 'В наличии',
  productType: 'heating_cable',
  powerW: 900,
  linearPowerWm: 15,
  cableLengthM: 60,
  voltageV: 230,
}, base, DEFAULT_WARM_FLOOR_SETTINGS);
const cableCalc = cable.calculation as WarmFloorCableCalculation;
assert.equal(cableCalc.requiredPowerW, 900);
assert.equal(cableCalc.lengthRequiredM, 60);
assert.equal(cableCalc.actualPowerWm2, 150);
assert.equal(cableCalc.spacingCm, 10);
assert.equal(cableCalc.nearestAllowedSpacingCm, 10);
assert.equal(cableCalc.mountingTapeM, 12);
assert.equal(cable.warnings.length, 0);

assert.equal(nearestAllowedStep(11.7, [7.5, 10, 12.5, 15]).step, 12.5);

const mat = calculateMatCandidate({
  id: 2,
  slug: 'test-mat',
  sku: 'MAT-900',
  name: 'Test mat 900W 6m2',
  brand: 'Test',
  price: 200,
  availabilityStatus: 'in_stock',
  availabilityLabel: 'В наличии',
  productType: 'heating_mat',
  powerW: 900,
  matAreaM2: 6,
  voltageV: 230,
}, base, DEFAULT_WARM_FLOOR_SETTINGS);
const matCalc = mat.calculation as WarmFloorMatCalculation;
assert.equal(matCalc.coveredAreaM2, 6);
assert.equal(matCalc.actualPowerWm2, 150);
assert.equal(matCalc.coveragePercent, 100);
assert.equal(mat.compatible, true);

const mainHeating = calculateWarmFloorBase(normalizeWarmFloorInput({
  roomPurpose: 'living_room',
  heatingGoal: 'main_heating',
  totalAreaM2: 20,
  heatedAreaM2: 16,
  substrateType: 'concrete_screed',
  floorCovering: 'tile',
  wetZone: false,
  targetPowerMode: 'preset',
}), DEFAULT_WARM_FLOOR_SETTINGS);
assert.ok(mainHeating.warnings.some((warning) => warning.code === 'HEAT_LOSS_REQUIRED'));

console.log('warmFloorCalculator tests passed');
