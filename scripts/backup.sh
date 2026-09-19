#!/usr/bin/env bash
# Archive a consistent PocketBase backup and supplementary app data.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
set -a
if [ -f .env ]; then . ./.env; fi
set +a
exec python3 scripts/backup.py
