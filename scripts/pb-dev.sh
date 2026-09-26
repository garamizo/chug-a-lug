#!/usr/bin/env bash
# Foreground runner; stop with Ctrl-C. Relative data paths use the repository root; the default
# lives in CHUG_DATA (~/.chug-a-lug), outside every checkout.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
set -a
if [[ "${PB_SKIP_ENV:-0}" != 1 && -f .env ]]; then source .env; fi
set +a
: "${PB_ADMIN_EMAIL:?Set PB_ADMIN_EMAIL in the environment or .env}"
: "${PB_ADMIN_PASSWORD:?Set PB_ADMIN_PASSWORD in the environment or .env}"
CHUG_DATA="${CHUG_DATA:-$HOME/.chug-a-lug}"
CHUG_DATA="${CHUG_DATA/#\~/$HOME}"   # .env values arrive with ~ unexpanded
PB_DATA_DIR="${1:-$CHUG_DATA/pb_dev}"
PB_HTTP="${PB_HTTP:-127.0.0.1:8090}"
[[ $# -le 1 ]] || { echo 'Usage: scripts/pb-dev.sh [data-directory]' >&2; exit 1; }
[[ -x pocketbase/pocketbase ]] || bash scripts/pb-download.sh
mkdir -p "$PB_DATA_DIR"
ARGS=(--dir "$PB_DATA_DIR" --migrationsDir "$ROOT/pocketbase/pb_migrations" --hooksDir "$ROOT/pocketbase/pb_hooks")
pocketbase/pocketbase superuser upsert "$PB_ADMIN_EMAIL" "$PB_ADMIN_PASSWORD" "${ARGS[@]}" >/dev/null
# Disposable test servers set PB_AUTOMIGRATE=false so a test that edits collections never writes
# migration files into the repository.
exec pocketbase/pocketbase serve --dev --http "$PB_HTTP" --automigrate="${PB_AUTOMIGRATE:-true}" "${ARGS[@]}"
