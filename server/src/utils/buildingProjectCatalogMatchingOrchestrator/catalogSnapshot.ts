/** CM17 coherent read session: CM15 revision and Matcher share one SQLite snapshot. */
import {
  matchCatalogProducts,
  openCatalogMatcherDatabase,
} from "../catalogMatcher/index.js";
import {
  assertProviderTransactionSql,
  computeEngineeringCatalogStateRevision,
  projectEngineeringCatalogFacts,
  resolveEngineeringCatalogDatabasePath,
} from "../engineeringCatalogState/index.js";
import type {
  CatalogMatchingSnapshotProvider,
  CatalogMatchingSnapshotSession,
} from "./types.js";

export class SqliteCatalogMatchingSnapshotProvider implements CatalogMatchingSnapshotProvider {
  constructor(private readonly databasePath = resolveEngineeringCatalogDatabasePath()) {}

  openSession(): CatalogMatchingSnapshotSession {
    const db = openCatalogMatcherDatabase(this.databasePath);
    let active = false;
    try {
      assertProviderTransactionSql("BEGIN DEFERRED");
      db.exec("BEGIN DEFERRED");
      active = true;
      const facts = projectEngineeringCatalogFacts(db);
      const revision = computeEngineeringCatalogStateRevision(facts);

      const finish = (sql: "COMMIT" | "ROLLBACK") => {
        if (!active) return;
        active = false;
        try {
          assertProviderTransactionSql(sql);
          db.exec(sql);
        } finally {
          db.close();
        }
      };

      return {
        revision,
        match(request) {
          if (!active) {
            return {
              ok: false,
              kind: "MATCHER_INTERNAL_ERROR",
              error: { message: "Catalog matching snapshot session is closed.", cause: null },
            };
          }
          return matchCatalogProducts(request, { db });
        },
        commit() { finish("COMMIT"); },
        rollback() { finish("ROLLBACK"); },
      };
    } catch (err) {
      if (active) {
        try { db.exec("ROLLBACK"); } catch { /* preserve original error */ }
      }
      try { db.close(); } catch { /* preserve original error */ }
      throw err;
    }
  }
}
