import datetime as dt
import importlib.util
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("export_glv_dashboard", ROOT / "export_glv_dashboard.py")
assert SPEC is not None and SPEC.loader is not None
EXPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(EXPORTER)


def calendar_rows():
    return [
        ["", "feb", "91,550"],
        ["", "promo (06-14)", "55,241"],
        ["", "influ (19-22)", "14,099"],
        ["", "full price", "22,210"],
        ["", "may", "197,872"],
        ["", "promo (13-20)", "106,538"],
        ["", "influ kristyna (21-25, 27)", "43,561"],
        ["", "full price", "47,773"],
        ["", "august (actual)", "207,508"],
        ["", "promo private (18-19)", "41,941"],
        ["", "promo public (20-26)", "62,454"],
        ["", "influ kristyna (13-17)", "48,761"],
        ["", "//total promo", "104,395"],
        ["", "september (forecast)", "320,000"],
        ["", "promo (14-21)", "200,000"],
        ["", "influ kristyna (24-28)", "55,000"],
    ]


def daily(date="2026-09-10", region="CZ+SK", revenue="200", influ="80"):
    return {
        "Date": date,
        "Region": region,
        "Revenue ($)": revenue,
        "Ad spend ($)": "40",
        "Revenue INFLU ($)": influ,
        "Orders": "2",
        "Unique visitors": "20",
        "New customers": "1",
        "Returning customers": "1",
        "New customers revenue ($)": "100",
    }


class ManualCalendarParserTest(unittest.TestCase):
    def test_january_2026_supplement_survives_export_without_changing_other_months(self):
        payload = EXPORTER.build_payload([daily()], calendar_rows())
        january = [e for e in payload['phases'] if e['start_date'].startswith('2026-01')]
        self.assertEqual([(e['start_date'], e['end_date'], e['phase']) for e in january], [
            ('2026-01-06', '2026-01-14', 'Promo'),
            ('2026-01-15', '2026-01-19', 'Influ'),
        ])
        self.assertTrue(all(e['source_row'] is None and 'Tom' in e['source'] for e in january))
        self.assertEqual([e for e in payload['phases'] if e not in january],
                         EXPORTER.parse_manual_phase_calendar(calendar_rows(), 2026))

    def test_identical_sheet_january_is_retained_without_duplicates(self):
        rows = [["", "jan"], ["", "promo (06-14)"], ["", "influ (15-19)"]] + calendar_rows()
        source = EXPORTER.parse_manual_phase_calendar(rows, 2026)
        self.assertEqual(EXPORTER.build_payload([daily()], rows)['phases'], source)

    def test_conflicting_partial_empty_and_duplicate_january_fail_closed(self):
        for intervals in [ ['promo (07-14)', 'influ (15-19)'], ['promo (06-14)'],
                           ['full price'], ['promo (06-14)', 'influ (15-19)', 'promo (06-14)'] ]:
            rows = [["", "jan"]] + [["", value] for value in intervals] + calendar_rows()
            with self.subTest(intervals=intervals), tempfile.TemporaryDirectory() as directory:
                target = pathlib.Path(directory) / 'snapshot.json'
                target.write_text('last-valid')
                with self.assertRaisesRegex(ValueError, 'PHASE_JANUARY_CONFLICT'):
                    EXPORTER.export_snapshot(lambda: EXPORTER.build_payload([daily()], rows), [target])
                self.assertEqual(target.read_text(), 'last-valid')

    def test_supplement_is_idempotent_and_never_applies_to_other_years(self):
        source = EXPORTER.parse_manual_phase_calendar(calendar_rows(), 2026)
        supplemented = EXPORTER.supplement_phase_calendar(source, 2026)
        self.assertEqual(EXPORTER.supplement_phase_calendar(supplemented, 2026), supplemented)
        for year in (2025, 2027):
            source = EXPORTER.parse_manual_phase_calendar(calendar_rows(), year)
            self.assertEqual(EXPORTER.supplement_phase_calendar(source, year), source)

    def test_reporting_year_is_latest_valid_czsk_daily_year(self):
        records = [daily("2025-12-31"), daily("2026-09-10"), daily("2027-01-01", region="US")]
        self.assertEqual(EXPORTER.infer_reporting_year(records), 2026)

    def test_calendar_parser_preserves_subtypes_and_non_contiguous_dates(self):
        schedule = EXPORTER.parse_manual_phase_calendar(calendar_rows(), 2026)
        self.assertIn({
            "start_date": "2026-05-21", "end_date": "2026-05-25", "phase": "Influ",
            "label": "influ kristyna", "source_row": 7,
        }, schedule)
        self.assertIn({
            "start_date": "2026-05-27", "end_date": "2026-05-27", "phase": "Influ",
            "label": "influ kristyna", "source_row": 7,
        }, schedule)
        self.assertIn("promo private", [entry["label"] for entry in schedule])
        self.assertIn("promo public", [entry["label"] for entry in schedule])
        self.assertNotIn("full price", [entry["label"] for entry in schedule])
        self.assertNotIn("//total promo", [entry["label"] for entry in schedule])

    def test_calendar_parser_accepts_cross_month_dotted_intervals(self):
        rows = [["", "october"], ["", "promo (28.10. - 4.11.)"]]
        schedule = EXPORTER.parse_manual_phase_calendar(rows, 2026)
        self.assertEqual(schedule, [{
            "start_date": "2026-10-28",
            "end_date": "2026-11-04",
            "phase": "Promo",
            "label": "promo",
            "source_row": 2,
        }])

    def test_calendar_parser_rejects_malformed_or_impossible_intervals(self):
        with self.assertRaisesRegex(ValueError, "PHASE_DATE_INVALID"):
            EXPORTER.parse_manual_phase_calendar([["", "feb"], ["", "promo (31-32)"]], 2026)
        with self.assertRaisesRegex(ValueError, "PHASE_RANGE_INVALID"):
            EXPORTER.parse_manual_phase_calendar([["", "feb"], ["", "promo (14-06)"]], 2026)

    def test_future_malformed_phase_interval_warns_without_blocking_current_data(self):
        rows = calendar_rows() + [["", "october"], ["", "promo (banana)"]]
        payload = EXPORTER.build_payload(
            [daily("2026-09-17")],
            rows,
            now=dt.datetime(2026, 9, 18, tzinfo=dt.UTC),
        )
        self.assertEqual(payload["date_range"]["end"], "2026-09-17")
        self.assertEqual(len(payload["phase_contract"]["warnings"]), 1)
        self.assertIn("PHASE_FUTURE_INTERVAL_SKIPPED", payload["phase_contract"]["warnings"][0])

    def test_current_malformed_phase_interval_still_fails_closed(self):
        rows = calendar_rows() + [["", "september"], ["", "promo (banana)"]]
        with self.assertRaisesRegex(ValueError, "PHASE_DATE_INVALID"):
            EXPORTER.build_payload(
                [daily("2026-09-17")],
                rows,
                now=dt.datetime(2026, 9, 18, tzinfo=dt.UTC),
            )

    def test_cross_phase_overlap_is_rejected(self):
        rows = [["", "feb"], ["", "promo (06-14)"], ["", "influ (14-16)"]]
        with self.assertRaisesRegex(ValueError, "PHASE_OVERLAP_PROMO_INFLU.*2026-02-14"):
            EXPORTER.parse_manual_phase_calendar(rows, 2026)

    def test_build_payload_rejects_invalid_daily_dates_before_publish(self):
        records = [daily("2026-02-30"), daily("2026-09-10")]
        with self.assertRaisesRegex(ValueError, "DAILY_DATE_INVALID.*2026-02-30"):
            EXPORTER.build_payload(records, calendar_rows(), now=dt.datetime(2026, 9, 11, tzinfo=dt.UTC))

    def test_build_payload_keeps_home_markets_and_adds_source_driven_phase_fields(self):
        records = [daily(), daily(region="US", revenue="300", influ="0")]
        payload = EXPORTER.build_payload(records, calendar_rows(), now=dt.datetime(2026, 9, 11, tzinfo=dt.UTC))
        self.assertEqual({row["region"] for row in payload["rows"]}, {"czsk", "us"})
        self.assertEqual(payload["rows"][0]["influ_revenue"], 80)
        self.assertEqual(payload["phase_contract"]["scope"], "czsk")
        self.assertEqual(payload["phase_contract"]["reporting_year"], 2026)
        self.assertEqual(payload["phase_contract"]["latest_date"], "2026-09-10")
        self.assertEqual(payload["source"]["phase_calendar_sheet_id"], EXPORTER.PHASE_CALENDAR_SHEET_ID)
        self.assertNotIn("sheet_id", payload["source"])

    def test_phase_cutoff_uses_latest_czsk_date_not_global_market_end(self):
        records = [daily("2026-09-10"), daily("2027-01-02", region="US", revenue="300", influ="0")]
        payload = EXPORTER.build_payload(records, calendar_rows(), now=dt.datetime(2026, 9, 11, tzinfo=dt.UTC))
        self.assertEqual(payload["date_range"]["end"], "2027-01-02")
        self.assertEqual(payload["phase_contract"]["reporting_year"], 2026)
        self.assertEqual(payload["phase_contract"]["latest_date"], "2026-09-10")

    def test_stale_calendar_fails_before_replacing_last_valid_output(self):
        stale_rows = [["", "feb"], ["", "promo (06-14)"], ["", "influ (19-22)"]]
        with self.assertRaisesRegex(ValueError, "PHASE_CALENDAR_STALE"):
            EXPORTER.build_payload([daily()], stale_rows, now=dt.datetime(2026, 9, 11, tzinfo=dt.UTC))

        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "snapshot.json"
            target.write_text("last-valid", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "boom"):
                EXPORTER.export_snapshot(lambda: (_ for _ in ()).throw(ValueError("boom")), [target])
            self.assertEqual(target.read_text(encoding="utf-8"), "last-valid")


if __name__ == "__main__":
    unittest.main()
