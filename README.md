# Chug-a-Lug Choo-Choo

**chugalug.app**: a mobile-first web app for our family's annual Christmas bar crawl on the Chicago Metra.
One screen tells everyone where we are, where we go next, and when we must leave the bar to catch the train.

- Phase 1 **planning**: propose routes, vote, lock the plan.
- Phase 2 **live**: the day-of screen with the departure banner.
- Phase 3 **wrap-up**: album, scoreboard, awards.

This document, the code, and our conversations use plain developer terms. The themed rail-and-bar
vocabulary is for the UI only and is defined in the [UI glossary](#ui-glossary). The open-source survey
and the verified facts behind the design are in [docs/REFERENCES.md](docs/REFERENCES.md).

---

## Mission

Every Christmas the family rides Metra between suburbs and downtown, hopping bars and restaurants.
The pain points, in priority order:

1. **Missing trains.** Nobody watches the clock, and on a Saturday timetable the next UP-W train may be two hours out.
2. **Not knowing the stop.** Which station, which platform, which direction.
3. **Sharing the plan.** It lives in one person's head or a group chat that scrolls away.
4. **Changing the plan mid-crawl.** A bar is closed or packed and the group splinters.
5. **Planning together beforehand.** Everyone wants a say; nobody wants a spreadsheet.

Success looks like: zero missed trains, everyone sees the same plan at all times, and we end up
with an album and a scoreboard to argue about at dinner.

## Ground rules

- **Event: Saturday, December 26, 2026.** Metra runs its Saturday timetable. About 10 users.
- **Web only, no app stores.** Installable PWA is encouraged, never required.
- **Works on a phone in a loud bar with one bar of signal.** Big buttons, cached plan, degrades gracefully.
- **Private.** One shared crew password from the admin, plus your name so likes and comments are yours.
  No sign-up, no recovery, no per-person accounts; the session lives in a cookie for a year.
- **Lines:** UP-W (Ogilvie), MD-W (Union Station, turns at Elgin on weekends), BNSF (Union Station).
  Ogilvie and Union are a 6 min walk apart, so the plan can switch lines downtown.
- **The crawl is settled on the BNSF line** (Aurora to Union Station). The planner shows only that line;
  the schedule still loads all three so a stop on another line in an older draft keeps its train times.
- **Runs on the admin's own computer.** One machine at home holds the database, the media, and the API
  keys, published to the internet through a Cloudflare Tunnel at chugalug.app. No cloud accounts to manage.
- **Simulation is a first-class feature.** The whole live experience must be rehearsable at home with a fake
  clock, a replayed train feed, and the Conductor's shared position anchor. No GPS.
- **Metra data is proxied through our server** (their license requires it) and displayed with
  "not affiliated with Metra" and a last-updated time.

## UI glossary

Developer term on the left is what code, docs, and conversations use. UI label on the right is what
users see. Bars and restaurants keep their plain names.

| Developer term | UI label | Origin | Notes |
|---|---|---|---|
| Planning phase | **Route Planner** | Plain | |
| Itinerary draft | **Draft** | Plain | |
| Locked itinerary | **The Route** | Plain | |
| Approval vote on the final plan | **Highball** | Rail all-clear signal; also the cocktail | |
| Like / dislike | **Cheers / Pass** | Bar | |
| Live phase | **Live** | Plain | |
| Wrap-up phase | **Closing Time** | Bar | |
| Admin | **Conductor** | Rail | |
| Users | **Crew** | Rail | |
| User roster | **Crew Board** | Rail | |
| Stop (a bar or restaurant on the route) | **Stop** | Plain | A station is always a Metra station |
| Dwell time at a stop | **Layover** | Rail | |
| Train leg | **Run** | Rail, "the 8:40 run" | |
| Walk between station and stop | **Walk** | Plain | |
| Venue card | **Stop card** | Plain | |
| Departure banner | **Departure Board** | Rail | |
| First warning (about 10 min out) | **Last Call** | Bar | |
| Leave-now alert | **All Aboard** | Rail | |
| Location sharing | **Position Report** | Rail radio | |
| Check-in button | **Punch** | Rail ticket punch; bar punch bowl | |
| Plan edit: reroute | **Reroute** | Rail | |
| Plan edit: extend a stop | **Hold** | Rail | |
| Plan edit: cancel a stop | **Annul** | Rail, Metra's own word | |
| Plan edit: add a stop | **Extra** | Rail, an unscheduled train | |
| Broadcast message | **Bulletin** | Rail | |
| Event log | **Train Sheet** | Rail, the dispatcher's log | |
| Drink log | **Tab** | Bar | |
| Scoreboard | **Hall of Fame** | Sports | |
| Awards | **Golden Spikes** | Rail | |
| Media uploads | **Freight** | Rail | |
| Album | **Roundhouse** | Rail | |
| Simulation mode | **Shakedown Run** | Rail | |
| Simulation clock | **Railroad Time** | Rail | Railroads invented standard time |
| Meeting point | **Meet Point** | Rail | |
| Straggler flag | **Caboose** | Rail | |
| Left early | **Deadhead** | Rail | |
| Home station | **Home Terminal** | Rail | |
| Metra proxy service | **Dispatcher** | Rail | Internal name; never shown to users |

---

## Phase 1: planning

Goal: by early December, one locked itinerary that everyone has seen and voted on.

**Must have (MVP)**
- The BNSF line drawn top to bottom down the middle of the screen, Aurora at the top and Union Station at
  the bottom. Tap a station to see the best rated bars and restaurants within 250 m of it (Google Places
  Nearby Search, one call per station cached forever; OpenStreetMap, nearest first, when no key is set).
- The draft is laid out on that same line: a stop sits left of the line while the crawl heads toward
  Chicago and right of it on the way back to Aurora, in its station's row, with its train leg underneath.
  The two sides are panes wider than half the screen; one is in focus and a fifth of the other peeks in.
  Drag, tap the direction tab, or focus a card on the other side to shift. Tap a station's circle to add
  a stop there: the side of the map you tap on is the stop's direction (going or return), and the crawl
  is always the going stops top to bottom, then the return stops bottom to top, so a new stop slots in
  by station rather than at the end. Stations no train stops at on the crawl date (Metra skips Congress
  Park, Highlands, LaVergne, Stone Ave and West Hinsdale on weekends) are greyed out with no circle to
  tap, and a leg that still touches one says which station has no trains that day instead of blaming
  the layover. The last stop at a station picks its departure from that day's trains toward the next
  stop; earlier stops at the same station pick a plain layover and can swap places with the small arrows.
  A draft has two screens: the view (`/plan/<id>`) with the read-only route, cheers, comments and the
  Highball, and the edit screen (`/plan/<id>/edit`) with the controls and nothing else.
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

**Nice to have**
- Auto-suggest a route: greedy ordering of chosen stops by walk time with the train timetable as hard deadlines.
- "Tickets" checklist: Metra weekend pass (verify the current price on metra.com), Ventra app, kids' fares.

## Phase 2: live

Goal: nobody misses a train, nobody is lost, and the plan can change without chaos.

**Built in M3**

- **Departure Board** is read-only: the full board on Live and a compact banner on every other
  signed-in screen on the event day. It shows the current stop, next train (scheduled and live ETA),
  walk time to the platform and countdown, with Last Call and All Aboard warnings.
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
- **Crew Board** lists names, the Conductor role, today's drink count and who acknowledged the latest
  Bulletin. It does not track individual locations.
- **The Tab** logs beer, wine, cocktail, shot, water or food at the current stop, with undo for your own
  entries. The Tab and Freight are available only while the position source is `clock` or `override`;
  a stop still appears before and after the crawl, but those controls stay closed.
- **Freight** uploads photos and videos tagged with the stop the uploader's shared board shows. The
  server checks that the stop belongs to a locked route; an invalid tag is cleared without losing the
  upload. Images are compressed in the browser (the original is used if compression fails), videos
  pass through, and each selected file must be at most 90 MB. Unsupported file types are refused with
  a specific message; one failed file does not stop the rest of the batch.
- **Offline reading**: the app shell is precached and the locked itinerary, stops and legs are mirrored
  into IndexedDB. Live shows the saved copy and its age when PocketBase is unreachable. Open the app
  online first to populate it. Writes are deliberately not queued; failed actions must be retried online.

**Nice to have**
- Mini map with the three lines and live train dots.
- Meeting point per stop shown on the broadcast when someone taps "I'm lost".
- Home station per user and a personal "last train home" deadline on their departure banner.
- Round tracker / expense split.
- Push notifications for people who did add the app to their home screen (iOS 16.4+).

## Phase 3: wrap-up

Goal: the memories and the bragging rights.

**Must have (MVP)**
- Album per stop, swipeable lightbox, download originals one by one or as a zip.
- Scoreboard: drinks per person, per stop, per drink type; stop likes.
- Awards: a handful of computed ones plus admin-assigned ones.

**Nice to have**
- Event log replay: a timeline of the day with photos placed on it.
- On-time stats: planned vs actual departure per leg.
- Export the itinerary and stats as a shareable page for next year's planning.

## Cross-cutting: simulation mode

Sim mode has to exist before the live phase is considered done, because the real event happens once a year.

- **Sim clock**: the server publishes `{epochStart, rate, wallStart}`; every client and the Metra proxy
  derive the same virtual "now". In production it is the wall clock.
- **Recorded train feed**: a recorder polls Metra's positions, trip updates, and alerts every 30 s into
  timestamped protobuf snapshots. The proxy replays the snapshot nearest the sim clock.
  Record on a **Saturday in December**, since Dec 26 runs the Saturday timetable.
- **Shared position**: rehearse the same clock-derived stop and Conductor anchor as the live day. No GPS, waypoint player or per-person tracking.
- **Schedule-only fallback**: use scheduled departures when no recording exists; do not invent vehicle positions.
- **Isolation**: a rehearsal uses its own database and origin. Replay uses the recording's original service date and archived GTFS; operational timeouts and cache ages remain on wall time.
- M4 is specified but not yet implemented: see the [design](docs/superpowers/specs/2026-09-21-m4-simulation-design.md) and [implementation plan](docs/superpowers/plans/2026-09-21-m4-simulation.md).
- A real dry run on a December Saturday with two or three phones, before the freeze.

---

## Proposed architecture

Recommendation, not yet decided. See the references doc for the alternatives considered and
[docs/superpowers/specs/2026-09-19-chugalug-design.md](docs/superpowers/specs/2026-09-19-chugalug-design.md) for the full design.

- **Host**: the admin's home computer, Docker Compose, published through a Cloudflare Tunnel.
  chugalug.app is on the HSTS preload list, so HTTPS is mandatory; the tunnel provides the certificate
  and needs no port forwarding. Nightly backup of the data directory to a second disk or drive.
- **Frontend**: SvelteKit PWA (`@vite-pwa/sveltekit`), MapLibre GL for the map, a generated SVG schematic
  of the three lines (stations ordered from GTFS), PhotoSwipe for the gallery.
- **Backend**: PocketBase, a single binary with SQLite, file storage on local disk, and server-sent-event realtime.
- **Metra proxy**: SvelteKit server routes using `gtfs-realtime-bindings` and a pure-TypeScript GTFS loader
  (the feed is 700 KB; the three lines fit in memory). Polls Metra every 30 s, caches, computes "next train
  from station A to B", and serves the recorded replay in sim mode. The only component that talks to Metra.
- **Auth**: name plus the shared crew password (or the admin password for the Conductor role), checked by a
  PocketBase hook that creates the identity for that name on first login and returns a one-year token kept
  in a cookie. No SMS, no email, no recovery flow.
- **Places**: Google Places (server-side, key never leaves the box) for the rated list near each station,
  text search by name, and venue-card photos fetched once per stop and stored on disk; Overpass
  (OpenStreetMap) is the fallback for the station list when no key is configured.
- **Uploads**: PocketBase multipart, images compressed in the browser, videos capped at 90 MB because the
  Cloudflare free tier rejects requests over 100 MB. Chunked (tus) uploads are a later upgrade if the cap bites.

Data model sketch: `user`, `itinerary` (draft or locked), `stop` (venue, station, dwell, place_id),
`stop_photo` (file, source, attribution), `leg` (computed: walk, one train, or two trains via a downtown
transfer; segments json), `vote`, `comment`, `checkin`, `broadcast`, `drink_entry`, `media` (file, taken_at,
stop, tagged_by), `event_log`. M3 also adds `broadcast_acks` for each person's Bulletin acknowledgements;
there is no crew positions collection. Stations come straight from GTFS.

## Roadmap

Event is Saturday, December 26, 2026, 14 weeks out. The current GTFS feed already has the Saturday
timetable through Dec 31; Metra may still publish holiday-week changes in mid-December, so the app
re-reads the feed rather than hard-coding it.

| Milestone | Target | Done when |
|---|---|---|
| M0 Skeleton | early Oct | Repo skeleton, PocketBase + SvelteKit running locally, shared-password login, Cloudflare Tunnel live at chugalug.app |
| M1 Planning | end Oct | Diagram, stop picker, venue cards with Google photos, drafts with real train times, votes, comments, approval vote — done 2026-09-19 (see docs/superpowers/plans/2026-09-19-m1-planning.md) |
| M2 Metra proxy | mid Nov | BNSF realtime proxy with recording, Departure Board with Last Call and All Aboard, service alerts and the header menu, schedule fallback — done 2026-09-20 (see docs/superpowers/plans/2026-09-20-m2-metra-proxy.md) |
| M3 Live | end Nov | Clock-derived position with Conductor anchor, Crew Board, staged route edits, Bulletins, Tab, Freight, offline route mirror — done 2026-09-20 (see [plan](docs/superpowers/plans/2026-09-20-m3-live.md)) |
| M4 Simulation | Sat Dec 5 | Shared sim clock, feed replay and timetable fallback, Conductor anchor; full rehearsal at home — [spec and plan](docs/superpowers/plans/2026-09-21-m4-simulation.md) prepared, implementation pending |
| M5 Wrap-up | Dec 12 | Album, scoreboard, awards, downloads |
| Freeze + field test | Sat Dec 12 or 19 | Real train ride with 2-3 phones; bug fixes only after this |
| Launch | Sat Dec 26 | Crawl |

## Decisions and pushback

Numbered to match the earlier review; each is reversible.

1. **Bars near a station come from Google Places Nearby Search, ranked by rating.** One call per station
   (about 20 for the BNSF line); the venues go into the `places` table and a `place_lookups` row marks the
   station as searched, so the database answers every later request. The key never reaches the browser.
   OpenStreetMap remains the fallback without a key; it has no ratings, so that list is nearest first.
   Both are cut at 250 m.
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
6. **Login is a shared crew password plus your name.** Replaces the earlier phone-number plan. The admin
   hands out one password in the family chat and keeps a second admin password for the Conductor role.
   The first login with a name creates that identity; the same name on another phone is the same person.
   The session is a one-year cookie. Trade-off: anyone with the password can pick any name, which is
   fine for ten relatives and removes Twilio, SMS costs, and PIN resets entirely.
7. **Domain is chugalug.app.** HTTPS is mandatory on `.app`; Cloudflare Tunnel handles that from home.
8. **Home server trade-offs.** Simpler and free, but the event depends on your power and internet.
   Mitigations: a UPS, the same Compose file restorable on a $5 VPS from the nightly backup in about
   15 minutes, and the itinerary cached offline on every phone.
9. **Dec 26 timetable facts** (from the feed as of Sept 18): UP-W 10 trips each way, mostly every 2 h,
   last outbound from Ogilvie 12:40 AM. MD-W 12 trips each way to Elgin, 1 to 2 h apart, last outbound
   12:40 AM. BNSF 20 trips each way, hourly, last outbound 12:33 AM. Last inbound: UP-W 10:25 PM from
   Elburn, MD-W 10:10 PM from Elgin, BNSF 11:05 PM from Aurora.
10. **Route optimizer is a nice-to-have, not a phase.**
11. **Venue lookup has three sources.** The rated list within 250 m of the station (Google, cached forever;
    OpenStreetMap fallback), Google text search by name for anything farther out, and plain name entry.
    Google details and photos are still fetched once per stop.

## Open questions

- Start and end stations, which drives the "last train home" logic.
- Which phones are Android vs iPhone, for the PWA, offline and upload testing matrix.
