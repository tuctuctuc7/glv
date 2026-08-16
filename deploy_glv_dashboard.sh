#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/tom/.openclaw/workspace/dashboard/glv"
export PATH="/home/tom/.local/node/bin:$PATH"

DATASETS=(
  public/glv/glv_dashboard.json
  public/glv-2/glv_dashboard.json
)

RELEASE_ROOT="$(mktemp -d /tmp/glv-dashboard-release.XXXXXX)"
RELEASE_ADDED=0
cleanup() {
  if [ "$RELEASE_ADDED" = "1" ]; then
    git -C "$ROOT" worktree remove --force "$RELEASE_ROOT" >/dev/null 2>&1 || true
  else
    rm -rf "$RELEASE_ROOT"
  fi
}
trap cleanup EXIT

wait_for_vercel() {
  local release_sha="$1"
  local state="pending"
  for _attempt in $(seq 1 60); do
    state="$(gh api "repos/tuctuctuc7/glv/commits/$release_sha/status" \
      --jq '[.statuses[] | select(.context == "Vercel")][0].state // "pending"')"
    case "$state" in
      success)
        echo "Vercel deployment succeeded for $release_sha"
        return 0
        ;;
      error|failure)
        echo "Vercel deployment failed for $release_sha" >&2
        return 1
        ;;
    esac
    sleep 5
  done
  echo "Timed out waiting for Vercel deployment of $release_sha (last state: $state)" >&2
  return 1
}

# Never export or deploy from the long-lived canonical checkout. It may be dirty
# or behind origin/main while another agent is working. Freeze current main in a
# clean detached worktree instead.
git -C "$ROOT" fetch origin main
rmdir "$RELEASE_ROOT"
git -C "$ROOT" worktree add --detach "$RELEASE_ROOT" origin/main
RELEASE_ADDED=1

/home/tom/.config/fb-sync/.venv/bin/python "$RELEASE_ROOT/export_glv_dashboard.py"
cd "$RELEASE_ROOT"
npm run verify:glv-release

if git diff --quiet -- "${DATASETS[@]}"; then
  echo "GLV dashboard data is unchanged; no production deployment required"
  exit 0
fi

git add "${DATASETS[@]}"
git commit -m "refresh GLV dashboard data"

# The push is the production release trigger. A rejected fast-forward fails the
# job, and there is deliberately no direct production CLI fallback that could
# overwrite a newer production frontend from stale local source.
git push origin HEAD:main
RELEASE_SHA="$(git rev-parse HEAD)"
wait_for_vercel "$RELEASE_SHA"
