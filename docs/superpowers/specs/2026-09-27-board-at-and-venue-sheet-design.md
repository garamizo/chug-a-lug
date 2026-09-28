# Board at, and venue sheets while planning

Date: 2026-09-27. Branch: `feat/stop-sheet`.

## Why

1. A route's **Start** is the arrival at stop 1. The Builder of "Example Route" meant "we meet at
   Aurora at 11:00", added Lotus Banh Mi in Naperville, and the card said "Arrive 11:00 AM": the ride
   in was never counted, because a route has no idea where the crew boards.
2. On **Add Stop**, a venue is a line of text. The Builder wants to see a bar's pictures before adding
   it, and to add from that view.
3. On the **edit screen**, tapping a stop opens the stop's detail page, whose back button returns to
   the read-only draft page instead of the editor.

Success: a route with a start station shows stop 1's arrival after the first train; the Live ticket
before the crawl counts down to that boarding train; tapping a venue on Add Stop shows its photos and
an Add button; tapping a stop in the editor opens a sheet whose close leaves the editor as it was.

Out of scope: changing Start or Board at on a locked route (the staged Route editor already has no
Start control; Board at follows it), a starting point off the planner line, and the stale-PWA cache
issue seen on 2026-09-27.

## 1. Board at

### Data

- Migration: `itineraries.start_station` (text, optional, max 32) and `start_station_name` (text,
  optional, max 80), written together, as stops carry `station_id` and `station_name`, so Live can
  name the station without loading the schedule. Empty means today's behaviour: Start is the arrival
  at stop 1.
- Migration: `legs.from_stop` becomes optional (still a relation, still cascade-delete). A leg with an
  empty `from_stop` is the route's **opening leg**: from `start_station` to stop 1.
- `pb_hooks/planning.pb.js`: `start_station` joins `title/event_date/start_time` in the non-admin
  "no longer a draft" guard, and in `scheduleChanged`, so changing it recomputes the legs.
- `Itinerary` type gains `start_station: string`; `Leg.from_stop` stays `string` (empty for the
  opening leg).

### Planner

The one planner (`$lib/metra/plan.ts` `recomputeLegs`, through `$lib/metra/compute.ts` and
`$lib/server/plan.ts` `computeLegs`) takes an optional `startStation`:

- With `startStation` and at least one stop, it first plans
  `planLeg(s, startStation, stop1.station_id, startMin, date)` and emits an opening
  `ComputedLeg` with `fromStopId: ''`, `toStopId: stop1.id`, `readyMin = startMin`, the plan's
  `departMin`, and `arriveMin = (impossible ? startMin : plan.arriveMin) + stop1.walk_min`.
  Stop 1's arrival is that `arriveMin`; the rest chains exactly as today.
- Same station: `planLeg` already returns a 0-minute walk, so stop 1's arrival is Start plus its walk.
- Without `startStation` nothing changes: no opening leg, stop 1 arrives at `startMin`.
- The anchor still overrides: if the anchor is on stop 1 (or later), the anchored arrival wins, and the
  opening leg is history like any leg before the anchor.

`recompute.ts`, `/api/plan/preview` and `/api/plan/commit` pass `it.start_station`. Recompute writes
the opening leg with `from_stop: ''`. The preview response carries it like any other leg.

### Readers of legs

Every reader that keys by `from_stop` must tolerate the opening leg:

- `ItineraryView.svelte`: `arriveAt(0)` is the opening leg's `arrive_at` when present, else Start.
  The opening leg renders above stop 1 with the existing `LegRow` (e.g. "BNSF departs 11:12 Aurora →
  arrives 11:31 Naperville"), under a "Board at {station} · {Start}" line.
- `$lib/live/current.ts` `timings`: stop 1 arrives at the opening leg's `arrive_at` when present.
  `outgoing` must ignore the empty key.
- `$lib/live/board.ts` `plannedTrain`: the opening leg sorts first (order −1).
- Live before the crawl gets a **boarding journey**. New `LiveDay.boarding` getter: when
  `here.source === 'before'`, the route has a `start_station` different from stop 1's station, and the
  opening leg is a train, it is `{ from: start_station, fromName: start_station_name,
  to: stop1.station_id, toName: stop1.station_name, walkMin: 0, planned: first train segment of the
  opening leg }`; otherwise null. Everything that today reads `here.stop` / `here.onwardStop` /
  `here.stop.walk_min` for the countdown reads `boarding` first when it is set:
  - `loadTrains()` fetches `boarding.from → boarding.to` (after max(now, planned dep − 60 s)) instead of
    returning early for a single-stop route or asking for the onward journey;
  - `plannedTrip` is `boarding.planned`;
  - the Live page's and the Home banner's `DepartureBoard` show `fromName` as the station, `toName` as
    the next station, the stop's name as the destination venue, and `walkMin = 0` (the crew meets at
    the platform).
  Once `here.source` leaves `before` (Start passes, or an anchor exists), Live behaves exactly as
  today.
- `$lib/live/cohesion.ts` (`impossibleFromAnchor`, `cohesionBlockers`), the edit page's `departAt`
  and `planDiff`: the opening leg is included. An impossible opening leg blocks Save like any other
  impossible leg ahead of the anchor, and counts as history once an anchor exists.
- `$lib/live/preview.ts`: maps `fromStopId: ''` to `from_stop: ''`.

### UI

- Draft editor header (where Start is editable, i.e. `actions.setStartTime` exists): a **Board at**
  select of the planner line's stations for the event date (`/api/metra/stations`, `plannerStations`),
  stations with no trains that day disabled, plus an empty option "Pick where the crew boards".
  `PlanActions.setStartStation(id)` → `recordActions` writes `start_station`; the hook recomputes.
- Read-only views show "Board at {station}" when set.
- Labels in `labels.ts`: `boardAt`, `boardAtPick`, and the README glossary gets **Board at**.

## 2. Venue sheet on Add Stop

- New `VenueSheet.svelte`: a `<dialog>` sheet styled like `StopSheet` (grab bar, header, gallery,
  hours, footer). Shows name, kind, rating, address, walk minutes from the station, the event
  weekday's hours (`hoursFor`), photos, and **Add stop** (primary) and **Close** buttons. Escape,
  the scrim and Close all close it. Driven by `?venue=` shallow routing through `$lib/nav`
  (`openVenue`/`closeVenue`), so the back gesture closes it.
- Add Stop: tapping a Google or OSM venue row opens the sheet instead of adding. The sheet's Add
  calls the page's existing `add(venue)`. The typed-in custom venue still adds directly.
- Photos: new `POST /api/places/photos { placeRef }` (signed-in user). It reuses the fetch-once
  details-and-photos step from `attach.ts`, refactored into `ensurePlaceMedia(pb, placeRef)` that both
  `attachStop` and the new endpoint call, under the same per-ref lock and the same budget counters
  (details 800, photos 800 a month). It returns the photo URLs (and `status`). A venue already
  fetched costs nothing; a budget stop returns no photos and the sheet shows none. A venue without a
  `placeRef` (not yet stored) shows no photos.
- Adding a venue whose photos were fetched here reuses them: `attachStop` finds the place already
  done.

## 3. Stop sheet on the edit screen

- The edit page passes `onopenstop` to `ItineraryView`, which opens the existing `StopSheet` over the
  editor (`openStop`), without an Add button. Close returns to the editor via `closeStop` (history
  back for a pushed sheet), leaving staged edits untouched.
- `StopSheet` accepts the stops the editor has (staged stops may lack `expand.place`): it takes an
  optional `photos` map (stop id → URLs) from the editor, as `ItineraryView` already receives.
- **Edit details** (the link to the stop detail page) appears in the editor's sheet only on the draft
  path, whose edits are already written as they are made. On the staged Route editor it is hidden:
  `plan` and `before` are component state, so leaving the page would discard staged changes.
- The stop detail page's back button goes to `history.back()` when the app navigated there, else to
  the draft page, so a draft reaching it from the editor's sheet and backing out lands in the editor
  (which reloads from the database, where those edits already are).

## Error handling

- No trains from the start station after Start: the opening leg is `impossible`; the card shows the
  existing "no train" reason and Save is blocked as for any impossible leg.
- `/api/places/photos` failures (Google error, budget) answer 200 with `photos: []` and a status; the
  sheet never shows an error for missing photos.

## Testing

- Unit (`plan.test.ts`): opening leg by train, same station (walk 0), no train (impossible, stop 1 at
  Start + walk), no start station (unchanged), anchor on stop 1 overrides.
- Unit: `plannedTrain` prefers the opening leg; `timings` uses its arrival; cohesion counts it.
- Hooks: a leg with empty `from_stop` saves; changing `start_station` on a draft recomputes and
  writes the opening leg; a non-admin cannot change it on a locked route.
- Unit: `/api/places/photos` fetches once and a second call makes no Google request.
- Unit (`day` / board helpers): `boarding` is set only before the crawl with a train opening leg; a
  single-stop route fetches `start_station → stop 1` trains; a route whose onward journey differs
  still counts down to the opening train; walk allowance 0.
- e2e: Board at Aurora moves stop 1's arrival past the first train; before the crawl the Live ticket
  names Aurora and the opening train; the Route editor's sheet has no Edit details, and a staged
  change survives opening and closing the sheet; Add Stop tap opens the venue
  sheet, Add adds it; edit screen stop tap opens the sheet and Close leaves the URL on `/edit`.
