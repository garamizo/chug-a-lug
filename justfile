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
    mkdir -p data/gtfs data/places data/recordings
    docker compose up -d --build

down:
    docker compose down

logs SERVICE="":
    docker compose logs -f {{SERVICE}}

backup:
    bash scripts/backup.sh

record NAME:
    node web/scripts/record.mjs "{{NAME}}"
