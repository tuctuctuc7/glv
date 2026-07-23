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
        self.assertAlmostEqual(reconciliation["cross_family_ratio"], 0.18369349963520135)
        self.assertEqual(reconciliation["regional_purchase_family"], "onsite_conversion.purchase")
        self.assertFalse(reconciliation["cross_family_ratio_is_reconciliation"])
        self.assertGreater(reconciliation["mapped_spend_coverage"], 0.999)
        self.assertLess(reconciliation["mapped_spend_coverage"], 1)

    def test_reproducibility_metadata_is_versioned(self):
        self.assertEqual(self.payload["meta"]["model_version"], "elmich-value-sensitivity-v1.0.0")
        self.assertRegex(self.payload["meta"]["input_sha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(self.payload["meta"]["logic_sha256"], r"^[0-9a-f]{64}$")
        self.assertEqual(self.payload["methodology"]["neighbor_days"], 7)

    def test_public_contract_uses_aggregated_groups_without_names_or_ids(self):
        self.assertGreater(len(self.payload["campaign_groups"]), 0)
        self.assertGreater(len(self.payload["campaign_cells"]), 0)
        self.assertGreater(len(self.payload["growth_levers"]), 0)
        self.assertGreater(len(self.payload["creative_formats"]), 0)
        self.assertEqual(self.payload["detail_coverage"]["campaign_months"], 24)
        self.assertIn("campaign_cell_method", self.payload["detail_coverage"])
        self.assertEqual(self.payload["detail_coverage"]["creative_months_by_account"]["Gia Dụng"], 24)
        self.assertEqual(self.payload["detail_coverage"]["creative_months_by_account"]["Điện gia dụng"], 15)
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
        forbidden_fragments = ("campaign_name", "campaign_id", "ad_name", "adset", "ad_set", "ad_id", "account_id", "token", "secret", "password", "email")
        self.assertFalse(any(fragment in key.lower() for key in keys for fragment in forbidden_fragments))
        self.assertNotIn("FB|Ecom|", serialized)
        self.assertNotIn("Tú", serialized)
        self.assertNotIn("Thảo", serialized)
        self.assertIsNone(re.search(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", serialized))
        self.assertIsNone(re.search(r'"(?:act_)?\d{12,}"', serialized))
        self.assertEqual(json.loads(serialized)["meta"]["title"], "ELM Meta Ads")

    def test_name_classifiers_are_deterministic(self):
        self.assertEqual(EXPORTER.campaign_group("FB|Ecom|BAU|A4|Pros|Purchase|Product"), "BAU · Product")
        self.assertEqual(EXPORTER.campaign_group("FB|Ecom|A4|Retarget|Purchase"), "Retargeting")
        self.assertEqual(EXPORTER.creative_format("13|Video|Feature"), "Video")
        self.assertEqual(EXPORTER.creative_format("13|Single Image|Promotion"), "Banner / single image")

    def test_detail_spend_reconciles_to_account_months(self):
        account_months = {}
        for row in self.payload["account_daily"]:
            key = (row["date"][:7], row["account"])
            account_months[key] = account_months.get(key, 0) + row["spend"]

        for detail_key in ("campaign_groups", "creative_formats"):
            detail_months = {}
            for row in self.payload[detail_key]:
                key = (row["month"], row["account"])
                detail_months[key] = detail_months.get(key, 0) + row["spend"]
            self.assertGreater(len(detail_months), 0)
            for key, spend in detail_months.items():
                self.assertAlmostEqual(spend, account_months[key], places=6, msg=f"{detail_key} {key}")

    def test_monthly_sections_expose_metric_selectors(self):
        html = (ROOT / "public" / "elm-meta-ads" / "index.html").read_text(encoding="utf-8")
        for selector_id in ("growthMetric", "efficiencyMetric", "accountMetric", "intramonthMetric"):
            self.assertIn(f'id="{selector_id}"', html)
        self.assertGreaterEqual(html.count('<option value="modelled_purchase_value">'), 4)


if __name__ == "__main__":
    unittest.main()
