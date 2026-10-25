#!/usr/bin/env python3
"""Guarded EPD2C data-only rollback for an explicitly supplied isolated DB.

This helper requires explicit isolated and protected-production DB paths. It
refuses to run if the paths identify the same file. It strips transaction
wrappers from pure-DML rollback SQL, executes only exact-whitelisted engineering
table DELETEs inside BEGIN IMMEDIATE, validates postconditions before COMMIT,
and rolls back on every failure.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import re
import sqlite3
import sys
from pathlib import Path
from typing import Any

ROLLBACK_DELETE_TABLES = frozenset({
    "ENGINEERING_VALUE",
    "ENGINEERING_CONDITION_ENTRY",
    "ENGINEERING_CONDITION_SET",
    "ENGINEERING_SOURCE",
})
ENGINEERING_TABLES = [
    "engineering_equipment_type",
    "engineering_parameter",
    "engineering_condition_key",
    "engineering_source_type",
    "engineering_source",
    "engineering_product_profile",
    "engineering_condition_set",
    "engineering_condition_entry",
    "engineering_value",
]
ECOMMERCE_TABLES = [
    "products",
    "brands",
    "categories",
    "product_categories",
    "product_features",
    "product_attributes",
    "product_relationships",
    "relationship_rules",
]
VOCABULARY_TABLES = [
    "engineering_equipment_type",
    "engineering_parameter",
    "engineering_condition_key",
    "engineering_source_type",
]
TARGET_COUNTS = {
    "engineering_product_profile": 5,
    "engineering_source": 0,
    "engineering_condition_set": 0,
    "engineering_condition_entry": 0,
    "engineering_value": 0,
}


def qi(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def count(con: sqlite3.Connection, table: str) -> int:
    return int(con.execute(f"SELECT COUNT(*) FROM {qi(table)}").fetchone()[0])


def deterministic_hash(con: sqlite3.Connection, table: str) -> str:
    info = list(con.execute(f"PRAGMA table_info({qi(table)})"))
    names = [row[1] for row in info]
    primary = [row[1] for row in sorted((row for row in info if row[5]), key=lambda row: row[5])]
    order = primary or ["rowid"]
    select_order = ",".join(qi(name) for name in order)
    query = f"SELECT {','.join(qi(name) for name in names)} FROM {qi(table)} ORDER BY {select_order}"
    digest = hashlib.sha256()
    for row in con.execute(query):
        values: list[Any] = []
        for value in row:
            if isinstance(value, bytes):
                values.append({"__bytes__": base64.b64encode(value).decode("ascii")})
            else:
                values.append(value)
        digest.update(json.dumps(values, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def profile_snapshot(con: sqlite3.Connection) -> list[tuple[Any, ...]]:
    query = """SELECT product_id, equipment_type, series, model,
                      identity_status, data_completeness, source_verification,
                      schema_id, schema_version, created_at, updated_at
               FROM engineering_product_profile ORDER BY product_id"""
    return [tuple(row) for row in con.execute(query)]


def parse_dml(sql_text: str) -> list[str]:
    without_comments = "\n".join(line for line in sql_text.splitlines() if not line.strip().startswith("--"))
    statements = [re.sub(r"\s+", " ", part.strip()) for part in without_comments.split(";") if part.strip()]
    transaction_statements = {"BEGIN IMMEDIATE", "COMMIT"}
    rollback_statements = []
    for statement in statements:
        if statement.upper() in transaction_statements:
            continue
        match = re.fullmatch(
            r"DELETE\s+FROM\s+([A-Z_][A-Z0-9_]*)\s*(?:WHERE\s+.+)?",
            statement,
            re.IGNORECASE,
        )
        if match is None or match.group(1).upper() not in ROLLBACK_DELETE_TABLES:
            raise ValueError("rollback SQL contains a non-whitelisted statement or table")
        rollback_statements.append(statement)
    if not rollback_statements:
        raise ValueError("rollback SQL contains no whitelisted DELETE statements")
    if re.search(r"(?i)\b(DROP|UPDATE|INSERT|ALTER|VACUUM|ATTACH|DETACH)\b", without_comments):
        raise ValueError("rollback SQL contains a forbidden operation")
    if re.search(r"(?i)\b(products|brands|categories|orders|relationships|product_features|product_attributes)\b", without_comments):
        raise ValueError("rollback SQL references an ecommerce table")
    if re.search(r"(?i)\bengineering_product_profile\b|\bengineering_(equipment_type|parameter|condition_key|source_type)\b", without_comments):
        raise ValueError("rollback SQL would delete a preserved profile or vocabulary table")
    return rollback_statements


def main() -> int:
    parser = argparse.ArgumentParser(description="Guarded isolated EPD2C data-only rollback")
    parser.add_argument("--db", required=True, help="explicit isolated SQLite database path")
    parser.add_argument("--production-db", required=True, help="explicit protected production SQLite database path")
    parser.add_argument("--sql", required=True, help="explicit pure-DML data-only rollback SQL path")
    args = parser.parse_args()
    db_path = Path(args.db).expanduser().resolve()
    production_db_path = Path(args.production_db).expanduser().resolve()
    sql_path = Path(args.sql).expanduser().resolve()
    if not production_db_path.is_file():
        raise SystemExit("MISSING_PRODUCTION_DB: protected production DB path must exist")
    if not db_path.is_file():
        raise SystemExit("MISSING_DB: isolated database path must exist")
    if db_path.samefile(production_db_path):
        raise SystemExit("REFUSE_PRODUCTION_DB: isolated DB resolves to the protected production DB")
    if not sql_path.is_file():
        raise SystemExit(f"MISSING_SQL:{sql_path}")

    statements = parse_dml(sql_path.read_text(encoding="utf-8"))
    con = sqlite3.connect(db_path, timeout=30)
    con.execute("PRAGMA foreign_keys=ON")
    try:
        before_counts = {table: count(con, table) for table in ENGINEERING_TABLES}
        before_profiles = profile_snapshot(con)
        before_vocab_hashes = {table: deterministic_hash(con, table) for table in VOCABULARY_TABLES}
        before_ecommerce_counts = {table: count(con, table) for table in ECOMMERCE_TABLES}
        before_ecommerce_hashes = {
            table: deterministic_hash(con, table)
            for table in ("products", "product_features", "product_attributes")
        }
        expected_pre = {
            "engineering_product_profile": 5,
            "engineering_source": 2,
            "engineering_condition_set": 3,
            "engineering_condition_entry": 13,
            "engineering_value": 22,
        }
        if any(before_counts.get(table) != expected for table, expected in expected_pre.items()):
            raise RuntimeError(f"unexpected prestate: {before_counts}")

        con.execute("BEGIN IMMEDIATE")
        for statement in statements:
            con.execute(statement)

        after_counts = {table: count(con, table) for table in TARGET_COUNTS}
        after_profiles = profile_snapshot(con)
        after_vocab_hashes = {table: deterministic_hash(con, table) for table in VOCABULARY_TABLES}
        after_ecommerce_counts = {table: count(con, table) for table in ECOMMERCE_TABLES}
        after_ecommerce_hashes = {
            table: deterministic_hash(con, table)
            for table in ("products", "product_features", "product_attributes")
        }
        foreign_key_violations = list(con.execute("PRAGMA foreign_key_check"))
        integrity = str(con.execute("PRAGMA integrity_check").fetchone()[0])
        exact_target = after_counts == TARGET_COUNTS
        preserved = (
            after_profiles == before_profiles
            and after_vocab_hashes == before_vocab_hashes
            and after_ecommerce_counts == before_ecommerce_counts
            and after_ecommerce_hashes == before_ecommerce_hashes
        )
        if not exact_target or foreign_key_violations or integrity != "ok" or not preserved:
            con.execute("ROLLBACK")
            result = {
                "status": "ROLLBACK_POSTCONDITION_FAILURE",
                "committed": False,
                "before_counts": before_counts,
                "failed_after_counts": after_counts,
                "foreign_key_violations": len(foreign_key_violations),
                "integrity_check": integrity,
                "preserved": preserved,
            }
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 2

        con.execute("COMMIT")
        checkpoint = list(con.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone())
        con.close()

        verify = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        verify.execute("PRAGMA foreign_keys=ON")
        committed_counts = {table: count(verify, table) for table in TARGET_COUNTS}
        committed_fk = len(list(verify.execute("PRAGMA foreign_key_check")))
        committed_integrity = str(verify.execute("PRAGMA integrity_check").fetchone()[0])
        verify.close()
        if committed_counts != TARGET_COUNTS or committed_fk != 0 or committed_integrity != "ok":
            raise SystemExit("COMMITTED_POSTCHECK_FAILURE")
        print(json.dumps({
            "status": "COMMITTED_EXACT_DATA_ONLY_ROLLBACK",
            "committed": True,
            "db": str(db_path),
            "sql": str(sql_path),
            "before_counts": before_counts,
            "after_counts": committed_counts,
            "foreign_key_violations": committed_fk,
            "integrity_check": committed_integrity,
            "preserved_profiles_vocabularies_ecommerce": preserved,
            "checkpoint": checkpoint,
        }, ensure_ascii=False, indent=2))
        return 0
    except BaseException:
        try:
            con.execute("ROLLBACK")
        except sqlite3.Error:
            pass
        con.close()
        raise


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, sqlite3.Error) as exc:
        print(json.dumps({"status": "ROLLBACK_ABORTED", "committed": False, "error": str(exc)}, ensure_ascii=False, indent=2), file=sys.stderr)
        raise SystemExit(2)
