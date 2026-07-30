#!/usr/bin/env bash
# Deploy a dev.twake.ai custom app into the kickstart cozyt container.
#
# Adaptation of dev.twake.ai's scripts/deploy-app.sh for the containerized
# cozy-stack: we rsync the app source into ./cozy_apps/<slug>/ on the host
# (bind-mounted read-only to /apps/<slug> inside cozyt) and drive
# cozy-stack apps install/update via `docker exec cozyt cozy-stack …`.
#
# The cozy-stack `file://` install reads the app source at request time,
# so the /apps mount must survive across deploys. Keep the source dir
# stable and just rsync on top.
#
# Usage:
#   scripts/deploy-app-kickstart.sh <slug> [--branch <branch>] [--build] [--dry-run] [--domain <inst>]
#
# --domain defaults to iterating every kickstart instance returned by
# `docker exec cozyt cozy-stack instances ls`.

set -euo pipefail

slug="${1:-}"
shift || true
branch=""
do_build=false
dry_run=false
target_domain=""
while [ $# -gt 0 ]; do
  case "$1" in
    --branch) branch="$2"; shift 2 ;;
    --build)  do_build=true; shift ;;
    --dry-run) dry_run=true; shift ;;
    --domain) target_domain="$2"; shift 2 ;;
    *) echo "Unknown flag: $1" >&2; exit 2 ;;
  esac
done

DRY="$( [ "$dry_run" = true ] && printf '[DRY] ' || true )"

if [ -z "$slug" ]; then
  sed -n '2,/^$/p' "$0" >&2
  exit 2
fi

# Slug → source subdir under the dev.twake.ai repo (matches deploy-app.sh).
case "$slug" in
  twakespaceng)  src_rel="twake-space-ng-app"    ;;
  twakeagentic)  src_rel="twake-agentic-app"     ;;
  grist)         src_rel="grist-app"             ;;
  excalidraw)    src_rel="excalidraw-app"        ;;
  kanbn)         src_rel="kanbn-app"             ;;
  openproject)   src_rel="openproject-app"       ;;
  n8n)           src_rel="n8n-app"               ;;
  twake2fa)      src_rel="twake-2fa-app"         ;;
  calendar)      src_rel="calendar-app"          ;;
  bentopdf)      src_rel="bentopdf-app"          ;;
  dashboard)     src_rel="dashboard-app/build"   ;;
  docaposte-sign) src_rel="docaposte-sign-app"   ;;
  drive)         src_rel="twake-drive/build"     ;;
  *) echo "Unknown slug: $slug" >&2; exit 2 ;;
esac

deploy_root="$(cd "$(dirname "$0")/.." && pwd)"
dev_repo="${DEV_TWAKE_REPO:-$HOME/work/dev.twake.ai}"
dst_dir="$deploy_root/cozy_apps/$slug"

if [ ! -d "$dev_repo" ]; then
  echo "FAIL: dev.twake.ai repo not at $dev_repo (override with DEV_TWAKE_REPO=...)" >&2
  exit 1
fi

# --branch: prefer an already-linked worktree so we don't switch the main repo.
repo_root="$dev_repo"
if [ -n "$branch" ]; then
  alt_worktree="$(git -C "$dev_repo" worktree list --porcelain 2>/dev/null \
    | awk -v b="refs/heads/$branch" '
        /^worktree / {wt=$2; next}
        $0=="branch "b {print wt; exit}
      ')"
  if [ -n "$alt_worktree" ] && [ "$alt_worktree" != "$dev_repo" ]; then
    echo "== $branch is checked out at $alt_worktree (worktree) — using it as source"
    repo_root="$alt_worktree"
  else
    start_branch="$(git -C "$dev_repo" rev-parse --abbrev-ref HEAD)"
    trap 'git -C "$dev_repo" checkout "$start_branch" >/dev/null 2>&1 || true' EXIT
    echo "== Checking out $branch in $dev_repo (from $start_branch)"
    git -C "$dev_repo" checkout "$branch"
  fi
fi

src_dir="$repo_root/$src_rel"
if [ ! -d "$src_dir" ]; then
  echo "FAIL: $src_rel does not exist on branch $(git -C "$repo_root" rev-parse --abbrev-ref HEAD)" >&2
  exit 1
fi

if [ "$do_build" = true ]; then
  build_dir="$(dirname "$src_dir")"
  echo "== ${DRY}yarn build in $build_dir"
  if [ "$dry_run" = false ]; then
    ( cd "$build_dir" && yarn build )
  fi
fi

echo "== ${DRY}Syncing $src_dir → $dst_dir"
if [ "$dry_run" = true ]; then
  rsync -an --delete --itemize-changes "$src_dir/" "$dst_dir/" 2>&1 | head -50
else
  mkdir -p "$dst_dir"
  rsync -a --delete "$src_dir/" "$dst_dir/"
fi

# Cache-bust unhashed static assets (same logic as dev.twake.ai deploy-app.sh).
if [ "$dry_run" = false ] && [ -f "$dst_dir/index.html" ]; then
  echo "== Adding cache-busters to index.html"
  for asset in bar.js bar.css editor.js editor.css; do
    [ -f "$dst_dir/$asset" ] || continue
    h=$(md5sum "$dst_dir/$asset" | cut -c1-8)
    sed -i -E "s|([\"'])${asset}([?][^\"']*)?([\"'])|\1${asset}?v=${h}\3|g" \
      "$dst_dir/index.html"
  done
fi

# Pick target instance(s).
target_src="file:///apps/$slug"
if [ -n "$target_domain" ]; then
  instances=("$target_domain")
else
  mapfile -t instances < <(docker exec cozyt cozy-stack instances ls 2>/dev/null | awk '{print $1}')
fi
if [ "${#instances[@]}" -eq 0 ]; then
  echo "FAIL: no instances returned by cozy-stack instances ls" >&2
  exit 1
fi

echo "== ${DRY}Deploying $slug (source=$target_src) to ${#instances[@]} instance(s)"
fail_count=0
for inst in "${instances[@]}"; do
  printf '  - %-50s ' "$inst"
  current_src=$(docker exec cozyt cozy-stack apps ls --domain "$inst" 2>/dev/null \
                | awk -v s="$slug" '$1==s {print $2}')
  if [ "$dry_run" = true ]; then
    if [ -z "$current_src" ]; then
      echo "would: install $slug $target_src"
    elif [ "$current_src" = "$target_src" ]; then
      echo "would: update $slug (same source)"
    else
      echo "would: uninstall+install $slug (was $current_src)"
    fi
    continue
  fi
  if [ -z "$current_src" ]; then
    docker exec cozyt cozy-stack apps install "$slug" "$target_src" --domain "$inst" 2>&1 | tail -1
  elif [ "$current_src" = "$target_src" ]; then
    docker exec cozyt cozy-stack apps update "$slug" --domain "$inst" 2>&1 | tail -1
  else
    docker exec cozyt cozy-stack apps uninstall "$slug" --domain "$inst" >/dev/null 2>&1
    docker exec cozyt cozy-stack apps install "$slug" "$target_src" --domain "$inst" 2>&1 | tail -1
  fi
  current_after=$(docker exec cozyt cozy-stack apps show "$slug" --domain "$inst" 2>/dev/null \
                  | python3 -c "import json,sys; print(json.load(sys.stdin).get('source',''))" 2>/dev/null)
  if [ "$current_after" = "$target_src" ]; then
    printf '    ✓ healthcheck OK\n'
  else
    printf '    ✗ healthcheck FAIL (Source=%s, expected=%s)\n' \
           "${current_after:-<none>}" "$target_src" >&2
    fail_count=$((fail_count + 1))
  fi
done

if [ "$fail_count" -gt 0 ]; then
  echo "== FAIL: $fail_count/${#instances[@]} instance(s) failed healthcheck" >&2
  exit 1
fi
echo "== ${DRY}Done. $slug deployed from $dst_dir to ${#instances[@]} instance(s)."
