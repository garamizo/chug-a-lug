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
- `data/gtfs/` (Metra static feed, re-downloaded when `published.txt` changes, safe to delete) and
  `data/places/budget.json` (monthly Google call counters). Venues, their details and photos live in
  PocketBase (`places`, `place_lookups`), so they are covered by the database backup.
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

`.env` also needs `INTERNAL_SECRET` and `WEB_INTERNAL_URL=http://127.0.0.1:5173` for legs to recompute in
dev (the PocketBase hook calls the SvelteKit server with that secret and URL after every `stops` write).

## Planning data
- Nearby venues per station (within 250 m, best rated first) come from Google Places Nearby Search once; the
  venues are stored in the `places` collection and the station is marked in `place_lookups`, after which
  the database answers. Without `GOOGLE_PLACES_KEY` the server falls back to OpenStreetMap (no ratings,
  nearest first). To search a station again: as the Conductor, open
  `/api/places/nearby?station=LAGRANGE&refresh=1` (with the app's token; easiest is the browser console snippet in the M1 plan, Task 6).
  Old `data/places/nearby/*.json` and `data/places/<place_id>/` folders from before the table existed can be deleted.
- Google Places is called once per station (nearby), once per venue (details) plus once per photo, whichever
  stop or draft asks first; details and photos sit on the `places` record. `data/places/budget.json` counts
  calls per month; the server refuses new calls past 200 nearby or 800 of the other two. Reset by deleting
  the file at month start if needed.
- The Metra timetable zip is cached in `data/gtfs/` (a bind mount, so it survives `docker compose up`) and
  `published.txt` is checked once a day; delete the folder to force a fresh download.
- A stop whose photos failed shows "Try again" on its card. Setting `place_id` on the stop in the PocketBase admin UI
  (and clearing its `place` relation) then retrying fixes wrong matches.
- The Metra feed is checked every 10 minutes; the app keeps the last good copy if Metra is down.

## Realtime (M2)
- `METRA_API_TOKEN` in `.env` is the bearer token for
  `https://gtfspublic.metrarr.com/gtfs/public/{positions,tripupdates,alerts}`. Empty means the app runs on
  the static timetable and every screen says "Timetable only". The old `gtfsapi.metrarail.com` host was
  shut off 2025-11-01; anything using it is dead.
- The poller starts on the first request that needs it and refetches every 30 s. Metra asks that nobody
  poll faster. `GET /api/metra/status` reports `mode` (`live`, `stale`, `schedule_only`), `rtAgeSec` and a
  per-feed breakdown; anything over 120 s counts as stale and the app falls back to the timetable.
- **Freshness is per feed.** `/api/metra/next` trusts trip predictions only while the *tripupdates* feed
  itself is fresh, and `/api/metra/alerts` likewise for alerts. A healthy positions feed never vouches for
  stale departures. If the board says "Timetable only" while `/status` looks fine, read `feeds.tripupdates`.
- A fetch failure keeps the last good feed and logs one line per feed. It never clears one.
- `just record <name>` writes raw feed snapshots to `data/recordings/<name>/` until Ctrl-C, one file per
  feed per change in `header.timestamp`. Run it on a Saturday for M4's replay. The folder is git-ignored
  and bind-mounted, so it survives `docker compose up`. The script lives at `web/scripts/record.mjs`
  because the repo root has no `package.json` for Node to resolve the protobuf bindings from.
- Where the crawl is on the live day comes from the clock, not GPS. The Conductor can correct it from the
  Departure Board; that writes a `checkins` record and everyone's board follows within seconds.

- If venue photos fail with `Google 403`, enable **Places API (New)** for the project in the Google Cloud
  console (APIs & Services → Library → Places API (New)); the key itself is fine.

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
`INTERNAL_SECRET` is read by both containers (the PocketBase hook sends it, the SvelteKit server checks
it), so rotate it with `docker compose up -d --force-recreate pocketbase web`.
