/**
 * Calculator inference audit for the full catalog export: what the calculators currently derive for each active
 * product, computed by the calculators' own functions (no copy of their rules). Read-only; runs on the export's
 * read-only connection inside its snapshot transaction, in product-id ranges.
 *
 * - power_calculator: parsePowerKw of /api/tools/power-calculator (routes/tools.ts)
 * - ai_selection:     parsePowerKw of the AI engineering selection (services/engineeringSelectionService.ts)
 * - warm_floor:       warmFloorProductFromRow of the warm-floor calculator (utils/warmFloorProducts.ts)
 */
import type Database from 'better-sqlite3';
import { parsePowerKw as powerCalculatorPowerKw } from '../routes/tools.js';
import { parsePowerKw as aiSelectionPowerKw } from './engineeringSelectionService.js';
import { WARM_FLOOR_PRODUCT_SQL, warmFloorProductFromRow } from '../utils/warmFloorProducts.js';

type Db = InstanceType<typeof Database>;
type Row = Record<string, any>;

/** Same columns and feature_text expression as the calculators' own product queries. */
const POWER_SQL = `
  SELECT p.id, p.name_ru, p.short_description_ru, p.description_ru, p.cooling_power_kw, p.heating_power_kw, s.name AS series_name,
    COALESCE((SELECT GROUP_CONCAT(feature_name || ' ' || feature_value || ' ' || COALESCE(feature_unit, ''), ' ') FROM product_features pf WHERE pf.product_id = p.id), '') AS feature_text
  FROM products p
  LEFT JOIN series s ON s.id = p.series_id
  WHERE p.is_active = 1`;

const INFERENCE_SLICE = 100;
const positive = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0;
const ranged = (sql: string) => `SELECT * FROM (${sql}) AS q WHERE q.id >= ? AND q.id < ?`;

export function powerInference(row: Row) {
  const values = {
    power_calculator: { heating_kw: powerCalculatorPowerKw(row, 'heating'), cooling_kw: powerCalculatorPowerKw(row, 'cooling') },
    ai_selection: { heating_kw: aiSelectionPowerKw(row, 'heating'), cooling_kw: aiSelectionPowerKw(row, 'cooling') },
  };
  const any = [values.power_calculator, values.ai_selection].some((item) => item.heating_kw !== null || item.cooling_kw !== null);
  if (!any) return null;
  return {
    ...values,
    source: {
      heating_kw: positive(row.heating_power_kw) ? 'explicit_column' : 'calculator_text_inference',
      cooling_kw: positive(row.cooling_power_kw) ? 'explicit_column' : 'calculator_text_inference',
    },
  };
}

export function warmFloorInference(row: Row) {
  const product = warmFloorProductFromRow(row as any) as Row;
  const productType = String(product.productType || '');
  if (!productType || productType === 'accessory') return null;
  const isThermostat = productType === 'thermostat';
  return {
    product_type: productType,
    excluded: productType.startsWith('excluded'),
    power_w: product.powerW ?? null,
    linear_power_wm: product.linearPowerWm ?? null,
    cable_length_m: product.cableLengthM ?? null,
    mat_area_m2: product.matAreaM2 ?? null,
    voltage_v: product.voltageV ?? null,
    max_resistive_load_a: product.maxResistiveLoadA ?? null,
    sensor_included: product.sensorIncluded ?? null,
    rated_current_a: product.ratedCurrentA ?? null,
    trip_current_ma: product.tripCurrentMa ?? null,
    wet_zone_allowed: product.wetZoneAllowed ?? null,
    approved_for_thin_layer: product.approvedForThinLayer ?? null,
    source: {
      product_type: product.metadataExplicit ? 'explicit_column' : 'calculator_text_inference',
      power_w: positive(row.heating_power_kw) ? 'explicit_column' : 'calculator_text_inference',
      linear_power_wm: positive(row.warm_floor_linear_power_wm) ? 'explicit_column' : 'calculator_text_inference',
      cable_length_m: positive(row.warm_floor_cable_length_m) ? 'explicit_column' : 'calculator_text_inference',
      mat_area_m2: positive(row.warm_floor_mat_area_m2) || positive(row.recommended_area_m2) ? 'explicit_column' : 'calculator_text_inference_or_power_div_150',
      voltage_v: positive(row.warm_floor_voltage_v) ? 'explicit_column' : 'calculator_text_inference_or_default_230',
      max_resistive_load_a: isThermostat ? 'calculator_text_inference_or_default_16' : 'calculator_text_inference',
    },
  };
}

/** Map product id -> { power_calculator, ai_selection, warm_floor } for active products the calculators classify. */
export async function loadCalculatorInference(db: Db, ranges: [number, number][], nextTick: () => Promise<void>) {
  const result = new Map<number, Row>();
  const power = db.prepare(ranged(POWER_SQL));
  const warmFloor = db.prepare(ranged(WARM_FLOOR_PRODUCT_SQL));
  // The calculators' queries run per-product subqueries: smaller slices keep each blocking step short.
  const slices = ranges.flatMap(([from, to]) => {
    const parts: [number, number][] = [];
    for (let start = from; start < to; start += INFERENCE_SLICE) parts.push([start, Math.min(start + INFERENCE_SLICE, to)]);
    return parts;
  });
  for (const [from, to] of slices) {
    for (const row of power.all(from, to) as Row[]) {
      const value = powerInference(row);
      if (value) result.set(Number(row.id), { ...(result.get(Number(row.id)) || {}), ...value });
    }
    await nextTick();
    for (const row of warmFloor.all(from, to) as Row[]) {
      const value = warmFloorInference(row);
      if (value) result.set(Number(row.id), { ...(result.get(Number(row.id)) || {}), warm_floor: value });
    }
    await nextTick();
  }
  return result;
}
