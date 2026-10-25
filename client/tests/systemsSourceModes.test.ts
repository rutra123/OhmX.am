/**
 * Building Project Phase 2.8A — client source-isolation regressions (P0-1).
 *
 * Pure-helper tests for systemsSourceModes.ts. The client has no test harness,
 * so this file lives OUTSIDE client/src (client/tsconfig includes only "src"),
 * keeping `npm run build` (tsc -b && vite build) unaffected.
 *
 * Run (tsx is available in server/node_modules):
 *   cd server && npx tsx --test ../client/tests/systemsSourceModes.test.ts
 *
 * Scope: projectSourceOptions / setProjectSource / setApartmentSourceMode.
 * The server-side invariants for the same defects live in
 * server/src/utils/buildingProjectIntegrity.test.ts (P28A-* cases).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EXTERNAL_BUILDING_COOLING_SUPPLY_ID,
  EXTERNAL_BUILDING_HEATING_SUPPLY_ID,
  projectSourceOptions,
  setApartmentSourceMode,
  setProjectSource,
} from '../src/features/buildingProject/systemsSourceModes.js';
import type {
  BuildingSystemsCatalog,
  EngineeringSystemFamily,
  EngineeringSystemFamilySelection,
} from '../src/features/buildingProject/types.js';

const F = (id: string, service: EngineeringSystemFamily['service'], kind: EngineeringSystemFamily['kind'], scope: EngineeringSystemFamily['scope'], external = false): EngineeringSystemFamily => ({
  id,
  label: id,
  service,
  kind,
  scope,
  capabilityStatus: 'allowed',
  statusLabel: id,
  notes: [],
  external: external || undefined,
});

const SEL = (f: EngineeringSystemFamily): EngineeringSystemFamilySelection => ({ ...f, selectedAt: '2026-08-17T00:00:00.000Z' });

/** Catalog fixture mirroring the server SYSTEM_FAMILIES facts used by the wizard. */
const CATALOG_FAMILIES: EngineeringSystemFamily[] = [
  F(EXTERNAL_BUILDING_HEATING_SUPPLY_ID, 'heating', 'source', 'central', true),
  F(EXTERNAL_BUILDING_COOLING_SUPPLY_ID, 'cooling', 'source', 'central', true),
  F('reversible_air_to_water_heat_pump', 'heating_and_cooling', 'combined', 'central'),
  F('gas_condensing_boiler', 'heating', 'source', 'central'),
  F('chiller_fan_coils', 'cooling', 'source', 'central'),
  F('split_wall', 'cooling', 'combined', 'room_local'),
];

const CATALOG: BuildingSystemsCatalog = {
  serviceOptions: [],
  capabilityStates: [],
  systemFamilies: CATALOG_FAMILIES,
  groups: [],
};

test('P0-1: heating source options contain heating external supply, never the cooling one', () => {
  const heatingOptions = projectSourceOptions(CATALOG_FAMILIES, 'heating').map((f) => f.id);
  assert.ok(heatingOptions.includes(EXTERNAL_BUILDING_HEATING_SUPPLY_ID));
  assert.ok(!heatingOptions.includes(EXTERNAL_BUILDING_COOLING_SUPPLY_ID));
});

test('P0-1: cooling source options contain cooling external supply, never the heating one', () => {
  const coolingOptions = projectSourceOptions(CATALOG_FAMILIES, 'cooling').map((f) => f.id);
  assert.ok(coolingOptions.includes(EXTERNAL_BUILDING_COOLING_SUPPLY_ID));
  assert.ok(!coolingOptions.includes(EXTERNAL_BUILDING_HEATING_SUPPLY_ID));
});

test('P0-1: replacing ONLY the heating source preserves the working cooling external supply', () => {
  const start = [SEL(CATALOG_FAMILIES[0]), SEL(CATALOG_FAMILIES[1])]; // heating ext + cooling ext
  const next = setProjectSource(start, 'heating', 'gas_condensing_boiler', CATALOG);
  const ids = next.map((f) => f.id);
  assert.ok(ids.includes('gas_condensing_boiler'));
  assert.ok(ids.includes(EXTERNAL_BUILDING_COOLING_SUPPLY_ID), 'cooling external must survive a heating-source change');
  assert.ok(!ids.includes(EXTERNAL_BUILDING_HEATING_SUPPLY_ID), 'old heating external is replaced');
});

test('P0-1: replacing ONLY the cooling source preserves the working heating external supply', () => {
  const start = [SEL(CATALOG_FAMILIES[0]), SEL(CATALOG_FAMILIES[1])]; // heating ext + cooling ext
  const next = setProjectSource(start, 'cooling', 'chiller_fan_coils', CATALOG);
  const ids = next.map((f) => f.id);
  assert.ok(ids.includes('chiller_fan_coils'));
  assert.ok(ids.includes(EXTERNAL_BUILDING_HEATING_SUPPLY_ID), 'heating external must survive a cooling-source change');
  assert.ok(!ids.includes(EXTERNAL_BUILDING_COOLING_SUPPLY_ID), 'old cooling external is replaced');
});

test('P0-1: a single combined reversible source serves both services without duplication', () => {
  const reversible = CATALOG_FAMILIES.find((f) => f.id === 'reversible_air_to_water_heat_pump')!;
  // Select reversible as the heating source, then re-select it as the cooling source.
  const afterHeating = setProjectSource([], 'heating', 'reversible_air_to_water_heat_pump', CATALOG);
  const afterBoth = setProjectSource(afterHeating, 'cooling', 'reversible_air_to_water_heat_pump', CATALOG);
  assert.equal(afterBoth.filter((f) => f.id === reversible.id).length, 1, 'combined source must not be duplicated across services');
  // Apartment-side equivalent: mode 'own' for both services keeps ONE reversible entry.
  const apt = setApartmentSourceMode([], 'heating', 'own', ['heating', 'cooling'], CATALOG);
  const aptBoth = setApartmentSourceMode(apt, 'cooling', 'own', ['heating', 'cooling'], CATALOG);
  assert.equal(aptBoth.filter((f) => f.id === reversible.id).length, 1, 'apartment own-mode must not duplicate the combined source');
});

test('P0-1: switching one service OFF a combined source leaves no duplicate central sources', () => {
  const reversible = CATALOG_FAMILIES.find((f) => f.id === 'reversible_air_to_water_heat_pump')!;
  const start = [SEL(reversible)];
  const next = setProjectSource(start, 'cooling', 'chiller_fan_coils', CATALOG);
  const centralIds = next.map((f) => f.id);
  assert.equal(new Set(centralIds).size, centralIds.length, 'no duplicate central sources after a service-level replace');
  assert.equal(centralIds.filter((id) => id === 'chiller_fan_coils').length, 1);
});
