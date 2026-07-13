# AGENTS.md - GLV Dashboard

This directory is the source for the production `agenthic-lab` Vercel project serving `https://lab.agenthic.com`.

Before changing GLV code, read `README.md` in this directory. It contains the current Codex handoff, routes, env var names, timers, deploy commands, and historical gotchas.

Critical rules:

- Deploy with `vercel --prod --yes --scope agenthic`; do not use Tom's personal Vercel scope.
- Do not store, print, or repeat token/secret values.
- Keep private Google Sheet/service-account access local unless Tom explicitly asks to move it into Vercel.
- Business KPI dashboard data is USD from `public/glv/glv_dashboard.json`.
- Meta Ads and Media Buyer OS paid-media decisions use Meta API data in CZK; always label CZK.
- Keep `/glv-meta-ads/` and `/glv-mb-os/` password-gated through the existing `glv_meta_beta` cookie flow.
- Do not reintroduce legacy proxy rewrites to the old `glv-meta-ads.vercel.app` project.
