#!/usr/bin/env python3
"""Export the Elmich Meta audit into the public interactive dashboard contract."""

from __future__ import annotations

import argparse
import calendar
import hashlib
import importlib.util
import json
import re
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


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


ACTION_ALIASES = {
    "purchases": ["offsite_conversion.fb_pixel_purchase", "purchase", "omni_purchase", "onsite_conversion.purchase"],
    "landing_page_views": ["landing_page_view"],
    "checkouts": ["offsite_conversion.fb_pixel_initiate_checkout", "initiate_checkout", "omni_initiated_checkout"],
}


def action_pick(row: dict, source: str, aliases: list[str]) -> float:
    values = {item.get("action_type"): float(item.get("value") or 0) for item in row.get(source) or []}
    return next((values[alias] for alias in aliases if alias in values), 0.0)


def is_complete_audit_month(row: dict) -> bool:
    start = row.get("date_start", "")
    stop = row.get("date_stop", "")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", start):
        return False
    year, month = (int(part) for part in start[:7].split("-"))
    expected_stop = f"{year:04d}-{month:02d}-{calendar.monthrange(year, month)[1]:02d}"
    return start.endswith("-01") and stop == expected_stop and "2024-07" <= start[:7] <= "2026-06"


def load_monthly_level_rows(audit_root: Path, level: str) -> list[dict]:
    key_name = f"{level}_id"
    deduped: dict[tuple[str, str, str], dict] = {}
    for path in sorted((audit_root / "raw").glob(f"*_{level}_none_inc-monthly_*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        rows = payload.get("data", []) if isinstance(payload, dict) else payload
        for row in rows:
            if is_complete_audit_month(row):
                deduped[(row.get("account_name", ""), row.get(key_name, ""), row["date_start"])] = row
    return list(deduped.values())


def campaign_group(name: str) -> str:
    normalized = name.lower()
    if re.search(r"retarget|\brtg\b|remarket", normalized):
        return "Retargeting"
    if re.search(r"\basc\b|\bmsc\b|\bdpa\b", normalized):
        return "ASC / MSC / DPA"
    if "bau" in normalized and "product" in normalized:
        return "BAU · Product"
    if "bau" in normalized and "category" in normalized:
        return "BAU · Category"
    if re.search(r"\bawo\b", normalized):
        return "AWO"
    if re.search(r"promotion|sale|promo|khuyến mãi|flash", normalized):
        return "Promotion / Sale"
    if "campaign" in normalized:
        return "Campaign / CBO"
    return "Other / legacy"


def creative_format(name: str) -> str:
    normalized = name.lower()
    if "video" in normalized or re.search(r"(^|[|_ -])vid($|[|_ -])", normalized):
        return "Video"
    if "carousel" in normalized:
        return "Carousel"
    if "single image" in normalized or "banner" in normalized or re.search(r"(^|[|_ -])image($|[|_ -])", normalized):
        return "Banner / single image"
    if "collection" in normalized:
        return "Collection"
    if "dpa" in normalized or "dynamic" in normalized:
        return "Dynamic / DPA"
    return "Unclassified"


def clean_component(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", str(value or "").strip())
    if not cleaned:
        return ""
    if re.fullmatch(r"\d{5,}", cleaned):
        return "SKU-coded product"
    return cleaned[:44]


def campaign_cell(name: str, account: str) -> str:
    parts = [clean_component(part) for part in str(name or "").split("|")]
    parts = [part for part in parts if part]
    lowered = [part.lower() for part in parts]

    if any(part in {"rtg", "retarget", "retargeting"} for part in lowered):
        intent = "Retargeting"
    elif any(part in {"asc", "advantage+", "advantage shopping"} for part in lowered):
        intent = "ASC"
    elif any(part in {"pros", "prospecting", "mass"} for part in lowered):
        intent = "Prospecting"
    else:
        intent = "Mixed intent"

    level = next((part for part in parts if part.lower() in {"product", "category", "awo", "campaign"}), "Other")
    business_terms = {"gia dụng", "gia dung", "điện gia dụng", "dien gia dung", "all product", "all cate", "all category"}
    excluded_terms = {"fb", "ecom", "conversion", "purchase", "pros", "rtg", "retarget", "asc", "mass", "a4", "a5", "bau", "old tuc", "tú", "tu", "thảo", "thao", "mới", "moi", "campaign", "awo", "product", "category"}
    detail_candidates = []
    for part in parts:
        lowered_part = part.lower()
        if lowered_part in business_terms or lowered_part in excluded_terms:
            continue
        if any(name in lowered_part for name in ("tú", "thảo", "old tuc")):
            continue
        if re.fullmatch(r"20\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec", lowered_part):
            continue
        detail_candidates.append(part)
    # Prefer the category/product words that usually sit after the business line.
    detail = " / ".join(detail_candidates[:2]) if detail_candidates else "All products"
    return f"{account} · {intent} · {level} · {detail}"


def row_detail_metrics(row: dict) -> dict[str, float]:
    return {
        "spend": float(row.get("spend") or 0),
        "purchases": action_pick(row, "actions", ACTION_ALIASES["purchases"]),
        "landing_page_views": action_pick(row, "actions", ACTION_ALIASES["landing_page_views"]),
        "checkouts": action_pick(row, "actions", ACTION_ALIASES["checkouts"]),
        "raw_purchase_value": action_pick(row, "action_values", ACTION_ALIASES["purchases"]),
    }


def add_efficiency(row: dict) -> dict:
    spend = float(row.get("spend", 0) or 0)
    purchases = float(row.get("purchases", 0) or 0)
    lpv = float(row.get("landing_page_views", 0) or 0)
    value = float(row.get("raw_purchase_value", 0) or 0)
    return {
        **row,
        "cost_per_purchase": spend / purchases if purchases else None,
        "purchase_cvr": purchases / lpv if lpv else None,
        "raw_roas": value / spend if spend else None,
        "raw_aov": value / purchases if purchases else None,
    }


def median(values: list[float]) -> float | None:
    clean = sorted(value for value in values if value is not None)
    if not clean:
        return None
    middle = len(clean) // 2
    if len(clean) % 2:
        return clean[middle]
    return (clean[middle - 1] + clean[middle]) / 2


def aggregate_campaign_cells(rows: list[dict], flag_months: set[tuple[str, str]]) -> list[dict]:
    grouped: dict[tuple[str, str, str], dict[str, float]] = defaultdict(lambda: defaultdict(float))
    clean_value_candidates: dict[tuple[str, str], tuple[str, float]] = {}
    for row in rows:
        account = row.get("account_name", "").replace("Elmich - ", "")
        month = row["date_start"][:7]
        label = campaign_cell(row.get("campaign_name", ""), account)
        metrics = row_detail_metrics(row)
        for key, value in metrics.items():
            grouped[(account, month, label)][key] += value

    result = []
    for (account, month, label), metrics in sorted(grouped.items()):
        row = add_efficiency({
            "account": account,
            "month": month,
            "cell": label,
            **metrics,
            "value_reliable": (account, month) not in flag_months,
        })
        result.append(row)
        if row["value_reliable"]:
            key = (account, month)
            value = float(row.get("raw_purchase_value") or 0)
            if key not in clean_value_candidates or value > clean_value_candidates[key][1]:
                clean_value_candidates[key] = (label, value)

    winners = defaultdict(int)
    for label, _value in clean_value_candidates.values():
        winners[label] += 1
    for row in result:
        row["clean_value_months_won"] = winners[row["cell"]]
    return result


def summarize_cells(rows: list[dict]) -> list[dict]:
    grouped: dict[tuple[str, str], dict] = {}
    for row in rows:
        key = (row["account"], row["cell"])
        if key not in grouped:
            grouped[key] = {
                "account": row["account"],
                "cell": row["cell"],
                "months_active": set(),
                "clean_value_months_won": row.get("clean_value_months_won", 0),
                "spend": 0,
                "purchases": 0,
                "landing_page_views": 0,
                "checkouts": 0,
                "raw_purchase_value": 0,
            }
        target = grouped[key]
        target["months_active"].add(row["month"])
        for metric in ("spend", "purchases", "landing_page_views", "checkouts", "raw_purchase_value"):
            target[metric] += float(row.get(metric, 0) or 0)
    output = []
    for row in grouped.values():
        row["months_active"] = len(row["months_active"])
        output.append(add_efficiency(row))
    return output


def account_benchmarks(cell_summaries: list[dict]) -> dict[str, dict]:
    accounts = sorted({row["account"] for row in cell_summaries})
    return {
        account: {
            "median_cpa": median([row["cost_per_purchase"] for row in cell_summaries if row["account"] == account and row["purchases"] >= 30]),
            "median_cvr": median([row["purchase_cvr"] for row in cell_summaries if row["account"] == account and row["landing_page_views"] >= 500]),
        }
        for account in accounts
    }


def growth_levers_from_cells(cells: list[dict]) -> list[dict]:
    summaries = summarize_cells(cells)
    benchmarks = account_benchmarks(summaries)
    eligible = [
        row for row in summaries
        if row["months_active"] >= 3 and row["spend"] >= 80_000_000 and row["purchases"] >= 150
    ]
    levers = []
    for row in eligible:
        bench = benchmarks.get(row["account"], {})
        median_cpa = bench.get("median_cpa") or row["cost_per_purchase"]
        median_cvr = bench.get("median_cvr") or row["purchase_cvr"]
        cpa_advantage = (median_cpa - row["cost_per_purchase"]) / median_cpa if median_cpa and row["cost_per_purchase"] else None
        cvr_advantage = (row["purchase_cvr"] - median_cvr) / median_cvr if median_cvr and row["purchase_cvr"] else None
        score = 0
        if cpa_advantage is not None:
            score += cpa_advantage * 55
        if cvr_advantage is not None:
            score += cvr_advantage * 25
        score += min(row["clean_value_months_won"], 6) * 4
        score += min(row["months_active"], 12) * 1.5
        if cpa_advantage is not None and cpa_advantage > 0.12:
            levers.append({
                "type": "scale_candidate",
                "account": row["account"],
                "cell": row["cell"],
                "score": round(score, 2),
                "months_active": row["months_active"],
                "clean_value_months_won": row["clean_value_months_won"],
                "spend": row["spend"],
                "purchases": row["purchases"],
                "cost_per_purchase": row["cost_per_purchase"],
                "purchase_cvr": row["purchase_cvr"],
                "cpa_vs_account_median": cpa_advantage,
                "cvr_vs_account_median": cvr_advantage,
                "recommended_move": "Protect and isolate budget for a South-only variant; map product/offer availability before scaling.",
            })

    inefficient = []
    for row in eligible:
        bench = benchmarks.get(row["account"], {})
        median_cpa = bench.get("median_cpa")
        median_cvr = bench.get("median_cvr")
        if not median_cpa or not row["cost_per_purchase"]:
            continue
        cpa_penalty = (row["cost_per_purchase"] - median_cpa) / median_cpa
        cvr_gap = (median_cvr - row["purchase_cvr"]) / median_cvr if median_cvr and row["purchase_cvr"] is not None else None
        if cpa_penalty > 0.35 and row["spend"] >= 120_000_000:
            inefficient.append({
                "type": "waste_or_rebuild",
                "account": row["account"],
                "cell": row["cell"],
                "score": round(cpa_penalty * 60 + min(row["spend"] / 100_000_000, 10), 2),
                "months_active": row["months_active"],
                "clean_value_months_won": row["clean_value_months_won"],
                "spend": row["spend"],
                "purchases": row["purchases"],
                "cost_per_purchase": row["cost_per_purchase"],
                "purchase_cvr": row["purchase_cvr"],
                "cpa_vs_account_median": -cpa_penalty,
                "cvr_vs_account_median": -cvr_gap if cvr_gap is not None else None,
                "recommended_move": "Audit offer, landing path, audience intent and creative before allowing more South spend.",
            })

    return sorted(levers, key=lambda row: row["score"], reverse=True)[:8] + sorted(inefficient, key=lambda row: row["score"], reverse=True)[:6]


def aggregate_named_months(rows: list[dict], classifier, flag_months: set[tuple[str, str]]) -> list[dict]:
    grouped: dict[tuple[str, str, str], dict[str, float]] = defaultdict(lambda: defaultdict(float))
    for row in rows:
        account = row.get("account_name", "").replace("Elmich - ", "")
        month = row["date_start"][:7]
        label = classifier(row)
        for key, value in row_detail_metrics(row).items():
            grouped[(account, month, label)][key] += value
    return [
        {
            "account": account,
            "month": month,
            "group": label,
            **metrics,
            "value_reliable": (account, month) not in flag_months,
        }
        for (account, month, label), metrics in sorted(grouped.items())
    ]


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
            "impressions": agg["impressions"],
            "clicks": agg["clicks"],
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

    flag_months = {
        (row["account_name"].replace("Elmich - ", ""), row["date_start"][:7])
        for row in flags
    }
    campaign_rows = load_monthly_level_rows(audit_root, "campaign")
    ad_rows = load_monthly_level_rows(audit_root, "ad")
    campaign_cells = aggregate_campaign_cells(campaign_rows, flag_months)
    growth_levers = growth_levers_from_cells(campaign_cells)
    campaign_groups = aggregate_named_months(
        campaign_rows,
        lambda row: campaign_group(row.get("campaign_name", "")),
        flag_months,
    )
    creative_formats = aggregate_named_months(
        ad_rows,
        lambda row: creative_format(row.get("ad_name", "")),
        flag_months,
    )
    creative_months: dict[str, set[str]] = defaultdict(set)
    for row in ad_rows:
        creative_months[row.get("account_name", "").replace("Elmich - ", "")].add(row["date_start"][:7])

    payload = {
        "meta": {
            "title": "ELM Meta Ads",
            "currency": "VND",
            "date_range": {"start": audit.START, "end": audit.END},
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source": "Cached Meta API v22.0 audit export",
            "confidence": "Directional until backend and PowerBI reconciliation",
            "artifact_version": audit.ARTIFACT_VERSION,
            "model_version": audit.MODEL_VERSION,
            "input_sha256": sha256(audit.SOURCE),
            "logic_sha256": sha256(Path(audit.__file__ or audit_root / "scripts/revise_audit_from_tom_review.py")),
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
            "mapped_spend_coverage": mapped_spend / regional_totals["spend"] if regional_totals["spend"] else None,
            "account_purchase_family": "website purchase family selected by normalized alias precedence",
            "regional_purchase_family": "onsite_conversion.purchase",
            "regional_onsite_events": regional_totals["purchases"],
            "account_website_purchases": purchases,
            "cross_family_ratio": regional_totals["purchases"] / purchases if purchases else None,
            "cross_family_ratio_is_reconciliation": False,
        },
        "account_daily": account_daily,
        "campaign_cells": campaign_cells,
        "growth_levers": growth_levers,
        "campaign_groups": campaign_groups,
        "creative_formats": creative_formats,
        "detail_coverage": {
            "campaign_months": 24,
            "campaign_cell_method": "Sanitized account × intent × level × product/category cells parsed from campaign names; raw campaign names and IDs are excluded.",
            "creative_months_by_account": {account: len(months) for account, months in sorted(creative_months.items())},
            "creative_method": "Format inferred from ad names; assets were not available for visual review.",
            "daily_campaign_attribution_available": False,
        },
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
