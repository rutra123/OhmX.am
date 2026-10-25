"""Safety regression tests for the rollback SQL allowlist."""
import importlib.util
from pathlib import Path
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "engineering_product_data_rollback.py"
SPEC = importlib.util.spec_from_file_location("engineering_product_data_rollback", SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load rollback helper")
ROLLBACK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ROLLBACK)


class RollbackSqlAllowlistTests(unittest.TestCase):
    def test_accepts_exact_allowed_table(self):
        self.assertEqual(
            ROLLBACK.parse_dml("DELETE FROM engineering_value WHERE product_id = 'fixture';"),
            ["DELETE FROM engineering_value WHERE product_id = 'fixture'"],
        )

    def test_rejects_table_name_with_allowed_prefix(self):
        with self.assertRaisesRegex(ValueError, "non-whitelisted"):
            ROLLBACK.parse_dml("DELETE FROM engineering_value_archive;")

    def test_rejects_preserved_table(self):
        with self.assertRaisesRegex(ValueError, "non-whitelisted"):
            ROLLBACK.parse_dml("DELETE FROM engineering_product_profile;")


if __name__ == "__main__":
    unittest.main()