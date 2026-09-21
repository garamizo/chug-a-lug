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

# sim.mjs discards inherited dotenv values; only .env.sim's allowlisted settings are read.
sim RUN SOURCE="fixture":
    node web/scripts/sim.mjs start {{quote(RUN)}} {{quote(SOURCE)}}

sim-status RUN:
    node web/scripts/sim.mjs status {{quote(RUN)}}

sim-stop RUN:
    node web/scripts/sim.mjs stop {{quote(RUN)}}
