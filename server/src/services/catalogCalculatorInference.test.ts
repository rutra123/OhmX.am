// Imports calculator modules, which load db.js (it migrates the DB at DB_PATH). Always point both variables at
// throwaway copies of one snapshot:
// DB_PATH=<copy-a.db> OHMX_INFERENCE_TEST_DB=<copy-b.db> npx tsx --test src/services/catalogCalculatorInference.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';

const readonlyCopy = process.env.OHMX_INFERENCE_TEST_DB;
const skip = readonlyCopy && process.env.DB_PATH ? false : 'set DB_PATH and OHMX_INFERENCE_TEST_DB to copies of one snapshot';

test('audit reproduces exactly what the warm-floor calculator derives, on the read-only connection', { skip }, async () => {
  const { loadCalculatorInference } = await import('./catalogCalculatorInference.js');
  const { warmFloorProductRows } = await import('../utils/warmFloorProducts.js');
  const db = new Database(readonlyCopy!, { readonly: true, fileMustExist: true });
  const { lo, hi } = db.prepare('SELECT MIN(id) AS lo, MAX(id) AS hi FROM products').get() as any;
  const ranges: [number, number][] = [];
  for (let from = lo; from <= hi; from += 400) ranges.push([from, Math.min(from + 400, hi + 1)]);
  const audit = await loadCalculatorInference(db, ranges, () => new Promise((resolve) => setImmediate(resolve)));
  db.close();

  const calculator = warmFloorProductRows() as any[];
  let compared = 0;
  for (const product of calculator) {
    const entry = audit.get(product.id)?.warm_floor;
    if (product.productType === 'accessory') { assert.equal(entry, undefined); continue; }
    assert.ok(entry, `warm floor audit for ${product.id}`);
    assert.equal(entry.product_type, product.productType);
    assert.equal(entry.power_w, product.powerW ?? null);
    assert.equal(entry.linear_power_wm, product.linearPowerWm ?? null);
    assert.equal(entry.cable_length_m, product.cableLengthM ?? null);
    assert.equal(entry.mat_area_m2, product.matAreaM2 ?? null);
    assert.equal(entry.voltage_v, product.voltageV ?? null);
    assert.equal(entry.max_resistive_load_a, product.maxResistiveLoadA ?? null);
    compared += 1;
  }
  assert.ok(compared > 0);
  const excluded = [...audit.values()].filter((entry) => entry.warm_floor?.excluded).length;
  const power = [...audit.values()].filter((entry) => entry.power_calculator).length;
  console.log(`warm floor entries compared ${compared}, excluded types kept ${excluded}, products with power inference ${power}`);
});
