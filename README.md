# GLV Dashboard Handoff

This repo is the `agenthic-lab` Vercel project that serves the GLV dashboard surfaces on `lab.agenthic.com`.

## Production

- Vercel team: `agenthic`
- Vercel project: `agenthic-lab`
- GitHub repo: `https://github.com/tuctuctuc7/glv`
- Production domain: `https://lab.agenthic.com`
- Lab index: `https://lab.agenthic.com/`
- Business KPI dashboard: `https://lab.agenthic.com/glv/`
- Meta Ads dashboard: `https://lab.agenthic.com/glv-meta-ads/`
- Media Buyer OS: `https://lab.agenthic.com/glv-mb-os/`

Always deploy with the AGENTHIC Vercel scope:

```bash
cd /home/tom/.openclaw/workspace/dashboard/glv
PATH=/home/tom/.local/node/bin:$PATH vercel --prod --yes --scope agenthic
```

Do not deploy this to Tom's personal Vercel scope. `agenthic.com` belongs to the AGENTHIC team.

## Repository Map

```text
public/
  index.html                 Agenthic Lab index
  glv/                       static business KPI dashboard
  glv-meta-ads/              password-gated Meta Ads dashboard
  glv-mb-os/                 password-gated Media Buyer OS cockpit
api/
  glv-meta-ads/              Meta Ads, decision, auth, and summary APIs
  glv-mb-os/                 browser-safe proxy for Media Buyer OS
middleware.js                Vercel auth middleware for gated surfaces
export_glv_dashboard.py      exports private Google Sheet to public JSON
deploy_glv_dashboard.sh      export, commit/push JSON, deploy production
vercel.json                  static output, headers, and daily Vercel cron
```

Static assets are served from `public/`. Serverless functions live in `api/`. Private service-account files, tokens, and Slack details stay outside the repo.

## Business KPI Dashboard

Route: `/glv/`

The business KPI dashboard is a static frontend backed by:

```text
public/glv/glv_dashboard.json
```

The JSON is generated locally from a read-only Google Sheet:

- Sheet ID: `1KjiRfumk3w8tNZFpfI8RO9X5RTcqoq5LcKfyCzcpplQ`
- Tab: `Daily`
- Export script: `export_glv_dashboard.py`
- Python env: `/home/tom/.config/fb-sync/.venv/bin/python`
- Env file used by exporter: `/home/tom/.config/fb-sync/.env`

Export command:

```bash
/home/tom/.config/fb-sync/.venv/bin/python /home/tom/.openclaw/workspace/dashboard/glv/export_glv_dashboard.py
```

The exporter includes only absolute metrics:

- spend
- revenue
- purchases
- unique visitors

`BLENDED` rows are excluded. The dashboard `All` filter is calculated from `CZSK`, `US`, and `ROW` rows.

Derived metrics are calculated after date and region aggregation:

- ROAS = revenue / spend
- CPA = spend / purchases
- AOV = revenue / purchases
- CVR = purchases / unique visitors

Currency for the business KPI dashboard JSON is USD.

## Meta Ads Dashboard

Route: `/glv-meta-ads/`

This is password-gated by Vercel middleware using the `glv_meta_beta` cookie. Login lives at:

```text
public/glv-meta-ads/login.html
api/glv-meta-ads/auth.js
```

Meta Ads data comes from the Meta Graph API through Vercel serverless functions. The ad account is hardcoded in the API files:

```text
act_359758259164738
```

Main APIs:

```text
/api/glv-meta-ads/fb-data
/api/glv-meta-ads/cron
/api/glv-meta-ads/decision-input
/api/glv-meta-ads/decision-report
/api/glv-meta-ads/creative-previews
/api/glv-meta-ads/us-offer-glitch-analysis
/api/glv-meta-ads/post-cron-summary
```

The dashboard fetches `/api/glv-meta-ads/fb-data` with:

- `type=aggregate`
- `type=daily`
- `type=ads`

Standard cached presets:

- `last_7d`
- `last_14d`
- `last_30d`
- `last_90d`
- `this_month`
- `last_month`

Cron prewarms the standard presets into Upstash/Vercel KV. Custom ranges and cache misses can hit Meta live.

Meta Ads currency is CZK. Always label it as CZK in reports, Slack summaries, and paid-media decision logic.

## Media Buyer OS

Route: `/glv-mb-os/`

This is the standalone decision interface. It is separate from the Meta Ads dashboard and uses the same beta password/login.

Files:

```text
public/glv-mb-os/index.html
api/glv-mb-os/decision-report.js
api/glv-meta-ads/decision-input.js
api/glv-meta-ads/decision-report.js
```

`/api/glv-mb-os/decision-report` is a browser-safe proxy. It checks the beta auth cookie, then calls the protected server-side `/api/glv-meta-ads/decision-report` with `GLV_META_DECISION_SECRET || GLV_META_SUMMARY_SECRET`.

Decision logic uses Meta data in CZK. The business dashboard is still useful for broad brand context in USD, but paid-media actions should be grounded in Meta API data unless Tom says otherwise.

Current durable GLV/Gelavis decision rules:

- CZSK is a performance market focused on revenue growth and efficiency.
- ROAS below `1.0x`: scale down or stop.
- ROAS `1.0x-1.7x`: keep/optimize.
- ROAS above `1.7x`: scale, unless other signals say not to.
- High ROAS without increased spend is a scaling failure.
- Check 2-day spend and ROAS tendency before making budget calls.
- Below `1.2x` ROAS is an alarm.
- Standard daily increase: `20%`.
- Bullish increase: up to `50%`.
- Standard downscale starts at `25%`.
- Protective downscale: up to `50%`.
- Ad sets below `CZK 300` spend should generally be stopped instead of reduced.
- Low ROAS with strong LPV/checkout signals should be flagged for judgement, not blindly killed.
- US is PMF discovery, not mature performance yet. Goal is consistent checkouts and purchases, then breakeven ASAP. Once US reaches repeatable `1.0x` ROAS, treat it as a performance market.

## Environment Variables

Do not store or print secret values in repo docs, memory, logs, or chat.

Used by Vercel production:

```text
GLV_META_FB_ACCESS_TOKEN or FB_ACCESS_TOKEN
CRON_SECRET or GLV_META_CRON_SECRET
KV_REST_API_URL or UPSTASH_REDIS_REST_URL
KV_REST_API_TOKEN or UPSTASH_REDIS_REST_TOKEN
KV_REST_API_READ_ONLY_TOKEN
GLV_META_BETA_PASSWORD
GLV_META_BETA_AUTH_TOKEN
GLV_META_SUMMARY_SECRET
GLV_META_DECISION_SECRET
GLV_META_BASE_URL
```

Used by local service-account and Slack scripts:

```text
/home/tom/.config/fb-sync/.env
GOOGLE_CREDENTIALS_PATH
SLACK_CHANNEL_ID
GLV_META_SUMMARY_SECRET
TZ
```

The old `glv-meta-ads` Vercel project was migrated into `agenthic-lab`; do not reintroduce proxy rewrites back to `glv-meta-ads.vercel.app`.

## Automation

There are three relevant schedules.

### Business KPI Refresh

Local systemd user timer:

```text
~/.config/systemd/user/glv-dashboard-daily-refresh.timer
~/.config/systemd/user/glv-dashboard-daily-refresh.service
~/.local/bin/glv-dashboard-daily-refresh.sh
```

Schedule:

```text
02:10 Europe/Prague
00:10 UTC during Prague summer time
07:10 UTC+7
```

Flow:

1. Run `deploy_glv_dashboard.sh`.
2. Export the private Google Sheet into `public/glv/glv_dashboard.json`.
3. Commit changed JSON as `refresh GLV dashboard data`.
4. Push to `origin main` if ahead.
5. Deploy production to Vercel with `--scope agenthic`.

Logs:

```bash
journalctl --user -u glv-dashboard-daily-refresh.service -n 100 --no-pager
cat ~/.local/state/glv-dashboard-daily-refresh.log
```

### Business KPI Morning Slack Check

Local systemd user timer:

```text
~/.config/systemd/user/glv-dashboard-morning-crawl.timer
~/.config/systemd/user/glv-dashboard-morning-crawl.service
~/.local/bin/glv-dashboard-morning-crawl.py
```

Schedule:

```text
00:30 UTC
07:30 UTC+7
```

Flow:

1. Fetch `https://lab.agenthic.com/glv/`.
2. Fetch `https://lab.agenthic.com/glv/glv_dashboard.json`.
3. Calculate yesterday's all-region revenue, spend, and ROAS from dashboard aggregation rules.
4. Send Slack status to `SLACK_CHANNEL_ID`.

Status labels:

```text
Pass ✅
Needs check ❌
```

Use `/home/linuxbrew/.linuxbrew/bin/openclaw` in this script. The older `/home/tom/.openclaw/bin/openclaw` wrapper can fail config validation.

### Meta Ads Cron And Slack Summary

Vercel cron:

```text
/api/glv-meta-ads/cron
0 0 * * *
00:00 UTC
07:00 UTC+7
```

Local post-cron Slack timer:

```text
~/.config/systemd/user/glv-meta-ads-post-cron-slack.timer
~/.config/systemd/user/glv-meta-ads-post-cron-slack.service
~/.local/bin/glv-meta-ads-post-cron-slack.py
```

Schedule:

```text
00:15 UTC
07:15 UTC+7
```

Flow:

1. Vercel cron refreshes Meta Ads caches in Redis/KV.
2. Local script calls `https://lab.agenthic.com/api/glv-meta-ads/post-cron-summary` with `GLV_META_SUMMARY_SECRET`.
3. Endpoint reads Redis key `glv:daily:last_7d`.
4. It summarizes yesterday for CZSK and US.
5. Local script sends Slack status to `SLACK_CHANNEL_ID`.

Post-cron summary output uses CZK.

## Health Checks

Systemd timers:

```bash
systemctl --user list-timers --all 'glv*' --no-pager
systemctl --user status glv-dashboard-daily-refresh.timer
systemctl --user status glv-dashboard-morning-crawl.timer
systemctl --user status glv-meta-ads-post-cron-slack.timer
```

Recent service logs:

```bash
journalctl --user -u glv-dashboard-daily-refresh.service -n 100 --no-pager
journalctl --user -u glv-dashboard-morning-crawl.service -n 100 --no-pager
journalctl --user -u glv-meta-ads-post-cron-slack.service -n 100 --no-pager
```

Production smoke tests:

```bash
curl -I https://lab.agenthic.com/
curl -I https://lab.agenthic.com/glv/
curl -I https://lab.agenthic.com/glv/glv_dashboard.json
curl -I https://lab.agenthic.com/glv-meta-ads/
curl -I https://lab.agenthic.com/glv-mb-os/
```

Unauthenticated `/glv-meta-ads/` and `/glv-mb-os/` should redirect to login. Unauthenticated gated APIs should return `401`.

## Local Development

For static dashboard work:

```bash
cd /home/tom/.openclaw/workspace/dashboard/glv
python3 -m http.server 8081
```

Open:

```text
http://localhost:8081
```

For serverless API behavior, use Vercel local tooling if needed:

```bash
cd /home/tom/.openclaw/workspace/dashboard/glv
PATH=/home/tom/.local/node/bin:$PATH vercel dev --scope agenthic
```

## Known History And Gotchas

- `dashboard/glv` is the source for `agenthic/agenthic-lab`.
- Root `/` is the Agenthic Lab index.
- `/glv/` is the plain business KPI dashboard.
- `/glv-meta-ads/` is the Meta Ads dashboard.
- `/glv-mb-os/` is the Media Buyer OS.
- The old standalone `glv-meta-ads` app was migrated into this repo. Keep API routes namespaced under `/api/glv-meta-ads/*`.
- Earlier frontend breakage was caused by a fatal JS typo in the GLV Meta Ads dashboard, not by the Meta API token. If the page spins forever, check browser JS first.
- The Frankfurter CZK to USD exchange-rate fetch was made non-blocking with a timeout so it cannot prevent dashboard load.
- Vercel cannot access the private GLV Google Sheet unless service-account credentials are moved into Vercel env vars. Current design intentionally keeps the business KPI export local.
- Meta tokens have expired before. If cron/live Meta reads return Meta code `190`, rotate `GLV_META_FB_ACCESS_TOKEN` or `FB_ACCESS_TOKEN` in Vercel production, redeploy if needed, and rerun cron.
- Do not store or repeat Tom's GitHub token, Meta token, Vercel secrets, Slack channel secrets, or service-account contents.
- Browser screenshot verification has been blocked before because the host lacked managed Chromium dependencies. JS/runtime smoke tests with mock data were used as fallback.

## Related Reports And Docs

Useful workspace report artifacts:

```text
../../reports/glv-meta-ads-pmf-report-2026-06-23.md
../../reports/2026-06-30_analysis_glv_30d_creative_winners.md
../../reports/2026-07-02_analysis_glv_creative_evaluation_sop.md
../../reports/2026-07-02_analysis_glv_us_q2_sop_creative_evaluation.md
../../reports/gelavis_decision_engine_spec_v1.md
../../reports/gelavis_campaign_decision_report_2026-06-23.md
../../reports/gelavis_decision_engine_implementation_files.md
```

Durable Notion context exists for GELAVIS under the Jarvis project, including Client Onboarding Brief, Media Buyer Playbook, Decision API Config, Decision Engine Spec, and Decision Engine Implementation Files. Prefer updating those existing Documents database entries if Tom asks for Notion refinements.
