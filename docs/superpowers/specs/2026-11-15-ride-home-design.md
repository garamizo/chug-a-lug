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
- Existing data: all three production routes are test data. "Example Route" (locked, current) and one draft
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
- `planning.pb.js` create hook: if `start_station` is empty, set `start_station`/`start_station_name` to
  Aurora. Update hook: an update that would set `start_station` to empty is rejected with 400
  (`start_station_required`), for crew and superusers alike.
- Migration: backfill every itinerary with an empty `start_station` to Aurora, and make `legs.to_stop`
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

Order of `legs` stays chronological: opening, stop-to-stop, closing.

### Consumers

- **`current.ts`**: `timings` must not treat the closing leg as an incoming leg (`to_stop` `''`). The last
  stop's `departAt` becomes the closing leg's departure, so the board counts down to the train home. The crawl
  is `after` once `now >= closing.arrive_at`. Between the home train's departure and its arrival the source
  stays `clock` (or `override`) at the last stop — riding home is still part of the crawl. Routes without a
  closing leg (no stops, or legacy data) keep today's rule.
- **`crawlEnd(stops, legs, startAt)`**: new exported pure function returning the time the crawl is over (the
  closing leg's `arrive_at`, else today's fallback). `currentStop` uses it; pieces 3 and 4 will.
- **Departure Board**: at the last stop (`onwardStop` null, closing leg present and not a 0-minute walk) the
  board's destination is the Board at station. Implement as a `rideHome` getter on `liveDay` parallel to
  `boarding`, feeding `loadTrains`' `to` and the `nextStation` prop in `live/+page.svelte` and
  `(app)/+layout.svelte`, and the planned trip (the closing leg's first train) so the board counts down to
  *that* train. The layout's train-reload key must include it.
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
  with a run home. Existing fixtures that assumed no Board at will now get Aurora and an opening + closing
  leg; update their expectations rather than opting out of the default.

## Left to the builder

- Module names and where `HOME_STATION` lives; the post-deploy recompute mechanism.
- Exact visual of the closing leg (reuse the opening leg's style).
