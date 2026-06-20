# GLV Dashboard

Static dashboard prototype for the GLV KPI source sheet.

Deployable static files live in `public/`. The private refresh script stays outside `public/` so local paths and service-account details are not exposed.

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

Vercel serves `public/` as the static site root. The root page at `/` is the Agenthic Lab index, and `/glv/` is the GLV dashboard.

Production URLs:

```text
https://lab.agenthic.com/glv
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
