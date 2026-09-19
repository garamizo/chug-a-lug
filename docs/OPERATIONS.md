# Operations

## Where things live
- Home box: `~/chug-a-lug`, Docker Compose services `pocketbase` and `web`. The Cloudflare Tunnel runs as a
  host systemd service (`sudo cloudflared service install <token>`), enabled at boot, and points the public
  hostnames at `http://localhost:3000` (chugalug.app) and `http://localhost:8090` (pb.chugalug.app).
  `systemctl status cloudflared` shows it; `journalctl -u cloudflared -f` tails it.
- Never run the host service and the Compose `public` profile at the same time on the same box; Cloudflare
  would split traffic across both. The Compose profile (host networking, same origins) is for the VPS fallback.
- Data: `data/pb_data` (SQLite + uploads), `data/pb_data/backups` (PocketBase zips), `data/backups/snapshot-*` (host copies).
  The pocketbase container runs as root, so files under `data/pb_data` are root-owned; use `sudo` or a
  throwaway container to delete them. The backup script reads through the API, so it needs no special rights.
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
2. Restore as above and start the stack with `docker compose --profile public up -d`. The tunnel token in
   `.env` moves with it; Cloudflare routes to whichever `cloudflared` is connected, so stop the one at home
   first (`sudo systemctl stop cloudflared`) if it is still alive.
3. About 15 minutes; rehearse once before December.

## Rotate a secret
Edit `.env`, then `docker compose up -d --force-recreate <service>`. The hooks read `CREW_PASSWORD`,
`ADMIN_PASSWORD`, and the Metra token at request time from the container environment; the Cloudflare
token lives in the host service (`sudo cloudflared service uninstall`, then install with the new token).
