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
                                                        │     └── pb_hooks: OTP signup/recovery, media tagging
                                                        └── cloudflared  outbound tunnel, no open ports
```

Three processes. PocketBase owns all persistent state and realtime. The SvelteKit server owns everything
that talks to third parties (Metra, Google, Twilio is the exception: called from a PocketBase hook because
it must mint auth tokens). The browser talks to both: PocketBase directly for records and SSE, SvelteKit
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
    pb_hooks/                 # JS hooks: otp.pb.js, media.pb.js, guards.pb.js
  web/
    package.json, svelte.config.js, vite.config.ts
    src/lib/labels.ts         # developer term -> UI label (the glossary)
    src/lib/pb.ts             # PocketBase client + auth store
    src/lib/server/metra/     # gtfs static loader, rt poller, next-train, recorder, replayer
    src/lib/server/sim/       # sim clock
    src/lib/server/places/    # google places fetch-once
    src/routes/               # pages + /api/*
    tests/                    # vitest unit, playwright e2e
  data/                       # git-ignored runtime state
    pb_data/                  # SQLite + uploaded files
    gtfs/                     # schedule.zip + published.txt + sqlite import
    recordings/<name>/        # <epoch>.positions.pb etc.
    places/<place_id>/        # 1.jpg .. 5.jpg + meta.json
    backups/
```

### 2.2 Environment and secrets

All secrets live in `.env` on the home box, loaded by Compose. `.env.example` documents each.
`METRA_API_TOKEN`, `GOOGLE_PLACES_KEY`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SID`,
`CLOUDFLARE_TUNNEL_TOKEN`, `PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD`, `PB_URL` (internal, `http://pocketbase:8090`),
`PUBLIC_PB_URL` (what the browser uses: `http://localhost:8090` in dev, `https://pb.chugalug.app` in prod),
`OTP_DEV_CODE` (dev only, honored only when PocketBase runs with `--dev`),
`SIM` (0/1), `SIM_RECORDING`, `SIM_START`, `SIM_RATE`.

## 3. Data model (PocketBase collections)

All collections have `id`, `created`, `updated`. Times are UTC in the database; the app renders
America/Chicago. Access rules in brackets: A = admin only, U = any authenticated user, O = record owner.

| Collection | Fields | Rules |
|---|---|---|
| `users` (auth) | `phone` (unique, E.164), `name`, `is_admin` bool, `share_position` bool, `home_station` text, `left_early` bool | list/view U, update O (except `is_admin`), create via hook only |
| `allowlist` | `phone` (unique), `name`, `is_admin` | A |
| `stations` | `stop_id` (GTFS), `name`, `route_ids` json, `lat`, `lon` | view U, write A (seeded from GTFS) |
| `itineraries` | `title`, `status` enum draft/locked/archived, `event_date`, `created_by` rel users, `locked_at` | list/view U, create U, update O or A, only A may set locked |
| `stops` | `itinerary` rel, `order` int, `name`, `kind` enum bar/restaurant/other, `station` rel, `place_id`, `address`, `lat`, `lon`, `hours` json, `phone`, `confirmed_open` bool, `dwell_min` int, `walk_min` int, `notes`, `meet_point` text | view U, create/update U while itinerary draft; A always |
| `stop_photos` | `stop` rel, `file` file, `source` enum google/user, `attribution` text | view U, create U (user source) or hook (google) |
| `votes` | `user` rel, `target_collection` text, `target_id` text, `value` enum up/down | view U, create/update/delete O; unique (user, target) |
| `comments` | `user` rel, `target_collection`, `target_id`, `body` | view U, create U, update/delete O |
| `approval_votes` | `itinerary` rel, `user` rel, `value` enum go/nogo | view U, create/update O while itinerary draft |
| `legs` | `itinerary` rel, `from_stop` rel, `to_stop` rel, `route_id`, `trip_id`, `depart_station`, `arrive_station`, `sched_depart`, `sched_arrive`, `computed_at` | view U, write server only |
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
- `stations` is seeded by a script from `stops.txt` filtered to UP-W, MD-W, BNSF.

## 4. Authentication

Flow (PocketBase hooks in `otp.pb.js`, Twilio Verify):
1. `POST /api/crawl/otp/start {phone}`: normalize to E.164; reject unless in `allowlist`; call Verify
   `Verifications.create`; respond 204. Rate limit 5 per phone per hour.
2. `POST /api/crawl/otp/check {phone, code, pin}`: call Verify `VerificationChecks.create`; on approved,
   create the `users` record if missing (name and is_admin copied from allowlist) and set its password to
   the PIN; respond with a PocketBase auth token (`$tokens.recordAuthToken`).
3. Login: standard `pb.collection('users').authWithPassword(phone, pin)` with `phone` configured as the only
   identity field (`passwordAuth.identityFields = ["phone"]`, unique index on `phone`) and the password
   field's `min` set to 4. Token lifetime 180 days (`authToken.duration = 15552000`).
4. Recovery = step 1 and 2 again with a new PIN.
5. Dev mode: when PocketBase runs with `--dev` and `OTP_DEV_CODE` is set, step 1 skips Twilio and step 2
   accepts only that code. The production container never passes `--dev`, so the bypass cannot be enabled there.

Admin role: `users.is_admin`. Collection rules reference `@request.auth.is_admin = true`.

## 5. Metra proxy ("dispatcher")

Module `web/src/lib/server/metra/`, started once at server boot.

- **Static**: on boot and every 10 minutes, fetch `published.txt`; if changed, download `schedule.zip`
  and import into `data/gtfs/gtfs.sqlite` with `node-gtfs`. Expose `nextTrips(fromStopId, toStopId,
  afterTime, serviceDate)` returning trips that stop at both stops in order, express-aware.
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
on the SvelteKit server (shared secret header). Recompute:
1. Sort stops by `order`. For each consecutive pair, find the first trip from stop A's station to stop B's
   station departing after `arrivalAtA + dwell_min + walk_min`, on `event_date`.
2. Write `legs`, append `event_log {kind: recompute, payload: diff}`.
3. If any pair has no trip before the day's last train, mark the leg `status: impossible`; the UI shows it red.
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

`POST /api/places/attach {stopId, placeId}` (authenticated): if `data/places/<placeId>/meta.json` exists,
reuse it. Otherwise call Place Details (field mask: displayName, formattedAddress, regularOpeningHours,
rating, nationalPhoneNumber, photos) then up to 5 Place Photos (max 800 px), write JPEGs and meta, create
`stop_photos` records with `source: google` and the photo's author attribution, update the stop's address,
hours, phone. Budget guard: refuse when the month's counter exceeds 800 photo calls.

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
| Twilio error | 502 with a friendly message; dev code path unaffected |
| Google Places error or budget | stop is created without photos; admin sees a retry button |
| SSE disconnect | auto-reconnect, refetch collections, toast if offline > 60 s |
| Upload over 90 MB | client-side check with a message before upload starts |
| Recompute finds no trip | leg marked impossible, admin broadcast suggested |
| Sim recording missing | schedule-only synthesized positions, status shows `sim` |

## 14. Testing

- Unit (Vitest): phone normalization, `nextTrips` against a fixture GTFS subset, banner state machine,
  recompute with hold/cancel/add cases, GTFS `>24:00` times, sim clock math.
- Hook tests: run PocketBase on a temp `pb_data`, hit OTP endpoints with the dev code, assert user creation
  and token; media tagging with seeded positions.
- E2E (Playwright, mobile viewport): login, create draft, add stop, lock, live banner with MSW-mocked
  proxy at fixed sim time, check-in, broadcast ack, upload a small image.
- Manual: the December Saturday field test with real phones, and a full-day replay from the recording.

## 15. Milestones

M0 Skeleton → M1 Planning → M2 Metra proxy → M3 Live → M4 Simulation → M5 Wrap-up, as scheduled in the
README. Each milestone gets its own implementation plan in `docs/superpowers/plans/`.
