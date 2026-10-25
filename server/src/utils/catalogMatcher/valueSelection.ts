/**
 * Deterministic value selection. Never MAX() across operating points.
 */
import { convertUnit, numericEqual, textEqual } from './normalize.js';
import { COP_EQUALITY_EPSILON } from './policy.js';
import { findExactConditionSets } from './operatingPoint.js';
import type {
  CanonicalParameterCode,
  CatalogConditionSetFacts,
  CatalogValueFacts,
  ConditionRequirement,
  ReasonCode,
  ValueSelectionResult,
} from './types.js';

function usableKnown(value: CatalogValueFacts): boolean {
  return value.status === 'KNOWN';
}

function normalizedSignature(value: CatalogValueFacts, canonicalUnit: string | null): string {
  if (value.numeric != null) {
    let n = value.numeric;
    if (canonicalUnit && value.unit && value.unit !== canonicalUnit) {
      const converted = convertUnit(n, value.unit, canonicalUnit);
      if (converted != null) n = converted;
    }
    const epsilon = value.parameterCode === 'cop' || value.parameterCode === 'eer' || value.parameterCode === 'scop'
      ? COP_EQUALITY_EPSILON
      : 0;
    const rounded = epsilon > 0 ? Math.round(n / epsilon) * epsilon : n;
    return `n:${rounded}`;
  }
  if (value.text != null) return `t:${value.text.trim()}`;
  if (value.boolean != null) return `b:${value.boolean ? '1' : '0'}`;
  return 'empty';
}

function collapse(parameterCode: CanonicalParameterCode, rows: CatalogValueFacts[]): ValueSelectionResult {
  const known = rows.filter(usableKnown);
  if (known.length === 0) {
    const unknown = rows.some((row) => row.status === 'UNKNOWN');
    return {
      status: 'NOT_FOUND',
      parameterCode,
      values: [],
      conditionSetCode: rows[0]?.conditionSetCode ?? null,
      reasonCode: unknown ? 'CAPACITY_VALUE_UNKNOWN' : 'CAPACITY_VALUE_MISSING',
    };
  }
  const unit = known[0].canonicalUnit ?? known[0].unit;
  const groups = new Map<string, CatalogValueFacts[]>();
  for (const row of known) {
    const key = normalizedSignature(row, unit);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  if (groups.size > 1) {
    return {
      status: 'CONFLICT',
      parameterCode,
      values: known,
      conditionSetCode: known[0].conditionSetCode,
      reasonCode: 'DATA_CONFLICT',
    };
  }
  const selected = [...groups.values()][0];
  return {
    status: selected.length > 1 ? 'MULTIPLE_EQUIVALENT' : 'FOUND_ONE',
    parameterCode,
    values: selected,
    conditionSetCode: selected[0].conditionSetCode,
    reasonCode: null,
  };
}

export function selectApplicableEngineeringValue(
  parameterCode: CanonicalParameterCode,
  requestedConditions: readonly ConditionRequirement[],
  values: readonly CatalogValueFacts[],
  conditionSets: readonly CatalogConditionSetFacts[],
): ValueSelectionResult {
  const ofParameter = values.filter((value) => value.parameterCode === parameterCode);

  if (requestedConditions.length === 0) {
    const productLevel = ofParameter.filter((value) => value.conditionSetCode == null);
    if (productLevel.length === 0) {
      return {
        status: 'NOT_FOUND',
        parameterCode,
        values: [],
        conditionSetCode: null,
        reasonCode: ofParameter.length > 0 ? 'CAPACITY_VALUE_MISSING_AT_REQUIRED_OPERATING_POINT' : 'CAPACITY_VALUE_MISSING',
      };
    }
    return collapse(parameterCode, productLevel);
  }

  const exactSets = findExactConditionSets(requestedConditions, conditionSets);
  const exactCodes = new Set(exactSets.map((set) => set.conditionSetCode));
  const atExact = ofParameter.filter(
    (value) => value.conditionSetCode != null && exactCodes.has(value.conditionSetCode),
  );

  if (atExact.length === 0) {
    const elsewhere = ofParameter.filter((value) => value.conditionSetCode != null);
    const reason: ReasonCode = elsewhere.length > 0
      ? 'CAPACITY_VALUE_MISSING_AT_REQUIRED_OPERATING_POINT'
      : (ofParameter.length > 0 ? 'CAPACITY_VALUE_MISSING_AT_REQUIRED_OPERATING_POINT' : 'CAPACITY_VALUE_MISSING');
    return {
      status: 'NOT_FOUND',
      parameterCode,
      values: [],
      conditionSetCode: null,
      reasonCode: reason,
    };
  }

  return collapse(parameterCode, atExact);
}

export function valuesAreNumericEqual(a: CatalogValueFacts, b: CatalogValueFacts): boolean {
  if (a.numeric == null || b.numeric == null) {
    if (a.text != null && b.text != null) return textEqual(a.text, b.text);
    if (a.boolean != null && b.boolean != null) return a.boolean === b.boolean;
    return false;
  }
  const unit = a.canonicalUnit ?? a.unit;
  let bn = b.numeric;
  if (unit && b.unit && b.unit !== unit) {
    const converted = convertUnit(bn, b.unit, unit);
    if (converted == null) return false;
    bn = converted;
  }
  const epsilon = a.parameterCode === 'cop' || a.parameterCode === 'eer' ? COP_EQUALITY_EPSILON : 0;
  return numericEqual(a.numeric, bn, epsilon);
}
