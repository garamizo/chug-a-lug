# Chug-a-Lug Choo-Choo: system design

Date: 2026-09-19. Status: approved design, pre-implementation.
Companion docs: [README](../../../README.md) (product scope, UI glossary, decisions),
[REFERENCES](../../REFERENCES.md) (library survey, verified facts).

This spec uses developer terms. UI labels come from the README glossary and live only in the frontend's
label map.

## 1. Goals and non-goals

Goals
- Ten family members share one itinerary for a Metra bar crawl on Saturday 2026-12-26 and never miss a train.
- Planning (drafts, votes, comments, lock), live day (departure banner, check-ins, plan edits, broadcasts,
  drink log, media), and wrap-up (album, scoreboard, awards).
- The live day is fully rehearsable at home: fake clock, replayed Metra feed, scripted GPS.
- Runs on one home computer, reachable at https://chugalug.app through a Cloudflare Tunnel.

Non-goals
- Public users, app-store apps, background location tracking, multi-region hosting, route optimization.
- Anything that needs a Google map on screen. Google is used server-side for venue photos only.

## 2. Architecture

```
phone (PWA)  --https-->  Cloudflare edge  --tunnel-->  home box (Docker Compose)
   chugalug.app    -> web:3000                            ├── web        SvelteKit (Node adapter), port 3000
   pb.chugalug.app -> pocketbase:8090                     │
                                                        │     ├── UI + service worker (offline cache)
                                                        │     ├── /api/metra/*   Metra proxy ("dispatcher")
                                                        │     ├── /api/sim/*     sim clock + replay control
                                                        │     └── /api/places/*  Google Places fetch-once
                                                        ├── pocketbase Go binary, port 8090
                                                        │     ├── SQLite, auth, collections, SSE realtime, files
                                                        │     └── pb_hooks: shared-password login, media tagging
                                                        └── cloudflared  outbound tunnel, no open ports
```

Three processes. PocketBase owns all persistent state and realtime. The SvelteKit server owns everything
that talks to third parties (Metra, Google). The browser talks to both: PocketBase directly for records and SSE, SvelteKit
for pages and proxy endpoints.

Why not one process: PocketBase gives auth, admin UI, file storage, migrations, and SSE for free and is a
single binary. The Metra proxy needs long-running Node timers and protobuf decoding, which fit SvelteKit's
Node server better than PocketBase's embedded JS runtime.

### 2.1 Repository layout

```
chug-a-lug/
  README.md, docs/
  compose.yml                 # web, pocketbase, cloudflared
  .env.example                # every secret and knob, documented
  justfile                    # dev, test, build, backup, record, replay
  pocketbase/
    Dockerfile                # pins the PocketBase version
    pb_migrations/            # JS migrations, one file per schema change
    pb_hooks/                 # JS hooks: login.pb.js, media.pb.js, guards.pb.js
  web/
    package.json, svelte.config.js, vite.config.ts
    src/lib/labels.ts         # developer term -> UI label (the glossary)
    src/lib/pb.ts             # PocketBase client + auth store
    src/lib/metra/            # pure gtfs + plan (parser, nextTrips, planLeg, recomputeLegs)
    src/lib/server/metra/     # gtfs static loader, rt poller, next-train, recorder, replayer
    src/lib/server/sim/       # sim clock
    src/lib/server/places/    # google places fetch-once
    src/routes/               # pages + /api/*
    tests/                    # vitest unit, playwright e2e
  data/                       # git-ignored runtime state
    pb_data/                  # SQLite + uploaded files
    gtfs/                     # schedule.zip + published.txt (no sqlite)
    recordings/<name>/        # <epoch>.positions.pb etc.
    places/<place_id>/        # 1.jpg .. 5.jpg + meta.json
    backups/
```

### 2.2 Environment and secrets

All secrets live in `.env` on the home box, loaded by Compose. `.env.example` documents each.
`METRA_API_TOKEN`, `GOOGLE_PLACES_KEY`,
`CREW_PASSWORD`, `ADMIN_PASSWORD`, `CLOUDFLARE_TUNNEL_TOKEN`, `PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD`, `PB_URL` (internal, `http://pocketbase:8090`),
`PUBLIC_PB_URL` (what the browser uses: `http://localhost:8090` in dev, `https://pb.chugalug.app` in prod),
`SIM` (0/1), `SIM_RECORDING`, `SIM_START`, `SIM_RATE`.

## 3. Data model (PocketBase collections)

All collections have `id`, `created`, `updated`. Times are UTC in the database; the app renders
America/Chicago. Access rules in brackets: A = admin only, U = any authenticated user, O = record owner.

| Collection | Fields | Rules |
|---|---|---|
| `users` (auth) | `name` (display, first-seen spelling), `name_key` (unique, lowercased), `is_admin` bool, `share_position` bool, `home_station` text, `left_early` bool | list/view U, update O (except `name`, `name_key`, `is_admin`, `password`), create via hook only |
| `itineraries` | `title`, `status` enum draft/locked/archived, `event_date`, `start_time`, `vote_open` bool, `created_by` rel users, `locked_at` | list/view U, create U, update O or A, only A may set locked |
| `stops` | `itinerary` rel, `order` int, `name`, `kind` enum bar/restaurant/other, `station_id`, `station_name`, `place_id`, `osm_id`, `address`, `lat`, `lon`, `hours` json, `phone`, `website`, `confirmed_open` bool, `dwell_min` int, `walk_min` int, `notes`, `meet_point` text, `photos_status` enum none/pending/done/failed | view U, create/update U while itinerary draft; A always |
| `stop_photos` | `stop` rel, `file` file, `source` enum google/user, `attribution` text | view U, create U (user source) or hook (google) |
| `votes` | `user` rel, `target_collection` text, `target_id` text, `value` enum up/down | view U, create/update/delete O; unique (user, target) |
| `comments` | `user` rel, `target_collection`, `target_id`, `body` | view U, create U, update O, delete O or A |
| `approval_votes` | `itinerary` rel, `user` rel, `value` enum go/nogo | view U, create/update O while itinerary `vote_open` |
| `legs` | `itinerary` rel, `from_stop` rel, `to_stop` rel, `kind` enum train/walk/impossible, `ready_at`, `depart_at`, `arrive_at`, `segments` json, `computed_at` | view U, write server only |
| `checkins` | `user` rel, `stop` rel nullable, `kind` enum at_stop/on_train, `at` datetime | view U, create O |
| `positions` | `user` rel, `lat`, `lon`, `accuracy`, `at` | view U, create O; server keeps only the latest 50 per user |
| `broadcasts` | `itinerary` rel, `kind` enum reroute/hold/cancel/add/message, `body`, `created_by` rel | view U, create A |
| `broadcast_acks` | `broadcast` rel, `user` rel | view U, create O; unique (broadcast, user) |
| `drink_entries` | `user` rel, `stop` rel, `kind` enum beer/wine/cocktail/shot/water/food, `at` | view U, create/delete O |
| `media` | `user` rel, `file` file (max 90 MB), `kind` image/video, `taken_at`, `stop` rel nullable, `tagged_by` enum admin_position/admin_checkin/manual/none | view U, create U, update A |
| `event_log` | `itinerary` rel, `kind`, `payload` json, `actor` rel users nullable, `at` | view U, create server/hook only |
| `awards` | `itinerary` rel, `user` rel, `title`, `reason`, `computed` bool | view U, write A or server |

Notes
- One itinerary is "active" per event date: the locked one. Plan edits modify the locked itinerary in
  place and append to `event_log`; there is no versioning beyond the log.
- `legs` is a cache. The server recomputes it whenever `stops` of the itinerary change, using the GTFS
  schedule for `event_date`. Recompute is idempotent and takes under a second for ten stops.
- One vote per `(user, target)`: `votes.value` is up/down on any `target_collection`/`target_id` pair
  (an itinerary or a stop); a second vote from the same user on the same target updates in place.
- Approval votes only while `vote_open`: `approval_votes` can be created/updated only while the
  itinerary's `vote_open` is true; the admin opens the vote and locks the itinerary from the tally.
- No `stations` collection: stations come straight from GTFS (`GET /api/metra/stations`), nothing to seed.

## 4. Authentication

There are no per-person credentials. The admin shares one crew password with the family (and keeps a
separate admin password). A person identifies themself by name so votes, comments, drinks, and uploads
carry a name. The `users` record for a name is created on first login; nobody signs up or recovers anything.

Flow (PocketBase hook `pb_hooks/login.pb.js`):
1. `POST /api/crawl/login {name, password}`: normalize the name (trim, collapse spaces, 2 to 32 chars of
   letters, digits, spaces, `.`, `'`, `-`; `name_key` = lowercase). Compare `password` in constant time
   against `CREW_PASSWORD` and `ADMIN_PASSWORD` from the environment. Wrong password → 401.
   Rate limit: 20 attempts per client IP per 15 minutes (429), persisted in the `_crawl_limits` table.
2. Find the user by `name_key` or create it with a random unused password and `verified: true`.
   The admin password sets `is_admin = true`; the crew password leaves the flag as it is, so the admin
   can log in from any device with either password without losing the role.
3. Respond `{token, record}`; `token` is a PocketBase auth token valid for one year (`authToken.duration = 31536000`).
4. The browser keeps the token in a `pb_auth` cookie on the app origin (SameSite=Lax, Secure in production,
   one-year Max-Age, readable by the app's JavaScript because the SDK sends it as an `Authorization` header
   to `pb.chugalug.app`). Logout deletes the cookie. Same name on another phone = same identity.
5. Password auth, OTP, and MFA on the `users` collection are disabled; the hook is the only way in.
   Rotating `CREW_PASSWORD` does not invalidate existing sessions; to force everyone out, change the
   collection's token secret in the PocketBase admin UI.

Admin role: `users.is_admin`. Collection rules reference `@request.auth.is_admin = true`.

## 5. Metra proxy ("dispatcher")

Module `web/src/lib/server/metra/`, started once at server boot.

- **Static**: on boot and every 10 minutes, fetch `published.txt`; if changed, download `schedule.zip`
  to `data/gtfs/` and parse it in memory with a pure TypeScript loader (no `node-gtfs`, no sqlite); a
  download failure keeps the previous import and logs, retrying in 10 minutes. Expose
  `nextTrips(fromStopId, toStopId, afterTime, serviceDate)` returning trips that stop at both stops in
  order, express-aware; `nextTrips` is a scan over the three lines' trips (2,400) and takes about a
  millisecond.
- **Realtime**: every 30 s fetch positions, tripupdates, alerts with the bearer token; decode with
  `gtfs-realtime-bindings`; keep the latest FeedMessage of each in memory plus `fetchedAt`. Never expose
  the token; never let the browser hit Metra.
- **Merge**: `nextTrips` overlays TripUpdate delays on scheduled times when a TripUpdate exists; absence
  means on time (Metra's documented semantics). Annulled trips (schedule_relationship CANCELED) are dropped.
- **Endpoints**
  - `GET /api/metra/next?from=&to=&limit=3` → `[{tripId, routeId, schedDepart, liveDepart, schedArrive, liveArrive, delayMin, status}]`
  - `GET /api/metra/positions?routes=UP-W,MD-W,BNSF` → GeoJSON points with `route_id`, `trip_id`, `timestamp`
  - `GET /api/metra/alerts?routes=` → active alerts for the three lines
  - `GET /api/metra/status` → `{staticPublishedAt, rtFetchedAt, rtAgeSec, mode: live|stale|schedule_only|sim}`
- **Staleness**: `rtAgeSec > 120` reports `stale`; the client shows scheduled times with a "schedule only"
  tag. Fetch failures log and keep the last good feed.
- **Recorder**: `just record <name>` runs the same poller writing `data/recordings/<name>/<epoch>.<feed>.pb`
  until stopped. Intended use: a December Saturday, all day.
- **Replayer**: with `SIM=1`, the poller is replaced by a reader that, for each request, picks the snapshot
  with the largest epoch ≤ sim clock now, and rewrites `header.timestamp`. Schedule-only fallback when no
  recording is configured: synthesize positions by interpolating along `shapes.txt` between stop times.

## 6. Departure banner logic (client, pure functions, unit-tested)

Inputs: active itinerary with legs, the user's current stop (from their latest check-in, else the admin's),
`/api/metra/next` for the current leg, walk minutes for the stop, sim or wall clock.

```
leaveAt      = liveDepart - walkMin - bufferMin(3)
departsIn    = leaveAt - now
state        = departsIn > 10 min ? normal
             : departsIn > 0      ? warning     (UI: Last Call)
             :                      leave_now   (UI: All Aboard)
```
If the next train is missed (`now > liveDepart`), roll to the following trip and post a client-side notice.
The banner subscribes to SSE on `stops`, `legs`, `broadcasts` and polls `/api/metra/next` every 30 s.

## 7. Plan edits and recompute

Admin actions are ordinary record writes on `stops` (reorder, insert, delete, change `dwell_min`), plus a
`broadcasts` record. A PocketBase hook on `stops` after-write calls `POST /api/internal/recompute?itinerary=`
on the SvelteKit server (shared secret header). Recompute (`recomputeLegs`, pure function, unit-tested):
1. Sort stops by `order`, starting from `itineraries.start_time` at the first stop. For each consecutive
   pair A → B: `ready_at` = A's arrival + A's `dwell_min` (leave the venue); `depart_at`-eligible time =
   `ready_at` + A's `walk_min` (at A's station).
2. Plan the station-to-station hop from that time (`planLeg`). Same station → a 0-minute walk; both
   stations are the downtown pair (OTC/CUS) → a 6-minute walk. Otherwise the earliest arrival among four
   shapes, with the simpler one winning a tie: (a) a direct trip; (b) *train then walk* — the destination
   is downtown but no train reaches it, so ride to the other terminal and walk the 6 minutes across;
   (c) *walk then train* — the origin is downtown and the line leaves from the other terminal, so walk
   across first and ride out (`depart_at` is then when the walk starts, not the train's departure);
   (d) *train, downtown walk, train* — a transfer between two lines. If none exists, `kind: impossible`.
3. `arrive_at` = the hop's arrival (or the eligible time, for `impossible`) + B's `walk_min` (walk from B's
   station to the venue). Write `legs` with `kind`, `ready_at`, `depart_at`, `arrive_at`, `segments` (json:
   one or two `train` segments and any `walk` segment), `computed_at`; append `event_log {kind: recompute,
   payload: diff}`.
4. A leg with no trip before the day's last train is `kind: impossible`; the UI shows it red and an admin
   broadcast is suggested.
Hold = increase `dwell_min` of the current stop until the next trip. Cancel = delete stop. Add = insert stop.

## 8. Media

- Client compresses images (`browser-image-compression`, max 2000 px, 0.8 quality) before upload;
  videos upload as-is, capped at 90 MB by the collection rule (Cloudflare free plan limit is 100 MB).
- Upload goes straight to PocketBase multipart. An after-create hook (`media.pb.js`) sets `stop` and
  `tagged_by` from the admin's latest `positions` record if it is under 15 minutes old (nearest stop within
  300 m), else the admin's latest `checkins`, else null. Admin can edit later.
- Album pages query `media` by `stop`, serve PocketBase thumbnails (`?thumb=`) and originals; zip download is
  a SvelteKit endpoint streaming files with `archiver`.

## 9. Venue photos (Google Places, fetch-once)

`POST /api/places/attach {stopId}` (authenticated): if the stop already has a `place_id`, use it. Otherwise
run a Google Text Search for `"<stop name> <station name>"` biased to the station and take the first hit as
`place_id` (the text-search step for stops with no `place_id` — manual-entry stops and OSM picks alike); no
match fails the stop with a retryable message rather than guessing. Then, if `data/places/<place_id>/meta.json`
exists, reuse it. Otherwise call Place Details (field mask: displayName, formattedAddress, regularOpeningHours,
rating, nationalPhoneNumber, websiteUri, googleMapsUri, photos) then up to 5 Place Photos (max 800 px), write
JPEGs and meta under `data/places/<place_id>/`, create `stop_photos` records with `source: google` and the
photo's author attribution, update the stop's `place_id`, address, hours, phone, website. Budget guard:
`data/places/budget.json` keeps separate monthly counters for `details` and `photos` calls; each refuses a
new call once its counter reaches 800. A call blocked by the budget leaves the stop `photos_status: failed`
with a retry button rather than a partial write (unless at least one photo already made it through the
batch, in which case the stop finishes `done` with those).

The stop picker itself (Task 6) has three sources ahead of this endpoint: the Overpass nearby list per
station (cached forever, no Google call), Google Text Search by name for the thin suburbs
(`GET /api/places/search?q=&station=`, same field-limited search as above), and plain manual name entry
(no `place_id`, no coordinates beyond the station's) — `attach` is what turns any of the three into a
`place_id` and a card.

## 10. Simulation mode

- `GET /api/sim/clock` → `{enabled, epochStart, rate, wallStart}`; the client's `now()` helper uses it.
  Admin-only `POST /api/sim/clock` to set or pause. Off in production unless `SIM=1`.
- Client GPS: `?sim=1` swaps `navigator.geolocation` for a waypoint player (module port of
  geolocation-simulator) fed by `static/sim/route.json` (station and stop coordinates with speeds and pauses).
- Playwright e2e uses `context.setGeolocation` and MSW handlers for `/api/metra/*` with recorded fixtures.

## 11. Offline and realtime

- Service worker (vite-pwa, `generateSW`) precaches the app shell and runtime-caches `/api/metra/*` and
  PocketBase record reads with network-first, 24 h fallback. The active itinerary and legs are also written
  to IndexedDB on every change so the schedule page renders offline.
- Realtime: PocketBase SSE subscriptions on `stops`, `legs`, `broadcasts`, `checkins`, `positions`,
  `drink_entries`. On reconnect, the client refetches those collections once.
- Unacknowledged broadcasts render as a pinned card until the user creates a `broadcast_acks` record.

## 12. Deployment and operations

- `compose.yml`: `pocketbase` (built from `pocketbase/Dockerfile`, volume `./data/pb_data`), `web` (node
  adapter, volumes `./data/gtfs`, `./data/recordings`, `./data/places`), `cloudflared` (token from env).
  PocketBase is exposed on its own hostname rather than proxied through SvelteKit, so SSE streams and
  large uploads never pass through Node. The SDK keeps the auth token in localStorage, so no cookies cross hosts.
- Cloudflare: tunnel `chugalug` with two public hostnames: `chugalug.app` → `http://web:3000` and
  `pb.chugalug.app` → `http://pocketbase:8090`. HSTS is inherent to `.app`. PocketBase version pinned: v0.40.4.
- Backups: PocketBase's built-in backup on a daily cron to `data/backups/`, plus `just backup` that also
  tars `data/places` and `data/gtfs`. Restore procedure documented in `docs/OPERATIONS.md`.
- Disaster fallback: the same Compose file on any VPS with the latest backup and the same `.env`.

## 13. Error handling

| Failure | Behavior |
|---|---|
| Metra RT fetch fails or stale | keep last feed, `status.mode = stale`, banner shows schedule times with tag |
| Static GTFS download fails | keep the previous import, log, retry in 10 min |
| Login not configured (no `CREW_PASSWORD`) | 503 with a message; nothing else works until `.env` is fixed |
| Google Places error or budget | stop is created without photos; admin sees a retry button |
| SSE disconnect | auto-reconnect, refetch collections, toast if offline > 60 s |
| Upload over 90 MB | client-side check with a message before upload starts |
| Recompute finds no trip | leg marked impossible, admin broadcast suggested |
| Sim recording missing | schedule-only synthesized positions, status shows `sim` |

## 14. Testing

- Unit (Vitest): label map (`labels.test.ts`), GTFS parser against the fixture feed incl. `>24:00` times
  (`gtfs.test.ts`), `nextTrips`/`planLeg`/`recomputeLegs` incl. downtown transfer and impossible cases
  (`plan.test.ts`), time zone and DST edge cases (`time.test.ts`), haversine/walk minutes (`geo.test.ts`),
  static schedule download/cache/keep-previous-on-failure (`static.test.ts`), Overpass nearby with disk
  cache (`overpass.test.ts`), Google text search/details/photos field mapping (`google.test.ts`), the
  monthly budget counters (`budget.test.ts`), and `attachPlace`'s fetch-once/text-search/budget-blocked
  paths (`attach.test.ts`). Banner state machine and sim clock math are deferred to M2.
- Hook tests: run PocketBase on a temp `pb_data` with test passwords, hit the login endpoint, assert identity
  creation, case-insensitive reuse, admin flag, access rules, and rate limits (`login.test.ts`); planning
  collections' defaults, lock guard, and event log (`planning.test.ts`); the `stops`-write → internal
  recompute trigger (`recompute.test.ts`). Media tagging with seeded positions is deferred to M3.
- E2E (Playwright, mobile viewport, fixture GTFS + mocked `/api/places/*`): name + password login with
  cookie persistence (`login.spec.ts`); create a draft, add two stops from the schematic and a station
  select, real train times and a leg that recomputes after a layover change, open a stop card, retry
  photos (Google not configured), edit notes/confirmed-open/phone and have them survive a reload, vote and
  comment on the draft, run and tally an approval vote, and lock into The Route (`planning.spec.ts`). Live
  banner with MSW-mocked proxy at fixed sim time, check-in, broadcast ack, and image upload are deferred to
  M2/M3.
- Manual: the December Saturday field test with real phones, and a full-day replay from the recording.

## 15. Milestones

M0 Skeleton → M1 Planning → M2 Metra proxy → M3 Live → M4 Simulation → M5 Wrap-up, as scheduled in the
README. Each milestone gets its own implementation plan in `docs/superpowers/plans/`.
