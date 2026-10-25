/**
 * Pure operating-point matcher. COMPATIBLE is never returned in V1
 * because the equivalence table is empty.
 */
import { convertUnit, numericEqual, textEqual, unitsCompatible } from './normalize.js';
import { COP_EQUALITY_EPSILON } from './policy.js';
import type {
  CanonicalConditionKey,
  CatalogConditionSetFacts,
  ConditionMatchState,
  ConditionRequirement,
  OperatingPointMatchResult,
} from './types.js';

function entryMatchesRequest(
  request: ConditionRequirement,
  set: CatalogConditionSetFacts,
): ConditionMatchState {
  const matches = set.entries.filter((entry) => entry.conditionKey === request.conditionKey);
  if (matches.length === 0) return 'MISSING';
  if (matches.length > 1) return 'CONFLICT';
  const entry = matches[0];

  if (request.valueNumeric != null) {
    if (entry.numeric == null) return 'MISSING';
    let actual = entry.numeric;
    const reqUnit = request.unit;
    const actUnit = entry.unit;
    if (reqUnit && actUnit && reqUnit !== actUnit) {
      if (!unitsCompatible(actUnit, reqUnit)) return 'MISSING';
      const converted = convertUnit(actual, actUnit, reqUnit);
      if (converted == null) return 'MISSING';
      actual = converted;
    }
    const epsilon = request.conditionKey === 'load_percent' ? 0 : 0;
    void epsilon;
    void COP_EQUALITY_EPSILON;
    return numericEqual(actual, request.valueNumeric, 0) ? 'EXACT' : 'MISSING';
  }

  if (request.valueText != null) {
    if (entry.text == null) return 'MISSING';
    return textEqual(entry.text, request.valueText) ? 'EXACT' : 'MISSING';
  }

  if (request.valueBoolean != null) {
    if (entry.boolean == null) return 'MISSING';
    return entry.boolean === request.valueBoolean ? 'EXACT' : 'MISSING';
  }

  return 'MISSING';
}

export function matchOperatingPoint(
  requestedConditions: readonly ConditionRequirement[],
  candidateConditionSet: CatalogConditionSetFacts | null,
): OperatingPointMatchResult {
  const perKey: Partial<Record<CanonicalConditionKey, ConditionMatchState>> = {};

  if (requestedConditions.length === 0) {
    return { overall: 'NOT_APPLICABLE', perKey, matchedSetCode: candidateConditionSet?.conditionSetCode ?? null };
  }

  if (candidateConditionSet == null) {
    for (const req of requestedConditions) perKey[req.conditionKey] = 'MISSING';
    return { overall: 'MISSING', perKey, matchedSetCode: null };
  }

  let anyConflict = false;
  let anyMissing = false;
  for (const req of requestedConditions) {
    const state = entryMatchesRequest(req, candidateConditionSet);
    perKey[req.conditionKey] = state;
    if (state === 'CONFLICT') anyConflict = true;
    if (state === 'MISSING') anyMissing = true;
  }

  if (anyConflict) {
    return { overall: 'CONFLICT', perKey, matchedSetCode: candidateConditionSet.conditionSetCode };
  }
  if (anyMissing) {
    return { overall: 'MISSING', perKey, matchedSetCode: null };
  }
  return { overall: 'EXACT', perKey, matchedSetCode: candidateConditionSet.conditionSetCode };
}

export function findExactConditionSets(
  requestedConditions: readonly ConditionRequirement[],
  conditionSets: readonly CatalogConditionSetFacts[],
): CatalogConditionSetFacts[] {
  if (requestedConditions.length === 0) return [];
  return conditionSets.filter((set) => matchOperatingPoint(requestedConditions, set).overall === 'EXACT');
}
