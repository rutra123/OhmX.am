/**
 * CM11 adapter — frozen constant bridge + pure diagnostics/validators.
 *
 * Re-exports the sealed CM9/CM7.1 identities and reuses the exact Unicode
 * ordering and stable-id semantics already frozen in the Engineering
 * Configurator, so the adapter cannot drift from the canonical vocabulary.
 */
import type {
  EngineeringCatalogStateRevision,
  CommerceStateRevision,
} from "../engineeringConfigurator/types.js";
import type { AdapterBlockingReason, AdapterBlockingReasonCode, AdapterWarning, AdapterWarningCode } from "./types.js";
import { ADAPTER_BLOCKING_REASON_CODES, ADAPTER_WARNING_CODES } from "./types.js";
import { compareCodePoints, canonicalIds, validStableId } from "../engineeringConfigurator/componentIdentity.js";

// Frozen identity constants (value-exact; never re-entered by hand here).
export {
  ENGINEERING_CONFIGURATOR_POLICY_ID,
  ENGINEERING_CONFIGURATOR_POLICY_VERSION,
  CM7_GENERIC_CONFIGURATOR_POLICY_ID,
  CM7_GENERIC_CONFIGURATOR_POLICY_VERSION,
  CM8_SYSTEM_TOPOLOGY,
  CM8_SYSTEM_ARCHITECTURE_ID,
  CM8_SYSTEM_OPERATION_POLICY,
  CM8_SERVICE_INTENT,
  CM8_REVERSIBLE_SOURCE_FAMILY_ID,
  CM8_FAN_COIL_FAMILY_ID,
  CM8_RESIDENTIAL_OBJECT_TYPES,
  CM8_COMPLETENESS_STATE,
  CM8_MINIMUM_PROFESSIONAL_USE_LEVEL,
  CM8_COVERAGE_AREA_EPSILON_M2,
  CM8_COVERAGE_RATIO_EPSILON,
  CM8_ACCEPTED_BUILDING_LOAD_MODES,
  CONFIGURATOR_SELECTION_INTENTS,
} from "../engineeringConfigurator/types.js";
export {
  EQUIPMENT_REQUIREMENT_CONTRACT_ID,
  EQUIPMENT_REQUIREMENT_CONTRACT_VERSION,
  MATCHER_MODEL_ID,
  MATCHER_MODEL_VERSION,
  MATCHER_POLICY_ID,
  ENGINEERING_SCHEMA_ID,
  ENGINEERING_SCHEMA_VERSION,
  BUILDING_QUALITY_MODEL_ID,
  BUILDING_QUALITY_MODEL_VERSION,
} from "../engineeringConfigurator/equipmentRequirementTypes.js";
export { MATCHER_POLICY_VERSION, VERIFICATION_REQUIREMENTS } from "../engineeringConfigurator/policy.js";

export { compareCodePoints, canonicalIds, validStableId };

// ---------------------------------------------------------------------------
// Primitive guards (mirror CM9 policy.ts exactly)
// ---------------------------------------------------------------------------
export function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
export function nonNegative(value: unknown): value is number {
  return finite(value) && value >= 0;
}
export function revision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
export function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === "string");
}
/** Exact two-service set { heating, cooling }, no duplicates, no order meaning. */
export function bothServices(value: unknown): value is ["heating", "cooling"] {
  return (
    strings(value) &&
    value.length === 2 &&
    (value as string[]).includes("heating") &&
    (value as string[]).includes("cooling")
  );
}
export function canonicalNumber(value: number): number {
  return value === 0 ? 0 : value;
}

// ---------------------------------------------------------------------------
// Token validators (format only; producer remains external)
// ---------------------------------------------------------------------------
export const HEX64 = /^[0-9a-f]{64}$/;
function token(value: unknown, prefix: string): boolean {
  return (
    typeof value === "string" &&
    value.startsWith(prefix) &&
    value.length === prefix.length + 64 &&
    HEX64.test(value.slice(prefix.length))
  );
}
export function validLoadRevision(value: unknown): value is string {
  return token(value, "load:sha256:");
}
export function validEngineeringCatalogRevision(value: unknown): value is EngineeringCatalogStateRevision {
  return token(value, "engineering-catalog-state:sha256:");
}
export function validCommerceRevision(value: unknown): value is CommerceStateRevision {
  return token(value, "commerce-state:sha256:");
}

// ---------------------------------------------------------------------------
// Diagnostics (adapter vocabulary: fieldPath-bearing, canonical ordering)
// ---------------------------------------------------------------------------
export interface Diagnostics {
  blockingReasons: AdapterBlockingReason[];
  warnings: AdapterWarning[];
}

export interface BlockOpts {
  roomId?: string | null;
  service?: "HEATING" | "COOLING" | null;
  sourceReference?: string | null;
  message?: string;
}

export function block(d: Diagnostics, code: AdapterBlockingReasonCode, fieldPath: string, opts: BlockOpts = {}): void {
  d.blockingReasons.push({
    code,
    fieldPath,
    roomId: opts.roomId ?? null,
    service: opts.service ?? null,
    sourceReference: opts.sourceReference ?? null,
    message: opts.message ?? `${code}: ${fieldPath}`,
  });
}

export function warn(
  d: Diagnostics,
  code: AdapterWarningCode,
  fieldPath: string,
  message: string,
  sourceReference: string | null = null,
): void {
  d.warnings.push({ code, fieldPath, sourceReference, message });
}

function cmpNullable(a: string | null, b: string | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return compareCodePoints(a, b);
}

/**
 * CM10 diagnostics.ordering: deduplicate by (code,fieldPath,roomId,service,
 * sourceReference), sort by code index in ADAPTER_BLOCKING_REASON_CODES then
 * roomId, service, fieldPath, sourceReference (null before strings).
 */
export function orderedBlockers(rows: readonly AdapterBlockingReason[]): AdapterBlockingReason[] {
  const seen = new Set<string>();
  const out: AdapterBlockingReason[] = [];
  for (const r of rows) {
    const key = `${r.code}\u0000${r.fieldPath}\u0000${r.roomId ?? "\u0001"}\u0000${r.service ?? ""}\u0000${r.sourceReference ?? "\u0001"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  out.sort(
    (a, b) =>
      ADAPTER_BLOCKING_REASON_CODES.indexOf(a.code) - ADAPTER_BLOCKING_REASON_CODES.indexOf(b.code) ||
      cmpNullable(a.roomId, b.roomId) ||
      cmpNullable(a.service, b.service) ||
      compareCodePoints(a.fieldPath, b.fieldPath) ||
      cmpNullable(a.sourceReference, b.sourceReference),
  );
  return out;
}

export function orderedWarnings(rows: readonly AdapterWarning[]): AdapterWarning[] {
  const seen = new Set<string>();
  const out: AdapterWarning[] = [];
  for (const r of rows) {
    const key = `${r.code}\u0000${r.fieldPath}\u0000${r.sourceReference ?? "\u0001"}\u0000${r.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  out.sort(
    (a, b) =>
      ADAPTER_WARNING_CODES.indexOf(a.code) - ADAPTER_WARNING_CODES.indexOf(b.code) ||
      compareCodePoints(a.fieldPath, b.fieldPath) ||
      cmpNullable(a.sourceReference, b.sourceReference) ||
      compareCodePoints(a.message, b.message),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Structural deep equality (strict, array-order-sensitive, key-order-free)
//
// Used to compare the projected canonical load facts against the externally
// supplied loadRevisionReference.canonicalFacts (NOT to mint any token).
// ---------------------------------------------------------------------------
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    const ak = Object.keys(a as Record<string, unknown>);
    const bk = Object.keys(b as Record<string, unknown>);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!(k in (b as Record<string, unknown>))) return false;
      if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
    }
    return true;
  }
  return false;
}