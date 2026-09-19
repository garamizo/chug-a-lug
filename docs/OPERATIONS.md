# Operations

## Where things live
- Home box: `~/chug-a-lug`, Docker Compose services `pocketbase`, `web`, and `cloudflared`. The tunnel
  connector runs in the `cloudflared` container using `CLOUDFLARE_TUNNEL_TOKEN` from `.env`; the tunnel's
  public hostnames point at the Docker service names `http://web:3000` (chugalug.app) and
  `http://pocketbase:8090` (pb.chugalug.app). `docker compose logs -f cloudflared` shows
  "Registered tunnel connection" when it is up.
- Do not also install cloudflared as a host systemd service; two connectors with one token split the traffic.
  If one exists: `sudo cloudflared service uninstall` (removes the unit and its token file).
- The site is public only while the stack is up: `docker compose stop` takes it offline, `docker compose up -d`
  brings it back. The tunnel reconnects on its own after reboots because of `restart: unless-stopped`.
- Data: `data/pb_data` (SQLite + uploads), `data/pb_data/backups` (PocketBase zips), `data/backups/snapshot-*` (host copies).
  The pocketbase container runs as uid 1000 (your user), so everything under `data/` stays yours. If a
  root-owned file ever appears there, fix it with
  `docker run --rm -v "$PWD/data:/d" alpine sh -c 'chown -R 1000:1000 /d'`.
- Secrets: `.env` (never committed). Metra token file in `.secrets/`.
- Dashboards: Cloudflare Zero Trust → Networks → Tunnels → `chugalug`; PocketBase admin at http://127.0.0.1:8090/_/ from the box.

## Local development
    just pb-download          # once: pinned PocketBase binary
    just pb                   # terminal 1: PocketBase with --dev on data/pb_dev
    just web                  # terminal 2: vite dev on http://localhost:5173
    just test-unit && just test-hooks && just test-e2e

`.env` holds the production values (`PUBLIC_PB_URL=https://pb.chugalug.app`, `ORIGIN=https://chugalug.app`)
because this box is the server. `.env.local` (git-ignored, read by Vite only) overrides `PUBLIC_PB_URL` to
`http://127.0.0.1:8090` so `just web` talks to the local PocketBase. Tests never read either file; they start
a disposable PocketBase with their own passwords. The web image bakes `PUBLIC_PB_URL` in at build time, so
changing it means `docker compose up -d --build web`.

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
    docker compose logs -f web

Migrations apply automatically when the `pocketbase` container starts. Environment changes need
`docker compose up -d --force-recreate <service>`.

## Restore from backup
1. `docker compose down`
2. Either unzip a `pb_backup_*.zip` into a fresh `data/pb_data/`, or copy `data/backups/snapshot-<ts>/pocketbase.zip`
   and unzip it there; copy `places/`, `gtfs/`, `recordings/` from the snapshot back under `data/`.
3. `docker compose up -d`

## Disaster fallback (home internet or power is out on event day)
1. On any Linux VPS: install Docker, `git clone` the repo, copy `.env` and the latest `data/backups/snapshot-*` over.
2. Restore as above and `docker compose up -d`. The tunnel token in `.env` moves with it; Cloudflare routes
   to whichever `cloudflared` is connected, so `docker compose stop cloudflared` at home first if that box
   is still alive.
3. About 15 minutes; rehearse once before December.

## Rotate a secret
Edit `.env`, then `docker compose up -d --force-recreate <service>`. The hooks read `CREW_PASSWORD`,
`ADMIN_PASSWORD`, and the Metra token at request time from the container environment; the Cloudflare
token is read by the `cloudflared` container at start (`docker compose up -d --force-recreate cloudflared`).
