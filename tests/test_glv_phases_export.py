import datetime as dt
import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("export_glv_dashboard", ROOT / "export_glv_dashboard.py")
assert SPEC is not None and SPEC.loader is not None
EXPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXPORTER)


class GlvPhaseExporterTest(unittest.TestCase):
    def test_parse_phase_records_normalizes_the_schedule_contract(self):
        records = [{
            "Start date": "06/02/2026",
            "End date": "14/02/2026",
            "Phase": "promo",
            "Label": "Promo acquisition",
            "Influencer": "",
            "Notes": "window",
        }]
        self.assertEqual(EXPORTER.parse_phase_records(records), [{
            "start_date": "2026-02-06",
            "end_date": "2026-02-14",
            "phase": "Promo",
            "label": "Promo acquisition",
            "influencer": "",
        }])

    def test_build_payload_exports_influ_attribution_absolutes_and_phase_schedule(self):
        daily = [{
            "Date": "2026-02-19",
            "Region": "CZSK",
            "Revenue ($)": "200",
            "Ad spend ($)": "40",
            "Revenue INFLU ($)": "120",
            "Ad spend Influ ($)": "10",
            "Orders": "2",
            "Unique visitors": "20",
            "New customers": "1",
            "Returning customers": "1",
            "New customers revenue ($)": "100",
        }]
        schedule = [{
            "Start date": "2026-02-19",
            "End date": "2026-02-22",
            "Phase": "Influ",
            "Label": "Influ",
            "Influencer": "Kristyna",
            "Notes": "",
        }]
        payload = EXPORTER.build_payload(daily, schedule, now=dt.datetime(2026, 2, 23, tzinfo=dt.UTC))
        self.assertEqual(payload["rows"][0]["influ_revenue"], 120)
        self.assertEqual(payload["rows"][0]["influ_commission"], 10)
        self.assertEqual(payload["phases"][0]["influencer"], "Kristyna")
        self.assertEqual(payload["phase_absolute_metrics"], ["influ_revenue", "influ_commission"])
        self.assertEqual(payload["phase_contract"]["historical_start"], "2026-02-01")
        self.assertEqual(payload["source"]["phases_tab"], "Phases")
        self.assertNotIn("sheet_id", payload["source"])
        self.assertNotIn("notes", payload["phases"][0])

    def test_public_phase_schedule_omits_private_notes_and_rejects_unsafe_display_text(self):
        schedule = [{
            "Start date": "2026-02-19",
            "End date": "2026-02-22",
            "Phase": "Influ",
            "Label": "Influ",
            "Influencer": "Approved display name",
            "Notes": "private operational detail",
        }]
        [window] = EXPORTER.parse_phase_records(schedule)
        self.assertNotIn("notes", window)
        self.assertEqual(window["influencer"], "Approved display name")

        schedule[0]["Label"] = "Unsafe\nlabel"
        with self.assertRaisesRegex(ValueError, "public Label"):
            EXPORTER.parse_phase_records(schedule)

    def test_build_payload_rejects_missing_phase_schedule(self):
        with self.assertRaisesRegex(ValueError, "Phases"):
            EXPORTER.build_payload([], [], now=dt.datetime(2026, 2, 23, tzinfo=dt.UTC))

    def test_build_payload_rejects_promo_influ_overlap(self):
        schedule = [
            {"Start date": "2026-02-06", "End date": "2026-02-14", "Phase": "Promo"},
            {"Start date": "2026-02-14", "End date": "2026-02-20", "Phase": "Influ"},
        ]
        with self.assertRaisesRegex(ValueError, "Promo and Influ overlap on 2026-02-14"):
            EXPORTER.build_payload([], schedule, now=dt.datetime(2026, 2, 23, tzinfo=dt.UTC))

    def test_build_payload_rejects_code_revenue_above_total_revenue(self):
        daily = [{
            "Date": "2026-02-19",
            "Region": "CZSK",
            "Revenue ($)": "5",
            "Revenue INFLU ($)": "6",
        }]
        schedule = [{
            "Start date": "2026-02-19",
            "End date": "2026-02-22",
            "Phase": "Influ",
        }]
        with self.assertRaisesRegex(ValueError, "(?i)code revenue exceeds total revenue.*2026-02-19"):
            EXPORTER.build_payload(daily, schedule, now=dt.datetime(2026, 2, 23, tzinfo=dt.UTC))

    def test_build_payload_rejects_invalid_phase_absolute_metrics(self):
        schedule = [{
            "Start date": "2026-02-19",
            "End date": "2026-02-22",
            "Phase": "Influ",
        }]
        invalid_values = (
            ("Revenue INFLU ($)", -1, "influ revenue"),
            ("Ad spend Influ ($)", -1, "influ commission"),
            ("Revenue INFLU ($)", float("nan"), "influ revenue"),
            ("Ad spend Influ ($)", float("inf"), "influ commission"),
        )
        for field, value, error_label in invalid_values:
            with self.subTest(field=field, value=value):
                daily = [{
                    "Date": "2026-02-19",
                    "Region": "CZSK",
                    "Revenue ($)": "5",
                    field: value,
                }]
                with self.assertRaisesRegex(ValueError, rf"(?i){error_label}.*non-negative finite.*2026-02-19"):
                    EXPORTER.build_payload(daily, schedule, now=dt.datetime(2026, 2, 23, tzinfo=dt.UTC))


if __name__ == "__main__":
    unittest.main()
