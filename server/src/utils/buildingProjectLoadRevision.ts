/**
 * CM14 — deterministic Building Project load-result identity producer.
 *
 * Implements the CM12-frozen prerequisite F:
 *   computeLoadCalculationRevision(canonicalFacts) -> `load:sha256:<64 lowercase hex>`
 *
 * PARITY WITH CM11 (the only trusted source of canonical rules):
 *   - The canonical projection is NOT re-implemented here. `projectCanonicalLoadFacts`
 *     is imported from the CM11 adapter (`buildingProjectConfiguratorAdapter/loadRevision.ts`)
 *     and fed with the exact same inputs the adapter uses at validation time:
 *       projectId, objectType, project.calculationConfiguration.coverageIntent
 *       and the materialized (margin-normalized) confirmed-system design inputs.
 *   - `canonicalNumber` (the frozen -0 -> 0 numeric identity) is imported from
 *     `buildingProjectConfiguratorAdapter/policy.ts`.
 *   - `algorithmVersion` is the frozen CM10/CM11 literal
 *     `ohmx.building-project-load-canonical-json.v1` — reused verbatim, not re-invented.
 *   - The projection output (CanonicalLoadFingerprintFacts) is serialized with a
 *     canonical JSON serializer (UTF-8, recursive lexicographic code-point key order,
 *     frozen semantic array order already applied by the projection itself, explicit
 *     nulls preserved, finite numbers only, no `-0`, no locale dependence) and hashed
 *     with standard SHA-256.
 *
 * CM14 owns LOAD_RESULT_IDENTITY only. It never mutates revisions, staleness,
 * quality, coverage, or adapter behavior. No DB, no network, no clock, no random:
 * the ONLY cryptographic operation is `createHash("sha256")` over canonical facts.
 *
 * Identity lifecycle (CM12 §13/§16/§17):
 *   - Produced ONCE per successful steady_state calculation, at persistence time,
 *     after ALL canonical load facts are final.
 *   - `sourceCalculationId === loadCalculationRevision` (CM12 current policy).
 *   - Legacy results without these fields remain readable; no read-time mutation,
 *     no read-time hashing (CM14-L: no fabrication).
 *   - quick / professional / limited / incomplete / legacy results are NOT certified;
 *     they persist without a revision and the future orchestrator must treat them
 *     as LOAD_REVISION_MISSING (CM12 §26 fail-closed).
 */
import { createHash } from "node:crypto";
import type {
  BuildingLoadCalculation,
  BuildingProject,
} from "./buildingProjectTypes.js";
import type {
  AdapterLoadCalculation,
  CanonicalLoadFingerprintFacts,
} from "./buildingProjectConfiguratorAdapter/types.js";
import { projectCanonicalLoadFacts } from "./buildingProjectConfiguratorAdapter/loadRevision.js";
import { materializeMargins } from "./buildingProjectConfiguratorAdapter/operatingInputs.js";
import {
  LOAD_CANONICAL_ALGORITHM_VERSION,
  LOAD_REVISION_PREFIX,
} from "./buildingProjectConfiguratorAdapter/types.js";

/** Frozen CM10/CM11 canonical algorithm identity — reused verbatim. */
export const LOAD_REVISION_ALGORITHM_VERSION = LOAD_CANONICAL_ALGORITHM_VERSION;
export const LOAD_REVISION_PREFIX_VALUE = LOAD_REVISION_PREFIX;

/** Producer result per CM12 §13/§17: one token, one policy, source == revision. */
export interface LoadRevisionProduction {
  revision: string;
  sourceCalculationId: string;
  algorithmVersion: typeof LOAD_CANONICAL_ALGORITHM_VERSION;
  canonicalFacts: CanonicalLoadFingerprintFacts;
}

/** Fail-closed canonicalization error (CM14 group G). */
export class LoadRevisionInputError extends Error {
  code: string;
  fieldPath: string;
  constructor(code: string, fieldPath: string, message?: string) {
    super(message ?? `${code}: ${fieldPath}`);
    this.name = "LoadRevisionInputError";
    this.code = code;
    this.fieldPath = fieldPath;
  }
}

function fail(code: string, fieldPath: string): never {
  throw new LoadRevisionInputError(code, fieldPath);
}

/** Frozen semantic service order — exact CM11 requestedServices literal order. */
const CANONICAL_SERVICE_ORDER = ["heating", "cooling"] as const;

/**
 * Canonical code-point string ordering (deterministic, locale-independent).
 * Same comparison semantics as the CM11/CM9 `compareCodePoints`.
 */
export function compareCodePoints(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  const length = Math.min(x.length, y.length);
  for (let i = 0; i < length; i++) {
    const difference = (x[i].codePointAt(0) ?? 0) - (y[i].codePointAt(0) ?? 0);
    if (difference !== 0) return difference;
  }
  return x.length - y.length;
}

// ---------------------------------------------------------------------------
// Numeric canonicalization (CM14 §8)
// ---------------------------------------------------------------------------

/**
 * Gate every number before it may enter the canonical facts:
 * - NaN / Infinity / -Infinity are rejected (never stringified, never coerced).
 * - `-0` is normalized to `0` (the frozen single representation, matching the
 *   CM11 `canonicalNumber` policy).
 * - No rounding is applied: frozen contract values pass through untouched.
 * - 1 and 1.0 are the SAME IEEE-754 double; canonicalization is therefore
 *   identical by construction (JSON numeric identity).
 */
export function canonicalizeFiniteNumber(value: unknown, fieldPath: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) fail("load_revision_number_nan", fieldPath);
  if (!Number.isFinite(value)) fail("load_revision_number_infinite", fieldPath);
  return value === 0 ? 0 : value;
}

/**
 * Deep numeric gate over an already-projected canonical facts object. The CM11
 * projection copies values verbatim from the immutable load result, so this
 * pass enforces the finite/-0 contract over every numeric leaf without
 * re-interpreting any rule. Returns the same shape with:
 *   - `-0` -> `0`
 * and throws `LoadRevisionInputError` on NaN/Infinity anywhere.
 */
export function canonicalizeLoadCalculationFacts<T>(facts: T, fieldPath = "canonicalFacts"): T {
  if (typeof facts === "number") return canonicalizeFiniteNumber(facts, fieldPath) as unknown as T;
  if (facts === null || typeof facts !== "object") return facts;
  if (Array.isArray(facts)) {
    const out = facts as unknown[];
    for (let i = 0; i < out.length; i++) out[i] = canonicalizeLoadCalculationFacts(out[i], `${fieldPath}[${i}]`);
    return facts;
  }
  const source = facts as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    source[key] = canonicalizeLoadCalculationFacts(source[key], `${fieldPath}.${key}`);
  }
  return facts;
}

// ---------------------------------------------------------------------------
// Canonical JSON serialization (CM14 §7)
// ---------------------------------------------------------------------------

/**
 * Canonical JSON string for a canonical facts object:
 * - object keys sorted recursively by Unicode code points (not localeCompare);
 * - arrays preserved in their frozen semantic order (the CM11 projection
 *   already sorted rooms by stable roomId and services canonically);
 * - explicit null preserved; booleans preserved; strings exact (UTF-8);
 * - numbers via the deterministic `Number.prototype.toString` representation
 *   (no locale, no exponent policy change, no thousands separators).
 *
 * `JSON.stringify` is used ONLY as the emission format; ordering comes from the
 * rebuilt objects below, so property insertion order cannot leak into the hash.
 */
export function serializeCanonicalLoadFacts(facts: unknown): string {
  return JSON.stringify(canonicalizeValue(facts, "canonicalFacts"));
}

function canonicalizeValue(value: unknown, fieldPath: string): unknown {
  if (typeof value === "number") return canonicalizeFiniteNumber(value, fieldPath);
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i++) out.push(canonicalizeValue(value[i], `${fieldPath}[${i}]`));
    return out;
  }
  const source = value as Record<string, unknown>;
  const keys = Object.keys(source).sort(compareCodePoints);
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = canonicalizeValue(source[key], `${fieldPath}.${key}`);
  return out;
}

// ---------------------------------------------------------------------------
// Hash (CM14 §9)
// ---------------------------------------------------------------------------

/**
 * SHA-256 over the UTF-8 canonical JSON. Standard algorithm, no salt, no
 * secret, no timestamp, no truncation, lowercase hex output.
 */
export function computeLoadCalculationRevision(canonicalFacts: CanonicalLoadFingerprintFacts): string {
  const canonicalJson = serializeCanonicalLoadFacts(canonicalFacts);
  const digest = createHash("sha256").update(canonicalJson, "utf8").digest("hex");
  if (!/^[0-9a-f]{64}$/.test(digest)) fail("load_revision_digest_invalid", "digest");
  return `load:sha256:${digest}`;
}

// ---------------------------------------------------------------------------
// Producer (CM12 §13 / CM14 §11–12)
// ---------------------------------------------------------------------------

/**
 * Eligibility gate (CM12 §13, §26; CM11 validateLoadReadiness semantics):
 * ONLY a successful supported steady_state result may carry a certifying
 * revision. Everything else must persist WITHOUT one.
 */
export function isLoadRevisionEligible(load: BuildingLoadCalculation | null | undefined): boolean {
  if (!load || typeof load !== "object") return false;
  if (load.mode !== "steady_state" || load.status !== "calculated") return false;
  if (load.methodId !== "ohmx.steady-state.v1" || load.methodVersion !== "1.0.0") return false;
  if (load.inputSnapshot?.mode !== load.mode) return false;
  if (load.inputSnapshot?.methodVersion !== load.methodVersion) return false;
  if (!load.engineeringQuality || typeof load.engineeringQuality !== "object") return false;
  return true;
}

/**
 * Build the canonical facts EXACTLY as CM11 builds them at validation time:
 * coverage intent from the persisted `project.calculationConfiguration`,
 * design inputs from the CONFIRMED system snapshot, margins materialized with
 * the frozen CM11 `materializeMargins` (absent groups => sanctioned 0/NONE).
 */
export function buildCanonicalLoadFacts(
  project: BuildingProject,
  load: BuildingLoadCalculation,
): CanonicalLoadFingerprintFacts {
  const intent = project.calculationConfiguration?.coverageIntent ?? null;
  if (!intent) fail("load_revision_coverage_intent_missing", "project.calculationConfiguration.coverageIntent");
  const confirmed = project.systemsConfigurationSnapshot ?? null;
  if (!confirmed) fail("load_revision_system_snapshot_missing", "project.systemsConfigurationSnapshot");
  const rawDesign = confirmed.engineeringDesignInputs ?? null;
  if (!rawDesign) {
    fail("load_revision_design_inputs_missing", "project.systemsConfigurationSnapshot.engineeringDesignInputs");
  }
  const materializedDesign = materializeMargins(
    rawDesign as unknown as Parameters<typeof materializeMargins>[0],
  );
  if (!materializedDesign) fail("load_revision_design_inputs_missing", "engineeringDesignInputs (materialized)");
  const adapterLoad = load as unknown as AdapterLoadCalculation;
  return projectCanonicalLoadFacts(adapterLoad, project.id, project.objectType, intent, materializedDesign);
}

/**
 * Full production: canonical facts + token. Pure; throws fail-closed on
 * ineligible results, missing parents, or non-finite numbers. The caller
 * attaches the result to the load at persistence time; this module never
 * persists anything itself.
 */
export function produceLoadCalculationRevision(
  project: BuildingProject,
  load: BuildingLoadCalculation,
): LoadRevisionProduction {
  if (!isLoadRevisionEligible(load)) {
    fail("load_revision_not_eligible", "loadCalculation (steady_state/calculated/quality required)");
  }
  const canonicalFacts = buildCanonicalLoadFacts(project, load);
  canonicalizeLoadCalculationFacts(canonicalFacts);
  const revision = computeLoadCalculationRevision(canonicalFacts);
  return {
    revision,
    sourceCalculationId: revision, // CM12 §17 current policy
    algorithmVersion: LOAD_REVISION_ALGORITHM_VERSION,
    canonicalFacts,
  };
}

// ---------------------------------------------------------------------------
// Persistence-time attach (CM12 §16) + legacy read policy (CM14 §24)
// ---------------------------------------------------------------------------

/** The two identity fields owned by LOAD_RESULT_IDENTITY. */
export interface LoadRevisionIdentity {
  loadCalculationRevision: string;
  sourceCalculationId: string;
}

/** Both fields or none — a half-stamped result is a contract violation. */
export function loadRevisionIdentityOf(
  load: BuildingLoadCalculation | null | undefined,
): LoadRevisionIdentity | null {
  const anyLoad = load as { loadCalculationRevision?: unknown; sourceCalculationId?: unknown } | null | undefined;
  const revision = typeof anyLoad?.loadCalculationRevision === "string" ? anyLoad.loadCalculationRevision : null;
  const source = typeof anyLoad?.sourceCalculationId === "string" ? anyLoad.sourceCalculationId : null;
  if (revision && source) return { loadCalculationRevision: revision, sourceCalculationId: source };
  return null;
}

/**
 * Attach the produced identity to a load result object (mutating the detached
 * result object handed to persistence — the ONLY mutation CM14 performs, and
 * only on a NEW successful steady_state calculation).
 */
export function attachLoadCalculationRevision(
  load: BuildingLoadCalculation,
  production: LoadRevisionProduction,
): void {
  if (!isLoadRevisionEligible(load)) {
    fail("load_revision_not_eligible", "attachLoadCalculationRevision");
  }
  const target = load as BuildingLoadCalculation & LoadRevisionIdentity;
  target.loadCalculationRevision = production.revision;
  target.sourceCalculationId = production.sourceCalculationId;
}

/**
 * A load result whose identity fields were produced by an older algorithm
 * version than the current frozen literal must not be certified CURRENT.
 */
export function loadRevisionAlgorithmMatches(load: BuildingLoadCalculation | null | undefined): boolean {
  const identity = loadRevisionIdentityOf(load);
  if (!identity) return false;
  const stored = (load as { loadRevisionAlgorithmVersion?: unknown } | null | undefined)
    ?.loadRevisionAlgorithmVersion;
  if (stored === undefined || stored === null) return true; // fields produced by the current policy
  return stored === LOAD_REVISION_ALGORITHM_VERSION;
}

/**
 * CM12 §18 frozen service order helper (semantic set, one frozen order).
 * Kept exported for the parity fixture and tests; the CM11 projection fixes
 * `requestedServices` to the canonical two-service order itself.
 */
export function canonicalServiceOrder(): readonly ["heating", "cooling"] {
  return CANONICAL_SERVICE_ORDER;
}
