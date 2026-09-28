set dotenv-load := true

default:
    @just --list

pb-download:
    bash scripts/pb-download.sh

# PocketBase for dev; with no argument it uses $CHUG_DATA/pb_dev (~/.chug-a-lug/pb_dev).
pb DATA_DIR="":
    bash scripts/pb-dev.sh "{{DATA_DIR}}"

web:
    cd web && npm run dev

check:
    cd web && npm run check

test-unit:
    cd web && npm test

test-hooks:
    bash scripts/test-hooks.sh

test-e2e:
    cd web && npm run test:e2e

build:
    cd web && npm run build

up:
    bash scripts/up.sh

down:
    docker compose down

logs SERVICE="":
    docker compose logs -f {{SERVICE}}

backup:
    bash scripts/backup.sh

record NAME DATE WINDOW_START WINDOW_END:
    node web/scripts/record.mjs {{quote(NAME)}} {{quote(DATE)}} {{quote(WINDOW_START)}} {{quote(WINDOW_END)}}

index-recording NAME ZIP DATE WINDOW_START WINDOW_END:
    node web/scripts/index-recording.mjs {{quote(NAME)}} {{quote(ZIP)}} {{quote(DATE)}} {{quote(WINDOW_START)}} {{quote(WINDOW_END)}}

inspect-recording NAME:
    node web/scripts/index-recording.mjs {{quote(NAME)}}

# Counted against the monthly budget; refuses up front if the month has too few calls left.
# Refresh every BNSF station's best bars and restaurants from Google on the running stack.
places-warm:
    curl --fail-with-body -sS --max-time 900 -X POST -H "x-internal-secret: $INTERNAL_SECRET" http://127.0.0.1:3000/api/internal/places/warm
    @echo

sim-fixture:
    node web/scripts/generate-sim-fixture.mjs

