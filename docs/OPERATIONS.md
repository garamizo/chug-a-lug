# Operations

## Where things live
- Home box: `~/chug-a-lug`, Docker Compose services `pocketbase`, `web`, `cloudflared` (the tunnel is in the
  `public` profile, so `docker compose --profile public up -d` starts all three).
- Data: `data/pb_data` (SQLite + uploads), `data/pb_data/backups` (PocketBase zips), `data/backups/snapshot-*` (host copies).
- Secrets: `.env` (never committed). Metra token file in `.secrets/`.
- Dashboards: Cloudflare Zero Trust → Networks → Tunnels → `chugalug`; PocketBase admin at http://127.0.0.1:8090/_/ from the box.

## Local development
    just pb-download          # once: pinned PocketBase binary
    just pb                   # terminal 1: PocketBase with --dev on data/pb_dev
    just web                  # terminal 2: vite dev on http://localhost:5173
    just test-unit && just test-hooks && just test-e2e

`.env` needs at least `PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD`, `CREW_PASSWORD`. Tests never read `.env`;
they start a disposable PocketBase with their own passwords.

## Daily
- `just logs` to tail everything. `docker compose ps` should show the services `Up` and pocketbase `healthy`.
- Backups run inside PocketBase at 04:00 UTC and `just backup` from host cron at 04:30 local.

## Crew access
- Share `CREW_PASSWORD` in the family chat. People log in with their name and that password; the first
  login creates their identity. The same name on a second phone is the same person.
- `ADMIN_PASSWORD` gives the Conductor role. Once a name has it, later crew-password logins keep it.
- Someone typed their name wrong and now has two identities: PocketBase admin → Collections → `users`,
  delete the stray record (or rename `name` / `name_key` on the right one).
- Force everyone to log in again (leaked password): change `CREW_PASSWORD` in `.env`, then in the
  PocketBase admin UI → Collections → `users` → Options → Auth token → regenerate the secret.

## Deploy a change
    git pull
    just up                                  # docker compose up -d --build
    docker compose --profile public up -d    # if cloudflared is not already running
    docker compose logs -f web

Migrations apply automatically when the `pocketbase` container starts. Environment changes need
`docker compose up -d --force-recreate <service>`.

## Restore from backup
1. `docker compose down`
2. Either unzip a `pb_backup_*.zip` into a fresh `data/pb_data/`, or copy `data/backups/snapshot-<ts>/pocketbase.zip`
   and unzip it there; copy `places/`, `gtfs/`, `recordings/` from the snapshot back under `data/`.
3. `docker compose --profile public up -d`

## Disaster fallback (home internet or power is out on event day)
1. On any Linux VPS: install Docker, `git clone` the repo, copy `.env` and the latest `data/backups/snapshot-*` over.
2. Restore as above and start the stack. The tunnel token in `.env` moves with it; Cloudflare routes to
   whichever `cloudflared` is connected.
3. About 15 minutes; rehearse once before December.

## Rotate a secret
Edit `.env`, then `docker compose up -d --force-recreate <service>`. The hooks read `CREW_PASSWORD`,
`ADMIN_PASSWORD`, and the Metra token at request time from the container environment; the Cloudflare
token needs a cloudflared restart.
