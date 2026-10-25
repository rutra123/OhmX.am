/**
 * Warm-floor project calculator tests (engineering + multi-room + confirm + estimate).
 * Run: npx tsx --test src/utils/warmFloorProject.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { dataRoot } from '../paths.js';
import { calculateRoomEngineering, bindInstalledPower } from './warmFloorRoomEngineering.js';
import { selectRoomEquipment, applySelectionToEngineering } from './warmFloorRoomSelection.js';
import { buildRoomSpecification, consolidateBom } from './warmFloorSpecification.js';
import { buildEstimate } from './warmFloorEstimate.js';
import {
  createProject,
  addRoom,
  updateRoom,
  removeRoom,
  recalculateProject,
  confirmProject,
  loadProject,
  deleteProject,
} from './warmFloorProjectService.js';
import type { RoomInput } from './warmFloorProjectTypes.js';
import { matchWarmFloorProductsV3 } from './warmFloorMatcherV3.js';
import { resolveDesignTargets, normalizeWarmFloorInputV3 } from './warmFloorEngineV3.js';

const STORE = path.join(dataRoot, 'warm-floor-projects');

function cleanStore() {
  if (!fs.existsSync(STORE)) return;
  for (const f of fs.readdirSync(STORE)) {
    if (f.endsWith('.json')) fs.unlinkSync(path.join(STORE, f));
  }
}

function room(partial: Partial<RoomInput> & { name: string; roomType: string }): RoomInput {
  return {
    id: partial.id || `r-${Math.random().toString(16).slice(2, 8)}`,
    name: partial.name,
    roomType: partial.roomType,
    roomAreaM2: partial.roomAreaM2 ?? 8,
    installationAreaM2: partial.installationAreaM2 ?? 6,
    heatingPurpose: partial.heatingPurpose || 'comfort_floor',
    floorCovering: partial.floorCovering || 'tile',
    substrateType: partial.substrateType || 'concrete_screed',
    insulationLevel: partial.insulationLevel || 'standard',
    systemPreference: partial.systemPreference || 'auto',
    wetZone: partial.wetZone,
    heatLossW: partial.heatLossW ?? null,
    regionProfile: 'AM',
  };
}

const fixtureProducts = [
  {
    id: 101, sku: 'MAT-P-900', article: 'MAT-P-900', name: 'DEVI mat 900W 6m2', brand: 'DEVI',
    price: 100000, currency: 'AMD', availabilityStatus: 'in_stock', productType: 'heating_mat',
    powerW: 900, matAreaM2: 6, voltageV: 230, wetZoneAllowed: true, approvedForThinLayer: true,
    floorCoverings: ['tile', 'porcelain'], substrateTypes: ['concrete_screed', 'tile_adhesive'],
    calculatorPriority: 10,
  },
  {
    id: 111, sku: 'MAT-P-1200', article: 'MAT-P-1200', name: 'DEVI mat 1200W 8m2', brand: 'DEVI',
    price: 130000, currency: 'AMD', availabilityStatus: 'in_stock', productType: 'heating_mat',
    powerW: 1200, matAreaM2: 8, voltageV: 230, wetZoneAllowed: true, approvedForThinLayer: true,
    floorCoverings: ['tile', 'porcelain'], substrateTypes: ['concrete_screed', 'tile_adhesive'],
    calculatorPriority: 10,
  },
  {
    id: 112, sku: 'MAT-S-1200', article: 'MAT-S-1200', name: 'Fenix mat 1200W 8m2', brand: 'Fenix',
    price: 90000, currency: 'AMD', availabilityStatus: 'in_stock', productType: 'heating_mat',
    powerW: 1200, matAreaM2: 8, voltageV: 230, wetZoneAllowed: true, approvedForThinLayer: true,
    floorCoverings: ['tile'], substrateTypes: ['concrete_screed', 'tile_adhesive'],
  },
  {
    id: 113, sku: 'MAT-E-1200', article: 'MAT-E-1200', name: 'HIF mat 1200W 8m2', brand: 'HIF',
    price: 60000, currency: 'AMD', availabilityStatus: 'in_stock', productType: 'heating_mat',
    powerW: 1200, matAreaM2: 8, voltageV: 230, wetZoneAllowed: true, approvedForThinLayer: true,
    floorCoverings: ['tile'], substrateTypes: ['concrete_screed'],
  },
  {
    id: 102, sku: 'MAT-S-900', article: 'MAT-S-900', name: 'Fenix mat 900W 6m2', brand: 'Fenix',
    price: 70000, currency: 'AMD', availabilityStatus: 'in_stock', productType: 'heating_mat',
    powerW: 900, matAreaM2: 6, voltageV: 230, wetZoneAllowed: true, approvedForThinLayer: true,
    floorCoverings: ['tile'], substrateTypes: ['concrete_screed', 'tile_adhesive'],
  },
  {
    id: 103, sku: 'MAT-E-900', article: 'MAT-E-900', name: 'HIF mat 900W 6m2', brand: 'HIF',
    price: 50000, currency: 'AMD', availabilityStatus: 'in_stock', productType: 'heating_mat',
    powerW: 900, matAreaM2: 6, voltageV: 230, wetZoneAllowed: true, approvedForThinLayer: true,
    floorCoverings: ['tile'], substrateTypes: ['concrete_screed'],
  },
  {
    id: 201, sku: 'CAB-P-1400', article: 'CAB-P-1400', name: 'DEVIflex 18T 1400W 78m', brand: 'DEVI',
    price: 120000, currency: 'AMD', availabilityStatus: 'in_stock', productType: 'heating_cable',
    powerW: 1400, cableLengthM: 78, linearPowerWm: 18, voltageV: 230, wetZoneAllowed: true,
    floorCoverings: ['tile', 'laminate'], substrateTypes: ['concrete_screed'],
  },
  {
    id: 202, sku: 'CAB-P-1800', article: 'CAB-P-1800', name: 'DEVIflex 18T 1800W 100m', brand: 'DEVI',
    price: 150000, currency: 'AMD', availabilityStatus: 'in_stock', productType: 'heating_cable',
    powerW: 1800, cableLengthM: 100, linearPowerWm: 18, voltageV: 230, wetZoneAllowed: true,
    floorCoverings: ['tile', 'laminate'], substrateTypes: ['concrete_screed'],
  },
  {
    id: 301, sku: 'MAT-SMALL', article: 'MAT-SMALL', name: 'DEVI mat 300W 2m2', brand: 'DEVI',
    price: 30000, currency: 'AMD', availabilityStatus: 'in_stock', productType: 'heating_mat',
    powerW: 300, matAreaM2: 2, voltageV: 230, wetZoneAllowed: true, approvedForThinLayer: true,
    floorCoverings: ['tile'], substrateTypes: ['concrete_screed', 'tile_adhesive'],
  },
  {
    id: 401, sku: 'TH-1', article: 'TH-1', name: 'DEVIreg Touch', brand: 'DEVI',
    price: 45000, currency: 'AMD', availabilityStatus: 'in_stock', productType: 'thermostat',
    accessoryGroup: 'thermostat', maxResistiveLoadA: 16, sensorIncluded: true,
  },
  {
    id: 402, sku: 'BOX-1', article: 'BOX-1', name: 'Batibox 1 post 40 mm', brand: 'Legrand',
    price: 2000, currency: 'AMD', availabilityStatus: 'in_stock', productType: 'mounting_box',
    accessoryGroup: 'mounting_box',
  },
  {
    id: 403, sku: 'CB-16', article: 'CB-16', name: 'Автоматический выключатель TX³ 16A', brand: 'Legrand',
    price: 5000, currency: 'AMD', availabilityStatus: 'in_stock', productType: 'circuit_breaker',
    accessoryGroup: 'circuit_breaker', ratedCurrentA: 16,
  },
  {
    id: 404, sku: 'RCD-25', article: 'RCD-25', name: 'УЗО TX³ 25A 30mA', brand: 'Legrand',
    price: 12000, currency: 'AMD', availabilityStatus: 'in_stock', productType: 'rcd',
    accessoryGroup: 'rcd', ratedCurrentA: 25, tripCurrentMa: 30,
  },
  {
    id: 405, sku: 'TUBE-1', article: 'TUBE-1', name: 'Гофра 16mm', brand: 'DKC',
    price: 500, currency: 'AMD', availabilityStatus: 'in_stock', productType: 'corrugated_tube',
    accessoryGroup: 'corrugated_tube',
  },
  {
    id: 406, sku: 'TAPE-25', article: 'TAPE-25', name: 'Монтажная лента 25 метров', brand: 'DEVI',
    price: 8000, currency: 'AMD', availabilityStatus: 'in_stock', productType: 'mounting_tape',
    accessoryGroup: 'mounting_tape',
  },
];

test('engineering: small bathroom comfort power fields', () => {
  const eng = calculateRoomEngineering(room({
    name: 'Bath', roomType: 'bathroom', roomAreaM2: 7, installationAreaM2: 5,
    heatingPurpose: 'comfort_floor', floorCovering: 'tile', wetZone: true,
  }));
  assert.equal(eng.power.heatedAreaM2, 5);
  assert.ok(eng.power.requiredPowerW > 0);
  assert.equal(eng.power.designPowerW, eng.power.requiredPowerW);
  assert.equal(eng.power.installedPowerW, null);
  assert.ok(eng.power.targetWm2 >= 130 && eng.power.targetWm2 <= 160);
  // 5 * ~150 = ~750
  assert.ok(eng.power.requiredPowerW >= 650 && eng.power.requiredPowerW <= 850);
  assert.ok(['PASS', 'WARNING'].includes(eng.status));
});

test('engineering: large living comfort', () => {
  const eng = calculateRoomEngineering(room({
    name: 'Living', roomType: 'living_room', roomAreaM2: 30, installationAreaM2: 24,
    heatingPurpose: 'comfort_floor',
  }));
  assert.equal(eng.power.heatedAreaM2, 24);
  assert.ok(eng.power.requiredPowerW >= 24 * 100);
});

test('engineering: main heating without heat loss is WARNING', () => {
  const eng = calculateRoomEngineering(room({
    name: 'Bedroom', roomType: 'bedroom', roomAreaM2: 16, installationAreaM2: 12,
    heatingPurpose: 'main_heating',
  }));
  assert.equal(eng.power.mainHeatingMode, 'area_fallback_needs_heat_loss');
  assert.ok(eng.issues.some((i) => i.code === 'engineering.mainHeatingNeedsHeatLoss'));
  assert.equal(eng.status, 'WARNING');
});

test('engineering: main heating with heat loss uses margin path', () => {
  const eng = calculateRoomEngineering(room({
    name: 'Bedroom', roomType: 'bedroom', roomAreaM2: 16, installationAreaM2: 12,
    heatingPurpose: 'main_heating', heatLossW: 2000,
  }));
  assert.equal(eng.power.mainHeatingMode, 'heat_loss');
  assert.ok(eng.power.requiredPowerW >= 2000 * 1.15);
});

test('engineering: heat loss exceeding covering limit is BLOCKED', () => {
  const eng = calculateRoomEngineering(room({
    name: 'Room', roomType: 'living_room', roomAreaM2: 10, installationAreaM2: 8,
    heatingPurpose: 'main_heating', floorCovering: 'laminate', heatLossW: 5000,
  }));
  // 5000*1.25/8 = 781 W/m2 >> laminate max
  assert.equal(eng.status, 'BLOCKED');
  assert.ok(eng.issues.some((i) => i.code === 'engineering.heatLossExceedsCoveringLimit'));
});

test('engineering: heated area exceeds room is BLOCKED', () => {
  const eng = calculateRoomEngineering(room({
    name: 'Bad', roomType: 'kitchen', roomAreaM2: 5, installationAreaM2: 9,
  }));
  assert.equal(eng.status, 'BLOCKED');
  assert.equal(eng.validation.valid, false);
});

test('engineering: laminate covering limit applied vs tile', () => {
  const tile = calculateRoomEngineering(room({
    name: 'T', roomType: 'living_room', roomAreaM2: 12, installationAreaM2: 10,
    floorCovering: 'tile', insulationLevel: 'poor',
  }));
  const lam = calculateRoomEngineering(room({
    name: 'L', roomType: 'living_room', roomAreaM2: 12, installationAreaM2: 10,
    floorCovering: 'laminate', insulationLevel: 'poor',
  }));
  assert.ok(lam.power.coveringMaxWm2 <= 150);
  assert.ok(tile.power.targetWm2 >= lam.power.targetWm2 || tile.power.coveringMaxWm2 >= lam.power.coveringMaxWm2);
});

test('engineering: bind installed power computes reserve/deficit', () => {
  const eng = calculateRoomEngineering(room({
    name: 'Bath', roomType: 'bathroom', roomAreaM2: 7, installationAreaM2: 6,
  }));
  const bound = bindInstalledPower(eng, eng.power.requiredPowerW + 50);
  assert.equal(bound.power.installedPowerW, eng.power.requiredPowerW + 50);
  assert.ok((bound.power.powerReserveW || 0) >= 50);
  assert.ok(bound.power.currentA != null && bound.power.currentA > 0);
});

test('selection: fixture bathroom gets premium mat + accessories', () => {
  const r = room({
    name: 'Bath', roomType: 'bathroom', roomAreaM2: 8, installationAreaM2: 6,
    heatingPurpose: 'comfort_floor', floorCovering: 'tile', substrateType: 'tile_adhesive', wetZone: true,
  });
  const eng = calculateRoomEngineering(r);
  const sel = selectRoomEquipment(r, eng, { products: fixtureProducts, preferredBundleRole: 'premium' });
  assert.ok(sel.selectedVariant, 'expected selected variant');
  assert.equal(sel.selectedVariant.brandTier, 'premium');
  assert.ok(sel.accessories.some((a) => a.accessoryGroup === 'thermostat' || a.productType === 'thermostat'));
  assert.ok(
    sel.accessories.some((a) => a.accessoryGroup === 'rcbo' || a.productType === 'rcbo')
    || (
      sel.accessories.some((a) => a.productType === 'circuit_breaker')
      && sel.accessories.some((a) => a.productType === 'rcd')
    ),
  );
});

test('selection: no compatible product returns BLOCKED with reasons', () => {
  const r = room({
    name: 'Wood', roomType: 'bedroom', roomAreaM2: 12, installationAreaM2: 10,
    substrateType: 'wood', floorCovering: 'engineered_wood',
  });
  const eng = calculateRoomEngineering(r);
  const sel = selectRoomEquipment(r, eng, { products: fixtureProducts });
  // wood blocks standard wet; fixtures have no special dry
  assert.equal(sel.status, 'BLOCKED');
  assert.equal(sel.selectedVariant, null);
  assert.ok(sel.selectionReasons.some((x) => x.severity === 'block'));
});

test('selection: multi-unit packing when only small mats exist', () => {
  const smallOnly = fixtureProducts.filter((p) => !['heating_mat', 'heating_cable'].includes(p.productType) || p.id === 301);
  const r = room({
    name: 'Large', roomType: 'bathroom', roomAreaM2: 10, installationAreaM2: 6,
    floorCovering: 'tile', substrateType: 'tile_adhesive', wetZone: true,
  });
  const eng = calculateRoomEngineering(r);
  // required ~900W, single 300W mat fails power; 3x300 may pass coverage/power
  const sel = selectRoomEquipment(r, eng, { products: smallOnly, allowMultiUnit: true });
  if (sel.selectedVariant) {
    assert.ok((sel.multiUnit?.unitCount || 1) >= 2);
    assert.ok(sel.selectionReasons.some((x) => x.code === 'selection.multiUnitRequired'));
  } else {
    // If still blocked, must explain — not silently pick wrong product
    assert.equal(sel.status, 'BLOCKED');
    assert.ok(sel.selectionReasons.length > 0);
  }
});

test('spec + bom: same thermostat across rooms consolidates quantity', () => {
  const rooms = [
    room({ id: 'a', name: 'Bath', roomType: 'bathroom', roomAreaM2: 8, installationAreaM2: 6, wetZone: true, substrateType: 'tile_adhesive' }),
    room({ id: 'b', name: 'Kitchen', roomType: 'kitchen', roomAreaM2: 10, installationAreaM2: 7, substrateType: 'tile_adhesive' }),
    room({ id: 'c', name: 'Bed', roomType: 'bedroom', roomAreaM2: 14, installationAreaM2: 10, substrateType: 'concrete_screed', systemPreference: 'cable' }),
  ];
  const lines = rooms.flatMap((r) => {
    const eng = calculateRoomEngineering(r);
    const sel = selectRoomEquipment(r, eng, { products: fixtureProducts });
    return buildRoomSpecification(r, sel);
  });
  assert.ok(lines.length >= 3);
  const bom = consolidateBom(lines);
  const th = bom.find((b) => b.sku === 'TH-1' || /devireg/i.test(b.name));
  assert.ok(th, 'thermostat in BOM');
  assert.ok(th!.quantity >= 2);
  assert.ok(th!.roomDistribution.length >= 2);
  // room lines still separate
  const roomTh = lines.filter((l) => l.sku === 'TH-1' || /devireg/i.test(l.name));
  assert.equal(roomTh.reduce((s, l) => s + l.quantity, 0), th!.quantity);
});

test('estimate: missing price does not invent values', () => {
  const bom = consolidateBom([
    {
      lineId: '1', roomId: 'a', roomName: 'A', productId: 1, sku: 'X', article: 'X', name: 'Priced', brand: 'B',
      role: 'heating_element', requiredQuantity: 2, quantity: 2, purchaseQuantity: 2, surplus: 0,
      packageSize: 1, packageCount: 2, packingSource: 'unit_is_package', quantityScope: 'per_heating_kit',
      unit: 'pcs', engineeringReasonCodes: [], unitPrice: 1000, currency: 'AMD', lineTotal: 2000, priceStatus: 'ok',
    },
    {
      lineId: '2', roomId: 'a', roomName: 'A', productId: null, sku: 'Y', article: 'Y', name: 'Manual', brand: '',
      role: 'required_sensor_path', requiredQuantity: 1, quantity: 1, purchaseQuantity: 1, surplus: 0,
      packageSize: 1, packageCount: 1, packingSource: 'none', quantityScope: 'per_control_zone',
      unit: 'pcs', engineeringReasonCodes: [], isManualLineItem: true,
      unitPrice: null, currency: 'AMD', lineTotal: null, priceStatus: 'manual_no_price',
    },
  ]);
  const est = buildEstimate(bom);
  assert.equal(est.equipmentSubtotal, 2000);
  assert.equal(est.missingPriceCount, 1);
  assert.equal(est.incompleteCommercial, true);
  assert.ok(est.lines.some((l) => l.priceMissing && l.lineTotal == null));
  assert.ok(!est.lines.some((l) => l.priceMissing && l.lineTotal === 0));
});

test('bom roomDistribution invariant holds for multi-room project', () => {
  cleanStore();
  const p = createProject({ name: 'BOM inv' });
  addRoom(p.id, {
    name: 'Bath', roomType: 'bathroom', roomAreaM2: 8, installationAreaM2: 6,
    floorCovering: 'tile', substrateType: 'tile_adhesive', wetZone: true, heatingPurpose: 'comfort_floor',
  });
  addRoom(p.id, {
    name: 'Kitchen', roomType: 'kitchen', roomAreaM2: 12, installationAreaM2: 8,
    floorCovering: 'tile', substrateType: 'concrete_screed', heatingPurpose: 'comfort_floor',
  });
  const project = recalculateProject(p.id, { products: fixtureProducts });
  const { assertBomRoomDistributionInvariant } = requireInvariant();
  const check = assertBomRoomDistributionInvariant(project.draftResult!.consolidatedBom);
  assert.equal(check.ok, true, JSON.stringify(check.violations));
  deleteProject(p.id);
});

function requireInvariant() {
  return { assertBomRoomDistributionInvariant: (bom: any) => {
    // lazy import via already compiled module path is awkward in tsx; inline
    const violations: any[] = [];
    for (const line of bom) {
      const distSum = (line.roomDistribution || []).reduce((s: number, d: any) => s + Number(d.quantity || 0), 0);
      const qty = Number(line.purchaseQuantity ?? line.quantity ?? 0);
      if (Math.abs(distSum - qty) > 1e-9) violations.push({ key: line.key, bomQty: qty, distSum });
    }
    return { ok: violations.length === 0, violations };
  } };
}

test('multi-unit accessories sized from combined load, not N× thermostat', () => {
  const smallOnly = fixtureProducts.filter((p) => !['heating_mat', 'heating_cable'].includes(p.productType) || p.id === 301);
  const r = room({
    name: 'Large', roomType: 'bathroom', roomAreaM2: 10, installationAreaM2: 6,
    floorCovering: 'tile', substrateType: 'tile_adhesive', wetZone: true,
  });
  const eng = calculateRoomEngineering(r);
  const sel = selectRoomEquipment(r, eng, { products: smallOnly, allowMultiUnit: true });
  if (!sel.selectedVariant) {
    assert.equal(sel.status, 'BLOCKED');
    return;
  }
  assert.ok((sel.multiUnit?.unitCount || 1) >= 2);
  const th = sel.accessories.filter((a) => a.productType === 'thermostat' || a.accessoryGroup === 'thermostat');
  assert.equal(th.length, 1, 'one thermostat per control zone, not per heating kit');
  assert.equal(Number(th[0].quantity || 1), 1);
  assert.ok(sel.accessories.some((a) => a.productType === 'circuit_breaker' || a.productType === 'rcbo' || a.accessoryGroup === 'rcbo'));
  assert.ok(sel.circuitSummary);
  assert.equal(sel.circuitSummary!.heatingKits, sel.multiUnit!.unitCount);
  assert.ok(sel.circuitSummary!.actualCurrentA > 0);
  // packing on main line
  const spec = buildRoomSpecification(r, sel);
  const main = spec.find((l) => l.role === 'heating_element')!;
  assert.equal(main.purchaseQuantity, sel.multiUnit!.unitCount);
  assert.equal(main.quantityScope, 'per_heating_kit');
  assert.ok(main.packingSource);
});

test('calculationMode quick_estimate vs heat_loss labeling', () => {
  const q = calculateRoomEngineering(room({
    name: 'A', roomType: 'bathroom', roomAreaM2: 7, installationAreaM2: 5, heatingPurpose: 'comfort_floor',
  }));
  assert.equal(q.power.calculationMode, 'quick_estimate');
  const h = calculateRoomEngineering(room({
    name: 'B', roomType: 'bedroom', roomAreaM2: 16, installationAreaM2: 12,
    heatingPurpose: 'main_heating', heatLossW: 1500,
  }));
  assert.equal(h.power.calculationMode, 'heat_loss');
});

test('confirmed snapshot immutable against later catalog-independent draft mutation attempt', () => {
  cleanStore();
  const p = createProject({ name: 'Snap' });
  addRoom(p.id, {
    name: 'Bath', roomType: 'bathroom', roomAreaM2: 8, installationAreaM2: 6,
    floorCovering: 'tile', substrateType: 'tile_adhesive', wetZone: true, heatingPurpose: 'comfort_floor',
  });
  recalculateProject(p.id, { products: fixtureProducts });
  const confirmed = confirmProject(p.id);
  const snapLen = confirmed.confirmedSnapshot!.specificationByRoom.length;
  const snapTotal = confirmed.confirmedSnapshot!.estimate.projectTotal;
  assert.throws(() => updateRoom(p.id, confirmed.rooms[0].id, { name: 'X' }));
  const reloaded = loadProject(p.id)!;
  assert.equal(reloaded.confirmedSnapshot!.specificationByRoom.length, snapLen);
  assert.equal(reloaded.confirmedSnapshot!.estimate.projectTotal, snapTotal);
  deleteProject(p.id);
});

test('project lifecycle: draft mutate, recalculate, confirm immutable', () => {
  cleanStore();
  const p = createProject({ name: 'Test apartment', preferredBundleRole: 'premium' });
  addRoom(p.id, {
    name: 'Ванная', roomType: 'bathroom', roomAreaM2: 8, installationAreaM2: 6,
    heatingPurpose: 'comfort_floor', floorCovering: 'tile', substrateType: 'tile_adhesive', wetZone: true,
  });
  addRoom(p.id, {
    name: 'Кухня', roomType: 'kitchen', roomAreaM2: 12, installationAreaM2: 8,
    heatingPurpose: 'comfort_floor', floorCovering: 'tile', substrateType: 'concrete_screed',
  });
  let project = recalculateProject(p.id, { products: fixtureProducts });
  assert.equal(project.status, 'draft');
  assert.ok(project.draftResult);
  assert.equal(project.draftResult!.rooms.length, 2);
  assert.ok(project.draftResult!.specificationByRoom.length > 0);
  assert.ok(project.draftResult!.consolidatedBom.length > 0);

  const roomId = project.rooms[0].id;
  updateRoom(p.id, roomId, { name: 'Ванная (обновлено)', notes: 'user reviewed' });
  project = recalculateProject(p.id, { products: fixtureProducts, roomId });
  assert.equal(project.rooms.find((r) => r.id === roomId)!.name, 'Ванная (обновлено)');
  assert.ok(project.draftResult);
  assert.notEqual(project.draftResult!.overallStatus, 'BLOCKED');

  // confirm
  project = confirmProject(p.id);
  assert.equal(project.status, 'confirmed');
  assert.ok(project.confirmedSnapshot);
  assert.equal(project.confirmedSnapshot!.rooms.length, 2);
  assert.ok(project.confirmedSnapshot!.estimate);

  assert.throws(() => addRoom(p.id, { name: 'X', roomType: 'other', roomAreaM2: 3, installationAreaM2: 2, heatingPurpose: 'comfort_floor', floorCovering: 'tile', substrateType: 'concrete_screed' }), /confirmed/i);
  assert.throws(() => recalculateProject(p.id), /confirmed/i);

  // snapshot stable after load
  const reloaded = loadProject(p.id)!;
  assert.equal(reloaded.confirmedSnapshot!.specificationByRoom.length, project.confirmedSnapshot!.specificationByRoom.length);
  deleteProject(p.id);
});

test('project: remove room and single-room path', () => {
  cleanStore();
  const p = createProject({ name: 'One room' });
  addRoom(p.id, {
    name: 'Bath', roomType: 'bathroom', roomAreaM2: 6, installationAreaM2: 4.5,
    floorCovering: 'tile', substrateType: 'tile_adhesive', wetZone: true, heatingPurpose: 'comfort_floor',
  });
  const extra = addRoom(p.id, {
    name: 'Tmp', roomType: 'other', roomAreaM2: 4, installationAreaM2: 3,
    floorCovering: 'tile', substrateType: 'concrete_screed', heatingPurpose: 'comfort_floor',
  });
  const rid = extra.rooms.find((r) => r.name === 'Tmp')!.id;
  removeRoom(p.id, rid);
  const project = recalculateProject(p.id, { products: fixtureProducts });
  assert.equal(project.rooms.length, 1);
  assert.equal(project.draftResult!.rooms.length, 1);
  deleteProject(p.id);
});

test('project: blocked project cannot confirm', () => {
  cleanStore();
  const p = createProject({ name: 'Blocked' });
  addRoom(p.id, {
    name: 'Bad', roomType: 'bedroom', roomAreaM2: 10, installationAreaM2: 20,
    heatingPurpose: 'comfort_floor', floorCovering: 'tile', substrateType: 'concrete_screed',
  });
  recalculateProject(p.id, { products: fixtureProducts });
  assert.throws(() => confirmProject(p.id), /BLOCKED|blocked/i);
  deleteProject(p.id);
});

test('regression: legacy matcher still returns premium-first for bathroom fixture path', () => {
  const result = matchWarmFloorProductsV3({
    roomType: 'bathroom',
    roomAreaM2: 8,
    installationAreaM2: 6,
    substrateType: 'tile_adhesive',
    floorCovering: 'tile',
    heatingPurpose: 'comfort_floor',
    wetZone: true,
  }, { products: fixtureProducts });
  assert.equal(result.status, 'ok');
  assert.ok(result.variants.length >= 1);
  assert.equal(result.variants[0].isPrimary, true);
  assert.ok(result.selectionMeta);
  assert.equal(result.selectionMeta.phaseB.order[0], 'premium');
});

test('engineering formulas unchanged vs resolveDesignTargets', () => {
  const input = normalizeWarmFloorInputV3({
    roomType: 'bathroom', totalAreaM2: 7, heatedAreaM2: 5,
    floorCovering: 'tile', substrateType: 'concrete_screed',
    heatingGoal: 'comfort_floor', insulationLevel: 'standard',
  });
  const design = resolveDesignTargets(input);
  const eng = calculateRoomEngineering(room({
    name: 'Bath', roomType: 'bathroom', roomAreaM2: 7, installationAreaM2: 5,
    floorCovering: 'tile', substrateType: 'concrete_screed', heatingPurpose: 'comfort_floor',
  }));
  assert.equal(eng.power.requiredPowerW, design.requiredTotalPowerW);
  assert.equal(eng.power.targetWm2, design.targetInstalledPowerWm2);
});

test('duplicate room types are independent instances with unique ids', () => {
  cleanStore();
  const p = createProject({ name: 'dup-types', objectType: 'private_house', objectTotalAreaM2: 180 });
  assert.equal(p.objectType, 'private_house');
  assert.equal(p.objectTotalAreaM2, 180);
  addRoom(p.id, room({ name: 'Спальня 1', roomType: 'bedroom', roomAreaM2: 14, installationAreaM2: 12 }));
  addRoom(p.id, room({ name: 'Спальня 2', roomType: 'bedroom', roomAreaM2: 12, installationAreaM2: 10 }));
  addRoom(p.id, room({ name: 'Спальня 3', roomType: 'bedroom', roomAreaM2: 16, installationAreaM2: 14 }));
  addRoom(p.id, room({ name: 'Ванная 1', roomType: 'bathroom', roomAreaM2: 6, installationAreaM2: 5, wetZone: true }));
  addRoom(p.id, room({ name: 'Ванная 2', roomType: 'bathroom', roomAreaM2: 5, installationAreaM2: 4, wetZone: true }));
  const loaded = loadProject(p.id)!;
  assert.equal(loaded.rooms.length, 5);
  const ids = new Set(loaded.rooms.map((r) => r.id));
  assert.equal(ids.size, 5);
  const bedrooms = loaded.rooms.filter((r) => r.roomType === 'bedroom');
  assert.equal(bedrooms.length, 3);
  assert.notEqual(bedrooms[0].roomAreaM2, bedrooms[1].roomAreaM2);
  // editing one room does not change another
  const b2 = bedrooms[1].id;
  updateRoom(p.id, b2, { roomAreaM2: 11, installationAreaM2: 9, name: 'Детская Армана' });
  const after = loadProject(p.id)!;
  const still = after.rooms.find((r) => r.name === 'Спальня 1');
  assert.ok(still);
  assert.equal(still!.roomAreaM2, 14);
  const renamed = after.rooms.find((r) => r.id === b2);
  assert.equal(renamed!.name, 'Детская Армана');
  assert.equal(renamed!.roomType, 'bedroom');
  deleteProject(p.id);
});

test('own-house object area does not block multi-room project', () => {
  cleanStore();
  const p = createProject({ name: 'house', objectType: 'private_house', objectTotalAreaM2: 200 });
  addRoom(p.id, room({ name: 'Кухня', roomType: 'kitchen', roomAreaM2: 12, installationAreaM2: 8 }));
  addRoom(p.id, room({ name: 'Гостиная', roomType: 'living_room', roomAreaM2: 28, installationAreaM2: 22 }));
  // Partial room sum << house total — still recalculate/confirm OK
  const next = recalculateProject(p.id, { products: fixtureProducts });
  assert.ok(next.draftResult);
  assert.notEqual(next.draftResult!.overallStatus, 'BLOCKED');
  assert.equal(next.objectTotalAreaM2, 200);
  const sumRooms = next.rooms.reduce((s, r) => s + r.roomAreaM2, 0);
  assert.ok(sumRooms < 200);
  const confirmed = confirmProject(p.id);
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.confirmedSnapshot?.objectTotalAreaM2, 200);
  deleteProject(p.id);
});

test('backend project persistence survives reload (navigation simulation)', () => {
  cleanStore();
  const p = createProject({ name: 'persist-nav', objectType: 'apartment' });
  addRoom(p.id, room({ name: 'Спальня 1', roomType: 'bedroom', roomAreaM2: 12, installationAreaM2: 10 }));
  addRoom(p.id, room({ name: 'Спальня 2', roomType: 'bedroom', roomAreaM2: 11, installationAreaM2: 9 }));
  recalculateProject(p.id, { products: fixtureProducts });
  confirmProject(p.id);
  // Simulate SPA unmount + remount: only id known
  const reloaded = loadProject(p.id)!;
  assert.equal(reloaded.status, 'confirmed');
  assert.equal(reloaded.rooms.length, 2);
  assert.ok(reloaded.confirmedSnapshot);
  assert.equal(reloaded.confirmedSnapshot!.rooms.length, 2);
  assert.ok(reloaded.confirmedSnapshot!.specificationByRoom.length >= 2);
  // Spec lines retain roomId/roomName linkage
  for (const line of reloaded.confirmedSnapshot!.specificationByRoom) {
    assert.ok(line.roomId);
    assert.ok(line.roomName);
  }
  // room-grouped uniqueness
  const roomNames = new Set(reloaded.confirmedSnapshot!.specificationByRoom.map((l) => l.roomName));
  assert.ok(roomNames.has('Спальня 1'));
  assert.ok(roomNames.has('Спальня 2'));
  deleteProject(p.id);
});

test('room specification grouping + BOM distribution for multi bedroom house', () => {
  cleanStore();
  const p = createProject({ name: 'house-spec', objectType: 'private_house', objectTotalAreaM2: 160 });
  const rooms = [
    room({ name: 'Спальня 1', roomType: 'bedroom', roomAreaM2: 14, installationAreaM2: 11 }),
    room({ name: 'Спальня 2', roomType: 'bedroom', roomAreaM2: 13, installationAreaM2: 10 }),
    room({ name: 'Спальня 3', roomType: 'bedroom', roomAreaM2: 12, installationAreaM2: 9 }),
    room({ name: 'Ванная 1', roomType: 'bathroom', roomAreaM2: 6, installationAreaM2: 5, wetZone: true, substrateType: 'tile_adhesive' }),
    room({ name: 'Ванная 2', roomType: 'bathroom', roomAreaM2: 5, installationAreaM2: 4, wetZone: true, substrateType: 'tile_adhesive' }),
    room({ name: 'Кухня', roomType: 'kitchen', roomAreaM2: 14, installationAreaM2: 10 }),
    room({ name: 'Гостиная', roomType: 'living_room', roomAreaM2: 30, installationAreaM2: 24 }),
  ];
  for (const r of rooms) addRoom(p.id, r);
  const computed = recalculateProject(p.id, { products: fixtureProducts });
  assert.equal(computed.rooms.length, 7);
  assert.ok(computed.draftResult);
  const spec = computed.draftResult!.specificationByRoom;
  const byRoom = new Map<string, number>();
  for (const line of spec) {
    byRoom.set(line.roomName, (byRoom.get(line.roomName) || 0) + 1);
  }
  assert.ok(byRoom.get('Спальня 1')! >= 1);
  assert.ok(byRoom.get('Гостиная')! >= 1);
  for (const bomLine of computed.draftResult!.consolidatedBom) {
    const sum = (bomLine.roomDistribution || []).reduce((s, d) => s + Number(d.quantity || 0), 0);
    assert.equal(sum, bomLine.purchaseQuantity, `BOM invariant failed for ${bomLine.sku || bomLine.name}`);
  }
  const est = computed.draftResult!.estimatePreview;
  for (const line of est.lines) {
    if (line.priceMissing) {
      assert.equal(line.lineTotal, null);
      assert.notEqual(line.unitPrice, 0);
    }
    assert.ok(Array.isArray(line.roomDistribution));
  }
  deleteProject(p.id);
});
