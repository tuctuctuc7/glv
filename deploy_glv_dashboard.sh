#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/tom/.openclaw/workspace/dashboard/glv"
export PATH="/home/tom/.local/node/bin:$PATH"

/home/tom/.config/fb-sync/.venv/bin/python "$ROOT/export_glv_dashboard.py"
cd "$ROOT"

DATASETS=(
  public/glv/glv_dashboard.json
  public/glv-2/glv_dashboard.json
)

if ! git diff --quiet -- "${DATASETS[@]}"; then
  git add "${DATASETS[@]}"
  git commit -m "refresh GLV dashboard data"
fi

if [ "$(git rev-list --count @{u}..HEAD 2>/dev/null || echo 0)" != "0" ]; then
  git push origin main || echo "Warning: git push failed; continuing with direct Vercel deploy"
fi

vercel --prod --yes --scope agenthic
