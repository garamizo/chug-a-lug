# Practice days: one database, the current route, and a Live screen that works every day

Status: design approved in conversation 2026-09-24. Branch `feat/practice-days`.

## Why

Rehearsal is a separate deployment today (`compose.rehearsal.yml`, `REHEARSAL=1` by default in
`scripts/up.sh`). It has its own PocketBase data (`data/rehearsal/pb_data`), its own cookie and a
simulated clock, and `just up` wipes it. That has three problems:

- While the rehearsal stack is running, all planning and voting goes into the practice database.
  The next `just up` deletes it, and it never reaches the real event.
- Rehearsal Bulletins and the departure banner interrupt people on planning and voting screens.
- Practice activity can only be separated from real activity by keeping two databases, and the only
  reset is deleting everything.

## Decisions (from the conversation)

1. **One deployment, one database.** `just up` runs the real stack only.
2. **The Conductor selects the current route.** Live, the home page and The Route show it. There is
   no practice/real switch.
3. **The day decides the mode.** On the current route's `event_date` (Chicago) it is the **event
   day**. On any other day it is a **practice day**.
4. **Practice days run in real time against the plan date's timetable.** Today's Chicago time of day
   is laid onto the route's `event_date`: 14:00 on a Tuesday shows where the crew would be at 14:00
   on the event day. Trains come from that date's published timetable. There is no realtime and no
   alerts.
5. **Everything people post carries real (wall) time.** Drinks, photos, chat, reactions, Bulletins and
   acks are stamped with when they actually happened, never with the projected plan time.
6. **Nothing is deleted.** Live shows only rows from today's Chicago date. Each day starts empty on
   its own, the event day shows only event-day activity, and past practices stay on the server.
7. **Practice interrupts only on Live.** On a practice day, the pinned Bulletin, the departure banner
   and the unread badge render only on `/live`. On the event day they behave as today.
8. **The canned route is built once.** A one-time script builds a realistic out-and-back route and
   saves it to the database as an ordinary locked route. There is no editing step.
9. **Shared rehearsal is removed.** The isolated developer simulation harness (`compose.sim.yml`,
   `web/scripts/sim.mjs`, `web/tests/sim`) stays as a test tool.

## Two clocks on the client: wall time and plan time

`liveDay` already separates event time (`now`) from wall time (`wallNow`). This design makes the
split explicit:

- **Wall time**: `clientClock.eventNow()`. It is real time in production and simulated time in the
  developer harness. It is used for:
  - every timestamp written (drink `at`)
  - "today" for activity filtering (`todayInTz(wall)`)
  - the leaderboard and Crew Board day
  - cache ages
- **Plan time**: wall time on the event day. On a practice day it is
  `projectToPlanDate(wall, event_date)`: the Chicago wall-clock time of `wall` (hours, minutes and
  seconds read through `Intl`, not elapsed minutes since midnight, which are an hour off on DST
  transition days) laid onto `event_date` with `localToUtc`.
  It is used only for:
  - `currentStop()`
  - the route strip state
  - the Departure Board countdown
  - the `after` of `/api/metra/next`

A new pure module `web/src/lib/live/planClock.ts` holds `isEventDay(route, wall)`,
`projectToPlanDate(wall, date)` and `planNow(route, wall)`. `liveDay.now` becomes plan time, and a new
`liveDay.today` (the Chicago date of wall time) replaces every `todayInTz(liveDay.now)` that is really
asking about activity. Each call site is classified in the plan. The trap in `CLAUDE.md` ("Unknown
offline Railroad Time is not today's date") still applies to wall time.

Anchors:
- Conductor corrections are used only on the event day. `activeAnchor` and the live view's
  Chicago-date gate stay as they are.
- On a practice day, `currentStop()` gets no override, and a practice-day Save cannot re-plan legs.
  This is existing behaviour for off-day anchors.
- Save in the locked-route editor still edits the route itself on any day. It is the planner, not
  practice activity.

## Current route

- **New collection `crawl_settings`**: a singleton with id `crawlsettings` and one field,
  `current_itinerary` (relation to `itineraries`, optional, no cascade).
  - List/view rule: signed-in users. Create/update: `@request.auth.is_admin = true`. Delete: nobody.
  - A migration creates the empty row.
- **Resolving the current route** (`web/src/lib/live/route.ts`, shared by `liveDay.loadRoute`,
  `(app)/+page.svelte` and The Route):
  1. use `crawl_settings.current_itinerary` if it points at a locked route
  2. otherwise use the most recently locked route (today's behaviour)
  3. otherwise there is no route
- **"Make current"**: a Conductor-only button on a locked route's page in the planner. It shows
  "Current route" when it is already selected. A realtime subscription on `crawl_settings` makes every
  client reload the route.
- **Server:** everything that assumes "the live route" uses the same resolver.
  - The media hook (`pocketbase/pb_hooks/live.pb.js:7-30`) tags a photo to a stop only when that
    stop belongs to the current route. Today it accepts a stop on any locked route. The hook reads
    `crawl_settings` and falls back to the newest locked route.
- The lock hook's archiving of same-date locked routes is unchanged. The canned route's date is
  chosen so that it does not collide with the real route.

## Practice days on the Live screen

- Live shows the current route whenever there is one, not only when `event_date` is today:
  - `isToday` splits into `hasRoute` and `isEventDay`
  - `/live`'s "no active route" branch triggers only when there is no route
  - the home page's Live link shows whenever there is a route
- The tab bar and the event-day auto-landing on Live stay **event-day only**. On practice days, Live
  is reached from the home page, so planning screens stay free of Live controls.
- **Trains:** `loadTrains` sends `date=event_date&after=<plan time>&practice=1`.
  - `/api/metra/next` with `practice=1` returns timetable departures only, with mode
    `schedule_only`. It never applies realtime predictions, which would belong to a different date
    anyway.
  - `loadAlerts` is skipped on practice days, so the alert list is empty.
- **Badge:** a small "Practice" badge (label in `labels.ts`, README glossary updated) appears in the
  Live header on practice days.
- If the timetable does not cover `event_date`, the board shows its existing "no trains" state.

## Activity by date

Every live-day read is limited to the current route **and** today's Chicago date, using wall time:

| Data | Filter (added) |
|---|---|
| `drink_entries` (Tab, leaderboard, milestones, Crew Board) | `stop.itinerary = route && at in [dayStart, dayEnd)` |
| `media` (Freight, chat photos) | `stop.itinerary = route && at in day` |
| `chat_messages`, `reactions` | `itinerary = route && created in day` (`at` for messages) |
| `broadcasts` (pinned Bulletin, notifications list) | `itinerary = route && at in day` |
| `broadcast_acks` | acks for the day's broadcasts only |
| Crew Board (`crew/+page.svelte:30-33`) | today's drinks and acks on the current route, instead of all of them |

- `dayStart`/`dayEnd` are the UTC bounds of today's Chicago date (`localToUtc(today, 0)` to
  `localToUtc(tomorrow, 0)`), computed from wall time.
- A new `dayBounds(date)` helper goes in `$lib/time.ts`.
- Activity on screen belongs to a *scope*: route id plus Chicago day. When either changes (midnight,
  or "Make current"), `liveDay` **clears** the feed, Bulletins and trains at once and then reloads them.
  A failed reload leaves the screen empty, never showing yesterday's or the old route's rows, and an
  answer to a read from an earlier scope is dropped. The check runs on every tick.
- "Today" is the server's day: `/api/day` returns the server's clock, and the client keeps the offset.
  It keeps counting the server's day on its own clock between polls and while offline. Before the
  server has ever answered, it uses the phone's date.
- The IndexedDB mirror and the `seenAlerts` key stay as they are. The mirror holds the route, not the
  activity.
- Server-stamped `at` fields (`live.pb.js`) already use `clock.js` `eventNow`, which is wall time in
  production. Drinks are stamped by a create hook with `clock.js` `eventNow`, like chat, photos and
  Bulletins. `today` comes from `GET /api/day`, the server's Chicago date.

## Interruptions on practice days

`practice = hasRoute && !isEventDay`. When `practice` is true and the path is not `/live`:

- `(app)/+layout.svelte` does not render `PinnedBulletin` or the departure banner.
- `routes/+layout.svelte` leaves Bulletins out of the header dot and the `AppMenu` unread count.
  Alerts are empty on practice days anyway.

Notifications (`/notifications`) still list the day's Bulletins, so nothing is hidden for good.

## The canned route

- `web/scripts/practice-route.mjs` (run with `just practice-route`) runs once against the real stack.
  - It authenticates as superuser with `.env`.
  - It refuses to run if a route with the canned title already exists.
- **Stations and venues (BNSF):**
  - **Out, toward Chicago:** a bar at Aurora; a bar at Naperville; a **lunch** restaurant at Lisle or
    Downers Grove (highest-rated `restaurant` with at least 200 ratings, open at noon); a bar at
    Downers Grove Main St; a bar at LaGrange Road.
  - **Back, toward Aurora:** a bar at Hinsdale; a bar at Westmont; a **deep-dish dinner** (a Places
    text search for "deep dish pizza" near each outbound station, taking the best-rated result within
    walking distance, expected to be Lou Malnati's or Giordano's in Naperville); a last bar at
    Route 59.
  - Bars are chosen as the rehearsal script chooses them today (`scripts/rehearsal-venues.mjs`, moved
    and reused): nearest operational bar/pub/brewery with at least 20 ratings, never the same venue
    twice.
- **Route details:**
  - `event_date` is the next Saturday that is not the real route's date, and whose timetable the
    stack has.
  - `start_time` is 11:00.
  - Dwell times: 30 min for a bar, 60 min for lunch, 75 min for dinner.
- **How it is created:** through the normal path, so the hooks run:
  1. create the itinerary (the hook forces it to draft)
  2. create the stops, and attach places and photos
  3. wait for the recompute to produce legs (it runs on drafts)
  4. check that every leg is `train` or `walk`
  5. only then lock the route by update
  6. set `crawl_settings.current_itinerary` if it is empty
- If a leg is impossible or the planner times out, the script fails loudly and leaves the **draft**
  for inspection. Nobody sees a draft on Live.
- A re-run replaces its own leftover draft, reusing the cached Places answers. It refuses only when a
  locked canned route already exists.
- The Places responses and photos are cached under `data/practice-route/`, so a failed run can be
  repeated without spending the budget again.

## Removing shared rehearsal

**Deleted:**
- `compose.rehearsal.yml`
- the `REHEARSAL` switch in `scripts/up.sh` (`just up` is the real stack)
- `web/scripts/prepare-rehearsal.mjs` and `web/scripts/shared-rehearsal.mjs`
- `web/src/lib/server/sim/shared.ts` and its tests
- rehearsal-only labels (`rehearsalIntro`, `rehearsalLive*`, `rehearsalBulletins`, …) where nothing
  else uses them
- the login page's rehearsal notice

**Kept:**
- the simulation clock, `/sim`, `compose.sim.yml`, `seed.ts`, `setup.ts` and every `PUBLIC_SIM`
  branch. They serve the isolated harness and its tests.

**Changed:**
- `README.md` and `CLAUDE.md` deployment notes: `REHEARSAL=0` and the practice-data trap go away,
  replaced by "practice days and the date filter".
- `data/rehearsal/` is left on disk for the user to delete. No script removes it.

## Testing

Tests come first, as usual:

- **Unit:**
  - `planClock` (event day vs practice day, projection across DST and midnight)
  - `dayBounds`
  - the route resolver (setting, fallback, stale setting pointing at an archived route)
  - `liveDay` day filtering and the midnight rollover
  - `/api/metra/next` with `practice=1` ignoring predictions
- **Hooks** (`scripts/test-hooks.sh`):
  - `crawl_settings` rules (crew cannot write; unauthorised list is empty)
  - the media hook tags only to current-route stops
- **e2e:**
  - Conductor makes a route current, and a second browser's Live follows it
  - on a practice day, Live shows the route at plan time with timetable trains and the Practice badge
  - yesterday's drink/chat/photo rows do not appear today
  - on a practice day, a Bulletin pins on Live but not on the plan or vote screens
  - on the event day, the Bulletin pins everywhere as before
- **The canned-route script:**
  - unit-tested with Places stubbed (venue choice rules, dwell times, refusal to run twice)
  - run once for real after merge

## Risks

- **The timetable may not cover a far-future `event_date`.** Metra's GTFS covers its current service
  period. Practice for a December route will then show no trains until Metra publishes that period.
  The board's existing empty state covers it. This is not solved here.
- **A Save during practice edits the real route.** This is intended: it is the same route. The
  Conductor should practise on the canned route when they do not want that.
