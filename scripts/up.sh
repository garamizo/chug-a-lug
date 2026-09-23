#!/usr/bin/env bash
# just loads .env; this script selects a complete mode without changing the real event's data.
set -euo pipefail
cd "$(dirname "$0")/.."
compose=(docker compose -f compose.yml)
case "${REHEARSAL-1}" in
  1)
    compose+=(-f compose.rehearsal.yml)
    for directory in data/rehearsal data/rehearsal/pb_data data/rehearsal/cache data/rehearsal/cache/gtfs data/rehearsal/cache/places data/rehearsal/cache/recordings; do
      [[ ! -L "$directory" ]] || { echo 'Rehearsal data cannot be a symlink.' >&2; exit 1; }
      mkdir -p "$directory"
    done
    node web/scripts/prepare-rehearsal.mjs
    export REHEARSAL_RUN_ID
    REHEARSAL_RUN_ID="$(node -p "JSON.parse(require('fs').readFileSync('data/rehearsal/source/scenario.json', 'utf8')).runId")"
    "${compose[@]}" down
    # Only the isolated practice database: removes uploads and invalidates all old logins.
    rm -rf -- data/rehearsal/pb_data data/rehearsal/initialized.json data/rehearsal/setup.lock
    mkdir -p data/rehearsal/pb_data
    "${compose[@]}" up -d --build
    "${compose[@]}" run --build --rm --no-deps rehearsal-init
    ;;
  0)
    mkdir -p data/gtfs data/places data/recordings
    "${compose[@]}" up -d --build
    ;;
  *) echo 'REHEARSAL must be 1 (practice, default) or 0 (real event).' >&2; exit 1 ;;
esac
