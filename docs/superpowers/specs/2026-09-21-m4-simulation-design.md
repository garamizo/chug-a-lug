# M4: Simulation without GPS

- Date: 2026-09-21
- Status: specified; implementation pending
- Branch: `feat/m4-simulation`
- Baseline: `72a32a5` (M3 and its review fixes)

## 1. Outcome and confirmed scope

Rehearse the live crawl at home with a shared, controllable clock, a recorded Metra feed, and the
same route editor, Departure Board, Bulletins, Tab, Crew Board and Freight used on the day.
A Conductor can pause, resume, accelerate and advance the rehearsal. Every participant observes
the same run. A complete rehearsal works without a Metra token or a new live-feed request.

**Confirmed by the user: no GPS.** Neither real nor scripted `navigator.geolocation`, waypoint
players, individual location reports, `positions` collections, Punch controls nor straggler alerts
are part of M4. The shared clock and newest Conductor anchor locate the crawl, exactly as in M3.
Metra's feed named `positions` describes trains, not people; it may be recorded and replayed for
feed-status parity, but M4 does not add train dots or a map.

This decision supersedes the scripted-GPS language in the [original design](2026-09-19-chugalug-design.md)
and the older README roadmap. The [M3 design](2026-09-20-m3-live-design.md) remains authoritative for
staged route changes and the anchor. Implementation tasks are in the
[M4 plan](../plans/2026-09-21-m4-simulation.md).

### Included

- A persistent, server-authoritative clock; pause, resume, rates 1×, 5×, 10×, 30× and 60×; forward seek.
- Conductor-only controls; a visible simulation indicator and Railroad Time for everyone.
- Per-feed replay and stale/schedule-only behavior through the existing Metra APIs.
- A deterministic, checked-in rehearsal fixture and support for real Saturday recordings.
- An isolated rehearsal database, media directory and origin, with a repeatable seed/run workflow.
- Tests proving that a virtual event day drives both browser behavior and server-side planning.
- A complete at-home rehearsal and an operations runbook.

### Excluded

GPS; new train-map UI; arbitrary timestamp/service-date rebasing; rewinding an already-mutated
database; automatic scenario scripting; edits to production data; M5 albums, awards and downloads;
changing static route planning to use realtime predictions. `computeLegs` remains the only planner.

## 2. What exists and what must change

| Existing seam | M4 change |
|---|---|
| `web/src/lib/live/day.svelte.ts` owns `now`, advancing every 15 wall seconds | Derive event time from a shared client clock; keep data-poll intervals in wall time |
| `live/current.ts`, `live/board.ts`, `live/cohesion.ts` accept a time | Supply virtual time without changing their underlying position/train rules |
| `server/plan.ts::activeAnchor` defaults to real `new Date()` | Pass the captured server event time from preview, commit and recompute |
| Preview and commit stamp their own current time | Capture one server clock context per operation, including the anchor and validation date |
| `server/metra/index.ts` exports a static loader and a live poller | Select live, replay or timetable provider before starting any real poller |
| `server/metra/realtime.ts` tracks freshness per feed | Preserve that contract; replay freshness must reflect recorded observations |
| `web/scripts/record.mjs` writes deduplicated `<epoch>.<feed>.pb` files | Add a manifest, matching static GTFS snapshot and successful/failed poll observations |
| PocketBase hooks write some event-log timestamps directly | Give hooks an event-clock helper; retain wall-clock creation metadata |
| IndexedDB mirror age uses `liveDay.now` in its callers | Use wall time for cache age; simulation must not make a fresh mirror months old |

Changing only `LiveDay.now` is insufficient: a browser rehearsing December while the server still
thinks it is September would suppress the anchor in commit/recompute, timestamp Tab entries on the
wrong day, and expire alerts against the wrong clock.

## 3. Isolate a rehearsal from the actual crawl

Use a standalone `compose.sim.yml`, not an override merged into `compose.yml`. It has its own
Compose project name, PocketBase volume, uploads, clock state, web cache, credentials and network.
It has no Cloudflare service and never binds host ports 3000 or 8090. Proposed defaults are web
15174 and PocketBase 18094. Existing automated tests retain 15173/18093 and run one suite at a time.

Simulation configuration is explicit: `SIM=1` on web and PocketBase, `PUBLIC_SIM=1` on the web build
and runtime, an isolated `PB_URL`, and a `file:` GTFS source. Normal production defaults remain
`SIM=0`/`PUBLIC_SIM=0`. The launcher and runtime agree on `SIM_RUN_ID`; resolve replay files only under an explicit
`SIM_RECORDINGS_DIR`. A singleton belonging to another run is a setup error. The launcher refuses missing isolation settings, a production PocketBase
URL, production data mounts, or a conflicting host port. An isolated container may retain its standard internal PocketBase port;
that is not a binding to the host's production port. It must not inherit `.env` through the root
justfile's dotenv setting: construct the simulation environment from an allowlist and a separate
ignored simulation env file. Never copy the production PocketBase directory or production secrets.

Recordings may be mounted read-only from the main checkout. Runtime state stays under an explicit,
ignored simulation directory. A sanitized itinerary export can provide stop metadata, but the
seed creates new users and IDs, a draft itinerary, its stops, then locks it through an update.
It waits for the recompute hook to settle and reads the resulting legs instead of assuming seeded
leg times survived. There is one locked rehearsal route per instance.

An ordinary application request never creates, clears or resets a rehearsal database. Starting
over means launching a new named run with a fresh database and re-seeding it. Existing run names
are resumed only when their persisted source/date configuration matches; refuse mismatches.
No `rm -rf` reset command is required for M4. Retired runs can be removed separately by the operator.

For multiple physical phones, use a dedicated rehearsal origin and PocketBase origin reachable by
all phones, with URLs supplied to the launcher. PWA/offline phone rehearsal needs HTTPS; localhost
browser tests supply the secure-context offline checks. The runbook must distinguish LAN HTTP
functional rehearsal from HTTPS PWA rehearsal rather than claim both are equivalent.

## 4. Clock contract

### Persisted state

Add a private `simulation_clock` base collection with one fixed record, ID `simulationclock`.
All direct client list/view/create/update/delete rules are locked; authenticated clients use the
SvelteKit clock endpoint. PocketBase superuser access is used by setup and the server only.

Fields: `run_id` (safe run slug), `revision` (positive integer), `epoch_start` (UTC date),
`wall_start` (UTC date), `rate` (number including zero), `resume_rate`, `service_date` (Chicago date),
`source` (`recording` or `timetable`), `recording_id` (optional safe slug), `window_start` and
`window_end` (UTC dates). Source/date/window are immutable after setup. Revision increments on every
control mutation. Initial state is paused at the scenario start, with resume rate 1.

For a captured wall instant `w`, all clock math is:

```
eventNow = min(windowEnd, epochStart + max(0, w - wallStart) * rate)
```

A zero rate pauses. Reaching the window end reports an ended/paused effective clock and never loops.
Rate changes first materialize eventNow using the old state, then re-anchor both epochs; changing
speed must not jump the clock. Pause remembers the last nonzero rate. Resume uses that rate. Selecting a rate while paused
updates the remembered resume rate without starting playback.
Seeking is allowed only while paused, at or after eventNow, within the configured window. Negative
rates, backwards seeks, invalid dates, nonfinite numbers and unsupported rates return 400.

A run window covers the chosen scenario and its final stop. It is explicit in fixture/recording
metadata; it is not derived from the latest file separately on every request. The normal M3
Chicago-date gate still applies when a window spans midnight. Cross-midnight crawl redesign is
outside M4; tests must demonstrate the existing gate rather than accidentally bypass it.

### API

`GET /api/sim/clock` requires a signed-in user. Return `enabled`, `serverWallNow`, `eventNow` and,
when enabled, `runId`, `revision`, `epochStart`, `wallStart`, `rate`, `resumeRate`, `serviceDate`,
`source`, `recordingId`, `windowStart`, `windowEnd` and `ended`. Map these camelCase API keys to the
snake_case storage fields. Dates are ISO UTC. With `SIM=0`,
return `enabled:false` and real time, without reading the simulation collection.

`POST /api/sim/clock` requires a Conductor and `SIM=1`. Body:

```
{ expectedRevision, action: 'pause' | 'resume' | 'rate' | 'seek', rate?, at? }
```

Return the same complete clock response. Missing/stale revision returns 409 and current state;
missing login 401; Crew 403; simulation disabled 404; malformed input 400. A missing/corrupt enabled
clock or unavailable persistence returns 503, never a silent switch to wall time or real feeds.
All clock responses use `Cache-Control: no-store` and `Vary: Authorization`.

The single web process serializes control mutations and checks the revision again before persisting.
Prevent clock changes during a plan commit: track active event-write leases (commit and autonomous recompute) and return a retryable 409
from the control endpoint while one is applying. Do not hold a clock mutex while waiting on
`recomputeItinerary`; its hook-triggered queue must remain able to run. Preview is a dry run and
returns its captured `clockRevision`, which the editor rejects if it is now obsolete. In simulation,
commit requires that `clockRevision` and rejects a stale one with 409 before any write. Normal-mode
payloads remain backward-compatible. Recheck the captured revision when admitting the commit to its write phase, serialized against
control mutations: a clock change during validation also returns 409 with zero writes. An applying
commit cannot be made stale by a control change.

Persistence gives a defined restart behavior: paused stays paused; a running clock includes elapsed
wall time during a restart, bounded by windowEnd. Restart does not create a new run or revision.
For a fresh replay from the beginning, use a new named instance.

### Browser synchronization

Add a client clock store, initialized once by the app layout before starting event-dependent data
loads. Interpolate from a server event-time sample using local `performance.now()`; do not assume
the phone's wall clock agrees with the server. Estimate request transit using half the round trip;
never extrapolate a paused clock. A newer revision invalidates older in-flight clock/preview/feed
responses. Synchronize every five wall seconds and on focus/online/control success. Do not expose
the clock collection just to gain SSE: bounded polling is sufficient for ten users.

Use a 250 ms display tick only in simulation (60× then advances by at most 15 event seconds per tick).
Normal live mode may keep its current cadence. Only the latest subscription/refresh is installed,
and all timers and focus/online listeners are disposed on logout/layout teardown.

After a clock revision change, immediately refresh route/anchor, trains, alerts, Tab and Freight,
and trigger an editor preview even if its stop list did not change. Between revisions, ordinary
30-wall-second data polling remains for records; replay train/alert refresh uses one wall second
in simulation so acceleration does not leave the board many simulated minutes behind.

A running client that loses connectivity may keep displaying its last known mapping, marked as
unsynchronized; writes and Conductor controls require a successful resync. A fresh offline
simulation boot may show the route mirror but must not fabricate a clock or silently use today's
wall date. `PUBLIC_SIM` makes that distinction available before the first API response. Mirror data
is tagged with `run_id`; discard an old run's mirror after learning the current run ID. Mirror age
and clock-last-synced age are always wall-time measurements.

## 5. Event time versus operational time

| Value | Clock |
|---|---|
| Shared current stop, countdown, live-day gate, Crew Board's day | Event time |
| Preview anchor, commit anchor, cohesion gate, recompute anchor-date check | One captured server event time per operation |
| Metra default `after`, alert active periods, replay selection | Event time; an explicitly supplied `after` remains honored |
| `checkins.at`, `drink_entries.at`, `event_log.at` for rehearsal actions | Event time |
| Bulletin's displayed sent time | Event time in a new `broadcasts.at` field |
| PocketBase `created`/`updated`, `locked_at`, leg `computed_at` | Wall time, as storage/operational metadata |
| Mirror `savedAt` and its age, parked-editor expiry | Wall time |
| Token expiry/auth cache, login rate limits, Places budgets/TTL, network timeouts | Wall time |
| Live Metra polling/freshness outside simulation, recording observation time | Wall time |
| Photo/video `taken_at` supplied by the file | Actual capture time; never rewrite EXIF/file dates |

Update both live-page drink logging and hook-generated event logs. Add `broadcasts.at` with a
migration that backfills existing rows from `created`; create hooks stamp it from the authoritative
event-clock helper and the Bulletin event-log row reuses it. Display `at` with a `created` fallback
for older mirrored data. Keep newest-Bulletin/ack behavior and idempotent retry IDs intact.
The hook helper uses `$os.getenv('SIM')` and reads the same singleton record when enabled; it never
calls back into a blocking web endpoint. Test its arithmetic against the shared TypeScript clock
vectors. In normal mode hooks continue stamping wall time.

`computeLegs` stays pure apart from its existing schedule read. Inject time where the anchor is
chosen, not inside the train search. Commit captures event time/revision before validation and
retains that context for its explicit recompute. Autonomous hook recomputes capture their own
context inside a write lease at execution time. No process-wide monkey-patching of `Date`, timer acceleration or
simulation-specific bypass of `activeAnchor`/cohesion rules is allowed.

### Ordering actions while time is paused

Event timestamps are not action IDs. Add a server-assigned, immutable positive `action_order` to
`checkins` and `drink_entries`, allocated from a persisted monotonic counter in the same database
transaction as creation. Rollbacks must not publish an order and concurrent creates must never
share one. Ignore client-supplied values, including superuser request values. Deleting the latest
row must not reset the counter. Backfill existing rows deterministically by `(created, id)`;
the original submission order of historical same-timestamp records cannot be reconstructed.

Keep event time unchanged while paused. Both server `findAnchor` and client `loadAnchor` sort by
`-at,-action_order`; the Tab's Undo comparison uses `(at, action_order)` and does not depend on list
arrival order. Define a stable `(created, id)` fallback only for legacy cached entries lacking the
new field. Repeated paused saves, retry-created anchor rows, same-millisecond requests, concurrent
creates, and beer-then-water followed by Undo all get regression tests. Two distinct actions can
have the same `at`, but must still have an unambiguous latest action.

### Recompute publication and clock changes

Every operation that publishes event-dependent legs participates in the clock's write lease,
including autonomous hook recomputes. Acquire a lease before capturing the recompute's context and
hold it through computing and publishing its legs and log. For a supplied commit context, verify
its revision at lease admission; never publish using an obsolete revision. Control mutations return
409 while any lease is active. Release leases on every failure path.

A lease is a reference count admitted under a short serialization lock, not a mutex held across
its callback. Nested recompute inside commit can obtain a lease on the same revision, and queued
hook recomputes can finish while the commit awaits the per-itinerary queue. Add tests that hold an
autonomous recompute across a requested midnight seek, exercise a nested lease, and throw inside a
publisher; no stale legs, deadlocks or leaked busy state are permitted. Read-only previews remain
optimistic and discard responses from obsolete revisions.

## 6. Recording format and replay

### Dates and static schedule

M4 replays a recording on **its original Chicago service date**. Set the rehearsal itinerary and
clock to that date, even when rehearsing in September. Do not rewrite just `header.timestamp`:
trip-update arrival/departure epochs, trip `startDate` and alert periods would still be wrong.
There is no arbitrary recording-to-December-26 rebasing in M4. The synthetic scenario uses the
existing December 26 fixture schedule; a real Saturday recording uses its matching archived GTFS.

A recording directory contains:

- Existing `<headerEpochSeconds>.<positions|tripupdates|alerts>.pb` files.
- `manifest.json`, version 1: service date, recording ID, UTC playback window, GTFS zip filename and
  SHA-256, start/end observation times, and whether poll observations are available.
- `schedule.zip` copied/downloaded once when recording begins, before snapshots are accepted.
- `polls.ndjson`: one result per feed attempt, with wall observation time, feed name, success/failure,
  and the successful snapshot's header epoch. Never store request headers, tokens or raw error objects.

The recorder retains deduplication and the 30-second minimum real polling interval. Only append a
successful observation after its snapshot is safely written. Failed fetch/decode/write attempts
produce a failed observation. Use a single in-flight tick and atomic snapshot/manifest replacement;
partial trailing NDJSON after an interrupted process is ignored and reported during indexing.

Legacy recordings without manifests are not silently replayed against today's GTFS. An explicit
index command accepts the known matching zip, service date and playback window, verifies them,
and produces metadata with `observationsAvailable:false`. Without poll history, freshness uses
snapshot header timestamps conservatively; this limitation is visible in the source description.
The command cannot reconstruct past successful polls from duplicate suppression.

### Provider boundary

Introduce an asynchronous `RealtimeProvider.snapshot(context)` returning an immutable `Feeds` plus
per-feed status for the same captured event instant. Adapt the existing live loader; do not remove
its per-feed freshness, stop/start lifecycle or existing tests. Mode selection happens centrally:

- Normal process: existing live poller, real token, wall-time cadence and freshness.
- Simulation recording: disk-backed replay, pinned static zip, no live poller and no network fallback.
- Simulation timetable: no realtime data; existing scheduled trips and `schedule_only` mode.

`/api/metra/next`, `/alerts` and `/status` use this boundary. Static stations/planning load the same
pinned schedule as replay. Add a source discriminator (`live`, `recording`, `timetable`) and clock
revision to simulation responses; do not overload `FeedMode` to mean source. A fresh recording may
still have `mode:'live'` internally, but UI must identify it as recorded under Shakedown Run.

Index each feed independently. With poll observations, choose the latest successful observation
at or before eventNow and resolve its referenced snapshot. A failed observation never refreshes
freshness. With legacy metadata, choose the greatest snapshot epoch not after eventNow. Never
select a future snapshot, including an entity header later than its observation. A missing feed
before its first observation is null. Missing/corrupt files are reported and skipped to the most
recent valid prior observation; do not re-date that fallback as fresh.

Preserve the recorded protobuf timestamps and entities. Freshness is eventNow minus the selected
successful observation (or legacy header), independently for each feed. Use the existing 120-second
staleness rule. Gaps and the tail after the final observation naturally become stale; stale trip
predictions fall back to timetable while alerts retain the existing active-period behavior.
At the playback window end, pause/clamp; do not jump back to the first snapshot.

Resolve recording names and all manifest references within the configured recordings directory,
including realpath/symlink containment. Accept safe slugs, never user-provided arbitrary paths.
Validate hashes, parseable epochs, manifest version, nonempty usable BNSF service and agreement
between trip IDs/service dates and the pinned schedule. Reject incompatible metadata at setup;
report unmatched entities in diagnostics rather than presenting a supposedly healthy replay that
contributes no usable trip updates. Cache decoded snapshots by file with a bounded LRU; a rehearsal
must not decode an entire all-day recording into memory on startup or on every display tick.

Timetable fallback means the existing scheduled departures, not invented vehicle positions or
fake delays labeled live. The checked-in scenario supplies deliberate predictions and cancellations
when those behaviors need testing.

## 7. Controls and rehearsal flow

Keep vocabulary in `web/src/lib/labels.ts`: existing Shakedown Run and Railroad Time labels, plus
plain control/status copy. An always-visible indicator identifies simulation, event date/time,
rate, paused/ended state and synchronization status. Crew sees the indicator but no mutation
controls. Conductor gets a menu entry to `/sim` with pause/resume, rate buttons and a forward-time
input. Source/date are shown read-only; startup selects them. Controls handle 409 by displaying
and adopting current state, without automatically replaying an obsolete action.

Use real route editing to set the crew's position. There is no second correction button on the
Departure Board, no location permission prompt, and no alternate simulation planner. A deliberate
hold, annulment or anchor change goes through preview, Save, recompute and the Bulletin sheet.

Rehearsal steps: create a new named fixture run; sign in as one Conductor and two Crew; inspect
paused start; advance through Last Call/All Aboard; exercise a delayed and canceled train; Save a
hold and a changed position; acknowledge Bulletins on separate phones; log/undo drinks; upload a
small photo; lose and regain connectivity; advance beyond the final stop; check persisted records.
Then repeat with an indexed Saturday recording and its original date.

## 8. Acceptance and validation

1. Two independent browser sessions agree exactly when paused. At speed, divergence is bounded by
   measured request transit and display tick, not the phones' wall-clock skew. A control change
   reaches another online client within five wall seconds without navigation.
2. Simulated December on a real September day drives server preview, commit, anchor, recompute and
   browser board consistently. Clock changes during an applying commit return 409 without deadlock.
3. Off-event-day validation still checks the entire route. Event-day impossible legs before the
   anchor remain history. UTC-midnight/Chicago-date cases stay covered.
4. Pause/rate/seek preserve continuity; restart semantics are tested; backwards seek is rejected.
5. Replay selects no future data, handles cancellation/delay/alert periods, independently goes stale,
   and falls back to scheduled departures without calling the real feed.
6. SIM-disabled defaults retain normal behavior, hide controls, reject mutations, and do not depend
   on a simulation record. Crew cannot mutate state directly or through the API.
7. Tab counts use the rehearsal day; Bulletin/event-log timestamps use event time; uploads retain
   real capture metadata; mirror age, TTLs and authentication remain on wall time.
8. A late response from an older revision cannot restore old train/preview/clock state. Offline
   recovery re-syncs before writes; a new run cannot inherit the old run's mirror.
9. Seed/setup refuses production URLs/data and occupied ports. Separate run names have independent
   records and uploads; live credentials never appear in fixtures, manifests or logs.
10. Complete both ordinary and simulation Playwright suites, production-build offline smoke check,
    unit/type checks and hook tests sequentially. Record the at-home rehearsal results separately;
    automated green checks alone are not the full milestone acceptance.

## 9. Defaults chosen for this plan

GPS is the confirmed user decision. Other choices here are implementation defaults: isolated
instance, original recording date, forward-only time travel, immutable source per run, five-second
clock sync and the listed rates. They bound M4 without adding a second data model for undoing a day.
If a future requirement needs replaying one Saturday's predictions on a different date or rewinding
persisted interactions, write a separate design for full timestamp rebasing or run-scoped history.
