import importlib.util
import json
import re
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("elm_dashboard_export", ROOT / "export_elm_meta_dashboard.py")
if not SPEC or not SPEC.loader:
    raise RuntimeError("Unable to load the ELM dashboard exporter")
EXPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXPORTER)


class ElmMetaExportTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory(prefix="elm-dashboard-test-")
        cls.output = Path(cls.temp_dir.name) / "elm_meta_ads.json"
        cls.payload = EXPORTER.export(EXPORTER.DEFAULT_AUDIT_ROOT, cls.output)

    @classmethod
    def tearDownClass(cls):
        cls.temp_dir.cleanup()

    def test_contract_matches_audited_anomaly_result(self):
        self.assertEqual(len(self.payload["account_daily"]), 1460)
        self.assertEqual(len(self.payload["anomalies"]), 26)
        self.assertAlmostEqual(self.payload["summary"]["modelled_roas"], 3.5464695928103254)
        self.assertEqual(self.payload["methodology"]["replacement"], "local median AOV × actual purchases")

    def test_reconciliation_is_derived_and_precise(self):
        reconciliation = self.payload["reconciliation"]
        self.assertAlmostEqual(reconciliation["regional_purchase_coverage"], 0.18369349963520135)
        self.assertAlmostEqual(reconciliation["regional_value_coverage"], 0.009982186484889832)
        self.assertGreater(reconciliation["mapped_spend_coverage"], 0.999)
        self.assertLess(reconciliation["mapped_spend_coverage"], 1)

    def test_public_contract_omits_campaign_names_and_ids(self):
        self.assertNotIn("campaigns", self.payload)
        serialized = self.output.read_text(encoding="utf-8")
        keys = set()

        def collect_keys(value):
            if isinstance(value, dict):
                keys.update(value)
                for child in value.values():
                    collect_keys(child)
            elif isinstance(value, list):
                for child in value:
                    collect_keys(child)

        collect_keys(self.payload)
        forbidden_fragments = ("campaign", "adset", "ad_set", "ad_id", "account_id", "token", "secret", "password", "email")
        self.assertFalse(any(fragment in key.lower() for key in keys for fragment in forbidden_fragments))
        self.assertIsNone(re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", serialized))
        self.assertIsNone(re.search(r'"(?:act_)?\d{12,}"', serialized))
        self.assertEqual(json.loads(serialized)["meta"]["title"], "ELM Meta Ads")


if __name__ == "__main__":
    unittest.main()
