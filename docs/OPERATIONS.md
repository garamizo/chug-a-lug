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
- Data: `~/.chug-a-lug/pb_data` (SQLite + uploads), `~/.chug-a-lug/pb_data/backups` (PocketBase zips), `~/.chug-a-lug/backups/snapshot-*` (host copies, `BACKUP_DIR`).
  The pocketbase container runs as uid 1000 (your user), so everything under `~/.chug-a-lug/` stays yours. If a
  root-owned file ever appears there, fix it with
  `docker run --rm -v "$HOME/.chug-a-lug:/d" alpine sh -c 'chown -R 1000:1000 /d'`.
- `~/.chug-a-lug/gtfs/` (Metra static feed, re-downloaded when `published.txt` changes, safe to delete) and
  `~/.chug-a-lug/places/budget.json` (monthly Google call counters). Venues, their details and photos live in
  PocketBase (`places`, `place_lookups`), so they are covered by the database backup.
- Secrets: `.env` (never committed). Metra token file in `.secrets/`.
- The PocketBase superuser (`PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD`) is upserted from `.env` every time the
  pocketbase container starts, so a fresh or restored database needs no manual setup; change the password
  in `.env` and restart pocketbase to rotate it. The web server signs in with it for venue lookups and recomputes.
- Dashboards: Cloudflare Zero Trust → Networks → Tunnels → `chugalug`; PocketBase admin at http://127.0.0.1:8090/_/ from the box.

## Local development
    just pb-download          # once: pinned PocketBase binary
    just pb                   # terminal 1: PocketBase with --dev on ~/.chug-a-lug/pb_dev
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
- Nearby venues per station (within half a mile, best rated first) come from Google Places Nearby Search,
  one call for bars and one for restaurants, each the 20 most popular with rating and hours; the
  venues are stored in the `places` collection and the station is marked in `place_lookups`, after which
  the database answers. Without `GOOGLE_PLACES_KEY` the server falls back to OpenStreetMap (no ratings,
  nearest first). To search a station again: as the Conductor, open
  `/api/places/nearby?station=LAGRANGE&refresh=1` (with the app's token; easiest is the browser console snippet in the M1 plan, Task 6).
  To fill or refresh every BNSF station at once (52 calls), run `just places-warm` against the running stack;
  it refuses up front if the month has too few nearby calls left.
  Old `~/.chug-a-lug/places/nearby/*.json` and `~/.chug-a-lug/places/<place_id>/` folders from before the table existed can be deleted.
- Google Places is called twice per station (nearby), once per venue (details) plus once per photo, whichever
  stop or draft asks first; details and photos sit on the `places` record. `~/.chug-a-lug/places/budget.json` counts
  calls per month; the server refuses new calls past 200 nearby or 800 of the other two. Do not delete it:
  it is the only guard between a bug and the bill, and Google's own count does not reset with it.
- Opening a venue's sheet on Add Stop (`POST /api/places/photos`) spends 1 details call plus up to 5 photo
  calls the first time anyone opens that venue; the result sits on its `places` record, so every later
  open of the same venue — from Add Stop or once it is a stop — costs nothing further.
- The Metra timetable zip is cached in `~/.chug-a-lug/gtfs/` (a bind mount, so it survives `docker compose up`) and
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
- `just record <name>` writes raw feed snapshots to `~/.chug-a-lug/recordings/<name>/` until Ctrl-C, one file per
  feed per change in `header.timestamp`. Run it on a Saturday for M4's replay. The folder is git-ignored
  and bind-mounted, so it survives `docker compose up`. The script lives at `web/scripts/record.mjs`
  because the repo root has no `package.json` for Node to resolve the protobuf bindings from.
- The Departure Board follows the shared crawl clock. M3 moved position corrections into the route
  editor; the board itself is read-only (see below).

- If venue photos fail with `Google 403`, enable **Places API (New)** for the project in the Google Cloud
  console (APIs & Services → Library → Places API (New)); the key itself is fine.

## Live day (M3)

- Four new collections: `broadcasts` (Conductor Bulletins), `broadcast_acks` (one acknowledgement per
  person per Bulletin), `drink_entries` (the Tab), and `media` (Freight). M3 reuses `checkins` for the
  newest admin anchor and `event_log` for plan edits and Bulletins. There is no positions collection,
  per-crew check-in or straggler alert.
- Correct the crawl's position in The Route's editor and Save. The anchor changes both the shared
  board's position and where planning the remaining legs starts, only on the event's Chicago date.
  Off-day edits use the route's scheduled start time. The Tab and Freight open only for a `clock` or
  `override` position; merely having a current stop is not enough before or after the crawl.
- Save calls `POST /api/plan/commit`. It reconciles the persisted stop ids before validating rideability
  from the anchor onward; impossible legs behind the crew do not block Save. A 409 "The Route changed"
  means reload and make the change again. Reconciliation checks stop membership, not a version of
  every field: it is not a general concurrent-edit lock.
- Saves span several PocketBase requests. Retrying the same payload after a partial failure reuses
  editor-minted stop and Bulletin ids, skips already-completed deletes and cannot duplicate those
  records. It can add another `checkins` anchor and `event_log` entry; the newest anchor wins. Do not
  describe this as an atomic transaction. Unsaved edits are parked only for the venue-picker trip,
  expire after one hour, and are cleared on success; this is not durable draft recovery.
- Freight files live in PocketBase's `~/.chug-a-lug/pb_data` storage alongside venue photos and are included
  in the nightly PocketBase backup and host snapshot. Include uploads when estimating backup size.
  The application and `media.file` field both cap each file at 94,371,840 bytes (90 MiB, labeled 90 MB
  in the UI). This cap leaves room below the Cloudflare free-plan tunnel request limit; it is an
  application setting, not an inherent PocketBase limit. Images are compressed client-side, videos
  pass through. A rejected file does not stop the rest of its batch; unsupported types get a specific
  error. The client supplies the board's stop, and the hook clears invalid tags but keeps the file.
- Before the crawl, open the app online on each phone so the service worker precaches the shell and
  IndexedDB receives the locked route. Do it in the week before: that open also renews the phone's
  session (see Crew access), so nobody is signed out on the day. When PocketBase cannot be reached, Live uses that mirror and
  shows its age (a saved date/time after an hour). A fresh browser without a mirror has no saved route.
  Offline writes are deliberately not queued; retry failed actions after connectivity returns.

## Daily
- `just logs` to tail everything. `docker compose ps` should show the services `Up` and pocketbase `healthy`.
- Backups run inside PocketBase at 04:00 UTC and `just backup` from host cron at 04:30 local.

## Crew access

Everyone has their own account, keyed by email. There is no shared password; each person may set their own.

- **Boarding.** A newcomer opens `/join` (Board), enters a name, an email and a password, passes
  Cloudflare Turnstile and confirms the emailed code. That creates a boarding request, not a user. Any
  approved crew member can Let aboard or Turn away, from the popup or the Crew Board section. The chosen
  password is installed when a crew member lets them aboard; until then the person cannot sign in.
  Conductors get a batched email about waiting requests (at most one per 10 minutes).
- **Signing in.** `/login` offers Google (when `PUBLIC_GOOGLE_ENABLED=1`), email and password,
  "Forgot password?" and "Email me a code instead".
- **Passwords.** "Forgot password?" and Your ticket email a link that works once, for 30 minutes.
  Setting a password signs out every other session. There are 10 tries per address per 15 minutes;
  when they are spent, the emailed code and Google still work. Reset mails are capped at 3 per
  address per hour, and PocketBase limits each IP too. A person who is put off gets no reset mail and
  cannot use a link. People who boarded before passwords existed, or with Google, set one through
  "Forgot password?". The Conductor should use a long, unique password.
- **The Manifest** (`/crew/access`, Conductor only) lists people, their emails, status, when they came
  aboard and who let them, last seen, and the access log (kept 90 days, at most 10,000 rows).
- **Put off / Let back on** (Manifest, Conductor only) blocks or unblocks a person. Blocking from the
  PocketBase admin UI (`users` -> the record -> `blocked`) also ends that user's sessions.
- **Your ticket** (`/account`) lets a person rename themselves and email themselves a link to set a password. Nobody can change their own email; a
  superuser does it in the admin UI.
- **Sessions** last 90 days and renew whenever the app is opened online with a session more than a day
  old. Someone who boards in October and next opens the app on the event day is still aboard, but
  have everyone open the app online in the week before the crawl anyway.
- **Add another Conductor:** PocketBase admin (http://127.0.0.1:8090/_/ on the box) -> Collections ->
  `users` -> the person's record -> tick `is_admin`; make sure `verified` is on too. The first Conductor is always the account
  for `CONDUCTOR_EMAIL`, recreated on every start. When you type an email into a user record in the
  admin UI, type it in lowercase: sign-in and boarding look addresses up lowercased.
- **Mail troubleshooting.** `docker compose logs pocketbase` shows SMTP errors. Check `SMTP_HOST`,
  `SMTP_PORT=465` with `SMTP_TLS=1` (Resend uses implicit TLS), `SMTP_USERNAME=resend`, the API key in
  `SMTP_PASSWORD` and that the sending domain is verified in Resend. Settings are re-applied from `.env`
  at every start. If mail is down, a join answers an error: its request is created and at once expired,
  so nobody waits on it. Google sign-up still works. After a decision the decision stands and the
  notification retries.
- **Conductor without mail.**
  1. Sign in with your password, if you set one.
  2. If your Google account has the same email as your seat, sign in with Google.
  3. Otherwise mint a session on the box (the admin UI and superuser API answer only there):
     http://127.0.0.1:8090/_/ -> Collections -> `users` -> your record -> Impersonate, with a duration
     such as 86400 (a day), or the same by API:

         SU=$(curl -s http://127.0.0.1:8090/api/collections/_superusers/auth-with-password \
           -H 'content-type: application/json' -d '{"identity":"<superuser email>","password":"<superuser password>"}' | jq -r .token)
         curl -s http://127.0.0.1:8090/api/collections/users/impersonate/<your user id> -H "Authorization: $SU" \
           -H 'content-type: application/json' -d '{"duration":86400}' > /tmp/session.json

     The answer is `{"token": "...", "record": {...}}`. The app keeps its session in the cookie
     `pb_auth` on `chugalug.app`, holding that same JSON shape URL-encoded (the SDK's cookie format):

         node -e 'const s=require("/tmp/session.json");console.log(encodeURIComponent(JSON.stringify({token:s.token,record:s.record})))'

     On https://chugalug.app open the browser's developer tools -> Application (Storage) -> Cookies,
     add `pb_auth` with that value, path `/`, then reload. Delete `/tmp/session.json`. The session
     cannot be renewed and ends after its duration; fix mail before then.
- **Never publish port 8090 anywhere but the tunnel and the Docker network:** PocketBase trusts
  `CF-Connecting-IP`, so a directly reachable port would let anyone forge their address. Hooks in
  `edge.pb.js` answer 404 for `/_/` and the superusers endpoints on any request that carries that
  header, so the admin UI is reachable only from the box.
- Rehearsal stacks (`SIM=1`) alone keep `CREW_PASSWORD` / `ADMIN_PASSWORD` and the
  `/api/crawl/login` route; production has neither. A rehearsal's passwords come from the launcher's
  per-run credentials (`node web/scripts/sim.mjs`), not from `.env`.
- PocketBase's own rate limits are on (`PB_RATE_LIMITS`; only the test harness sets `off`).

## Deploying crew access

The migration `1758900000_crew_access.js` is destructive: it wipes every user except the Conductor and
all personal activity (likes, comments, Tab, acks), keeps routes, and refuses to start without
`CONDUCTOR_EMAIL`.

1. `just backup`.
2. Dry-run the migration on a copy of that backup, never on `~/.chug-a-lug/pb_data`:

       rm -rf /tmp/chugalug-dryrun && mkdir -p /tmp/chugalug-dryrun/pb_data
       unzip -q ~/.chug-a-lug/backups/snapshot-<ts>/pocketbase.zip -d /tmp/chugalug-dryrun/pb_data
       q() { sqlite3 /tmp/chugalug-dryrun/pb_data/data.db "select (select count(*) from users), (select count(*) from itineraries), (select count(*) from stops)"; }
       q   # before: users, routes, stops
       CONDUCTOR_EMAIL=<you> pocketbase/pocketbase migrate up --dir /tmp/chugalug-dryrun/pb_data \
         --hooksDir pocketbase/pb_hooks --migrationsDir pocketbase/pb_migrations
       q   # after: 1 user (the Conductor), the same routes and stops

   Or look through the admin UI of a disposable serve on a spare port (never 8090):
   `pocketbase/pocketbase serve --dir /tmp/chugalug-dryrun/pb_data --http 127.0.0.1:18099`. Then
   `rm -rf /tmp/chugalug-dryrun`: it is a copy of production data.
3. Fill the new `.env` keys (see `.env.example`): `CONDUCTOR_EMAIL`, `APP_URL`, `MAIL_FROM`, `SMTP_*`,
   `TURNSTILE_SECRET`, `PUBLIC_TURNSTILE_SITE_KEY`, and optionally `GOOGLE_CLIENT_ID`,
   `GOOGLE_CLIENT_SECRET` with `PUBLIC_GOOGLE_ENABLED=1`. Remove `CREW_PASSWORD` and `ADMIN_PASSWORD`.
   Do the Cloudflare checklist below first for the Turnstile, Resend and Google values.
4. `just up`, then sign in as the Conductor by email code.
5. Tell the family to board at `/join`.
6. Delete and recreate any rehearsal runs (`.simulations/<run>`): the migration wipes their users while
   their marker still says ready.
7. Never publish port 8090 anywhere but the tunnel and the Docker network, because the
   `CF-Connecting-IP` trust depends on it.
8. Run the manual acceptance list below.

**Rollback:** restore the backup (Restore from backup below) **and** check out the code from before
crew access. Reverting the code alone leaves email required on every user with no password route,
so nobody can sign in.

### Manual acceptance

The harness cannot prove these:

- **Real Google round trip:** a phone boards by Google, and an existing member signs in by Google.
- **Conductor-email batching:** two sign-ups a minute apart produce one email (tests run with
  `NOTIFY_INTERVAL_SECONDS=0`).
- **Daily access-log retention:** after the 03:17 UTC job, rows older than 90 days and rows past the
  newest 10,000 are gone.
- On the real stack after deploy:
  1. `https://pb.chugalug.app/_/` and the superusers auth endpoint, by name and by ID, return 404.
  2. Sign-in as the Conductor works by email code.
  3. A phone boards by Google.
  4. A second phone boards by email.
  5. Popup approval works from a third browser, and the popup clears on the other approver's screen.
  6. Put off works.
  7. The Manifest shows real visitor IPs and countries.
  8. Cloudflare Security Insights clears the chugalug.app findings after the checklist.

## Cloudflare checklist

Dashboard steps verified against developers.cloudflare.com on 2026-10-03. Each step names its source
page; Cloudflare renames menus often, so re-check the page if a label is missing.

1. **MFA on the Cloudflare account.** My Profile -> Authentication -> add a factor.
   Source: https://developers.cloudflare.com/fundamentals/user-profiles/2fa/
2. **HTTPS and TLS** (zone chugalug.app). SSL/TLS -> Edge Certificates:
   - turn on **Always Use HTTPS** (the SSL/TLS encryption mode must not be Off);
   - for **HTTP Strict Transport Security (HSTS)** select **Enable HSTS**, then **I understand**,
     **Next**, set **Max Age Header** to 6 months, turn on **Apply HSTS policy to subdomains**, leave
     **Preload** off, **Save**;
   - set **Minimum TLS Version** to TLS 1.2.
   Sources: .../ssl/edge-certificates/additional-options/always-use-https/,
   .../http-strict-transport-security/, .../minimum-tls/ (HSTS is Cloudflare's job; the app does
   not send it).
3. **Bot Fight Mode.** Security -> Settings, filter by **Bot traffic**, turn **Bot fight mode** on. Then
   confirm realtime updates (SSE) and photo/video uploads still work from a phone.
   Source: https://developers.cloudflare.com/bots/get-started/bot-fight-mode/
4. **WAF custom rule on `pb.chugalug.app`.** Security -> Security rules -> Create rule -> Custom rules.
   Name it, match hostname equals `pb.chugalug.app` and URI path starts with `/_/` or starts with
   `/api/collections/_superusers`, action **Block**, **Deploy**. A second layer: `edge.pb.js` already
   returns 404 for these and also covers the collection ID.
   Source: https://developers.cloudflare.com/waf/custom-rules/create-dashboard/
5. **Visitor location headers.** Rules -> Settings -> **Managed Transforms** tab -> enable **Add visitor
   location headers** (gives the Manifest its countries).
   Source: https://developers.cloudflare.com/rules/transform/managed-transforms/configure/
6. **Turnstile.** Turnstile page -> **Add widget**: name, hostname `chugalug.app`, mode Managed ->
   **Create**; copy the sitekey into `PUBLIC_TURNSTILE_SITE_KEY` and the secret key into
   `TURNSTILE_SECRET`.
   Source: https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/
7. **Resend.** In Resend, add the chugalug.app domain, publish the DNS records it shows in Cloudflare DNS
   (set them to DNS only), then create an API key; it is `SMTP_PASSWORD`. Find the exact steps from
   Resend's domain documentation.
8. **Google Cloud.** Create an OAuth client of type Web application with redirect URI
   `https://chugalug.app/auth/google`; its ID and secret are `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`. Find the exact steps from Google's OAuth client documentation.

## Deploy a change
    git pull
    just up                                  # docker compose up -d --build
    docker compose logs -f web

Migrations apply automatically when the `pocketbase` container starts. Environment changes need
`docker compose up -d --force-recreate <service>`.

## Restore from backup
1. `docker compose down`
2. Either unzip a `pb_backup_*.zip` into a fresh `~/.chug-a-lug/pb_data/`, or copy `~/.chug-a-lug/backups/snapshot-<ts>/pocketbase.zip`
   and unzip it there; copy `places/`, `gtfs/`, `recordings/` from the snapshot back under `~/.chug-a-lug/`.
3. `docker compose up -d`

## Disaster fallback (home internet or power is out on event day)
1. On any Linux VPS: install Docker, `git clone` the repo, copy `.env` and the latest `~/.chug-a-lug/backups/snapshot-*` over.
2. Restore as above and `docker compose up -d`. The tunnel token in `.env` moves with it; Cloudflare routes
   to whichever `cloudflared` is connected, so `docker compose stop cloudflared` at home first if that box
   is still alive.
3. About 15 minutes; rehearse once before December.

## Rotate a secret
Edit `.env`, then `docker compose up -d --force-recreate <service>`. PocketBase reads `SMTP_PASSWORD`,
`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, `TURNSTILE_SECRET` and the Metra token from its environment
(the SMTP and Google settings are re-applied at start), so rotate those with
`docker compose up -d --force-recreate pocketbase`. `PUBLIC_*` values (`PUBLIC_PB_URL`,
`PUBLIC_TURNSTILE_SITE_KEY`, `PUBLIC_GOOGLE_ENABLED`) are baked into the web image, so changing one needs
`just up`, a rebuild. The Cloudflare token is read by the `cloudflared` container at start
(`docker compose up -d --force-recreate cloudflared`). `INTERNAL_SECRET` is read by both containers (the
PocketBase hook sends it, the SvelteKit server checks it), so rotate it with
`docker compose up -d --force-recreate pocketbase web`.


## Shakedown Run (M4)

Live runs every day on the one real stack; there is no separate rehearsal deployment or
`REHEARSAL` switch (see README ["Practice days"](../README.md#practice-days)). `just up` runs
`docker compose -f compose.yml up -d --build` against the real database, `~/.chug-a-lug/pb_data`. On the
current route's `event_date` it is the event day; any other day, Live shows the route at today's
Chicago time against that date's timetable, with a Practice badge, and nothing people post that
day reaches the event day.


Tests use disposable credentials/data and ports 15173/18093, one suite at a time. Never test against
the regular stack ports 3000/8090. The advanced standalone launcher remains available through
`node web/scripts/sim.mjs` for isolated developer runs, independent of the real stack.

To capture or index an archive, supply its service date and explicit UTC playback window:

```bash
just record NAME DATE WINDOW_START WINDOW_END
just index-recording NAME MATCHING_GTFS_ZIP DATE WINDOW_START WINDOW_END
just inspect-recording NAME
```

 The recorder archives GTFS and per-feed poll observations.
Use `just index-recording` with the matching zip/date/window for legacy snapshots. Indexing cannot
recover successful unchanged polls; legacy freshness remains conservative. Never re-date protobuf
headers to pretend the recording is from another Saturday.

After upgrading to crew access, delete existing `.simulations/<run>` folders and start fresh runs: the
migration wipes their users while their marker still says ready.

Sign in (rehearsal stacks keep the shared passwords), then choose Shakedown Run from the Conductor
menu. All signed-in users see Railroad Time and synchronization status. Only the Conductor sees
controls. Pause before seeking forward; the seek input is Chicago time on the source service date.
Rates are 1×, 5×, 10×, 30× and 60×. A paused rate selection changes the resume rate without starting.
Playback clamps at the window end. Restart preserves paused time or includes elapsed wall downtime
for a running clock. A conflict adopts the current clock and asks for another deliberate action.

Use The Route editor to move the crew, Hold, Annul or add a venue. The same preview/Save/Bulletin
flow is used as on the live day. A clock revision refreshes previews and prevents obsolete saves.
Tab, Undo, uploads, acknowledgements and standalone Bulletins resynchronize before writing. Offline
writes are not queued. A previously synchronized browser can display its last running mapping while
marked unsynchronized; a fresh offline browser shows only its route mirror and clock-unavailable
status. Mirror ages and parked-edit expiry remain wall time, as do auth, cache budgets and photo dates.

For phones, use the regular HTTPS app and PocketBase origins. Localhost production-build tests
exercise the real service worker, but do not establish physical-phone offline acceptance.

Run the ordinary gate, then `npm run test:sim` and `npm run test:sim:offline` in `web/`, sequentially.
The latter builds the production bundle, registers its real service worker, disconnects and reloads
The Route, then verifies resynchronization and excluded API caches. Browser screenshots are retained
under `web/test-results/sim/` and `web/test-results/sim-offline/`. Record device/browser/build/source
and each manual checkpoint using [the rehearsal template](rehearsals/m4-template.md). Automated
fixtures do not establish real Saturday recording or physical-phone acceptance.
