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
  Ogilvie and Union are a 5 min walk apart, so the plan can switch lines downtown.
- **Runs on the admin's own computer.** One machine at home holds the database, the media, and the API
  keys, published to the internet through a Cloudflare Tunnel at chugalug.app. No cloud accounts to manage.
- **Simulation is a first-class feature.** The whole live experience must be rehearsable at home with a fake
  clock, a replayed train feed, and scripted GPS.
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
- Schematic diagram of the three lines with stations. Tap a station to see nearby bars and restaurants
  (Overpass query on OpenStreetMap within about 800 m of the station).
- Build an itinerary draft: ordered stops, each tied to a station and a planned dwell time. The app fills
  in train legs and walks from the Saturday Metra schedule, so the draft shows real train times and flags
  any leg that doesn't work.
- Venue card: name, address, hours, walk time from station, up to 5 photos, link to Google Maps, notes.
  When anyone adds a stop, the server calls Google Places once, saves the photos to disk, and every user
  sees the same card from then on (see Decisions, item 3).
- **"Confirmed open on event day" checkbox with phone number.** Dec 26 is a normal Saturday for most
  bars, but the week after Christmas still catches some closures.
- Like / dislike and comments on each draft and each stop.
- Approval vote run by the admin; on a pass, the draft becomes the locked itinerary.

**Nice to have**
- Auto-suggest a route: greedy ordering of chosen stops by walk time with the train timetable as hard deadlines.
- "Tickets" checklist: Metra weekend pass (verify the current price on metra.com), Ventra app, kids' fares.

## Phase 2: live

Goal: nobody misses a train, nobody is lost, and the plan can change without chaos.

**Must have (MVP)**
- **Departure banner** pinned at the top of every screen: current stop, next train (scheduled and live ETA
  from GTFS-realtime), walk time to the platform, and "departs in". Two thresholds: a first warning about
  10 minutes out (amber, settle the tab), then the leave-now alert (full-width red, vibration, sound if allowed).
- Next-train logic works from the static schedule when the live feed is missing or stale, and says so.
- **Check-in**: two big buttons, "At the bar" and "On the train". The roster shows who is where and who
  hasn't checked in since the last leg. Straggler alert to the admin.
- **Location sharing** using the browser's location permission prompt, foreground-only, with screen wake
  lock during train legs. Each user has a "share my position" toggle; the admin's is on by default.
  Shown as "last seen N min ago".
- **Plan edits** by the admin: reroute, extend a stop, cancel a stop, add a stop. Downstream legs recompute;
  every screen updates within seconds; a broadcast message is pinned until each person taps "Got it".
  Everything lands in the event log.
- **Drink log**: one tap per drink type (beer, wine, cocktail, shot, water, food) at the current stop.
- **Media uploads**: photos and short videos from the phone with no labeling by the user. The server
  tags each upload with the admin's current stop, taken from the latest shared position or check-in.
  The admin can fix a tag later in the album.
- Plan and station data cached offline so the itinerary is readable in a tunnel.

**Nice to have**
- Mini map with the three lines and live train dots.
- Meeting point per stop shown on the broadcast when someone taps "I'm lost".
- Home station per user and a personal "last train home" deadline on their departure banner.
- "Left early" button so the straggler alert ignores them.
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
- **Scripted GPS**: a waypoint list with speeds and pauses drives a fake `navigator.geolocation` behind a `?sim=1` flag.
- **Schedule-only fallback**: synthesize train positions from the static timetable when no recording exists.
- A real dry run on a December Saturday with two or three phones, before the freeze.

---

## Proposed architecture

Recommendation, not yet decided. See the references doc for the alternatives considered and
[docs/superpowers/specs/2026-09-19-chugalug-design.md](docs/superpowers/specs/2026-09-19-chugalug-design.md) for the full design.

- **Host**: the admin's home computer, Docker Compose, published through a Cloudflare Tunnel.
  chugalug.app is on the HSTS preload list, so HTTPS is mandatory; the tunnel provides the certificate
  and needs no port forwarding. Nightly backup of the data directory to a second disk or drive.
- **Frontend**: SvelteKit PWA (`@vite-pwa/sveltekit`), MapLibre GL for the map, a hand-authored
  `d3-tube-map` JSON for the schematic diagram, PhotoSwipe for the gallery.
- **Backend**: PocketBase, a single binary with SQLite, file storage on local disk, and server-sent-event realtime.
- **Metra proxy**: SvelteKit server routes using `gtfs-realtime-bindings` and `node-gtfs`. Polls Metra every
  30 s, caches, computes "next train from station A to B", and serves the recorded replay in sim mode.
  The only component that talks to Metra.
- **Auth**: name plus the shared crew password (or the admin password for the Conductor role), checked by a
  PocketBase hook that creates the identity for that name on first login and returns a one-year token kept
  in a cookie. No SMS, no email, no recovery flow.
- **Places**: Overpass (OpenStreetMap) for bars near stations, Photon for search, Google Places (server-side,
  key never leaves the box) for venue-card photos, fetched once per stop and stored on disk.
- **Uploads**: PocketBase multipart, images compressed in the browser, videos capped at 90 MB because the
  Cloudflare free tier rejects requests over 100 MB. Chunked (tus) uploads are a later upgrade if the cap bites.

Data model sketch: `user`, `itinerary` (draft or locked), `stop` (venue, station, dwell, place_id),
`stop_photo` (file, source, attribution), `leg` (computed), `vote`, `comment`, `checkin`, `broadcast`,
`drink_entry`, `media` (file, taken_at, stop, tagged_by), `event_log`, `position`.

## Roadmap

Event is Saturday, December 26, 2026, 14 weeks out. The current GTFS feed already has the Saturday
timetable through Dec 31; Metra may still publish holiday-week changes in mid-December, so the app
re-reads the feed rather than hard-coding it.

| Milestone | Target | Done when |
|---|---|---|
| M0 Skeleton | early Oct | Repo skeleton, PocketBase + SvelteKit running locally, shared-password login, Cloudflare Tunnel live at chugalug.app |
| M1 Planning | end Oct | Diagram, stop picker, venue cards with Google photos, drafts with real train times, votes, comments, approval vote |
| M2 Metra proxy | mid Nov | Proxy live and recording, departure banner with both alerts, schedule fallback |
| M3 Live | end Nov | Check-in, roster, plan edits, broadcasts, drink log, media upload, offline cache |
| M4 Simulation | Sat Dec 5 | Sim clock, replay, scripted GPS; full sim run at home |
| M5 Wrap-up | Dec 12 | Album, scoreboard, awards, downloads |
| Freeze + field test | Sat Dec 12 or 19 | Real train ride with 2-3 phones; bug fixes only after this |
| Launch | Sat Dec 26 | Crawl |

## Decisions and pushback

Numbered to match the earlier review; each is reversible.

1. **Bars near a station come from OpenStreetMap, not Google.** Free, cacheable, no key in the browser.
2. **Metra key verified on Sept 19, 2026.** All three realtime endpoints return protobuf that decodes; the
   static schedule needs no key. The file in `.secrets/` is git-ignored.
3. **Venue-card photos come from Google Places, fetched once per stop and stored on our disk.** Flow: a user
   picks a bar; the server calls Place Details (name, address, hours, rating, photo references) and then
   Place Photos for up to 5 images, writes the JPEGs under the stop's folder with Google attribution, and
   never calls Google for that stop again. Everyone sees the same five photos. Budget: about 30 stops
   means 30 detail calls and 150 photo calls, inside the 1,000 free calls a month for each. The key lives
   only on the home box with a monthly cap set in the Google console. Accepted caveat: Google's terms say
   Places photos may not be cached; the realistic downside for a private app is a disabled key.
4. **Location sharing uses the browser location prompt.** That prompt is the Geolocation API; it works
   foreground-only with wake lock, which you accepted. Each person toggles sharing; the admin is on by default.
5. **Media is tagged with the admin's location, not the uploader's.** Users upload with no labels.
   The server stamps each file with the stop the admin is at, from the latest shared position, or the
   latest check-in if the position is stale. No EXIF reading needed, which also sidesteps iPhones stripping
   GPS from browser uploads. The admin fixes stragglers in the album.
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

## Open questions

- Start and end stations, which drives the "last train home" logic.
- Which phones are Android vs iPhone, for the GPS and push testing matrix.
