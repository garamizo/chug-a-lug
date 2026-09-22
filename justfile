set dotenv-load := true

default:
    @just --list

pb-download:
    bash scripts/pb-download.sh

pb DATA_DIR="data/pb_dev":
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

sim-fixture:
    node web/scripts/generate-sim-fixture.mjs
