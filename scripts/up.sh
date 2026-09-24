#!/usr/bin/env bash
# just loads .env. One stack, one database: practice happens on Live on any day that is not the
# current route's date (see README "Practice days").
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/gtfs data/places data/recordings
docker compose -f compose.yml up -d --build
