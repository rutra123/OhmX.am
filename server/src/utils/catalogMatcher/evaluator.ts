/**
 * Pure deterministic Catalog Matcher evaluator.
 * No DB, network, time, or random. Does not parse product titles.
 */
import { convertUnit, numericEqual, unitsCompatible } from './normalize.js';
import { matchOperatingPoint } from './operatingPoint.js';
import {
  CATALOG_MATCHER_POLICY,
  COMMERCE_WARNING_CODES,
  ENGINEERING_WARNING_CODES,
  PARAMETER_REQUIREMENT_LEVELS,
  PROFESSIONAL_ACCEPTED_TIERS,
  type CatalogMatcherPolicy,
  getServiceApplicability,
  isServiceSupported,
} from './policy.js';
import { buildRankTuple, rankKeyFromTuple } from './ranking.js';
import { primaryReasonOf, reasonDetail, sortReasonCodes, sortReasonDetails } from './reasons.js';
import { selectApplicableEngineeringValue } from './valueSelection.js';
import type {
  CanonicalParameterCode,
  CatalogCandidateFacts,
  CatalogMatchRequest,
  CatalogValueFacts,
  CandidateEvaluation,
  CompatibilityEvaluation,
  ConditionMatchState,
  DecisionState,
  DisplayValue,
  EngineeringEligibilityState,
  MatchedValue,
  ReasonCode,
  ReasonDetail,
  RequirementEvaluation,
  RequirementGap,
  Warning,
} from './types.js';

const DECISION_RANK: Record<DecisionState, number> = {
  CONFLICT: 0,
  EXCLUDED: 1,
  INSUFFICIENT_DATA: 2,
  MATCH_WITH_WARNINGS: 3,
  MATCH: 4,
};

function worsen(current: DecisionState | null, next: DecisionState): DecisionState {
  if (current == null) return next;
  return DECISION_RANK[next] < DECISION_RANK[current] ? next : current;
}

function displayOf(value: CatalogValueFacts): DisplayValue {
  const out: DisplayValue = { unit: value.unit };
  if (value.numeric != null) out.valueNumeric = value.numeric;
  if (value.text != null) out.valueText = value.text;
  if (value.boolean != null) out.valueBoolean = value.boolean;
  return out;
}

function toMatchedValue(value: CatalogValueFacts, request: CatalogMatchRequest): MatchedValue {
  const set = value.conditionSetCode
    ? undefined
    : undefined;
  void set;
  return {
    parameterCode: value.parameterCode,
    value: displayOf(value),
    conditionSetCode: value.conditionSetCode,
    operatingPoint: request.operatingConditions,
    valueStatus: value.status,
    sourceType: value.sourceType,
    verificationTier: value.verificationTier,
  };
}

function conditionEntriesAsRequirements(facts: CatalogCandidateFacts, code: string | null) {
  const set = facts.conditionSets.find((row) => row.conditionSetCode === code);
  if (!set) return [];
  return set.entries.map((entry) => ({
    conditionKey: entry.conditionKey,
    valueNumeric: entry.numeric,
    valueText: entry.text,
    valueBoolean: entry.boolean,
    unit: entry.unit,
    matchPolicy: 'EXACT' as const,
  }));
}

function hasNominalSize(facts: CatalogCandidateFacts): boolean {
  return facts.values.some((row) => row.parameterCode === 'nominal_size' && row.status === 'KNOWN');
}

function otherOperatingPointsExist(
  facts: CatalogCandidateFacts,
  parameterCode: CanonicalParameterCode,
  selectedCode: string | null,
): boolean {
  return facts.values.some(
    (row) =>
      row.parameterCode === parameterCode &&
      row.conditionSetCode != null &&
      row.conditionSetCode !== selectedCode,
  );
}

function countPreferredMatches(request: CatalogMatchRequest, facts: CatalogCandidateFacts): number {
  let count = 0;
  for (const pref of request.preferredParameters) {
    const found = facts.values.find(
      (row) => row.parameterCode === pref.parameterCode && row.status === 'KNOWN',
    );
    if (!found) continue;
    if (pref.preferredValue == null) {
      count += 1;
      continue;
    }
    if (
      pref.preferredValue.valueNumeric != null &&
      found.numeric != null &&
      numericEqual(found.numeric, pref.preferredValue.valueNumeric)
    ) {
      count += 1;
    } else if (
      pref.preferredValue.valueText != null &&
      found.text != null &&
      found.text.trim() === pref.preferredValue.valueText.trim()
    ) {
      count += 1;
    }
  }
  return count;
}

function eligibilityOf(decision: DecisionState): EngineeringEligibilityState {
  if (decision === 'MATCH') return 'ELIGIBLE';
  if (decision === 'MATCH_WITH_WARNINGS') return 'ELIGIBLE_WITH_WARNINGS';
  return decision;
}

export function effectiveRequiredCapacity(request: CatalogMatchRequest): number | null {
  if (!request.requiredCapacity) return null;
  return request.requiredCapacity.requiredValue * (1 + request.designMarginPercent / 100);
}

export function evaluateCatalogCandidate(
  request: CatalogMatchRequest,
  facts: CatalogCandidateFacts,
  policy: CatalogMatcherPolicy = CATALOG_MATCHER_POLICY,
): CandidateEvaluation {
  void policy;
  const reasonDetails: ReasonDetail[] = [];
  const warnings: Warning[] = [];
  const missingRequirements: RequirementGap[] = [];
  const requiredValues: RequirementEvaluation[] = [];
  const matchedValues: MatchedValue[] = [];
  const reasonCodes: ReasonCode[] = [];

  let decision: DecisionState | null = null;
  let selectedCapacity: CatalogValueFacts | null = null;
  let oversizeRatio: number | null = null;
  let operatingOverall: ConditionMatchState = request.operatingConditions.length ? 'MISSING' : 'NOT_APPLICABLE';
  let operatingPerKey: CandidateEvaluation['operatingPoint']['perKey'] = {};
  let actualConditions = request.operatingConditions;

  const addCode = (code: ReasonCode) => {
    if (!reasonCodes.includes(code)) reasonCodes.push(code);
  };
  const addDetail = (detail: ReasonDetail) => {
    reasonDetails.push(detail);
    addCode(detail.code);
  };
  const addWarning = (code: ReasonCode, message: string, parameter: CanonicalParameterCode | null = null) => {
    warnings.push({
      code,
      message,
      parameter,
      conditionContext: request.operatingConditions,
    });
    addCode(code);
  };

  if (request.allowInterpolation) {
    addWarning('INTERPOLATION_NOT_ALLOWED', 'Interpolation is not implemented in matcher v1');
  }
  if (request.allowExtrapolation) {
    addWarning('EXTRAPOLATION_NOT_ALLOWED', 'Extrapolation is not implemented in matcher v1');
  }
  if (request.selectionMode === 'PROFESSIONAL' && request.requireExactOperatingPoint === false) {
    addWarning('NO_EXACT_OPERATING_POINT', 'Professional v1 still requires EXACT operating points');
  }

  if (
    facts.product.equipmentType !== request.equipmentType ||
    facts.profile.equipmentType !== request.equipmentType
  ) {
    addDetail(reasonDetail('EQUIPMENT_TYPE_MISMATCH', `Equipment type ${facts.profile.equipmentType} does not match ${request.equipmentType}`));
    decision = worsen(decision, 'EXCLUDED');
  }

  if (!isServiceSupported(request.equipmentType, request.service)) {
    addDetail(reasonDetail('SERVICE_UNSUPPORTED', `Service ${request.service} is not supported for ${request.equipmentType}`));
    decision = worsen(decision, 'EXCLUDED');
  }

  if (facts.profile.identityStatus === 'IDENTITY_UNCERTAIN') {
    addDetail(reasonDetail('PROFILE_IDENTITY_UNCERTAIN', 'Product identity is uncertain'));
    decision = worsen(decision, 'INSUFFICIENT_DATA');
  } else if (request.selectionMode === 'PROFESSIONAL' && facts.profile.identityStatus !== 'IDENTIFIED') {
    addDetail(reasonDetail('IDENTITY_UNVERIFIED', 'Professional mode requires IDENTIFIED identity'));
    decision = worsen(decision, 'INSUFFICIENT_DATA');
  } else if (request.selectionMode === 'PRELIMINARY' && facts.profile.identityStatus === 'IDENTITY_PARTIAL') {
    addWarning('IDENTITY_UNVERIFIED', 'Identity is only partial');
  }

  if (facts.profile.dataCompleteness === 'BLOCKED') {
    addDetail(reasonDetail('PROFILE_INCOMPLETE', 'Profile data completeness is BLOCKED'));
    decision = worsen(decision, 'INSUFFICIENT_DATA');
  } else if (facts.profile.dataCompleteness === 'PARTIAL') {
    addWarning('PROFILE_INCOMPLETE', 'Profile data completeness is PARTIAL');
  }

  const applicability = getServiceApplicability(request.equipmentType, request.service);
  let capacityFound = false;

  if (request.requiredCapacity) {
    const parameterCode = request.requiredCapacity.parameterCode;
    const selection = selectApplicableEngineeringValue(
      parameterCode,
      request.operatingConditions,
      facts.values,
      facts.conditionSets,
    );

    if (selection.status === 'CONFLICT') {
      addDetail(reasonDetail('DATA_CONFLICT', 'Conflicting active values at the same operating point', { parameter: parameterCode }));
      decision = worsen(decision, 'CONFLICT');
    } else if (selection.status === 'NOT_FOUND') {
      const missingAtOp = request.operatingConditions.length > 0;
      const code: ReasonCode = missingAtOp
        ? 'CAPACITY_VALUE_MISSING_AT_REQUIRED_OPERATING_POINT'
        : (selection.reasonCode ?? 'CAPACITY_VALUE_MISSING');
      addDetail(reasonDetail(code, `No ${parameterCode} at the required operating point`, { parameter: parameterCode }));
      if (otherOperatingPointsExist(facts, parameterCode, null)) {
        addDetail(reasonDetail('OPERATING_POINT_MISMATCH', `${parameterCode} exists only at other operating points`, { parameter: parameterCode }));
      }
      if (hasNominalSize(facts) && (parameterCode === 'heating_capacity' || parameterCode === 'cooling_capacity')) {
        addDetail(reasonDetail('NOMINAL_SIZE_NOT_CAPACITY', 'nominal_size is not a capacity substitute', { parameter: 'nominal_size' }));
      }
      missingRequirements.push({
        parameterCode,
        requirementLevel: 'REQUIRED_FOR_SELECTION',
        reasonCode: code,
      });
      decision = worsen(decision, 'INSUFFICIENT_DATA');
    } else {
      selectedCapacity = selection.values[0];
      capacityFound = true;
      matchedValues.push(toMatchedValue(selectedCapacity, request));
      const selectedConditionSetCode = selectedCapacity.conditionSetCode;
      const set = facts.conditionSets.find((row) => row.conditionSetCode === selectedConditionSetCode) ?? null;
      const op = matchOperatingPoint(request.operatingConditions, set);
      operatingOverall = op.overall;
      operatingPerKey = op.perKey;
      actualConditions = conditionEntriesAsRequirements(facts, selectedCapacity.conditionSetCode);

      if (op.overall === 'MISSING') {
        addDetail(reasonDetail('OPERATING_POINT_MISSING', 'Required operating conditions are missing', { parameter: parameterCode }));
        decision = worsen(decision, 'INSUFFICIENT_DATA');
        capacityFound = false;
      } else if (op.overall === 'CONFLICT') {
        addDetail(reasonDetail('OPERATING_POINT_CONFLICT', 'Operating-point data conflict', { parameter: parameterCode }));
        decision = worsen(decision, 'CONFLICT');
        capacityFound = false;
      }

      const tier = selectedCapacity.verificationTier;
      const professionalOk = tier != null && PROFESSIONAL_ACCEPTED_TIERS.includes(tier);
      if (request.selectionMode === 'PROFESSIONAL' && !professionalOk) {
        addDetail(reasonDetail('INSUFFICIENT_SOURCE_VERIFICATION', 'Source tier is not Professional-eligible', { parameter: parameterCode }));
        decision = worsen(decision, 'INSUFFICIENT_DATA');
        capacityFound = false;
      } else if (request.selectionMode === 'PRELIMINARY' && (tier == null || tier === 'UNVERIFIED')) {
        addWarning('SOURCE_NOT_PROFESSIONALLY_VERIFIED', 'Source is not professionally verified', parameterCode);
      }

      if (capacityFound && selectedCapacity.numeric != null) {
        const requiredUnit = request.requiredCapacity.unit;
        let available = selectedCapacity.numeric;
        if (selectedCapacity.unit && selectedCapacity.unit !== requiredUnit) {
          if (!unitsCompatible(selectedCapacity.unit, requiredUnit)) {
            addDetail(reasonDetail('CAPACITY_UNIT_MISMATCH', `Cannot compare ${selectedCapacity.unit} to ${requiredUnit}`, { parameter: parameterCode }));
            decision = worsen(decision, 'INSUFFICIENT_DATA');
            capacityFound = false;
          } else {
            const converted = convertUnit(available, selectedCapacity.unit, requiredUnit);
            if (converted == null) {
              addDetail(reasonDetail('CAPACITY_UNIT_MISMATCH', 'Unit conversion failed', { parameter: parameterCode }));
              decision = worsen(decision, 'INSUFFICIENT_DATA');
              capacityFound = false;
            } else {
              available = converted;
            }
          }
        }

        if (capacityFound) {
          const effective = effectiveRequiredCapacity(request) ?? request.requiredCapacity.requiredValue;
          oversizeRatio = effective === 0 ? null : available / effective;
          const cmp = request.requiredCapacity.comparisonPolicy;
          let ok = false;
          if (cmp === 'AT_LEAST') ok = available >= effective;
          else if (cmp === 'AT_MOST') ok = available <= effective;
          else if (cmp === 'EQUAL') ok = numericEqual(available, effective);
          else if (cmp === 'WITHIN_RANGE') {
            const upper = request.requiredCapacity.upperValue;
            ok = upper != null && available >= effective && available <= upper;
          }
          if (!ok) {
            addDetail(reasonDetail(
              'CAPACITY_TOO_LOW',
              `Available ${available} ${requiredUnit} is below required ${effective} ${requiredUnit}`,
              {
                parameter: parameterCode,
                required: { valueNumeric: effective, unit: requiredUnit },
                actual: { valueNumeric: available, unit: requiredUnit },
                conditionContext: request.operatingConditions,
              },
            ));
            decision = worsen(decision, 'EXCLUDED');
          }
          requiredValues.push({
            parameterCode,
            requirementLevel: 'REQUIRED_FOR_SELECTION',
            status: ok ? 'SATISFIED' : 'OUT_OF_RANGE',
            matchedValueCount: selection.values.length,
          });
        }
      }
    }
  }

  if (applicability) {
    for (const code of applicability.requiredForSelectionOperatingPoint) {
      if (request.requiredCapacity && code === request.requiredCapacity.parameterCode) continue;
      const selection = selectApplicableEngineeringValue(
        code,
        request.operatingConditions,
        facts.values,
        facts.conditionSets,
      );
      if (selection.status === 'CONFLICT') {
        addDetail(reasonDetail('DATA_CONFLICT', `Conflicting values for ${code}`, { parameter: code }));
        decision = worsen(decision, 'CONFLICT');
      } else if (selection.status === 'NOT_FOUND') {
        addDetail(reasonDetail('REQUIRED_PARAMETER_MISSING', `Missing required selection parameter ${code}`, { parameter: code }));
        missingRequirements.push({ parameterCode: code, requirementLevel: 'REQUIRED_FOR_SELECTION', reasonCode: 'REQUIRED_PARAMETER_MISSING' });
        decision = worsen(decision, 'INSUFFICIENT_DATA');
        requiredValues.push({ parameterCode: code, requirementLevel: 'REQUIRED_FOR_SELECTION', status: 'MISSING', matchedValueCount: 0 });
      } else {
        matchedValues.push(toMatchedValue(selection.values[0], request));
        requiredValues.push({ parameterCode: code, requirementLevel: 'REQUIRED_FOR_SELECTION', status: 'SATISFIED', matchedValueCount: selection.values.length });
      }
    }
    for (const code of applicability.requiredForSelectionProductLevel) {
      const selection = selectApplicableEngineeringValue(code, [], facts.values, facts.conditionSets);
      if (selection.status === 'NOT_FOUND') {
        addDetail(reasonDetail('REQUIRED_PARAMETER_MISSING', `Missing required product-level parameter ${code}`, { parameter: code }));
        missingRequirements.push({ parameterCode: code, requirementLevel: 'REQUIRED_FOR_SELECTION', reasonCode: 'REQUIRED_PARAMETER_MISSING' });
        decision = worsen(decision, 'INSUFFICIENT_DATA');
      } else if (selection.status === 'CONFLICT') {
        addDetail(reasonDetail('DATA_CONFLICT', `Conflicting values for ${code}`, { parameter: code }));
        decision = worsen(decision, 'CONFLICT');
      } else {
        matchedValues.push(toMatchedValue(selection.values[0], request));
      }
    }
  }

  for (const extra of request.requiredParameters) {
    if (request.requiredCapacity && extra.parameterCode === request.requiredCapacity.parameterCode) continue;
    const conditions = extra.conditionScope === 'VALUE_OPERATING_POINT' ? request.operatingConditions : [];
    const selection = selectApplicableEngineeringValue(
      extra.parameterCode,
      conditions,
      facts.values,
      facts.conditionSets,
    );
    if (selection.status === 'NOT_FOUND') {
      addDetail(reasonDetail('REQUIRED_PARAMETER_MISSING', `Missing required parameter ${extra.parameterCode}`, { parameter: extra.parameterCode }));
      missingRequirements.push({
        parameterCode: extra.parameterCode,
        requirementLevel: extra.requirementKind === 'COMPATIBILITY' ? 'REQUIRED_FOR_COMPATIBILITY' : 'REQUIRED_FOR_SELECTION',
        reasonCode: 'REQUIRED_PARAMETER_MISSING',
      });
      decision = worsen(decision, 'INSUFFICIENT_DATA');
    }
  }

  const registry = PARAMETER_REQUIREMENT_LEVELS[request.equipmentType] ?? {};
  for (const [code, level] of Object.entries(registry) as Array<[CanonicalParameterCode, typeof registry[CanonicalParameterCode]]>) {
    if (level !== 'RECOMMENDED') continue;
    if (applicability?.notApplicable.includes(code)) continue;
    const present = facts.values.some((row) => row.parameterCode === code && row.status === 'KNOWN');
    if (!present) {
      addWarning('RECOMMENDED_PARAMETER_MISSING', `Recommended parameter ${code} is missing`, code);
    }
  }
  for (const [code, level] of Object.entries(registry) as Array<[CanonicalParameterCode, typeof registry[CanonicalParameterCode]]>) {
    if (level !== 'REQUIRED_FOR_COMPATIBILITY') continue;
    const present = facts.values.some((row) => row.parameterCode === code && row.status === 'KNOWN');
    if (!present) {
      addWarning('COMPATIBILITY_UNKNOWN', `Compatibility parameter ${code} is missing`, code);
    }
  }

  const compatibility: CompatibilityEvaluation[] = [];
  if (request.compatibilityRequirements.length === 0) {
    compatibility.push({
      relationType: 'COMPATIBLE_WITH',
      state: 'NOT_APPLICABLE',
      target: { productId: null, equipmentType: null, parameterCode: null },
      reasonCode: null,
    });
  } else {
    for (const req of request.compatibilityRequirements) {
      const fact = facts.compatibilityFacts.find((row) => {
        if (row.relationType !== req.relationType) return false;
        if (req.target.productId != null && row.targetProductId !== req.target.productId) return false;
        if (req.target.equipmentType != null && row.targetEquipmentType !== req.target.equipmentType) return false;
        return true;
      });
      if (fact && (fact.relationType === 'INCOMPATIBLE_WITH' || fact.stateHint === 'INCOMPATIBLE')) {
        compatibility.push({
          relationType: req.relationType,
          state: 'INCOMPATIBLE',
          target: req.target,
          reasonCode: 'COMPATIBILITY_FAILED',
        });
        addDetail(reasonDetail('COMPATIBILITY_FAILED', 'Explicit incompatibility'));
        decision = worsen(decision, 'EXCLUDED');
      } else if (!fact) {
        compatibility.push({
          relationType: req.relationType,
          state: 'UNKNOWN',
          target: req.target,
          reasonCode: 'COMPATIBILITY_UNKNOWN',
        });
        if (req.required && request.selectionMode === 'PROFESSIONAL') {
          addDetail(reasonDetail('COMPATIBILITY_UNKNOWN', 'Required compatibility is unknown'));
          decision = worsen(decision, 'INSUFFICIENT_DATA');
        } else {
          addWarning('COMPATIBILITY_UNKNOWN', 'Compatibility is unknown');
        }
      } else {
        compatibility.push({
          relationType: req.relationType,
          state: fact.stateHint ?? 'CONFIRMED',
          target: req.target,
          reasonCode: null,
        });
      }
    }
  }

  for (const exclusion of request.excludedParameters) {
    const found = facts.values.find((row) => row.parameterCode === exclusion.parameterCode && row.status === 'KNOWN');
    if (!found) continue;
    addDetail(reasonDetail('PARAMETER_OUT_OF_RANGE', exclusion.reason || `Excluded parameter ${exclusion.parameterCode}`, { parameter: exclusion.parameterCode }));
    decision = worsen(decision, 'EXCLUDED');
  }

  if (facts.commerce.stockStatus === 'OUT_OF_STOCK') {
    addWarning('OUT_OF_STOCK', 'Product is out of stock');
  }
  if (facts.commerce.price == null) {
    addWarning('PRICE_UNKNOWN', 'Price is unknown');
  }

  if (decision == null) {
    const engineeringWarnings = warnings.filter((row) => ENGINEERING_WARNING_CODES.includes(row.code));
    decision = engineeringWarnings.length > 0 ? 'MATCH_WITH_WARNINGS' : 'MATCH';
  }

  const sortedCodes = sortReasonCodes(reasonCodes);
  const sortedDetails = sortReasonDetails(reasonDetails);
  const primaryReason = primaryReasonOf(sortedCodes);

  const verificationTier = selectedCapacity?.verificationTier ?? null;
  const evaluation: CandidateEvaluation = {
    productId: facts.product.productId,
    sku: facts.product.sku,
    equipmentType: facts.profile.equipmentType,
    decision,
    engineeringEligibility: eligibilityOf(decision),
    rank: null,
    rankScore: null,
    rankKey: [],
    oversizeRatio,
    matchedValues,
    requiredValues,
    operatingPoint: {
      overall: operatingOverall,
      requested: request.operatingConditions,
      actual: actualConditions,
      perKey: operatingPerKey,
    },
    verification: {
      sourceType: selectedCapacity?.sourceType ?? null,
      verificationTier,
      professionalEligible:
        verificationTier != null && PROFESSIONAL_ACCEPTED_TIERS.includes(verificationTier),
      identityStatus: facts.profile.identityStatus,
      dataCompleteness: facts.profile.dataCompleteness,
      profileSourceVerification: facts.profile.sourceVerification,
    },
    compatibility,
    missingRequirements,
    warnings: warnings.filter((row) => !COMMERCE_WARNING_CODES.includes(row.code) || true).sort((a, b) => {
      const ia = sortedCodes.indexOf(a.code);
      const ib = sortedCodes.indexOf(b.code);
      return ia - ib;
    }),
    reasonCodes: sortedCodes,
    reasonDetails: sortedDetails,
    primaryReason,
    allReasons: sortedCodes,
    commercialData: facts.commerce,
    explanation: {
      decision,
      humanSummary: `${facts.product.sku}: ${decision}${primaryReason ? ` (${primaryReason})` : ''}`,
      reasonDetails: sortedDetails,
    },
  };

  const tuple = buildRankTuple(evaluation, countPreferredMatches(request, facts));
  evaluation.rankKey = rankKeyFromTuple(tuple);
  return evaluation;
}
