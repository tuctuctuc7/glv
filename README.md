# GLV Dashboard

Static dashboard hub for Agenthic Lab client workspaces.

Deployable static files live in `public/`. Serverless APIs live in `api/`. Private refresh scripts stay outside `public/` so local paths and service-account details are not exposed.

The source Google Sheet is read-only. The dashboard layer exports only absolute metrics from the `Daily` tab:

- spend
- revenue
- purchases
- unique visitors

`BLENDED` rows are excluded. The dashboard's `All` filter is calculated from the CZSK, US, and ROW breakdown rows.

Derived metrics are calculated after date and region aggregation:

- ROAS = revenue / spend
- CPA = spend / purchases
- AOV = revenue / purchases
- CVR = purchases / unique visitors

## Refresh Data

```bash
/home/tom/.config/fb-sync/.venv/bin/python /home/tom/.openclaw/workspace/dashboard/glv/export_glv_dashboard.py
```

## Run Locally

```bash
cd /home/tom/.openclaw/workspace/dashboard/glv
python3 -m http.server 8081
```

Open `http://localhost:8081`.

## GitHub And Vercel

This folder is the source for the existing Vercel project:

- Vercel team: `agenthic`
- Vercel project: `agenthic-lab`
- Production domain: `https://lab.agenthic.com`
- GLV route: `https://lab.agenthic.com/glv/`
- GLV Meta Ads route: `https://lab.agenthic.com/glv-meta-ads/`

Vercel serves `public/` as the static site root. The root page at `/` is the Agenthic Lab index, `/glv/` is the GLV KPI dashboard, and `/glv-meta-ads/` is the GLV Meta Ads dashboard.

APIs are namespaced by dashboard:

```text
/api/glv-meta-ads/fb-data
/api/glv-meta-ads/cron
```

The GLV Meta Ads cron runs daily at 00:00 UTC / 07:00 UTC+7. The API and cron
run inside `agenthic-lab` using the project's Meta token and Upstash env vars.

Production URLs:

```text
https://lab.agenthic.com/glv
https://lab.agenthic.com/glv-meta-ads
https://agenthic-lab.vercel.app/glv
```

Deploy current local files:

```bash
cd /home/tom/.openclaw/workspace/dashboard/glv
PATH=/home/tom/.local/node/bin:$PATH vercel --prod --yes --scope agenthic
```

Refresh data and deploy:

```bash
/home/tom/.openclaw/workspace/dashboard/glv/deploy_glv_dashboard.sh
```

GitHub repo: `tuctuctuc7/glv`.

Once the GitHub repo exists and is connected to the Vercel project, pushes to `main` should deploy production.
