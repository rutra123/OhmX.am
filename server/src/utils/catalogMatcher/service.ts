/**
 * CM5 thin orchestration layer.
 * Combines the CM4 read-only query adapter with the CM3 pure evaluator.
 * Does not decide capacity, operating-point, compatibility, or reason codes.
 */
import { evaluateCatalogCandidate, effectiveRequiredCapacity } from './evaluator.js';
import { CATALOG_MATCHER_POLICY, type CatalogMatcherPolicy } from './policy.js';
import { loadCatalogCandidates, openCatalogMatcherDatabase, MatcherWriteError, type MatcherDatabase } from './queryAdapter.js';
import { isEngineeringEligible, rankEligibleCandidates } from './ranking.js';
import type {
  CatalogCandidateFacts,
  CatalogMatchRequest,
  CatalogMatchResponse,
  CatalogMatcherRequestError,
  CandidateEvaluation,
  ComparisonPolicy,
  MatchSummary,
  ReasonCode,
  RequestErrorCode,
  Warning,
} from './types.js';
import {
  CANONICAL_PARAMETER_CODES,
  COMPARISON_POLICIES,
  CONDITION_KEYS,
  EQUIPMENT_TYPES,
  MATCHER_MODEL_ID,
  MATCHER_MODEL_VERSION,
  MATCHER_POLICY_ID,
  REQUEST_SOURCES,
  SELECTION_MODES,
  SERVICES,
  VERIFICATION_REQUIREMENTS,
} from './types.js';

export type CatalogMatcherFailureKind = 'REQUEST_ERROR' | 'DATABASE_READ_ERROR' | 'MATCHER_INTERNAL_ERROR';

export type CatalogMatcherResult =
  | { ok: true; response: CatalogMatchResponse }
  | { ok: false; kind: 'REQUEST_ERROR'; error: CatalogMatcherRequestError }
  | { ok: false; kind: 'DATABASE_READ_ERROR'; error: CatalogMatcherDatabaseError }
  | { ok: false; kind: 'MATCHER_INTERNAL_ERROR'; error: CatalogMatcherInternalError };

export interface CatalogMatcherDatabaseError {
  message: string;
  cause: string | null;
}

export interface CatalogMatcherInternalError {
  message: string;
  cause: string | null;
}

export interface CatalogMatcherServiceOptions {
  db?: MatcherDatabase;
  databasePath?: string;
  loadCandidates?: (request: CatalogMatchRequest) => CatalogCandidateFacts[];
  policy?: CatalogMatcherPolicy;
}

export class MatcherRequestError extends Error {
  readonly kind = 'REQUEST_ERROR' as const;
  readonly errorCode: RequestErrorCode;
  readonly field: string | null;
  readonly details: string[];

  constructor(error: CatalogMatcherRequestError) {
    super(error.message);
    this.name = 'MatcherRequestError';
    this.errorCode = error.errorCode;
    this.field = error.field;
    this.details = error.details;
  }
}

export class MatcherDatabaseReadError extends Error {
  readonly kind = 'DATABASE_READ_ERROR' as const;

  constructor(message: string, readonly causeMessage: string | null = null) {
    super(message);
    this.name = 'MatcherDatabaseReadError';
  }
}

export class MatcherInternalError extends Error {
  readonly kind = 'MATCHER_INTERNAL_ERROR' as const;

  constructor(message: string, readonly causeMessage: string | null = null) {
    super(message);
    this.name = 'MatcherInternalError';
  }
}

const EQUIPMENT_SET = new Set<string>(EQUIPMENT_TYPES);
const SERVICE_SET = new Set<string>(SERVICES);
const PARAMETER_SET = new Set<string>(CANONICAL_PARAMETER_CODES);
const CONDITION_SET = new Set<string>(CONDITION_KEYS);
const SELECTION_MODE_SET = new Set<string>(SELECTION_MODES);
const COMPARISON_SET = new Set<string>(COMPARISON_POLICIES);
const VERIFICATION_SET = new Set<string>(VERIFICATION_REQUIREMENTS);
const REQUEST_SOURCE_SET = new Set<string>(REQUEST_SOURCES);

function requestError(
  errorCode: RequestErrorCode,
  message: string,
  field: string | null = null,
  details: string[] = [],
): CatalogMatcherRequestError {
  return { errorCode, message, field, details };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function oneOfConditionValues(row: Record<string, unknown>): number {
  return [row.valueNumeric != null, row.valueText != null, row.valueBoolean != null].filter(Boolean).length;
}

function checkParameterCode(code: unknown, field: string): CatalogMatcherRequestError | null {
  if (typeof code !== 'string' || !PARAMETER_SET.has(code)) {
    return requestError('UNKNOWN_PARAMETER_CODE', `Unknown parameter code: ${String(code)}`, field);
  }
  return null;
}

export function validateCatalogMatchRequest(request: unknown): CatalogMatcherRequestError | null {
  if (!isRecord(request)) {
    return requestError('INVALID_REQUEST', 'Catalog match request must be an object', null);
  }

  if (request.matcherModelId !== MATCHER_MODEL_ID) {
    return requestError('UNKNOWN_MATCHER_MODEL', 'matcherModelId must be ohmx.catalog-matcher.v1', 'matcherModelId');
  }
  if (request.matcherModelVersion !== MATCHER_MODEL_VERSION) {
    return requestError('UNKNOWN_MATCHER_MODEL', 'matcherModelVersion must be 1.0.0', 'matcherModelVersion');
  }
  if (request.schemaVersion !== '1.0.0') {
    return requestError('INVALID_REQUEST', 'schemaVersion must be 1.0.0', 'schemaVersion');
  }
  if (request.policyId !== MATCHER_POLICY_ID) {
    return requestError('INVALID_REQUEST', 'policyId must be ohmx.catalog-matcher-policy.v1', 'policyId');
  }
  if (!isNonEmptyString(request.policyVersion)) {
    return requestError('INVALID_REQUEST', 'policyVersion is required', 'policyVersion');
  }
  if (!SELECTION_MODE_SET.has(String(request.selectionMode))) {
    return requestError('INVALID_REQUEST', `Unknown selectionMode: ${String(request.selectionMode)}`, 'selectionMode');
  }
  if (!EQUIPMENT_SET.has(String(request.equipmentType))) {
    return requestError('UNKNOWN_EQUIPMENT_TYPE', `Unknown equipment type: ${String(request.equipmentType)}`, 'equipmentType');
  }
  if (!SERVICE_SET.has(String(request.service))) {
    return requestError('UNKNOWN_SERVICE', `Unknown service: ${String(request.service)}`, 'service');
  }
  if (!VERIFICATION_SET.has(String(request.requiredVerificationTier))) {
    return requestError('INVALID_REQUEST', 'Unknown requiredVerificationTier', 'requiredVerificationTier');
  }
  if (typeof request.requireExactOperatingPoint !== 'boolean') {
    return requestError('INVALID_REQUEST', 'requireExactOperatingPoint must be boolean', 'requireExactOperatingPoint');
  }
  if (typeof request.allowInterpolation !== 'boolean' || typeof request.allowExtrapolation !== 'boolean') {
    return requestError('INVALID_REQUEST', 'allowInterpolation and allowExtrapolation must be boolean', 'allowInterpolation');
  }
  const designMarginPercent = request.designMarginPercent;
  if (!isFiniteNumber(designMarginPercent) || designMarginPercent < 0) {
    return requestError('INVALID_MARGIN', 'designMarginPercent must be a finite number >= 0', 'designMarginPercent');
  }
  const maxCandidates = request.maxCandidates;
  if (!Number.isInteger(maxCandidates) || (maxCandidates as number) < 1 || (maxCandidates as number) > 100) {
    return requestError('INVALID_REQUEST', 'maxCandidates must be an integer 1..100', 'maxCandidates');
  }
  const maxDiagnosticResults = request.maxDiagnosticResults;
  if (
    !Number.isInteger(maxDiagnosticResults) ||
    (maxDiagnosticResults as number) < 0 ||
    (maxDiagnosticResults as number) > 500
  ) {
    return requestError('INVALID_REQUEST', 'maxDiagnosticResults must be an integer 0..500', 'maxDiagnosticResults');
  }

  if (request.requiredCapacity != null) {
    if (!isRecord(request.requiredCapacity)) {
      return requestError('INVALID_REQUEST', 'requiredCapacity must be an object or null', 'requiredCapacity');
    }
    const capacityError = checkParameterCode(request.requiredCapacity.parameterCode, 'requiredCapacity.parameterCode');
    if (capacityError) return capacityError;
    if (!isFiniteNumber(request.requiredCapacity.requiredValue) || request.requiredCapacity.requiredValue <= 0) {
      return requestError('INVALID_REQUEST', 'requiredCapacity.requiredValue must be a number > 0', 'requiredCapacity.requiredValue');
    }
    if (typeof request.requiredCapacity.unit !== 'string' || request.requiredCapacity.unit.trim() === '') {
      return requestError('INVALID_UNIT', 'requiredCapacity.unit must be a non-empty string', 'requiredCapacity.unit');
    }
    if (!COMPARISON_SET.has(String(request.requiredCapacity.comparisonPolicy))) {
      return requestError('INVALID_COMPARISON', 'Unknown comparisonPolicy', 'requiredCapacity.comparisonPolicy');
    }
    const policy = request.requiredCapacity.comparisonPolicy as ComparisonPolicy;
    if (policy === 'WITHIN_RANGE' && !isFiniteNumber(request.requiredCapacity.upperValue)) {
      return requestError('INVALID_COMPARISON', 'WITHIN_RANGE requires upperValue', 'requiredCapacity.upperValue');
    }
  }

  if (!Array.isArray(request.operatingConditions)) {
    return requestError('INVALID_REQUEST', 'operatingConditions must be an array', 'operatingConditions');
  }
  for (let i = 0; i < request.operatingConditions.length; i += 1) {
    const row = request.operatingConditions[i];
    if (!isRecord(row)) {
      return requestError('INVALID_REQUEST', 'operatingConditions entries must be objects', `operatingConditions[${i}]`);
    }
    if (!CONDITION_SET.has(String(row.conditionKey))) {
      return requestError('UNKNOWN_CONDITION_KEY', `Unknown condition key: ${String(row.conditionKey)}`, `operatingConditions[${i}].conditionKey`);
    }
    if (row.matchPolicy !== 'EXACT') {
      return requestError('INVALID_REQUEST', 'operatingConditions.matchPolicy must be EXACT', `operatingConditions[${i}].matchPolicy`);
    }
    if (oneOfConditionValues(row) !== 1) {
      return requestError('INVALID_REQUEST', 'Each operating condition must have exactly one typed value', `operatingConditions[${i}]`);
    }
  }

  const listFields = ['requiredParameters', 'preferredParameters', 'excludedParameters', 'compatibilityRequirements'] as const;
  for (const field of listFields) {
    if (!Array.isArray(request[field])) {
      return requestError('INVALID_REQUEST', `${field} must be an array`, field);
    }
  }

  const requiredParameters = request.requiredParameters as Array<Record<string, unknown>>;
  for (let i = 0; i < requiredParameters.length; i += 1) {
    const err = checkParameterCode(requiredParameters[i]?.parameterCode, `requiredParameters[${i}].parameterCode`);
    if (err) return err;
  }
  const preferredParameters = request.preferredParameters as Array<Record<string, unknown>>;
  for (let i = 0; i < preferredParameters.length; i += 1) {
    const err = checkParameterCode(preferredParameters[i]?.parameterCode, `preferredParameters[${i}].parameterCode`);
    if (err) return err;
  }
  const excludedParameters = request.excludedParameters as Array<Record<string, unknown>>;
  for (let i = 0; i < excludedParameters.length; i += 1) {
    const err = checkParameterCode(excludedParameters[i]?.parameterCode, `excludedParameters[${i}].parameterCode`);
    if (err) return err;
  }

  if (request.projectContext != null) {
    if (!isRecord(request.projectContext)) {
      return requestError('INVALID_REQUEST', 'projectContext must be an object or null', 'projectContext');
    }
    if (!REQUEST_SOURCE_SET.has(String(request.projectContext.source))) {
      return requestError('INVALID_REQUEST', 'Unknown projectContext.source', 'projectContext.source');
    }
  }

  return null;
}

function requestScopedWarnings(request: CatalogMatchRequest): Warning[] {
  const warnings: Warning[] = [];
  const push = (code: ReasonCode, message: string) => {
    warnings.push({
      code,
      message,
      parameter: null,
      conditionContext: request.operatingConditions,
    });
  };
  if (request.allowInterpolation) {
    push('INTERPOLATION_NOT_ALLOWED', 'Interpolation is not implemented in matcher v1');
  }
  if (request.allowExtrapolation) {
    push('EXTRAPOLATION_NOT_ALLOWED', 'Extrapolation is not implemented in matcher v1');
  }
  return warnings;
}

function byProductId(a: CandidateEvaluation, b: CandidateEvaluation): number {
  return a.productId - b.productId;
}

function cap<T>(rows: T[], limit: number): T[] {
  return rows.slice(0, limit);
}

function summaryOf(evaluations: CandidateEvaluation[]): MatchSummary {
  const summary: MatchSummary = {
    productsConsidered: evaluations.length,
    eligible: 0,
    eligibleWithWarnings: 0,
    insufficientData: 0,
    excluded: 0,
    conflicts: 0,
  };
  for (const row of evaluations) {
    if (row.decision === 'MATCH') summary.eligible += 1;
    else if (row.decision === 'MATCH_WITH_WARNINGS') summary.eligibleWithWarnings += 1;
    else if (row.decision === 'INSUFFICIENT_DATA') summary.insufficientData += 1;
    else if (row.decision === 'EXCLUDED') summary.excluded += 1;
    else if (row.decision === 'CONFLICT') summary.conflicts += 1;
  }
  return summary;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function evaluateCatalogMatch(
  request: CatalogMatchRequest,
  facts: CatalogCandidateFacts[],
  policy: CatalogMatcherPolicy = CATALOG_MATCHER_POLICY,
): CatalogMatchResponse {
  const orderedFacts = [...facts].sort((a, b) => a.product.productId - b.product.productId);
  const evaluations = orderedFacts.map((candidate) => evaluateCatalogCandidate(request, candidate, policy));
  const ranked = rankEligibleCandidates(evaluations);

  const eligible = ranked.filter(isEngineeringEligible);
  const insufficientData = ranked.filter((row) => row.decision === 'INSUFFICIENT_DATA').sort(byProductId);
  const excluded = ranked.filter((row) => row.decision === 'EXCLUDED').sort(byProductId);
  const conflicts = ranked.filter((row) => row.decision === 'CONFLICT').sort(byProductId);

  const summary = summaryOf(ranked);
  const candidates = cap(eligible, request.maxCandidates);
  const diagnosticLimit = request.maxDiagnosticResults;

  return {
    matcherModelId: MATCHER_MODEL_ID,
    matcherModelVersion: MATCHER_MODEL_VERSION,
    policyId: MATCHER_POLICY_ID,
    policyVersion: request.policyVersion,
    request,
    effectiveRequiredCapacity: effectiveRequiredCapacity(request),
    summary,
    candidates,
    insufficientData: cap(insufficientData, diagnosticLimit),
    excluded: cap(excluded, diagnosticLimit),
    conflicts: cap(conflicts, diagnosticLimit),
    warnings: requestScopedWarnings(request),
  };
}

function loadFacts(
  request: CatalogMatchRequest,
  options: CatalogMatcherServiceOptions,
): { facts: CatalogCandidateFacts[]; opened: { close: () => void } | null } {
  if (options.loadCandidates) {
    return { facts: options.loadCandidates(request), opened: null };
  }
  if (options.db) {
    return { facts: loadCatalogCandidates(options.db, request), opened: null };
  }
  if (options.databasePath) {
    const opened = openCatalogMatcherDatabase(options.databasePath);
    try {
      return { facts: loadCatalogCandidates(opened, request), opened };
    } catch (err) {
      opened.close();
      throw err;
    }
  }
  throw new MatcherInternalError('Catalog matcher service requires db, databasePath, or loadCandidates');
}

export function matchCatalogProducts(
  request: CatalogMatchRequest,
  options: CatalogMatcherServiceOptions = {},
): CatalogMatcherResult {
  const invalid = validateCatalogMatchRequest(request);
  if (invalid) {
    return { ok: false, kind: 'REQUEST_ERROR', error: invalid };
  }

  let opened: { close: () => void } | null = null;
  let facts: CatalogCandidateFacts[];
  try {
    const loaded = loadFacts(request, options);
    opened = loaded.opened;
    facts = loaded.facts;
  } catch (err) {
    opened?.close();
    opened = null;
    if (err instanceof MatcherInternalError) {
      return { ok: false, kind: 'MATCHER_INTERNAL_ERROR', error: { message: err.message, cause: err.causeMessage } };
    }
    return {
      ok: false,
      kind: 'DATABASE_READ_ERROR',
      error: {
        message: errorMessage(err),
        cause: err instanceof MatcherWriteError || err instanceof MatcherDatabaseReadError ? err.message : null,
      },
    };
  }

  try {
    const response = evaluateCatalogMatch(request, facts, options.policy ?? CATALOG_MATCHER_POLICY);
    return { ok: true, response };
  } catch (err) {
    return {
      ok: false,
      kind: 'MATCHER_INTERNAL_ERROR',
      error: { message: errorMessage(err), cause: null },
    };
  } finally {
    opened?.close();
  }
}
