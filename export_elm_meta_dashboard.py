#!/usr/bin/env python3
"""Export the Elmich Meta audit into the public interactive dashboard contract."""

from __future__ import annotations

import argparse
import importlib.util
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_AUDIT_ROOT = Path("/home/tom/.openclaw/workspace/audits/elmich_meta_24m")
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "public/elm-meta-ads/elm_meta_ads.json"


def load_audit_module(audit_root: Path):
    script = audit_root / "scripts/revise_audit_from_tom_review.py"
    spec = importlib.util.spec_from_file_location("elmich_audit_revision", script)
    if not spec or not spec.loader:
        raise RuntimeError(f"Unable to load {script}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sum_metrics(rows: list[dict]) -> dict[str, float]:
    keys = ("spend", "purchases", "landing_page_views", "initiate_checkout")
    return {key: sum(float(row.get(key, 0) or 0) for row in rows) for key in keys}


def export(audit_root: Path, output: Path) -> dict:
    audit = load_audit_module(audit_root)
    daily, regional = audit.load_rows()
    cleaned, flags = audit.flag_value_anomalies(daily)

    raw_value = sum(row["raw_purchase_value"] for row in cleaned)
    modelled_value = sum(row["adjusted_purchase_value"] for row in cleaned)
    totals = sum_metrics(cleaned)
    spend = totals["spend"]
    purchases = totals["purchases"]
    regional_totals = audit.aggregate(regional)
    mapped_spend = sum(
        float(row.get("spend") or 0)
        for row in regional
        if audit.region_group(row.get("region", "")) != "Unmapped / non-Vietnam"
    )

    account_daily = []
    for row in cleaned:
        account_daily.append({
            "date": row["date_start"],
            "account": row["account_name"].replace("Elmich - ", ""),
            "spend": row["spend"],
            "purchases": row["purchases"],
            "landing_page_views": row["landing_page_views"],
            "checkouts": row["initiate_checkout"],
            "raw_purchase_value": row["raw_purchase_value"],
            "modelled_purchase_value": row["adjusted_purchase_value"],
            "raw_aov": row["aov"] if row["purchases"] else None,
            "baseline_aov": row["baseline_aov"] if row["value_flag"] else None,
            "flagged": row["value_flag"],
        })

    region_months: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in regional:
        region_months[(row["date_start"][:7], audit.region_group(row["region"]))].append(row)
    region_monthly = []
    for (month, region), rows in sorted(region_months.items()):
        agg = audit.aggregate(rows)
        region_monthly.append({
            "month": month,
            "region": region,
            "spend": agg["spend"],
            "purchases": agg["purchases"],
        })

    anomalies = []
    for row in flags:
        anomalies.append({
            "date": row["date_start"],
            "account": row["account_name"].replace("Elmich - ", ""),
            "purchases": row["purchases"],
            "raw_purchase_value": row["raw_purchase_value"],
            "raw_aov": row["aov"],
            "baseline_aov": row["baseline_aov"],
            "modelled_purchase_value": row["adjusted_purchase_value"],
            "excess_purchase_value": row["excess_purchase_value"],
        })

    payload = {
        "meta": {
            "title": "ELM Meta Ads",
            "currency": "VND",
            "date_range": {"start": audit.START, "end": audit.END},
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": "Cached Meta API v22.0 audit export",
            "confidence": "Directional until backend and PowerBI reconciliation",
        },
        "summary": {
            "spend": spend,
            "purchases": purchases,
            "cost_per_purchase": spend / purchases if purchases else None,
            "raw_purchase_value": raw_value,
            "raw_roas": raw_value / spend if spend else None,
            "modelled_purchase_value": modelled_value,
            "modelled_roas": modelled_value / spend if spend else None,
            "flagged_account_days": len(flags),
            "removed_value_share": (raw_value - modelled_value) / raw_value if raw_value else None,
        },
        "methodology": {
            "grain": "account × day",
            "neighbor_days": 7,
            "aov_multiplier": 5,
            "scaled_mad_multiplier": 6,
            "minimum_excess_value": 100_000_000,
            "replacement": "local median AOV × actual purchases",
            "immutable_metrics": ["spend", "purchases", "landing_page_views", "checkouts"],
            "interpretation": "Sensitivity scenario only; not corrected booked revenue.",
        },
        "reconciliation": {
            "regional_purchase_coverage": regional_totals["purchases"] / purchases if purchases else None,
            "regional_value_coverage": regional_totals["purchase_value"] / raw_value if raw_value else None,
            "mapped_spend_coverage": mapped_spend / regional_totals["spend"] if regional_totals["spend"] else None,
        },
        "account_daily": account_daily,
        "region_monthly": region_monthly,
        "anomalies": anomalies,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audit-root", type=Path, default=DEFAULT_AUDIT_ROOT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    payload = export(args.audit_root, args.output)
    print(json.dumps({
        "output": str(args.output),
        "account_days": len(payload["account_daily"]),
        "region_months": len(payload["region_monthly"]),
        "anomalies": len(payload["anomalies"]),
    }))


if __name__ == "__main__":
    main()
