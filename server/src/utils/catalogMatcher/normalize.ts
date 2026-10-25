/**
 * Deterministic unit conversion. Not interpolation.
 * No string parsing of values like "7 °C".
 */
import { UNIT_CONVERSIONS } from './policy.js';

export function convertUnit(value: number, fromUnit: string | null, toUnit: string | null): number | null {
  if (fromUnit == null || toUnit == null) return null;
  if (fromUnit === toUnit) return value;
  const rule = UNIT_CONVERSIONS.find((row) => row.from === fromUnit && row.to === toUnit);
  if (!rule) return null;
  return value * rule.factor;
}

export function unitsCompatible(fromUnit: string | null, toUnit: string | null): boolean {
  if (fromUnit == null || toUnit == null) return fromUnit === toUnit;
  if (fromUnit === toUnit) return true;
  return UNIT_CONVERSIONS.some((row) => row.from === fromUnit && row.to === toUnit);
}

export function numericEqual(a: number, b: number, epsilon = 0): boolean {
  if (epsilon <= 0) return a === b;
  const d = a - b;
  return d <= epsilon && d >= -epsilon;
}

export function textEqual(a: string, b: string): boolean {
  return a.trim() === b.trim();
}
