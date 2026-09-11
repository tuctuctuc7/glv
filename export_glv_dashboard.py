#!/usr/bin/env python3
import datetime as dt
import csv
import io
import json
import math
import os
import re
import tempfile
import urllib.request

from dotenv import load_dotenv
import gspread
from google.oauth2.service_account import Credentials


ENV_PATH = "/home/tom/.config/fb-sync/.env"
SOURCE_SHEET_ID = "1KjiRfumk3w8tNZFpfI8RO9X5RTcqoq5LcKfyCzcpplQ"
SOURCE_TAB = "Daily"
PHASE_CALENDAR_SHEET_ID = "18oXDGQaE2p8E_G3PGHJwaYsl0CFM0eE9pVd-ju19edY"
PHASE_CALENDAR_CSV_URL = (
    "https://docs.google.com/spreadsheets/d/"
    f"{PHASE_CALENDAR_SHEET_ID}/export?format=csv&gid=0"
)
ROOT = os.path.dirname(__file__)
OUT_PATHS = (
    os.path.join(ROOT, "public", "glv", "glv_dashboard.json"),
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


MONTHS = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}


def strict_date(value, code, context):
    text = str(value or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        raise ValueError(f"{code}: {context} invalid date {text or 'blank'}")
    try:
        parsed = dt.date.fromisoformat(text)
    except ValueError as error:
        raise ValueError(f"{code}: {context} invalid date {text}") from error
    if parsed.isoformat() != text:
        raise ValueError(f"{code}: {context} invalid date {text}")
    return parsed


def infer_reporting_year(records):
    dates = []
    for record in records:
        if region_key(record.get("Region")) != "czsk":
            continue
        day = date_iso(record.get("Date"))
        try:
            dates.append(strict_date(day, "DAILY_DATE_INVALID", "Daily"))
        except ValueError:
            continue
    if not dates:
        raise ValueError("DAILY_SCOPE_EMPTY: no valid CZSK Daily rows")
    return max(dates).year


def month_from_label(label):
    token = re.sub(r"\s*\([^)]*\)\s*$", "", label).strip().lower()
    return MONTHS.get(token)


def validate_phase_schedule(schedule):
    by_date = {}
    for entry in schedule:
        start = strict_date(entry["start_date"], "PHASE_DATE_INVALID", f"calendar row {entry['source_row']}")
        end = strict_date(entry["end_date"], "PHASE_DATE_INVALID", f"calendar row {entry['source_row']}")
        if end < start:
            raise ValueError(f"PHASE_RANGE_INVALID: calendar row {entry['source_row']} {start}..{end}")
        cursor = start
        while cursor <= end:
            by_date.setdefault(cursor.isoformat(), []).append(entry)
            cursor += dt.timedelta(days=1)
    for day, entries in sorted(by_date.items()):
        phases = {entry["phase"] for entry in entries}
        if phases == {"Promo", "Influ"}:
            rows = ",".join(str(entry["source_row"]) for entry in entries)
            raise ValueError(f"PHASE_OVERLAP_PROMO_INFLU: rows {rows} overlap {day}")


def parse_manual_phase_calendar(rows, reporting_year):
    schedule = []
    current_month = None
    for source_row, row in enumerate(rows, start=1):
        label = str(row[1] if len(row) > 1 else "").strip().lower()
        if not label:
            continue
        month = month_from_label(label)
        if month:
            current_month = month
            continue
        if label.startswith("full price") or label.startswith("//total promo"):
            continue
        match = re.fullmatch(r"((?:promo|influ)(?:\s+[^()]*)?)\s*\(([^)]+)\)", label)
        if not match:
            if label.startswith(("promo", "influ")):
                raise ValueError(f"PHASE_DATE_INVALID: calendar row {source_row} malformed interval")
            continue
        if current_month is None:
            raise ValueError(f"PHASE_DATE_INVALID: calendar row {source_row} has no month")
        source_label = re.sub(r"\s+", " ", match.group(1)).strip()
        phase = "Promo" if source_label.startswith("promo") else "Influ"
        for segment in (part.strip() for part in match.group(2).split(",")):
            range_match = re.fullmatch(r"(\d{1,2})(?:\s*-\s*(\d{1,2}))?", segment)
            if not range_match:
                raise ValueError(f"PHASE_DATE_INVALID: calendar row {source_row} malformed interval {segment}")
            start_day = int(range_match.group(1))
            end_day = int(range_match.group(2) or start_day)
            if end_day < start_day:
                raise ValueError(f"PHASE_RANGE_INVALID: calendar row {source_row} {segment}")
            try:
                start = dt.date(reporting_year, current_month, start_day)
                end = dt.date(reporting_year, current_month, end_day)
            except ValueError as error:
                raise ValueError(f"PHASE_DATE_INVALID: calendar row {source_row} {segment}") from error
            schedule.append({
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
                "phase": phase,
                "label": source_label,
                "source_row": source_row,
            })
    if not schedule:
        raise ValueError("PHASE_CALENDAR_EMPTY: no Promo or Influ intervals found")
    validate_phase_schedule(schedule)
    return schedule


def phase_metric(value, day, region):
    text = str(value if value is not None else "").strip()
    if not text:
        return 0.0
    normalized = text.replace("$", "").replace(",", "").replace("%", "").strip()
    try:
        parsed = float(normalized)
    except ValueError as error:
        raise ValueError(f"DAILY_METRIC_INVALID: Revenue INFLU ($) on {day} for {region}") from error
    if not math.isfinite(parsed) or parsed < 0:
        raise ValueError(f"DAILY_METRIC_INVALID: Revenue INFLU ($) on {day} for {region}")
    return round(parsed, 2)


def build_payload(records, calendar_rows, now=None):
    reporting_year = infer_reporting_year(records)
    schedule = parse_manual_phase_calendar(calendar_rows, reporting_year)
    rows = []
    for record in records:
        day = date_iso(record.get("Date"))
        region = region_key(record.get("Region"))
        if not day or region not in {"czsk", "us", "row"}:
            continue
        strict_date(day, "DAILY_DATE_INVALID", f"Daily {region}")
        revenue = round(number(record.get("Revenue ($)")), 2)
        influ_revenue = phase_metric(record.get("Revenue INFLU ($)"), day, region)
        if influ_revenue > revenue:
            raise ValueError(f"DAILY_METRIC_INVALID: code revenue exceeds total revenue on {day} for {region}")
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
        })
    rows.sort(key=lambda item: (item["date"], item["region"]))
    dates = sorted({row["date"] for row in rows})
    if not dates:
        raise ValueError("DAILY_SCOPE_EMPTY: no dashboard rows")
    latest_czsk = max(row["date"] for row in rows if row["region"] == "czsk")
    if max(entry["end_date"] for entry in schedule) < latest_czsk:
        raise ValueError(
            f"PHASE_CALENDAR_STALE: latest interval ends before CZSK Daily coverage {latest_czsk}"
        )
    timestamp = now or dt.datetime.now(dt.UTC)
    return {
        "updated_at": timestamp.strftime("%Y-%m-%d %H:%M UTC"),
        "source": {
            "tab": SOURCE_TAB,
            "phase_calendar_sheet_id": PHASE_CALENDAR_SHEET_ID,
            "phase_calendar_tab": "Sheet1",
            "mode": "read-only",
            "note": "BLENDED rows are intentionally excluded; All is aggregated from CZSK, US, and ROW.",
        },
        "currency": "USD",
        "date_range": {"start": dates[0], "end": dates[-1]},
        "absolute_metrics": ["spend", "revenue", "purchases", "unique_visitors", "new_customers", "returning_customers", "new_customer_revenue"],
        "derived_metrics": {
            "roas": "revenue / spend",
            "cpa": "spend / purchases",
            "aov": "revenue / purchases",
            "cvr": "purchases / unique_visitors",
            "new_customer_rate": "new_customers / (new_customers + returning_customers)",
            "cac": "spend / new_customers",
        },
        "phase_contract": {
            "scope": "czsk",
            "reporting_year": reporting_year,
            "latest_date": latest_czsk,
            "calendar_authority": "Marketing Ops | Gelavis, Sheet1",
            "bau": "Every CZSK date in the reporting year not covered by Promo or Influ.",
            "overlap_rule": "Promo and Influ must not overlap.",
        },
        "phases": schedule,
        "rows": rows,
    }


def fetch_calendar_rows():
    request = urllib.request.Request(PHASE_CALENDAR_CSV_URL, headers={"User-Agent": "glv-dashboard-exporter/1"})
    with urllib.request.urlopen(request, timeout=30) as response:
        text = response.read().decode("utf-8-sig")
    return list(csv.reader(io.StringIO(text)))


def export_snapshot(builder, out_paths=OUT_PATHS):
    payload = builder()
    serialized = json.dumps(payload, indent=2)
    pending = []
    try:
        for out_path in out_paths:
            target = os.fspath(out_path)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            handle = tempfile.NamedTemporaryFile(
                mode="w", encoding="utf-8", dir=os.path.dirname(target), delete=False
            )
            with handle:
                handle.write(serialized)
                handle.flush()
                os.fsync(handle.fileno())
            pending.append((handle.name, target))
        for temporary, target in pending:
            os.replace(temporary, target)
        return payload
    finally:
        for temporary, _ in pending:
            if os.path.exists(temporary):
                os.unlink(temporary)


def main():
    load_dotenv(ENV_PATH)
    creds = Credentials.from_service_account_file(
        os.environ["GOOGLE_CREDENTIALS_PATH"],
        scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
    )
    client = gspread.authorize(creds)
    records = client.open_by_key(SOURCE_SHEET_ID).worksheet(SOURCE_TAB).get_all_records()
    calendar_rows = fetch_calendar_rows()
    payload = export_snapshot(lambda: build_payload(records, calendar_rows))
    print(f"Wrote {OUT_PATHS[0]} with {len(payload['rows']):,} rows and {len(payload['phases'])} phase intervals")


if __name__ == "__main__":
    main()
