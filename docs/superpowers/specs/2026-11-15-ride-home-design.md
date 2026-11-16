# Run home: every route starts and ends at Aurora

Status: design, 2026-11-15. Branch `feat/ride-home`. First of four M5 pieces (ride home → photo Tab →
Golden Spikes → Closing Time); the user asked for them to run unattended, with Codex reviewing in their place.

## Why

The family parks at **Aurora** (BNSF) and must end the day back at the cars. Today a route boards at an
optional **Board at** station and simply *ends at its last bar*: there is no train home in the plan, and Live
calls the crawl over the moment the crew walks into the last stop. That is wrong twice:

- nobody is told which train gets them back to the cars (the one train that truly must not be missed);
- Closing Time (piece 4) is meant to open "after we return to the station", and there is nothing to time it by.

## Goals

1. Every route has a Board at station. New routes default to **Aurora**; the planner no longer offers "none".
   It can still be changed to another station (the user said "by default").
2. Every route with stops ends with a **Run home**: a computed leg from the last stop back to the Board at
   station, shown in the planner and on The Route, flagged like any other leg when no train makes it.
3. On Live the Departure Board at the last stop counts down to the train home, and the crawl is over when
   that train **arrives** at the Board at station, not when the crew reaches the last bar.
4. One shared function answers "when does the crawl end" so Closing Time and Golden Spikes can use it later.

## Non-goals

- No per-person home station or personal "last train home" (still a later idea in ROADMAP).
- No change to which line the planner shows (BNSF only).
- No Closing Time screen; this only provides its trigger time.

## Anti-goals

- A second leg planner. The run home is produced by `recomputeLegs` like every other leg, so preview,
  commit and recompute still agree (CLAUDE.md: "Nothing may plan legs except `computeLegs`").
- An anchor that breaks: a Conductor correction at the last stop must replan the run home from the anchor.

## Constraints found in the code

- The ride *in* already exists: `recomputeLegs` (`web/src/lib/metra/plan.ts`) emits a leg with
  `fromStopId: ''` from `startStation` to stop 1. Migration `1758880000_start_station.js` made
  `legs.from_stop` optional for it. `legs.to_stop` is still `required: true`
  (`1758400000_planning.js:157`).
- Consumers key legs by `from_stop` / `to_stop`: `current.ts` (`timings`), `strip.ts`, `board.ts`
  (`plannedTrain`, `boardingJourney`), `cohesion.ts` (`cohesionBlockers`, `impossibleFromAnchor`),
  `ItineraryView.svelte` (`opening`, `legAfter`, `finish`), `preview.ts`, `sim/seed.ts`.
- `current.ts` `finished()` today: at the last stop, `departAt === null ? at >= arriveAt : at >= departAt`.
  Once the last stop has an outgoing leg this would end the crawl at the home train's *departure*.
- `day.svelte.ts` `loadTrains` asks for trains `from` the current stop's station `to` `here.onwardStop`;
  at the last stop `onwardStop` is null, so the board shows no train.
- `pb_hooks/planning.pb.js` defaults `event_date` and `start_time` on create and recomputes when
  `start_station` changes. `planActions.setStartStation(null)` clears it today (tested in
  `planActions.test.ts:56`).
- Existing data (read from the production database on 2026-11-15): all three routes are test data. "Example Route" (locked, current) and one draft
  have no Board at; one draft boards at Aurora.

## Approaches considered

1. **A closing leg with `to_stop = ''`, mirroring the opening leg (chosen).** Same table, same planner, same
   rendering pattern as the ride in. Cost: `to_stop` becomes optional and every consumer that maps by
   `to_stop` must ignore `''`.
2. **A synthetic "home" stop row at Aurora appended to every route.** Reuses all stop logic, but it would show
   up as a bar in the Tab, Freight tagging, the strip, cheers and comments; every stop consumer would need to
   exclude it. Much larger blast radius.
3. **Compute the run home on the client only.** Breaks the preview/commit/recompute agreement and would
   not exist for the server's Save gate. Rejected.

## Design

### Home station

- `HOME_STATION = { id: 'AURORA', name: 'Aurora' }` lives in one TS module (`web/src/lib/home-station.ts` or
  similar, builder's call) and is mirrored in a hooks helper; a test asserts the two agree.
- **Default at the source, not in the create hook.** The planner's "new route" action and `cloneRoute` set
  `start_station`/`start_station_name` to Aurora when creating (a clone keeps its source's station, falling
  back to Aurora). The `itineraries` create hook does *not* default it: test fixtures and the simulation seed
  create routes through the API without a Board at, and they keep today's shape (no opening or closing leg).
  This keeps the blast radius off the simulation harness (`sim/seed.ts` `verifySeedLegs` expects
  `stops.length - 1` legs; `tests/sim/setup.ts` waits for two) and the recording archives, which do not
  contain Aurora. (Codex finding 6.)
- `pocketbase/pb_hooks/planning.pb.js` update hook: an update that clears a non-empty `start_station` is
  rejected with 400 (`start_station_required`), for crew and superusers alike.
- Migration (`pocketbase/pb_migrations/`): backfill every itinerary with an empty `start_station` to Aurora, and make `legs.to_stop`
  optional. Down: delete legs with `to_stop = ''` and make it required again (mirrors `1758880000`); it does
  not un-backfill.
- Planner (`ItineraryView`): the Board at select drops the empty "Pick where the crew boards" option. The
  `setStartStation` action no longer accepts null.
- Existing legs are stale after the backfill. After deploy each route must show its run home without a manual
  edit: the builder picks the mechanism (e.g. a `just recompute-all` recipe run from the deploy steps, or the
  web server recomputing routes whose legs lack a closing leg on start). Document it in OPERATIONS.

### Planning the run home (`recomputeLegs`)

After the stop-to-stop loop, when `startStation` is set and there is at least one stop:

- `last` = the last stop by order; its arrival is the running `arrival`, replaced by `anchor.atMin` when the
  anchor is the last stop (same rule as the loop).
- `readyMin = arrival + last.dwell_min`, `atStation = readyMin + last.walk_min`.
- `plan = planLeg(s, last.station_id, startStation, atStation, date)`. Same station → a 0-minute walk leg
  (already `planLeg`'s behaviour), so a last bar at Aurora needs no train.
- Push `{ fromStopId: last.id, toStopId: '', kind, readyMin, departMin, arriveMin }` with
  `arriveMin = plan.kind === 'impossible' ? atStation : plan.arriveMin` (no venue walk at the end: arriving at
  the station *is* arriving at the cars).
- **No run home after midnight.** If the plan's arrival is at or past minute 1440 of the service day, the
  closing leg is `impossible` instead. The practice-day clock (`planClock.ts`) and the event-day gates
  (`anchor.ts`, `onEventDate`) switch at Chicago midnight, so a crawl still riding home at 00:30 would turn into
  a practice day mid-ride and never reach its end. The planner must say *why* the run home is impossible
  ("The last train home must arrive before midnight" vs "No train from X to Aurora"); the builder chooses how
  that reason reaches `ItineraryView` (e.g. computing it client-side from the last stop's ready time and the
  schedule, or a reason field in `segments`). Late *intermediate* legs already have this problem today and stay
  out of scope. (Codex finding 7.)

`legs` are emitted in route order (opening, stop-to-stop, closing); after an early anchor correction their
timestamps need not be chronological.

### Consumers

- **`crawlEnd(stops, legs, startAt)`**: new exported pure function in `current.ts`. Returns
  `{ at: Date }` when the closing leg exists and is not `impossible` (its scheduled `arrive_at`);
  `{ at: null, reason: 'no_run_home' }` when the closing leg is `impossible` (no train, or after midnight);
  and today's fallback (last stop's arrival) when there is no closing leg (no Board at, legacy data). A null end
  means **the crew is not home**: it never produces `after`, and pieces 3 and 4 must not open Closing Time or
  finalise awards from it. Autonomous recompute can persist an impossible run home even though Save blocks it,
  so this is a real state, not just an editor one. (Codex finding 2.)
- **`current.ts` `currentStop`**: `timings` must not treat the closing leg as an incoming leg (`to_stop` `''`).
  The last stop's `departAt` becomes the closing leg's departure. The crawl is `after` once `now >= crawlEnd.at`
  (never when `at` is null). Between the home train's departure and its arrival the source stays `clock`
  (or `override`) at the last stop — riding home is still part of the crawl.
  - **Anchor at the last stop** (Codex finding 1): today an anchored last stop becomes `after` only when
    `checkedIn <= arriveAt`, so a late correction stays `override` forever. New rule for the anchored last
    stop: `after` iff the closing leg is resolved, its `ready_at` is at or after the check-in (i.e. it was
    replanned from this correction, not stale legs predating it), and `now >= crawlEnd.at`. With stale legs
    (recompute not landed yet) it stays `override`. Tests: early and late terminal check-ins, before and after
    recompute, up to and past the home arrival.
- **Completion uses the scheduled arrival** of the closing leg, not realtime predictions. If the crew misses the
  train home, the Conductor corrects the position at the last stop and the recompute plans the next one, as for
  any missed train.
- **Departure Board** (Codex finding 3): at the last stop (`onwardStop` null, closing leg present with a
  train) the board's destination is the Board at station. Implement as a `rideHome` getter on `liveDay`
  parallel to `boarding`, feeding `loadTrains`' `to` and the `nextStation` prop in `live/+page.svelte` and
  `(app)/+layout.svelte`. The layout's train-reload key must include it. Three states, driven by the closing
  leg's scheduled times:
  - **waiting** (`now <` the home train's departure): count down to the planned home train (`pickTrip` with the
    closing leg's first train as `plannedTripId`; `loadTrains` asks from just before it, as it does for the
    planned train today).
  - **riding** (departure `<= now <` `crawlEnd.at`): the board stops counting down and shows "On the way home ·
    arrives 10:42 PM" from the closing leg (new labels). It does not fall through to the next train or "no
    train left".
  - **home** (`now >= crawlEnd.at`): source `after`; the board shows what it shows after the crawl today.
  - With the closing leg impossible, the last stop keeps today's board (next trains toward home if any; else
    "no train left").
- **`strip.ts`**: build its `to_stop` maps from legs with a non-empty `to_stop` only. No new strip node.
- **`cohesion.ts`**: a closing leg's `toStopId` `''` names the Board at station ("No train from Pierce
  Tavern to Aurora"), not `copy.theStart`. `cohesionBlockers` needs the station name passed in. An impossible
  run home at or after the anchor blocks Save, as any later leg does.
- **`ItineraryView`**: render the closing leg after the last stop card (like `opening-leg`, testid
  `closing-leg`), labelled **Run home to Aurora**, with its `LegRow` and the unserved-station reason when the
  last stop's station has no service. The Finish stat becomes the closing leg's arrival when present.
- **`preview.ts`, `sim/seed.ts`, `plannedTrain`**: check they tolerate `to_stop: ''` (ids, sort); fix if not.

### Labels and glossary

- `copy.runHome: 'Run home to'` (UI: "Run home to Aurora"). README glossary row: Developer term "Closing leg
  (last stop → Board at)", UI label **Run home**, Rail, notes "Run" is a train leg.
- Remove `boardAtPick` if unused.

### Offline (Codex findings 4, 5: rejected as out of scope)

The mirrored route already cannot show a countdown when Metra is unreachable, and does not mirror the anchor;
both are true of every leg today, not something the run home introduces. The riding state above is derived from
mirrored legs only, so it does work offline.

## Testing (written first)

- `plan.test.ts`: closing leg present with start station; absent without stops; same-station walk; impossible
  when no train after the last stop; anchor at the last stop replans it.
- `current.test.ts`: board counts to the home train; source `clock` while riding home; `after` only at the
  home arrival; `crawlEnd`.
- `cohesion.test.ts`: impossible run home names the station and blocks Save after the anchor.
- `strip.test.ts`, `board.test.ts`: ignore `to_stop: ''`; ride-home trip choice.
- Hooks: create defaults Aurora; clearing `start_station` → 400; migration backfill; legs with `to_stop = ''`
  can be written by the recompute path.
- e2e: planner shows "Run home to Aurora"; Board at has no empty option; one `layoutSweep` line for a route
  with a run home. Routes created through the planner UI in e2e now board at Aurora, which the fixture GTFS
  (`web/tests/fixtures/gtfs/`, zipped into `gtfs.zip`) lacks: add an `AURORA` stop and extend some BNSF fixture
  trips to serve it (both directions, before and after midnight-safe times), rebuild `gtfs.zip`, and regenerate
  the sim fixture only if `just sim-fixture` reads it. Check `stations`-based tests (line drawing, unserved
  stations) for count changes.
- `current.test.ts`: midnight rule; impossible run home never yields `after`.

## Left to the builder

- Module names and where `HOME_STATION` lives; the post-deploy recompute mechanism.
- Exact visual of the closing leg (reuse the opening leg's style).
