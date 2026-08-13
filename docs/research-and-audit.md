# GLV Executive BI — Research, Audit, and Design Rationale

**Status:** Prototype research record
**Scope:** Daily spend, revenue, purchases, and daily unique visitors for CZSK, US, and ROW
**Prototype:** `prototype/glv-ceo-bi-v1` in the isolated worktree
**Production:** Not modified

## 1. Executive decision contract

The dashboard should answer:

> Is GLV growing efficiently and in the right regions, and what deserves investigation now?

It supports four bounded actions:

1. **Scale** where revenue, purchases, and revenue-to-spend efficiency move together.
2. **Protect** when revenue, purchases, traffic, or monetization weaken.
3. **Reallocate** attention between CZSK, US, and ROW when contribution and efficiency diverge.
4. **Investigate** meaningful movement without claiming the available data explains causality.

## 2. Evidence-backed design principles applied

### P0 — applied

- **One-screen hierarchy:** scope/trust → CEO brief → outcome and efficiency KPIs → trends/diagnostics → regions/signals → audit detail.
- **Small causal KPI set:** `Spend → daily visitors → visitor purchase rate → purchases → AOV → revenue`; CPA and revenue/spend summarize efficiency.
- **Outcome-first cards:** Revenue, Purchases, Revenue/spend, and CPA appear before supporting levers.
- **Comparable periods:** every selected period is compared with the immediately preceding equal-length period.
- **28-day default:** reduces weekday noise while retaining daily resolution.
- **Raw + smoothed trend:** raw daily values remain visible with a comparable-scale 7-day moving average and previous-period trace.
- **Direction-aware deltas:** higher revenue/purchases/AOV/visitor purchase rate/revenue-spend is favorable; lower CPA is favorable; spend is neutral without a plan.
- **Visible trust:** data-through date, refresh timestamp, currency, coverage, source, aggregation method, and limitations are in the interface.
- **Zero is not undefined:** zero-denominator ratios render as `—`, not an invented zero.
- **Ratios after aggregation:** absolute metrics are summed first; ratios are derived from those sums rather than averaging daily ratios.
- **Mobile decision order:** scope/freshness → brief → four headline KPIs → signals → remaining levers → trends/regions/detail.
- **Accessible fallbacks:** semantic regions, keyboard controls, skip link, visible focus, status regions, signed deltas, non-color cues, and chart text/table alternatives.

### P0 — explicit gaps, not invented

- **Targets:** no plan, budget, forecast, or guardrails are present in the source. The UI states `no targets configured`; historical comparison is not mislabeled as a target.
- **Profitability:** no COGS, contribution margin, gross margin, fees, shipping, returns, refunds, or taxes. Revenue/spend is never presented as profit.
- **Attribution:** no advertising source or attribution model. The ratio is labeled descriptive `Revenue / spend`, not attributed ROAS.
- **Standard ecommerce CVR:** the source has daily unique visitors, not sessions. The interface labels `Visitor purchase rate` and discloses that returning visitors can be counted across days.
- **Automated anomaly detection:** without operating thresholds and sufficient seasonal history, the prototype provides deterministic `signals to investigate`, not statistical anomaly claims or automated decisions.

## 3. Current dashboard audit that drove the redesign

The original public implementation was clean and lightweight, but not decision-safe or executive-grade.

### Critical calculation and semantic risks

1. Zero-denominator ratios were presented as zero. This made spend with zero purchases look like `$0 CPA` and revenue with zero recorded spend look like `0.00x` efficiency.
2. Daily unique visitors were summed across dates without disclosing non-additivity; the resulting conversion-style ratio could be mistaken for standard session conversion rate.
3. Stored source rows contain absolute metrics only. Derived ratios therefore must be calculated after aggregation, not trusted as row fields or averaged.
4. `ROAS` implied paid-media attribution even though the source does not declare an attribution model.
5. Revenue and revenue/spend could be mistaken for profit without margin and refund data.

### Missing executive functionality

- No explicit KPI hierarchy or causal chain.
- No equal-length previous-period comparison.
- No CEO narrative or revenue-change decomposition.
- No regional contribution and movement analysis.
- No growth-quality diagnostic.
- No prioritized investigation queue.
- No visible freshness/methodology/limitations contract.
- No daily/weekly/monthly aggregation, shareable filter state, or CSV export.
- Weak mobile density and detail-table handling.

### Accessibility and UX gaps addressed

- Added semantic navigation/main/section structure and a skip link.
- Added loading, error, and status regions.
- Added keyboard-operable controls and focus styles.
- Added a text fallback for the chart.
- Added signed labels and text so color is not the only carrier of meaning.
- Added intentional table scrolling and a mobile hint.
- Added a compact mobile freshness badge and decision-priority ordering.

## 4. Metric contract

| Metric | Prototype definition | Important limitation |
|---|---|---|
| Revenue | Sum of recorded revenue | Gross/net basis, tax, shipping, returns, refunds, and margin are unknown |
| Spend | Sum of recorded spend | Source/channel scope is not declared |
| Purchases | Sum of recorded purchases | Order/customer deduplication rules are not declared |
| Daily visitors | Sum of recorded daily unique-visitor counts | Non-additive across days and potentially regions |
| Revenue / spend | Aggregated revenue ÷ aggregated spend | Not profit and not attributed ROAS; undefined when spend is zero |
| CPA | Aggregated spend ÷ aggregated purchases | Cost per recorded purchase, not necessarily new-customer CAC |
| AOV | Aggregated revenue ÷ aggregated purchases | Revenue-basis caveats apply |
| Visitor purchase rate | Aggregated purchases ÷ summed daily unique-visitor counts | Directional; not standard orders ÷ sessions CVR |

## 5. Responsibly supportable now vs data required

### Responsible now

- Business pulse for selected dates and regions.
- Equal-length prior-period comparison.
- Daily, weekly, and monthly views.
- Revenue change decomposition into purchase-volume and AOV components.
- Revenue/spend, CPA, AOV, and visitor purchase rate after aggregation.
- Regional revenue contribution and absolute movement.
- Deterministic investigation signals with explicit evidence.
- CSV export and auditable daily rows.

### Requires new governed data

- **Profit and contribution:** COGS, fulfillment, processing fees, shipping, tax, refunds, returns, discounts.
- **Media attribution:** platform, channel, campaign/ad set/ad, attribution window/model, click/view split.
- **Customer economics:** customer ID, new/returning status, cohort, repeat purchase, LTV, retention.
- **Funnel diagnostics:** sessions, device, landing page, add-to-cart, checkout starts, abandonment.
- **Product/mix:** SKU, category, units, inventory, stockouts, discount/promotion markers.
- **Targets and pacing:** approved budget, revenue target, CPA guardrail, margin floor, forecast.
- **Causal annotations:** campaigns, launches, outages, tracking changes, promotions, holidays.

## 6. Source references

- Microsoft, **Tips for designing a great Power BI dashboard**: hierarchy, uncluttered overview, consistent scales and time frames.
  https://learn.microsoft.com/en-us/power-bi/create-reports/service-dashboards-design-tips
- Microsoft, **KPI visualizations**: current measure against target and trend; ahead/behind and distance to goal.
  https://learn.microsoft.com/en-us/power-bi/visuals/power-bi-visualization-kpi
- Microsoft, **Anomaly detection**: expected ranges, sensitivity, and explanatory dimensions.
  https://learn.microsoft.com/en-us/power-bi/visuals/power-bi-visualization-anomaly-detection
- Microsoft, **Drillthrough**: context-preserving path from summary to detail.
  https://learn.microsoft.com/en-us/power-bi/create-reports/desktop-drillthrough
- Microsoft, **Mobile-optimized Power BI reports**: intentionally rearrange and select mobile-relevant views.
  https://learn.microsoft.com/en-us/power-bi/create-reports/power-bi-create-mobile-optimized-report-about
- Shopify, **Ecommerce metrics**: KPI set and operational vs strategic monitoring cadence.
  https://www.shopify.com/blog/basic-ecommerce-metrics
- Shopify, **Ecommerce conversion rate**: sessions vs users, context-specific benchmarks, and source-of-truth consistency.
  https://www.shopify.com/blog/ecommerce-conversion-rate
- Google Analytics, **Data freshness**: processing delays, temporary intraday gaps, and changing attribution credit.
  https://support.google.com/analytics/answer/11198161
- Looker, **Creating alerts**: thresholds, change conditions, schedules, notifications, and driver analysis.
  https://cloud.google.com/looker/docs/creating-alerts
- Looker, **Content certification**: accuracy, consistency, governance, reliability, and documentation.
  https://cloud.google.com/looker/docs/content-certification
- WCAG 2.2, **Quick Reference**: semantic structure, keyboard access, contrast, focus, status, and reflow.
  https://www.w3.org/WAI/WCAG22/quickref/
- WCAG 2.2, **Reflow** and **Target Size**.
  https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
  https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
