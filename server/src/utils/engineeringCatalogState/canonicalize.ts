/**
 * ENGINEERING-CATALOG-CM15 — canonical JSON discipline.
 *
 * EXACT mirror of the CM14 canonicalization contract
 * (server/src/utils/buildingProjectLoadRevision.ts §7/§8/§9):
 *   - recursive object key ordering by Unicode code points (not localeCompare);
 *   - deterministic array ordering (arrays here are pre-sorted by their
 *     semantic identity in projection.ts; the emitter preserves that order);
 *   - explicit nulls preserved (null != 0, null != "", false != 0);
 *   - finite numbers only: NaN / +Infinity / -Infinity fail closed;
 *   - `-0` normalized to `0`; 1 and 1.0 are the same IEEE-754 double;
 *   - strings exact UTF-8; booleans preserved;
 *   - deterministic number serialization via Number.prototype.toString
 *     (JSON.stringify emission, no locale, no rounding);
 *   - SHA-256 over UTF-8, lowercase hex, no salt, no timestamp, no truncation.
 *
 * This module is PURE: no DB, no clock, no randomness, no imports beyond
 * node:crypto and the frozen vocabulary.
 */
import { createHash } from "node:crypto";
import {
  ENGINEERING_CATALOG_PREFIX,
  type EngineeringCatalogCanonicalFacts,
  type EngineeringCatalogStateRevision,
} from "./types.js";
import type { DeepReadonly } from "../buildingProjectConfiguratorAdapter/types.js";

/** Provider input error — carries a stable machine code (CM13/CM14 pattern). */
export class EngineeringCatalogStateInputError extends Error {
  readonly code: string;
  readonly fieldPath: string;

  constructor(code: string, fieldPath: string) {
    super(`engineering_catalog_state: ${code} at ${fieldPath}`);
    this.name = "EngineeringCatalogStateInputError";
    this.code = code;
    this.fieldPath = fieldPath;
  }
}

function fail(code: string, fieldPath: string): never {
  throw new EngineeringCatalogStateInputError(code, fieldPath);
}

/** Unicode code-point key comparator — NOT localeCompare (frozen CM14 rule). */
export function compareCodePoints(a: string, b: string): number {
  const aCode = Array.from(a).map((ch) => ch.codePointAt(0) ?? 0);
  const bCode = Array.from(b).map((ch) => ch.codePointAt(0) ?? 0);
  const n = Math.min(aCode.length, bCode.length);
  for (let i = 0; i < n; i++) {
    if (aCode[i] !== bCode[i]) return aCode[i] - bCode[i];
  }
  return aCode.length - bCode.length;
}

// ---------------------------------------------------------------------------
// Numeric canonicalization (frozen CM14 numeric identity)
// ---------------------------------------------------------------------------

/**
 * Gate every number before it may enter the canonical facts:
 * NaN / ±Infinity fail closed; `-0` -> `0`; no rounding.
 */
export function canonicalizeFiniteNumber(value: unknown, fieldPath: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) fail("catalog_state_number_nan", fieldPath);
  if (!Number.isFinite(value)) fail("catalog_state_number_infinite", fieldPath);
  return value === 0 ? 0 : value;
}

/**
 * Deep numeric gate + code-point key rebuild. RE-ASSIGNS normalized leaves
 * (the CM14-023 lesson: a visit-only walker can let `-0` survive).
 */
export function canonicalizeEngineeringCatalogFacts<T>(facts: T, fieldPath = "canonicalFacts"): T {
  if (typeof facts === "number") return canonicalizeFiniteNumber(facts, fieldPath) as unknown as T;
  if (facts === null || typeof facts !== "object") return facts;
  if (Array.isArray(facts)) {
    const out = facts as unknown[];
    for (let i = 0; i < out.length; i++) {
      out[i] = canonicalizeEngineeringCatalogFacts(out[i], `${fieldPath}[${i}]`);
    }
    return facts;
  }
  const source = facts as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    source[key] = canonicalizeEngineeringCatalogFacts(source[key], `${fieldPath}.${key}`);
  }
  return facts;
}

// ---------------------------------------------------------------------------
// Canonical JSON serialization
// ---------------------------------------------------------------------------

/**
 * Canonical JSON string for the projected engineering catalog state:
 * object keys sorted recursively by code points; arrays in their frozen
 * semantic (pre-sorted) order; explicit nulls; gated numbers.
 *
 * JSON.stringify is ONLY the emission format; ordering comes from the rebuilt
 * objects, so property insertion order cannot leak into the hash.
 */
export function serializeEngineeringCatalogFacts(facts: unknown): string {
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
// Hash
// ---------------------------------------------------------------------------

/**
 * SHA-256 over the UTF-8 canonical JSON of the canonical facts object.
 * Standard algorithm, no salt, no secret, no timestamp, lowercase hex,
 * 64 characters, frozen prefix.
 */
export function computeEngineeringCatalogStateRevision(
  canonicalFacts: DeepReadonly<EngineeringCatalogCanonicalFacts>,
): EngineeringCatalogStateRevision {
  const canonicalJson = serializeEngineeringCatalogFacts(canonicalFacts);
  const digest = createHash("sha256").update(canonicalJson, "utf8").digest("hex");
  if (!/^[0-9a-f]{64}$/.test(digest)) fail("catalog_state_digest_invalid", "digest");
  return `${ENGINEERING_CATALOG_PREFIX}${digest}` as const;
}
