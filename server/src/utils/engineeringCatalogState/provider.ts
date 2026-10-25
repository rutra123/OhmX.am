/**
 * ENGINEERING-CATALOG-CM15 — provider implementation.
 *
 * Implements the CM12 §18 frozen provider concept:
 *   EngineeringCatalogStateProvider.getCurrentState() ->
 *     { status, revision, algorithmVersion, policyVersion, warnings, errors }
 *
 * against the frozen CM11 reference vocabulary (types.ts of
 * buildingProjectConfiguratorAdapter):
 *   EngineeringCatalogStateReference:
 *     AVAILABLE   — revision + generatedFromPolicy{Id,Version} + scope +
 *                   readConsistency COMPLETE_COHERENT_SNAPSHOT + warnings
 *     UNAVAILABLE — null revision + diagnostics (fail closed; never a fake
 *                   revision)
 *
 * The returned object is EXACTLY the frozen EngineeringCatalogStateReference
 * shape — the provider adds no extra fields to it, so CM11 validation can
 * accept it verbatim (phase §24). The canonical facts / canonical JSON used
 * for the hash are exposed separately (readCanonicalFacts /
 * describeCanonicalJson) for tests and traceability, mirroring how the CM14
 * producer exposes canonicalFacts on its own reference.
 *
 * COHERENT READ MECHANISM (phase §22):
 *   The provider opens the catalog DB with better-sqlite3 in
 *   { readonly: true, fileMustExist: true } mode and sets `query_only = ON`
 *   (driver-level read-only open; belt-and-suspenders pragma). All projection
 *   queries then run inside ONE deferred read transaction (BEGIN DEFERRED ..
 *   COMMIT). better-sqlite3 is synchronous, so the multi-query fingerprint is
 *   computed over a single WAL snapshot with no interleaved write. Every
 *   statement is a SELECT; no INSERT/UPDATE/DELETE/ALTER/DROP/CREATE/
 *   VACUUM/REINDEX; no identity-bearing PRAGMA. A read-only connection never
 *   writes the database file.
 *
 * IDENTITY RULES (phase §9/§17/§18):
 *   The revision is SHA-256 over the canonical JSON of the semantic facts
 *   only. No DB file hash, no file size, no mtime, no inode, no page layout,
 *   no WAL position, no PRAGMA data_version, no rowid, no sequence counters,
 *   no clock, no randomness, no salt, no timestamp anywhere in the input.
 */
import fs from "node:fs";
import Database from "better-sqlite3";
import { resolveProjectPath } from "../../paths.js";
import {
  ENGINEERING_CATALOG_ALGORITHM_VERSION,
  ENGINEERING_CATALOG_SCOPE_EQUIPMENT_TYPES,
  type DeepReadonly,
  type EngineeringCatalogStateReference,
  type ProviderDiagnostic,
} from "../buildingProjectConfiguratorAdapter/types.js";
import {
  ENGINEERING_CATALOG_STATE_PROJECTION_VERSION,
  ENGINEERING_CATALOG_STATE_DOMAIN,
  type EngineeringCatalogCanonicalFacts,
  type EngineeringCatalogStateDbHandle,
} from "./types.js";
import { computeEngineeringCatalogStateRevision } from "./canonicalize.js";
import { projectEngineeringCatalogFacts } from "./projection.js";
import { serializeEngineeringCatalogFacts } from "./canonicalize.js";

/** Diagnostic code vocabulary for the UNAVAILABLE state (frozen, stable). */
export const ENGINEERING_CATALOG_STATE_PROVIDER_ERROR_CODES = [
  "catalog_state_db_open_failed",
  "catalog_state_projection_failed",
  "catalog_state_canonicalization_failed",
  "catalog_state_digest_failed",
] as const;
export type EngineeringCatalogStateProviderErrorCode =
  (typeof ENGINEERING_CATALOG_STATE_PROVIDER_ERROR_CODES)[number];

/**
 * Default production database path — the same DB_PATH resolution semantics
 * as the CM6 route and the application db helper: env DB_PATH resolved
 * against the project root (repo root), never the server/ cwd.
 */
export function resolveEngineeringCatalogDatabasePath(): string {
  const configured =
    String(process.env.DB_PATH || "./data/electro.db").trim() || "./data/electro.db";
  return resolveProjectPath(configured);
}

/**
 * Read-only SQL gate. Mirrors the CM4 MatcherWriteError discipline: only
 * SELECT/WITH statements pass. (better-sqlite3 readonly open + query_only
 * already refuse writes; this guard is defense in depth at the SQL layer.)
 */
const PROVIDER_SELECT_ONLY = /^\s*(SELECT|WITH)\b/i;

export function assertProviderSqlIsReadOnly(sql: string): void {
  if (!PROVIDER_SELECT_ONLY.test(sql)) {
    throw new Error(
      `engineering catalog state provider refused non-SELECT SQL: ${sql.trim().slice(0, 120)}`,
    );
  }
}

/**
 * exec() may carry ONLY transaction-control statements — the coherent-read
 * envelope. Anything else (in particular any write) is refused.
 */
const PROVIDER_TRANSACTION_ONLY = /^\s*(BEGIN|COMMIT|ROLLBACK)\b/i;

export function assertProviderTransactionSql(sql: string): void {
  if (!PROVIDER_TRANSACTION_ONLY.test(sql)) {
    throw new Error(
      `engineering catalog state provider refused non-transaction exec SQL: ${sql.trim().slice(0, 120)}`,
    );
  }
}

/**
 * Narrow read-only view over a better-sqlite3 connection: only
 * prepare(...).all(...) is exposed and every statement is SELECT-gated.
 */
class ReadOnlyDbHandle {
  private readonly db: Database.Database;

  private constructor(db: Database.Database) {
    this.db = db;
  }

  static open(filePath: string): ReadOnlyDbHandle {
    const db = new Database(filePath, { readonly: true, fileMustExist: true });
    db.pragma("query_only = ON");
    return new ReadOnlyDbHandle(db);
  }

  prepare(sql: string): { all(...params: unknown[]): unknown[] } {
    assertProviderSqlIsReadOnly(sql);
    return this.db.prepare(sql);
  }

  exec(sql: string): void {
    assertProviderTransactionSql(sql);
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }
}

export interface EngineeringCatalogStateProviderOptions {
  /** Explicit DB handle (tests use in-memory doubles). Overrides databasePath. */
  db?: EngineeringCatalogStateDbHandle;
  /** Explicit production DB file path (opened READ-ONLY). */
  databasePath?: string;
}

/**
 * Run `body` inside a single coherent read snapshot: BEGIN DEFERRED, run all
 * projection SELECTs, COMMIT. On any failure the transaction is ROLLBACK
 * (a rollback of a read-only transaction writes nothing).
 */
function withCoherentRead<T>(db: EngineeringCatalogStateDbHandle, body: () => T): T {
  const runTransaction = (sql: string): void => {
    db.exec(sql);
  };
  runTransaction("BEGIN DEFERRED");
  try {
    const result = body();
    runTransaction("COMMIT");
    return result;
  } catch (err) {
    try {
      runTransaction("ROLLBACK");
    } catch {
      // snapshot already gone; the original error is the meaningful one
    }
    throw err;
  }
}

function toDiagnosticCode(err: unknown): string {
  if (
    err &&
    typeof err === "object" &&
    typeof (err as { code?: unknown }).code === "string" &&
    (err as { code: string }).code.startsWith("catalog_state_")
  ) {
    return (err as { code: string }).code;
  }
  return "catalog_state_projection_failed";
}

export class EngineeringCatalogStateProvider {
  private readonly options: EngineeringCatalogStateProviderOptions;

  constructor(options: EngineeringCatalogStateProviderOptions = {}) {
    this.options = options;
  }

  /**
   * CM12 §18 provider entry point. Returns the frozen AVAILABLE / UNAVAILABLE
   * reference; never throws for expected catalog-state problems (fail closed
   * with diagnostics instead). Unexpected errors also land in UNAVAILABLE
   * with a stable diagnostic — the provider never fabricates a revision and
   * never leaks a partial one.
   */
  async getCurrentState(): Promise<DeepReadonly<EngineeringCatalogStateReference>> {
    try {
      const facts = this.readCanonicalFacts();
      const revision = computeEngineeringCatalogStateRevision(facts);
      const reference: EngineeringCatalogStateReference = {
        status: "AVAILABLE",
        revision,
        generatedFromPolicyId: "ohmx.engineering-configurator.heat-pump-fan-coil.v1",
        generatedFromPolicyVersion: "1.1.0",
        algorithmVersion: ENGINEERING_CATALOG_ALGORITHM_VERSION,
        scopeEquipmentTypes: ENGINEERING_CATALOG_SCOPE_EQUIPMENT_TYPES,
        readConsistency: "COMPLETE_COHERENT_SNAPSHOT",
        warnings: [],
        errors: [],
      };
      return reference;
    } catch (err) {
      const reference: EngineeringCatalogStateReference = {
        status: "UNAVAILABLE",
        revision: null,
        generatedFromPolicyId: null,
        generatedFromPolicyVersion: null,
        algorithmVersion: null,
        scopeEquipmentTypes: [],
        readConsistency: "UNAVAILABLE",
        warnings: [],
        errors: [
          {
            code: toDiagnosticCode(err),
            sourceReference: null,
            message: err instanceof Error ? err.message : String(err),
          } satisfies ProviderDiagnostic,
        ],
      };
      return reference;
    }
  }

  /** Frozen CM11 caller-owned provider interface (identical to getCurrentState). */
  async getCurrentReference(): Promise<DeepReadonly<EngineeringCatalogStateReference>> {
    return this.getCurrentState();
  }

  /**
   * Synchronous read path (used by tests for parity checks and by
   * getCurrentState internally). Opens the DB read-only if needed, reads ONE
   * coherent snapshot, closes an internally-opened handle.
   */
  readCanonicalFacts(): DeepReadonly<EngineeringCatalogCanonicalFacts> {
    if (this.options.db) {
      return withCoherentRead(this.options.db, () =>
        projectEngineeringCatalogFacts(this.options.db as EngineeringCatalogStateDbHandle),
      );
    }
    const databasePath = this.options.databasePath ?? resolveEngineeringCatalogDatabasePath();
    if (!fs.existsSync(databasePath)) {
      const err = new Error(`engineering catalog database not found: ${databasePath}`);
      (err as { code?: string }).code = "catalog_state_db_open_failed";
      throw err;
    }
    let handle: ReadOnlyDbHandle | null = null;
    try {
      handle = ReadOnlyDbHandle.open(databasePath);
      return withCoherentRead(
        handle as unknown as EngineeringCatalogStateDbHandle,
        () => projectEngineeringCatalogFacts(handle as unknown as EngineeringCatalogStateDbHandle),
      );
    } finally {
      if (handle != null) {
        try {
          handle.close();
        } catch {
          // close failure must not mask the read result
        }
      }
    }
  }

  /**
   * The exact canonical JSON string whose SHA-256 is the revision — the
   * deterministic trace of what entered the hash. Pure: no DB access.
   */
  describeCanonicalJson(
    facts: DeepReadonly<EngineeringCatalogCanonicalFacts>,
  ): string {
    return serializeEngineeringCatalogFacts(facts);
  }
}
