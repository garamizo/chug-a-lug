#!/usr/bin/env bash
# just loads .env. One stack, one database: practice happens on Live on any day that is not the
# current route's date (see README "Practice days").
set -euo pipefail
cd "$(dirname "$0")/.."
# Runtime state lives outside every checkout, so no git operation can delete it. Create the
# directories as this user first; otherwise Docker creates them root-owned and PocketBase (which
# runs as 1000:1000) cannot open its database.
CHUG_DATA="${CHUG_DATA:-$HOME/.chug-a-lug}"
CHUG_DATA="${CHUG_DATA/#\~/$HOME}"   # .env values arrive with ~ unexpanded
mkdir -p "$CHUG_DATA"/pb_data "$CHUG_DATA"/gtfs "$CHUG_DATA"/places "$CHUG_DATA"/recordings
export CHUG_DATA
docker compose -f compose.yml up -d --build
