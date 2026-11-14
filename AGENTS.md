# AGENTS.md - GLV Dashboard

This directory is the source for the production `agenthic-lab` Vercel project serving `https://lab.agenthic.com`.

Before changing GLV code, read `README.md` in this directory. It contains the current Codex handoff, routes, env var names, timers, deploy commands, and historical gotchas.

Critical rules:

- Deploy only under the `tucmedia` Vercel team scope (Tom approved replacing the obsolete `agenthic` scope). Prefer the Git-linked production deploy after a reviewed PR merges; for an explicitly authorized CLI deploy from a clean checkout use `npx --no-install vercel --prod --yes --scope tucmedia`. Never use Tom's personal Vercel scope.
- Do not store, print, or repeat token/secret values.
- Keep private Google Sheet/service-account access local unless Tom explicitly asks to move it into Vercel.
- Business KPI dashboard data is USD from `public/glv/glv_dashboard.json`.
- Meta Ads and Media Buyer OS paid-media decisions use Meta API data in CZK; always label CZK.
- Keep `/glv-meta-ads/` and `/glv-mb-os/` password-gated through the existing `glv_meta_beta` cookie flow.
- Do not reintroduce legacy proxy rewrites to the old `glv-meta-ads.vercel.app` project.
