---
name: camp-log
description: "Create and publish evidence-backed GLV/Gelavis daily or weekly campaign logs from the GLV business KPI dashboard and Meta Ads data. Use for campaign-log entries, CZSK and US performance reviews, creative/campaign/ad-set evaluations, reporting snapshots, or updates to the Notion Campaign Log. Read-only analysis only: never change campaigns as part of this skill."
---

# GLV Campaign Log

Produce concise operating reports that another media buyer can verify from source data. Treat the GitHub repositories as implementation context, dashboards as performance sources, and Notion as the publishing destination.

## Establish repository context

1. Use `tuctuctuc7/glv` as the canonical repository and production source. It serves:
   - `https://lab.agenthic.com/glv/` — business KPIs in USD.
   - `https://lab.agenthic.com/glv-meta-ads/` — password-gated Meta Ads data in CZK.
   - `https://lab.agenthic.com/glv-mb-os/` — paid-media decision interface in CZK.
2. Read `README.md` and `AGENTS.md` in `tuctuctuc7/glv` before relying on routes, schemas, aggregation rules, or deployment context.
3. Consult `tuctuctuc7/glv-meta-ads` only for legacy history when necessary. The standalone app was migrated into `glv`; never treat the legacy repository or `glv-meta-ads.vercel.app` as the production source.
4. If no checkout is available, use the connected GitHub tool to fetch both repositories. Do not require repository writes to create a report.

## Collect current evidence

1. Find the shared Notion page `CAMPAIGN LOG` and its inline `Campaign Log` database. Read the latest three to five substantive entries before drafting.
2. Set exact dates and data freshness. For a weekly overview, use the latest seven complete data days. Exclude the current partial day.
3. From the business KPI dashboard or `public/glv/glv_dashboard.json`, collect:
   - July/month-to-date `All` revenue, spend, and ROAS when at least seven complete days exist; otherwise use the latest 14 complete days.
   - Daily rows for the reporting window, split into CZSK and US.
4. From the authenticated Meta Ads dashboard/API, collect the same-window account, campaign, ad-set, and ad/creative breakdowns. Do not infer paid-media performance from business KPI data.
5. If Meta access is unavailable, complete only the KPI portion and stop before publishing creative, campaign, or ad-set recommendations. Ask for a signed-in session.

## Calculate correctly

- Business KPI values are USD. Meta Ads and Media Buyer OS values are CZK. Label every currency.
- Aggregate absolute values first; never average daily ratios.
- Calculate `ROAS = revenue / spend`, `CPA = spend / purchases`, `AOV = revenue / purchases`, and `CVR = purchases / visitors`.
- Use `All` only for context. Keep CZSK and US separate for operating conclusions.
- Rank creatives by spend within each market. Compare the top five with the same-market baseline for ROAS, CPA, CTR/link CTR, CVR, and purchases.
- Never call a winner from CTR alone. Require meaningful spend and conversion evidence.
- Use campaign and ad-set identifiers embedded in names, such as `TUC_003`, `GLV_016`, and `AS01`; never substitute Meta object IDs.

## Apply market rules

### CZSK

- Treat as a mature performance market focused on revenue growth at sustainable efficiency.
- Below `1.0x` ROAS: downscale or stop; below `1.2x` is an alarm.
- `1.0x–1.7x`: keep or optimize.
- Above `1.7x`: scale only when spend, conversion volume, and the latest two-day tendency support it.
- Standard increase is `20%`; bullish increase is up to `50%`. Standard downscale starts at `25%`; protective downscale is up to `50%`.
- Usually stop ad sets below CZK 300 spend instead of reducing them.
- Flag strong landing-page-view or checkout signals with weak ROAS for judgment; do not kill blindly.

### US

- Treat as PMF discovery until repeatable `1.0x` ROAS appears.
- Prioritize repeatable checkouts and purchases, then movement toward breakeven.
- Treat high CTR without purchases as an offer, landing-page, or funnel-fit question before declaring the creative bad.
- Flag fragmented low-spend ad sets, learning instability, and high CPM for consolidation attention.

## Build the report

1. Duplicate a proven recent Campaign Log page/template so its cover and tucmedia icon remain consistent. Update the duplicate; do not rebuild the page shell from scratch.
2. Use `YYYY-MM-DD` as the title. Use `YYYY-MM-DD (weekly overview)` only for a broader weekly synthesis matching recent convention.
3. Open with a static revenue-bar and ROAS-line snapshot. Use a dark navy background, bright cyan/blue bars, and a high-contrast line.
4. Because the image is non-interactive, always print both y-axis scales:
   - left: revenue values with currency;
   - right: ROAS values with `x` suffix;
   - align both sets of ticks to the gridlines and retain date labels on the x-axis.
5. Keep the copy compact and data-led:
   - performance summary with exact period and freshness;
   - CZSK last-7-day result, tendencies, top creatives, and campaign/ad-set attention;
   - blank `CZ/SK · Campaign changelog` section;
   - US last-7-day result, tendencies, top creatives, and campaign/ad-set attention;
   - blank `US · Campaign changelog` section.
6. Separate facts, tendencies, and recommendations. Never invent executed actions, impact, or post-change results.

## Decision language

- **Scale candidate:** above-average ROAS, below-average CPA, purchases, and sufficient spend.
- **Watch/test:** mixed signals, low spend, or sparse conversions.
- **Downscale/stop candidate:** below-average ROAS and above-average CPA after significant spend.
- Write like an operator: short bullets, exact figures, and direct implications. Avoid generic praise and long introductions.
- Use `🚀`, `🟠`, and `🔴` only as optional operating markers.

## Publish and verify

1. Create or update only the intended Notion page. Preserve any human edits made since the last read.
2. Leave both human campaign changelog sections empty and obvious.
3. Re-fetch the published page and verify:
   - title, cover, tucmedia icon, and opening chart;
   - exact dates and freshness;
   - five readable visuals where the template uses five;
   - both y-axis scales on the opening chart;
   - USD/CZK labels and market separation;
   - two blank changelog sections;
   - no secrets or invented execution claims.
4. Report what was published and explicitly confirm that no campaign changes were made.

## Safety

- This skill is read-only analysis and reporting. Never edit Meta campaigns, budgets, ads, or ad sets.
- Never print, store, or commit passwords, tokens, cookies, service-account contents, Slack secrets, or private environment values.
- Do not deploy either repository as part of campaign logging.
