# Features

How the app behaves today, phase by phase. Names in **bold** are UI labels from the
[UI glossary](../README.md#ui-glossary). What is still to build is in [ROADMAP.md](ROADMAP.md); how to
run, record and rehearse is in [OPERATIONS.md](OPERATIONS.md).

## Planning (Route Planner)

Goal: by early December, one locked itinerary that everyone has seen and voted on.

- The BNSF line drawn top to bottom, Aurora at the top and Union Station at
  the bottom. Tap a station to see the best rated bars and restaurants within half a mile of it (Google Places
  Nearby Search, two calls per station — bars, restaurants — cached until a refresh; OpenStreetMap,
  nearest first, when no key is set). A venue near two stations is on both lists, measured from each.
- The draft is laid out on that line unfolded: every station top to bottom toward Chicago
  (**Aurora → Chicago**), a **Turn around** divider, then every station again bottom to top on the way
  back (**Chicago → Aurora**). Each stop sits right of the line in its station's row of the half it is
  reached in, with its train leg underneath. Tap a station's circle to add
  a stop there: the half you tap in is the stop's direction (going or return), and the crawl
  is always the going stops top to bottom, then the return stops bottom to top, so a new stop slots in
  by station rather than at the end. Stations no train stops at on the crawl date (Metra skips Congress
  Park, Highlands, LaVergne, Stone Ave and West Hinsdale on weekends) are greyed out with no circle to
  tap, and a leg that still touches one says which station has no trains that day instead of blaming
  the layover. The last stop at a station picks its departure from that day's trains toward the next
  stop; earlier stops at the same station pick a plain layover and can swap places with the small arrows.
  A draft has two screens: the view (`/plan/<id>`) with the read-only route, cheers, comments and the
  Highball, and the edit screen (`/plan/<id>/edit`) with the controls. Tapping a stop opens its details
  in a sheet over the editor; Edit details from there leaves for the full stop page, and both the sheet
  and that page return to the editor.
- **Run home.** Every route boards at a station (Aurora by default, never empty) and the planner closes
  the day with a last leg, "Run home to Aurora", from the final stop. Finish is that train's arrival; if
  no train gets home before midnight the leg is flagged and Save names it.
- Build an itinerary draft: ordered stops, each tied to a station and a planned dwell time. The app fills
  in train legs and walks from the Saturday Metra schedule, so the draft shows real train times and flags
  any leg that doesn't work.
- Venue card: name, address, hours, rating, walk time from station, up to 5 photos, link to Google Maps,
  notes. Venues live in a `places` table: the station lookup stores the basics, the first stop that
  points at a venue adds Google details and photos, and every later stop in any draft reuses the same
  record (see Decisions, item 3).
- **"Confirmed open on event day" checkbox with phone number.** Dec 26 is a normal Saturday for most
  bars, but the week after Christmas still catches some closures.
- Like / dislike and comments on each draft and each stop.
- Approval vote run by the admin; on a pass, the draft becomes the locked itinerary.

### Route rules

A draft can be changed or deleted only by its builder or the Conductor; once locked, only the Conductor
can change or delete it.

Cloning copies any route, yours or not and in any status, into a new draft of your own — stops
included, a note left on both routes — in one transaction; nothing about the source is touched.

A route name is 1–80 characters after trimming, stored trimmed, and must be unique across every route
regardless of status, compared case-insensitively with runs of spaces collapsed; keeping a route's own
name (even re-cased) is never a clash.

## Live

Goal: nobody misses a train, nobody is lost, and the plan can change without chaos.

- **The crawl ends when the train home arrives.** After the last stop the board counts down to the run
  home, then shows the crew riding it, and goes quiet on arrival.
- **Departure Board** is read-only: the full board on Live and a compact banner on every other
  signed-in screen on the event day. It shows the current stop, next train (scheduled and live ETA),
  walk time to the platform and countdown, with Last Call and All Aboard warnings. On Live it is cut
  like the Home Ticket (notches, tear line, raised edge): gold, deep orange at Last Call, red at All
  Aboard. Before the crawl starts it counts down to the train the plan starts on, not merely the next
  one, falling back to the next train once the planned one has left. Service alerts sit above it as
  bubbles; each one closes with its X, remembered on that phone until Metra issues a new alert.
- Next-train logic works from the static schedule when the live feed is missing or stale, and says so.
- **Where the crawl is** comes from the clock over the locked itinerary. The Conductor corrects it in
  the route editor; the same save adjusts the remaining plan. The anchor is the newest admin
  `checkins` row, and only steers the planner on the event's own day (Chicago time). Before that, edits
  plan from the route's start time. No per-person check-in, GPS tracking, positions collection or
  straggler alert: ten people who can see each other do not need an app to say where they are.
- **Plan edits** by the Conductor on The Route are staged until one Save through `POST /api/plan/commit`:
  move, extend, remove or add stops and set the crawl's position. Preview and save use the same planner;
  Save requires a position and rideable legs from there onward. Legs behind the crew are history and
  may look broken. The endpoint checks for changes to the persisted stop set before validating the
  route and returns 409, "The Route changed", on a conflict. Editor-generated stop and Bulletin ids
  let the same payload be retried after a partial save without duplicating a bar or Bulletin. This is
  a sequence of writes, not a database transaction; a retry can add another anchor and event-log row.
  The staged plan and its original snapshot are parked in sessionStorage only for the venue-picker
  round trip, consumed on return, ignored after an hour and cleared on a successful save.
- **Bulletins** are drafted from the route diff for the Conductor to send, edit or skip at Save; the
  Conductor can also compose a message. The newest unacknowledged Bulletin is pinned across screens
  until that person taps "Got it". Plan edits and posted Bulletins go into the event log.
- **Crew Board** shows shot / cocktail / beer / non-alcoholic / food counts and who acknowledged the latest
  Bulletin. Ranking uses shot + cocktail + beer, then non-alcoholic drinks, then food. It does not track individual locations.
- **Live** reads top to bottom: the route strip (punched stops, 🚂 where the crew is, tap any stop), the
  Departure Board, the current stop (tap for its sheet: hours, walking directions, call, photos), the
  Bulletin, the leaderboard line and the crew chat, whose chat box also sends photos and videos at any
  time. On the event day a tab bar (Live · The Route · Crew Board · Tab) replaces the back links; the
  menu stays in the header. Opening the app lands on Live, but the logo still reaches Home. On a
  practice day Live shows the tab bar too, under the Practice strip. Stop sheets and the photo viewer close with the back
  gesture and never leave the screen underneath.
- **Crew chat** merges Tab activity, Bulletins, Freight, computed milestones (crew totals, the first photo at
  each stop), Golden Spikes and messages anyone can post (280 characters, own delete).
  Everyone can Cheers any entry once. Only Conductor Bulletins are pinned.
- **Golden Spikes** are worked out from the night's Tab, messages and photos, never stored: Pathfinder (first of each
  Tab kind), Big Boy (most drinks, from 3), Caboose (fewest, at Closing Time), Triple Header, Full Consist, Whistle Stop
  (most messages, from 5) and Railfan (most photos, from 3). They post to Crew chat, the winner sees a card once, and the
  Crew Board shows a laurel and count by each name.
- **Closing Time** starts when the train home arrives. Live then shows a card that plays the night's highlight
  reel. The reel opens by itself once on each phone, as soon as the whole night's feed has loaded, and never over
  an open sheet, photo, Tab or Bulletin. It plays full screen like a story: the route's title, then each stop with
  its most-Cheered photos (up to two), its most-Cheered message, the Golden Spikes won there and its drinks, then a
  finale with the crew's total, the spikes held at the end and the Caboose. Tap right or left to skip, hold to
  pause; ✕, Done or Back return to Live. Cheers are stamped by the server's clock, so a rehearsal counts them too.
- **The Tab** is a one-tap row of shot / cocktail / beer / non-alcoholic / food buttons in a sheet
  opened from the tab bar (from any screen it goes to Live first; X, a tap outside or Escape closes
  it, and it stays open between taps), with personal counters per drink and a running total for the day. A tap opens
  the camera; the drink counts once its photo lands (the photo is Freight, filed at the stop where
  the button was tapped, and shows once in Crew chat). While the photo sends the button says
  "Sending…"; a failed send offers Retry while the page stays open (a retry after a lost response
  never counts twice). A video is refused. Drinks logged before photos were required keep counting.
  A failed send the server refused (no stop, no usable image) shows its message and offers no Retry; a
  Retry goes away once the drink shows up, and its close button discards the kept photos.
  A toast with Undo confirms the drink (Undo removes its photo too, and the Conductor deleting a
  drink's photo removes the drink), and it stays up (with a retry
  if the delete fails) until it fades or another tap replaces it — after which "Undo my last one here"
  still undoes your newest entry at the stop. The Tab and Freight are available only while the position
  source is `clock` or `override`; a stop still appears before and after the crawl, but the Tab
  stays closed (buttons disabled, no toast).
- **Freight** uploads photos and videos from the chat box at any time (a Tab drink's photo is also Freight). Every upload is filed under the
  current route; while a stop is open it is also tagged with the stop the uploader's shared board
  shows. The server checks that the stop belongs to the current route; an invalid tag is cleared
  without losing the upload. Images are compressed in the browser (the original is used if compression fails), videos
  pass through, and each selected file must be at most 90 MB. Unsupported file types are refused with
  a specific message; one failed file does not stop the rest of the batch.
- **Offline reading**: the app shell is precached and the locked itinerary, stops and legs are mirrored
  into IndexedDB. Live shows the saved copy and its age when PocketBase is unreachable. Open the app
  online first to populate it. Writes are deliberately not queued; failed actions must be retried online.

## Simulation

Sim mode has to exist before the live phase is considered done, because the real event happens once a year.

- **Sim clock**: the server publishes `{epochStart, rate, wallStart}`; every client and the Metra proxy
  derive the same virtual "now". In real-event mode it is the wall clock.
- **Recorded train feed**: a recorder polls Metra's positions, trip updates, and alerts every 30 s into
  timestamped protobuf snapshots. The proxy replays the snapshot nearest the sim clock.
  Record on a **Saturday in December**, since Dec 26 runs the Saturday timetable.
- **Shared position**: rehearse the same clock-derived stop and Conductor anchor as the live day. No GPS, waypoint player or per-person tracking.
- **Schedule-only fallback**: use scheduled departures when no recording exists; do not invent vehicle positions.
- **Isolation**: practice happens on the one real database (see "Practice days" below), not a
  separate deployment. Only the isolated developer harness (`compose.sim.yml`) has its own database
  and auth cookie, at its own origin. Replay uses the recording's original service date and archived
  GTFS; operational timeouts and cache ages remain on wall time.

### Practice days

Live runs every day; there is no separate rehearsal deployment or `REHEARSAL` switch. On the
current route's `event_date` it is the event day; any other day is a practice day, and Live shows
the route at today's Chicago time against that date's timetable (no realtime, no alerts), with a
small **Practice** badge. Nothing is deleted: drinks, chat, photos and Bulletins are all
server-stamped and visible only on the day they were posted, so practice activity never lands on
the event day.

The Conductor makes any locked route current from its page in the planner with **Make current**.

### Shakedown Run

The isolated developer simulation harness (`compose.sim.yml`, `/sim`) is a separate test tool: its
own database, auth cookie and Compose project at their own origin and ports, independent of the
real stack. See [operations](OPERATIONS.md#shakedown-run-m4) for recovery and recording details.

The Metra endpoints use Railroad Time and return `source` (`live`, `recording`, `timetable`), `revision`,
and safe diagnostics alongside the existing modes/timestamps. A fresh recording still has
`mode: live`; `source: recording` identifies its origin. Missing or incompatible simulation data
returns 503 and never falls back to the live network. Server preview, commit and recompute use captured Railroad Time. Simulation commits require the
preview’s `clockRevision`; clock controls return 409 while a commit or recompute publishes changes.
Bulletins and event logs use event time, while storage metadata keeps wall time. Server-issued action
orders keep anchors and Tab Undo deterministic while paused. Browsers synchronize every five wall
seconds, use a monotonic clock between samples, and refresh replay departures/alerts every wall
second. A revision change refreshes the route and editor preview; Save carries that preview’s revision.

Offline clients retain their last mapping but require resynchronization before writes. A fresh offline
boot can show its saved route without inventing Railroad Time. Route mirrors are scoped to the run;
mirror age, authentication and file capture dates stay on wall time. Clock/feed responses are not
cached by the service worker. Forward seeks never rewind history; at the playback window end the
clock stops. Restarting resumes the persisted mapping, including wall downtime if it was running.

Run `cd web && npm run test:sim` for the isolated browser rehearsal and
`npm run test:sim:offline` for the production-build service-worker check, sequentially after ordinary
e2e and hook tests. The [operations guide](OPERATIONS.md#shakedown-run-m4) covers phone origins;
use the [rehearsal template](rehearsals/m4-template.md) to record physical-device acceptance.

The launcher discards inherited production settings and uses its own Compose project and network.
External tokens are empty, the timetable is pinned locally, and the venue lookup URL is disabled.
Stop this rehearsal before running the repository's test suites.

To change ports or expose a run for phone checks, copy `.env.sim.example` to `.env.sim` and set its
five allowlisted settings before the first start. LAN access requires an explicit bind address and
both reachable origins. LAN HTTP supports functional checks; phone PWA/offline checks require
separate HTTPS origins and an independently configured reverse proxy. The launcher supplies no
production tunnel configuration.

Recording and indexing real train feeds is covered in
[OPERATIONS → Recording and indexing train feeds](OPERATIONS.md#recording-and-indexing-train-feeds).

## Decisions

Numbered to match the earlier review; each is reversible.

1. **Bars near a station come from Google Places Nearby Search, ranked by rating.** Two calls per station,
   bars and restaurants, each its 20 most popular with rating and hours (52 for the 26 BNSF stations;
   `just places-warm` fetches them all, through the monthly counter); the venues go into the `places` table and a `place_lookups` row marks the
   station as searched, so the database answers every later request. The key never reaches the browser.
   OpenStreetMap remains the fallback without a key; it has no ratings, so that list is nearest first.
   Both are cut at half a mile (805 m).
2. **Metra key verified on Sept 19, 2026.** All three realtime endpoints return protobuf that decodes; the
   static schedule needs no key. The file in `.secrets/` is git-ignored.
3. **Venue-card photos come from Google Places, fetched once per venue and stored on the venue's record.**
   Flow: a user picks a bar; the server calls Place Details (name, address, hours, rating, photo
   references) and then Place Photos for up to 5 images, stores them as files on the `places` record with
   Google attribution, and never calls Google for that venue again, whichever draft or stop asks.
   Everyone sees the same five photos. Budget: about 30 stops
   means 30 detail calls and 150 photo calls, inside the 1,000 free calls a month for each. The key lives
   only on the home box with a monthly cap set in the Google console. Accepted caveat: Google's terms say
   Places photos may not be cached; the realistic downside for a private app is a disabled key.
4. **The clock and one Conductor anchor locate the crawl.** M3 deliberately cut per-person check-ins,
   location sharing and straggler alerts. Corrections belong in the staged route editor, where the
   remaining train legs can be fixed at the same time. The Departure Board is read-only.
5. **Media is tagged from the shared crawl clock.** The uploader's board supplies the stop; the server
   accepts it only if it belongs to a locked route, otherwise keeps the file untagged. No GPS or EXIF
   location lookup. Admin retagging is permitted by the collection rules; the album UI belongs to M5.
6. **Getting in takes the Conductor's join link, and accounts are keyed by email.** The Conductor shares one
   join link with limited seats and an end date; sign-in is email and password, with password reset by email.
   There is no shared password and no SMS. Trade-off: a forwarded link admits strangers up to its seats until
   it expires or is revoked, and only the Conductor can put someone off (and let them back on). That fits ten relatives who know each other and removes Twilio, SMS
   costs and PIN resets entirely.
7. **Domain is chugalug.app.** HTTPS is mandatory on `.app`; Cloudflare Tunnel handles that from home.
8. **Home server trade-offs.** Simpler and free, but the event depends on your power and internet.
   Mitigations: a UPS, the same Compose file restorable on a $5 VPS from the nightly backup in about
   15 minutes, and the itinerary cached offline on every phone.
9. **Dec 26 timetable facts** (from the feed as of Sept 18): UP-W 10 trips each way, mostly every 2 h,
   last outbound from Ogilvie 12:40 AM. MD-W 12 trips each way to Elgin, 1 to 2 h apart, last outbound
   12:40 AM. BNSF 20 trips each way, hourly, last outbound 12:33 AM. Last inbound: UP-W 10:25 PM from
   Elburn, MD-W 10:10 PM from Elgin, BNSF 11:05 PM from Aurora.
10. **Route optimizer is a nice-to-have, not a phase.**
11. **Venue lookup has three sources.** The rated list within half a mile of the station (Google, cached forever;
    OpenStreetMap fallback), Google text search by name for anything farther out, and plain name entry.
    Google details and photos are still fetched once per stop.
