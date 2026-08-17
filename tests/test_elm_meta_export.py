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
        self.assertGreater(len(self.payload["account_category_scope"]), 0)
        self.assertGreater(len(self.payload["seasonality_cells"]), 0)
        self.assertGreater(len(self.payload["creative_formats"]), 0)
        self.assertGreater(len(self.payload["structure_groups"]), 0)
        self.assertEqual(self.payload["detail_coverage"]["campaign_months"], 24)
        self.assertIn("campaign_cell_method", self.payload["detail_coverage"])
        self.assertIn("category_scope_method", self.payload["detail_coverage"])
        self.assertIn("structure_method", self.payload["detail_coverage"])
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
        for selector_id in ("growthMetric", "growthMetricRight", "accountMetric", "intramonthMetric", "intramonthMetricRight", "regionMetric"):
            selector = re.search(rf'<select id="{selector_id}">(.*?)</select>', html, re.DOTALL)
            if selector is None:
                self.fail(f"Missing selector {selector_id}")
        for selector_id in ("modelled_roasLeft", "modelled_roasRight", "cost_per_purchaseLeft", "cost_per_purchaseRight", "purchase_cvrLeft", "purchase_cvrRight", "modelled_aovLeft", "modelled_aovRight"):
            self.assertIn(f'id="{selector_id}"', html)
        for table_id in ("growthTable", "efficiencyTable", "accountMonthTable", "intramonthTable", "categoryScopeTable", "seasonalityTable", "structureTable", "regionMonthlyTable"):
            self.assertIn(f'id="{table_id}"', html)

    def test_dashboard_exposes_persisted_light_and_dark_themes(self):
        route = ROOT / "public" / "elm-meta-ads"
        html = (route / "index.html").read_text(encoding="utf-8")
        css = (route / "styles.css").read_text(encoding="utf-8")
        app = (route / "app.js").read_text(encoding="utf-8")

        self.assertIn('id="themeToggle"', html)
        self.assertIn('aria-label="Bright theme"', html)
        self.assertIn('aria-pressed="false"', html)
        self.assertIn('class="theme-toggle-icon" aria-hidden="true">☾</span>', html)
        self.assertNotIn('theme-toggle-label', html)
        self.assertLess(html.index("elm-meta-theme"), html.index('rel="stylesheet"'))
        self.assertIn(':root[data-theme="light"]', css)
        self.assertIn('color-scheme: light', css)
        self.assertIn("function applyTheme", app)
        self.assertIn("localStorage.setItem(THEME_STORAGE_KEY", app)
        self.assertIn("isLight ? '☀' : '☾'", app)
        self.assertIn("document.getElementById('themeToggle').addEventListener('click'", app)
        self.assertNotIn("Switch to ${", app)
        self.assertIn("--focus-ring:", css)
        self.assertIn("--button-ink:", css)

    def test_dashboard_exposes_persisted_english_and_vietnamese_languages(self):
        route = ROOT / "public" / "elm-meta-ads"
        html = (route / "index.html").read_text(encoding="utf-8")
        app = (route / "app.js").read_text(encoding="utf-8")

        self.assertIn('id="languageToggle"', html)
        self.assertIn('aria-label="Switch to Vietnamese"', html)
        self.assertIn('class="language-toggle-icon" aria-hidden="true">🇻🇳</span>', html)
        self.assertLess(html.index("elm-meta-language"), html.index('rel="stylesheet"'))
        self.assertIn("const LANGUAGE_STORAGE_KEY = 'elm-meta-language'", app)
        self.assertIn("function applyLanguage", app)
        self.assertIn("localStorage.setItem(LANGUAGE_STORAGE_KEY", app)
        self.assertIn("document.getElementById('languageToggle').addEventListener('click'", app)
        self.assertIn("Theo dõi biến động tháng.", app)
        self.assertIn("Tìm nguyên nhân.", app)
        self.assertNotIn("Sau đó tìm yếu tố tạo ra biến động.", app)
        self.assertIn("Xuất CSV theo bộ lọc", app)
        self.assertIn("ROAS định hướng", app)

    def test_dashboard_exposes_privacy_safe_campaign_longevity_evidence(self):
        route = ROOT / "public" / "elm-meta-ads"
        html = (route / "index.html").read_text(encoding="utf-8")
        app = (route / "app.js").read_text(encoding="utf-8")

        self.assertIn('id="campaignLongevityChart"', html)
        self.assertIn('id="campaignLongevityEvidence"', html)
        self.assertIn('id="campaignLongevityTable"', html)
        self.assertIn("04C / Campaign longevity", html)
        self.assertIn("Campaigns run in short flights", html)
        self.assertIn("const CAMPAIGN_LONGEVITY =", app)
        self.assertIn("campaigns: 1148", app)
        self.assertIn("meanActiveDays: 17.38850174216028", app)
        self.assertIn("medianActiveDays: 5", app)
        self.assertIn("campaigns: 547, meanActiveDays: 18.97074954296161, medianActiveDays: 6", app)
        self.assertIn("campaigns: 601, meanActiveDays: 15.948419301164725, medianActiveDays: 5", app)
        self.assertIn("shareWithin7Days: 0.6010452961672473", app)
        self.assertIn("shareWithin14Days: 0.7447735191637631", app)
        self.assertIn("shareWithin30Days: 0.8527874564459931", app)
        self.assertIn("startFirstWeek: 0.2691637630662021", app)
        self.assertIn("endLastWeek: 0.18292682926829268", app)
        self.assertIn("uniformCalendarBaseline: 0.22947950620059196", app)
        longevity_block = re.search(r"const CAMPAIGN_LONGEVITY = (\{.*?\n\});", app, re.DOTALL)
        self.assertIsNotNone(longevity_block)
        longevity_source = longevity_block.group(1) if longevity_block else ""
        self.assertEqual(
            sorted(re.findall(r"(?:\{|,)\s*([A-Za-z]\w*):", longevity_source)),
            sorted([
                "window", "since", "until", "combined", "accounts",
                "label", "label", "label",
                "campaigns", "campaigns", "campaigns",
                "meanActiveDays", "meanActiveDays", "meanActiveDays",
                "medianActiveDays", "medianActiveDays", "medianActiveDays",
                "shareWithin7Days", "shareWithin14Days", "shareWithin30Days",
                "startFirstWeek", "endLastWeek", "uniformCalendarBaseline",
            ]),
        )
        self.assertIn("function renderCampaignLongevity", app)
        self.assertIn("Campaigns marked active or delivering in the final 14 days were excluded.", html)
        self.assertIn("It is not a proven permanent-closure cohort: paused campaigns may resume later.", html)
        self.assertIn("of the observational sample", app)
        self.assertIn("had no more than 30 observed active days", app)
        self.assertNotIn("of completed campaigns", app)
        self.assertNotIn("ended within 30 active days", app)
        self.assertIn("had their last observed delivery in the final seven days", app)
        self.assertIn("có lần phân phối quan sát cuối cùng trong bảy ngày cuối tháng", app)
        self.assertNotIn("ended in the final seven days", app)
        self.assertNotIn("kết thúc trong bảy ngày cuối tháng", app)
        self.assertIn("Promotion calendar aligned to campaign starts and stops.", html)
        self.assertNotIn("Campaign-day extraction to attribute intra-month spikes.", html)


if __name__ == "__main__":
    unittest.main()
