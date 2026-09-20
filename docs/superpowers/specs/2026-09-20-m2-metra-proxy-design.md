# M2 Metra proxy and Departure Board: design

Date: 2026-09-20. Status: approved design, pre-implementation.
Companion docs: [system design](2026-09-19-chugalug-design.md) (sections 5 and 6 are the parent of this
one), [README](../../../README.md) (product scope, UI glossary), [REFERENCES](../../REFERENCES.md).

This spec uses developer terms. UI labels come from the README glossary and live only in `$lib/labels.ts`.
Where it contradicts the 2026-09-19 design, this document wins for M2; the reasons are in
[Departures from the parent spec](#8-departures-from-the-parent-spec).

## 1. Goal and scope

Goal: on the crawl, nobody misses a train, and when Metra's live feed says something has gone wrong,
everyone hears about it.

In scope
- A Metra GTFS-realtime poller for the **BNSF line only**, decoding trip updates, vehicle positions and
  service alerts, never exposing the API token.
- Live times merged onto the static timetable, with an honest fallback when the feed is stale or missing.
- A recorder that writes the raw feeds to disk, so M4 can replay a real Saturday.
- The **Departure Board**: a ticket-shaped banner on a new `/live` screen, with the Last Call and
  All Aboard thresholds.
- **Service alerts** as bubbles above the board, and a notifications screen reached from a new header menu.
- The Conductor can correct which stop the crawl is at.

Out of scope, deferred to their own milestones
- GPS, position sharing and the `positions` collection. Browsers cannot track location with the screen
  off, and a clock-derived position plus a Conductor override covers the crawl without it. See
  [Why not GPS](#3-where-the-crawl-is).
- Crew check-in buttons, the Crew Board roster, Bulletins, plan edits and the drink log (M3).
- The sim clock, the replayer and scripted GPS (M4).
- `GET /api/metra/positions` and the mini map: recorded in M2, served in M3 when something draws them.

## 2. The proxy

Module `web/src/lib/server/metra/`, alongside the existing static loader. One poller per server process,
started lazily on the first request that needs realtime (not at import time, so tests and the build never
open a socket).

### 2.1 Polling

- Every 30 s, fetch all three Metra realtime feeds —
  `https://gtfspublic.metrarr.com/gtfs/public/{positions,tripupdates,alerts}` — with
  `Authorization: Bearer <METRA_API_TOKEN>`; decode with `gtfs-realtime-bindings` (`FeedMessage.decode`).
  Metra updates these every 30 s and asks that nobody poll faster (REFERENCES, verified facts). The older
  `gtfsapi.metrarail.com` host and its key-and-secret Basic auth were shut off on 2025-11-01; any example
  found online using them is dead.
- Keep the latest decoded `FeedMessage` of each feed in memory with its `fetchedAt`. A fetch failure logs
  and keeps the previous feed; it never clears one.
- Filter to BNSF on read, not on store: the recorder writes whole feeds so a recording stays useful if the
  crawl ever moves lines.
- Predictions are also scoped to the **service date** the caller asked for, matched against the
  TripDescriptor's `start_date` (Metra sets it on every trip update). Trip ids repeat weekly, so without
  this a Saturday's live updates would be pinned onto the next Saturday's timetable and every train would
  read as long departed.
- protobufjs serves absent scalars from the prototype, so an omitted `end` on an alert's active period
  arrives as `Long(0)` and an omitted `effect` as the first enum value. Presence is checked with
  `hasOwnProperty` before any such field is interpreted, and `Alert.Effect` is read from the bindings'
  own enum, which runs 1..11.
- The token is read only through `serverEnv.metraToken` and never reaches a response body or the browser.

### 2.2 Merging live onto scheduled

`nextTrips` stays the pure schedule scan it is today. A new pure function wraps it:

```
mergeLive(trips, predictions, fromStopId, toStopId) -> NextTrip[]
```

- A `TripUpdate` whose `trip_id` matches overrides `schedDepart` / `schedArrive` with its predicted times,
  and sets `delayMin` as the signed difference in whole minutes.
- No `TripUpdate` for a trip means **on time** — Metra's documented semantics — so `liveDepart` equals
  `schedDepart` and `delayMin` is 0.
- A trip whose `schedule_relationship` is `CANCELED` is dropped from the list entirely, and the caller
  rolls to the next trip.
- `status` is `live` when the trip carried an update, `scheduled` otherwise.

**Order of operations.** The merge happens *before* any filtering or limiting, because both depend on the
effective departure rather than the scheduled one:

1. Draw candidates from `nextTrips` starting `DELAY_LOOKBACK_MIN` (60) **before** the caller's `after`,
   with a generous internal limit. A train scheduled for 20:31 and running ten minutes late has not left
   at 20:35; filtering on the scheduled time would drop it while it is still standing at the platform.
2. Merge predictions and drop cancellations.
3. Filter to trips whose **effective** departure is at or after `after`.
4. Sort by effective departure, then cut to the caller's `limit`.

Limiting first would also let three cancelled trips empty a board that has perfectly good service behind
them. The lookback is cheap: `nextTrips` is a scan over the line's trips and costs about a millisecond.

### 2.3 Staleness

Freshness is tracked **per feed**, not across the poller. Each feed keeps the `fetchedAt` of its own last
successful fetch, and one `mode` is computed from whichever feed the caller depends on:

| Condition | `mode` | What the UI does |
|---|---|---|
| That feed's `ageSec <= 120` | `live` | Shows merged times, no qualifier |
| That feed's `ageSec > 120` | `stale` | Shows timetable times with the "Timetable only" notice and the age |
| That feed never fetched, or no token configured | `schedule_only` | Same notice, wording omits the age |

`/api/metra/next` gates on the **tripupdates** feed alone. A shared timestamp advanced by any successful
fetch would let a healthy `positions` or `alerts` feed vouch for trip predictions that stopped arriving an
hour ago, and the board would keep counting down to times nobody is publishing any more — the precise
failure this section exists to prevent. `/api/metra/alerts` gates on the alerts feed the same way.

`/api/metra/status` reports the newest fetch across all feeds as `rtFetchedAt` / `rtAgeSec` for the
operator's benefit, plus a per-feed breakdown, and its top-level `mode` is the tripupdates mode so the
status page agrees with what the board is actually doing.

120 s is four missed polls. The threshold lives in one constant so the plan can tune it against the real
feed during the field test.

### 2.4 Endpoints

All require an authenticated user, as the existing ones do.

| Endpoint | Change |
|---|---|
| `GET /api/metra/next` | Already exists. Now fills `liveDepart`, `liveArrive`, `delayMin`, `status` from `mergeLive`, drops cancelled trips, filters and sorts on the effective departure per §2.2, and returns the tripupdates `mode`. |
| `GET /api/metra/status` | Already exists. Now fills `rtFetchedAt`, `rtAgeSec`, the per-feed breakdown, and the real `mode`. |
| `GET /api/metra/alerts` | New. Active BNSF alerts, shaped for the UI (below). |

`GET /api/metra/alerts` returns `{ mode, fetchedAt, alerts: Alert[] }` where

```ts
type Alert = {
  id: string;          // GTFS-RT entity id: stable across polls, so "seen" state sticks
  effect: string;      // NO_SERVICE | SIGNIFICANT_DELAYS | DETOUR | ...
  header: string;      // one line, from translated_string, English
  body: string;        // may be empty
  startsAt: string | null;
  endsAt: string | null;
  stationIds: string[]; // informed stops that are on our line, for "affects your stop"
};
```

An alert is included when it is active at `now` (any `active_period` covers it, or it has none) **and**
some `informed_entity` names route `BNSF`, one of the line's stop ids, or the agency as a whole. Selection
is a pure function over the decoded feed so it can be unit-tested against a fixture.

### 2.5 Recorder

`just record <name>` runs the same poller in a standalone Node script, writing each decoded feed's raw
bytes to `data/recordings/<name>/<epoch>.<feed>.pb` until interrupted. It writes a snapshot only when the
feed's `header.timestamp` changed, so an all-day recording does not store 2,880 identical positions files.
`data/recordings/` is git-ignored and is a Compose bind mount, like `data/gtfs/`.

The recorder is M2's deliverable; the replayer that reads these files is M4's.

## 3. Where the crawl is

The Departure Board needs one thing from the world: which stop the crawl is at. M2 derives it from the
clock and lets the Conductor correct it.

### 3.1 Why not GPS

`watchPosition` only delivers while the page is visible and foregrounded. Service workers cannot read
geolocation, and no mobile browser offers background geolocation. The Screen Wake Lock API keeps the
screen alive while the page is visible, but it releases when the phone is locked or another app comes
forward, and holding the screen on all day is a serious battery cost. True background tracking needs a
native app such as OwnTracks, which the parent spec already lists as a non-goal.

A GPS fix would also be the least debuggable input in the system: an urban multipath error parks the crawl
at the wrong bar with no way for anyone to see why. The clock is inspectable — it is the itinerary
everyone already approved.

### 3.2 Resolution

A pure function, unit-tested, with no clock or network of its own:

```
currentStop(stops, legs, now, override) -> { stop, source: 'override' | 'clock' | 'before' | 'after' }
```

1. If `override` is set, compare its `at` against the planned arrival of the stop the clock would pick.
   When the correction is the newer of the two, it wins; when it is older, it is a leftover from earlier in
   the day and the clock wins. So a correction holds until the schedule catches up with it, and a stale one
   can never drag the crawl backwards.
2. Otherwise walk the legs: the crawl is at the stop whose arrival is in the past and whose departure is
   in the future. Before the first arrival, `source` is `before`; after the last departure, `after`.
3. When several stops share a station, the train deadline belongs to the **last** stop at that station —
   the M1 layover model gives only that stop a departure drawn from the day's trains. The board counts
   down to that train from every stop at the station; the walk line names the stop you are actually in.
   `currentStop` therefore returns an `onwardStop` as well as `nextStop`: the next stop at a *different*
   station, which is where the train is going. Asking the timetable for a trip from a station to itself
   returns nothing, so using `nextStop` would read as "no train left today" for the whole layover.

### 3.3 The correction

The Conductor's "Not here? Set our stop" control writes a `checkins` record. This is deliberately the
record M3 generalises to the whole Crew, so the roster is built on data M2 already produces rather than an
M2-only field that has to be migrated away.

New collection:

| Collection | Fields | Rules |
|---|---|---|
| `checkins` | `user` rel, `stop` rel nullable, `kind` enum `at_stop`/`on_train`, `at` datetime | view U, create O |

M2 writes only `kind: at_stop` and only from the Conductor's control; the UI hides the control for
non-admins. The rule stays `create O` so M3 opens it to the Crew without a migration. The board reads the
newest `checkins` row belonging to an admin.

## 4. The Departure Board

A component on a new `/live` route, rendered when an itinerary is `locked`. It is not in the app layout in
M2; M3 pins it app-wide once check-ins give it a position on every screen.

### 4.1 State machine

Pure, unit-tested, `now` injected:

```
leaveAt   = liveDepart - walkMin - BUFFER_MIN(3)
departsIn = leaveAt - now
state     = departsIn > 10 min ? normal
          : departsIn > 0      ? warning     // UI: Last Call
          :                      leave_now   // UI: All Aboard
```

When `now > liveDepart` the train is missed: roll to the following trip from `/api/metra/next` and surface
a notice. The board re-polls `/api/metra/next` every 30 s and subscribes to PocketBase SSE on `stops`,
`legs` and `checkins` so a correction or a recompute lands immediately.

### 4.2 The ticket

Settled from the mockups (artboards 1 to 6 of the Departure Board canvas):

- A card on the dark app: ivory `#f2efe6` normally, full amber `#ffb400` at Last Call, full red `#c0261c`
  at All Aboard. The whole card changes colour, not a badge — it has to register without being read.
- Header row: `Metra BNSF` and the run number, monospace, uppercase.
- **The station name is the headline.** The venue is not: it appears only in the walk line.
- `Depart` / `Arrive` in two monospace columns with their station names.
- **No on-time or delay chip.** The times carry the delay silently. The single exception is the stale and
  `schedule_only` case, which shows a bordered notice inside the card reading "Timetable only — no live
  times since H:MM" — in that state the times are *not* known-correct, and saying so is the roadmap's
  schedule-fallback requirement.
- Below a dashed rule: the state line (`Leave in 42 min` / `Last Call` / `All Aboard`) and, under it,
  "N min walk from `<stop>`".
- The correction button is the last row, Conductor only.

### 4.3 Alerts in the UI

- Active alerts render as bubbles between the header and the ticket: at most two, then a "N more alerts"
  roll-up. They stay visible in the All Aboard state — suppressing a delay notice at the moment someone is
  running for a train is the wrong trade.
- Tapping a bubble or the roll-up opens `/notifications`, which lists **Service alerts** (from the proxy)
  and **Bulletins** (empty in M2; M3 fills it from `broadcasts`).
- Unread state is per-device: the set of alert ids the viewer has opened is kept in `localStorage`, read
  and written inside try/catch, and an unreadable store simply means everything reads as unread. Alert ids
  come from the GTFS-RT entity id, so they are stable across polls and server restarts. No collection is
  needed, and nothing about unread state needs to survive a new phone.

## 5. The header menu

The root layout's header loses the date — the phone already shows it — and gains a menu button on the
right with an amber dot when anything is unread. It opens a right-hand panel:

| Item | M2 |
|---|---|
| Notifications | Live. Routes to `/notifications`. |
| Drink scoreboard | Rendered disabled; M3. |
| The Route | Live. Routes to the locked itinerary. |
| Crew Board | Rendered disabled; M3. |
| Log out | Live. Moves the existing logout button into the menu. |

Disabled items are rendered rather than hidden so the shape of the finished app is visible, and so M3 only
has to enable them.

## 6. Configuration

| Variable | Meaning |
|---|---|
| `METRA_API_TOKEN` | Already in `.env.example`, unused until now. The bearer token for the realtime feeds; the file in `.secrets/` holds it and is git-ignored. Absent means `schedule_only` and no poller. |
| `METRA_RT_BASE` | Defaults to `https://gtfspublic.metrarr.com/gtfs/public`. Overridable so tests and M4's replayer can point elsewhere. |

## 7. Failure behaviour

| Failure | Behaviour |
|---|---|
| Realtime fetch fails | Keep the last feed, log once per failure, keep polling. `mode` becomes `stale` after 120 s. |
| One feed fails while the others succeed | Only that feed ages. Trip predictions are dropped once **tripupdates** is stale, however fresh `alerts` and `positions` are. |
| No token configured | No poller starts; every endpoint reports `schedule_only`; the board shows timetable times with the notice. |
| Static schedule unavailable | Unchanged from today: `/api/metra/next` and `/api/metra/status` return 503 with the existing message. |
| Feed decodes but has no trip updates | Every trip is on time, which is what Metra means. `mode` stays `live`. |
| Next train cancelled or already gone | Roll to the following trip and show a notice. |
| Next train delayed past its scheduled time | Still offered. Candidates come from a 60-minute lookback and are filtered on the effective departure, so a late train stays catchable. |
| No train works at all for the leg | The board says so and points at the itinerary, reusing M1's impossible-leg copy. |
| Itinerary not locked, or the date is not today | `/live` shows the "no active route" state rather than an empty board. |
| Alerts endpoint fails | Bubbles disappear; the board is unaffected. Alerts are never a hard dependency. |
| Alerts feed healthy while tripupdates rots | The board's "no live times since" shows the **trip-update** timestamp, not the newest fetch, so it names when train predictions actually stopped. |

## 8. Departures from the parent spec

1. **BNSF only** for alert and trip-update selection. The crawl was settled on BNSF in M1; all three feeds
   are still polled and recorded whole, so nothing is lost if that changes.
2. **No `positions` collection, no GPS, no location sharing in M2.** Replaced by clock plus Conductor
   correction. The parent spec's banner input "the user's latest check-in, else the admin's" becomes
   "the newest admin check-in, else the clock".
3. **`GET /api/metra/positions` is deferred** to whichever milestone draws the map.
4. **The banner lives on `/live`,** not in the app layout, until M3.
5. **The header menu and `/notifications` are new** — not in the parent spec at all, added because service
   alerts need somewhere to live that is not the banner.

## 9. Testing

- **Unit** (`web/tests/unit/`): `mergeLive` against a fixture feed (on time, delayed, cancelled, missing);
  a tripupdates feed that has been failing past 120 s while another feed keeps succeeding, proving its
  predictions are not used; a train delayed past its scheduled departure still appearing in `/api/metra/next`,
  and three cancelled trips not emptying a board that has later service;
  alert selection and the active-period window; `mode` thresholds around 120 s; `currentStop` for each
  `source`, including multiple stops at one station and an override that would move the crawl backwards;
  the board's state machine across the two thresholds and the missed-train roll.
- **Hooks** (`web/tests/hooks/`): `checkins` rules — a user may create their own and not another's, and
  everyone may read.
- **E2E** (`web/tests/e2e/`): `/live` at a fixed time with the proxy mocked, asserting each of the three
  states; the menu opens and Notifications routes; an alert bubble appears and opening it clears the dot.
- **Fixtures**: a small recorded `.pb` of each feed, captured with the recorder and committed, so the unit
  tests decode real Metra bytes rather than hand-built protobufs.
- **Manual**: point a dev server at the live feed and watch one real BNSF train through all three states.

## 10. Done when

- The poller runs against the real feed and `/api/metra/status` reports `live` with an age under 30 s.
- `/api/metra/next` shows a delay that matches what Metra's own app shows for the same train.
- Killing the token and restarting degrades to `schedule_only` with the notice, and nothing else breaks.
- `just record saturday` produces a folder of snapshots that grows only when the feed changes.
- `/live` shows the ticket in all three states against a mocked clock, and the Conductor's correction moves
  the crawl.
- Alerts from the live feed appear as bubbles and in `/notifications`.
