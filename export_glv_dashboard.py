#!/usr/bin/env python3
import datetime as dt
import json
import math
import os
import re

from dotenv import load_dotenv
import gspread
from google.oauth2.service_account import Credentials


ENV_PATH = "/home/tom/.config/fb-sync/.env"
SOURCE_SHEET_ID = "1KjiRfumk3w8tNZFpfI8RO9X5RTcqoq5LcKfyCzcpplQ"
SOURCE_TAB = "Daily"
PHASES_TAB = "Phases"
ROOT = os.path.dirname(__file__)
OUT_PATHS = (
    os.path.join(ROOT, "public", "glv", "glv_dashboard.json"),
    os.path.join(ROOT, "public", "glv-2", "glv_dashboard.json"),
)


def number(value):
    text = str(value or "").strip()
    if not text:
        return 0.0
    text = text.replace("$", "").replace(",", "").replace("%", "")
    text = re.sub(r"[^0-9.\-]", "", text)
    try:
        return float(text or 0)
    except ValueError:
        return 0.0


def phase_metric(value, label, day, region):
    text = str(value if value is not None else "").strip()
    if not text:
        return 0.0
    normalized = text.replace("$", "").replace(",", "").replace("%", "").strip()
    try:
        parsed = float(normalized)
    except ValueError as error:
        raise ValueError(
            f"{label} must be a non-negative finite number on {day} for {region}."
        ) from error
    if not math.isfinite(parsed) or parsed < 0:
        raise ValueError(f"{label} must be a non-negative finite number on {day} for {region}.")
    return round(parsed, 2)


def date_iso(value):
    raw = str(value or "").strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            return dt.datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            pass
    return raw


def region_key(value):
    raw = str(value or "").strip().upper()
    aliases = {
        "CZ+SK": "czsk",
        "CZSK": "czsk",
        "US": "us",
        "ROW": "row",
    }
    return aliases.get(raw, raw.lower() or "unknown")


def public_phase_text(value, field, row, default=""):
    text = str(value or default).strip()
    if any(ord(character) < 32 or ord(character) == 127 for character in text):
        raise ValueError(f"Invalid public {field} at Phases row {row}.")
    if len(text) > 80:
        raise ValueError(f"Public {field} is too long at Phases row {row}.")
    return text


def parse_phase_records(records):
    phases = []
    for index, record in enumerate(records, start=2):
        start_date = date_iso(record.get("Start date"))
        end_date = date_iso(record.get("End date"))
        phase = str(record.get("Phase") or "").strip().title()
        if not any((start_date, end_date, phase)):
            continue
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", start_date or ""):
            raise ValueError(f"Invalid Phases start date at row {index}.")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", end_date or ""):
            raise ValueError(f"Invalid Phases end date at row {index}.")
        if start_date > end_date:
            raise ValueError(f"Phases start date is after end date at row {index}.")
        if phase not in {"Promo", "Influ"}:
            raise ValueError(f"Invalid Phases phase at row {index}: {phase or 'blank'}.")
        phases.append({
            "start_date": start_date,
            "end_date": end_date,
            "phase": phase,
            "label": public_phase_text(record.get("Label"), "Label", index, phase) or phase,
            "influencer": public_phase_text(record.get("Influencer"), "Influencer", index),
        })
    return phases


def validate_phase_schedule(phases):
    by_date = {}
    for window in phases:
        start = dt.date.fromisoformat(window["start_date"])
        end = dt.date.fromisoformat(window["end_date"])
        cursor = start
        while cursor <= end:
            day = cursor.isoformat()
            by_date.setdefault(day, []).append(window["phase"])
            cursor += dt.timedelta(days=1)

    for day, day_phases in sorted(by_date.items()):
        if "Promo" in day_phases and "Influ" in day_phases:
            raise ValueError(f"Promo and Influ overlap on {day}. Update the Phases tab.")
        if day_phases.count("Promo") > 1:
            raise ValueError(f"Promo windows overlap on {day}. Update the Phases tab.")


def build_payload(records, phase_records, now=None):
    phases = parse_phase_records(phase_records)
    if not phases:
        raise ValueError("Phases tab must contain at least one scheduled Promo or Influ window.")
    validate_phase_schedule(phases)
    rows = []
    for record in records:
        day = date_iso(record.get("Date"))
        region = region_key(record.get("Region"))
        if not day or region not in {"czsk", "us", "row"}:
            continue

        revenue = round(number(record.get("Revenue ($)")), 2)
        influ_revenue = phase_metric(record.get("Revenue INFLU ($)"), "Influ revenue", day, region)
        influ_commission = phase_metric(record.get("Ad spend Influ ($)"), "Influ commission", day, region)
        if influ_revenue > revenue:
            raise ValueError(f"Code revenue exceeds total revenue on {day} for {region}.")
        rows.append({
            "date": day,
            "region": region,
            "revenue": revenue,
            "spend": round(number(record.get("Ad spend ($)")), 2),
            "purchases": int(round(number(record.get("Orders")))),
            "unique_visitors": int(round(number(record.get("Unique visitors")))),
            "new_customers": int(round(number(record.get("New customers")))),
            "returning_customers": int(round(number(record.get("Returning customers")))),
            "new_customer_revenue": round(number(record.get("New customers revenue ($)")), 2),
            "influ_revenue": influ_revenue,
            "influ_commission": influ_commission,
        })

    rows.sort(key=lambda item: (item["date"], item["region"]))
    dates = sorted({row["date"] for row in rows})
    timestamp = now or dt.datetime.now(dt.UTC)
    return {
        "updated_at": timestamp.strftime("%Y-%m-%d %H:%M UTC"),
        "source": {
            "tab": SOURCE_TAB,
            "phases_tab": PHASES_TAB,
            "mode": "read-only",
            "note": "BLENDED rows are intentionally excluded; All is aggregated from CZSK, US, and ROW.",
        },
        "currency": "USD",
        "date_range": {
            "start": dates[0] if dates else None,
            "end": dates[-1] if dates else None,
        },
        "absolute_metrics": ["spend", "revenue", "purchases", "unique_visitors", "new_customers", "returning_customers", "new_customer_revenue"],
        "phase_absolute_metrics": ["influ_revenue", "influ_commission"],
        "derived_metrics": {
            "roas": "revenue / spend",
            "cpa": "spend / purchases",
            "aov": "revenue / purchases",
            "cvr": "purchases / unique_visitors",
            "new_customer_rate": "new_customers / (new_customers + returning_customers)",
        },
        "phase_contract": {
            "scope": "czsk",
            "historical_start": "2026-02-01",
            "bau": "Every CZSK date not covered by Promo or Influ.",
            "overlap_rule": "Promo and Influ must not overlap; multiple Influ windows may overlap.",
        },
        "phases": phases,
        "rows": rows,
    }


def main():
    load_dotenv(ENV_PATH)
    creds = Credentials.from_service_account_file(
        os.environ["GOOGLE_CREDENTIALS_PATH"],
        scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
    )
    client = gspread.authorize(creds)
    spreadsheet = client.open_by_key(SOURCE_SHEET_ID)
    records = spreadsheet.worksheet(SOURCE_TAB).get_all_records()
    phase_records = spreadsheet.worksheet(PHASES_TAB).get_all_records()
    payload = build_payload(records, phase_records)
    serialized = json.dumps(payload, indent=2)
    for out_path in OUT_PATHS:
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(serialized)
        print(f"Wrote {out_path} with {len(payload['rows']):,} rows")


if __name__ == "__main__":
    main()
