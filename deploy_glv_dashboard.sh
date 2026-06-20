#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/tom/.openclaw/workspace/dashboard/glv"
export PATH="/home/tom/.local/node/bin:$PATH"

/home/tom/.config/fb-sync/.venv/bin/python "$ROOT/export_glv_dashboard.py"
cd "$ROOT"
vercel --prod --yes --scope agenthic
