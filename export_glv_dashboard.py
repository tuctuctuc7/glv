#!/usr/bin/env python3
import datetime as dt
import json
import os
import re

from dotenv import load_dotenv
import gspread
from google.oauth2.service_account import Credentials


ENV_PATH = "/home/tom/.config/fb-sync/.env"
SOURCE_SHEET_ID = "1KjiRfumk3w8tNZFpfI8RO9X5RTcqoq5LcKfyCzcpplQ"
SOURCE_TAB = "Daily"
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


def main():
    load_dotenv(ENV_PATH)
    creds = Credentials.from_service_account_file(
        os.environ["GOOGLE_CREDENTIALS_PATH"],
        scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"],
    )
    client = gspread.authorize(creds)
    worksheet = client.open_by_key(SOURCE_SHEET_ID).worksheet(SOURCE_TAB)
    records = worksheet.get_all_records()

    rows = []
    for record in records:
        day = date_iso(record.get("Date"))
        region = region_key(record.get("Region"))
        if not day or region not in {"czsk", "us", "row"}:
            continue

        rows.append({
            "date": day,
            "region": region,
            "revenue": round(number(record.get("Revenue ($)")), 2),
            "spend": round(number(record.get("Ad spend ($)")), 2),
            "purchases": int(round(number(record.get("Orders")))),
            "unique_visitors": int(round(number(record.get("Unique visitors")))),
            "new_customers": int(round(number(record.get("New customers")))),
            "returning_customers": int(round(number(record.get("Returning customers")))),
            "new_customer_revenue": round(number(record.get("New customers revenue ($)")), 2),
        })

    rows.sort(key=lambda item: (item["date"], item["region"]))
    dates = sorted({row["date"] for row in rows})
    payload = {
        "updated_at": dt.datetime.now(dt.UTC).strftime("%Y-%m-%d %H:%M UTC"),
        "source": {
            "sheet_id": SOURCE_SHEET_ID,
            "tab": SOURCE_TAB,
            "mode": "read-only",
            "note": "BLENDED rows are intentionally excluded; All is aggregated from CZSK, US, and ROW.",
        },
        "currency": "USD",
        "date_range": {
            "start": dates[0] if dates else None,
            "end": dates[-1] if dates else None,
        },
        "absolute_metrics": ["spend", "revenue", "purchases", "unique_visitors", "new_customers", "returning_customers", "new_customer_revenue"],
        "derived_metrics": {
            "roas": "revenue / spend",
            "cpa": "spend / purchases",
            "aov": "revenue / purchases",
            "cvr": "purchases / unique_visitors",
            "new_customer_rate": "new_customers / (new_customers + returning_customers)",
        },
        "rows": rows,
    }

    serialized = json.dumps(payload, indent=2)
    for out_path in OUT_PATHS:
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(serialized)
        print(f"Wrote {out_path} with {len(rows):,} rows")


if __name__ == "__main__":
    main()
