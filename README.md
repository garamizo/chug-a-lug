# Chug-a-Lug Choo-Choo

**chugalug.app**: a mobile-first web app for our family's annual Christmas bar crawl on the Chicago Metra.
One screen tells everyone where we are, where we go next, and when we must leave the bar to catch the train.

| Phase | What it is | Status |
|---|---|---|
| **Planning** | Propose routes, vote, lock the plan | Built |
| **Live** | The day-of screen with the departure banner; practice on any other day | Built |
| **Wrap-up** | Album, scoreboard, awards | Not started (M5) |

This document, the code, and our conversations use plain developer terms. The themed rail-and-bar
vocabulary is for the UI only and is defined in the [UI glossary](#ui-glossary).

## Docs

- [docs/FEATURES.md](docs/FEATURES.md): how planning, Live, practice days and the Shakedown Run behave,
  and the design decisions behind them.
- [docs/ROADMAP.md](docs/ROADMAP.md): **what is left before Dec 26**, milestones, M5 wrap-up, later ideas.
- [docs/OPERATIONS.md](docs/OPERATIONS.md): deploy, backups, crew access, Cloudflare, recordings, rehearsals.
- [docs/REFERENCES.md](docs/REFERENCES.md): the open-source survey and verified facts behind the design.
- [docs/superpowers/](docs/superpowers/): the design spec and implementation plan for every change.
- [CLAUDE.md](CLAUDE.md): working rules for this repo (worktrees, test ports, traps).

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
- **Private.** Everyone has their own account, keyed by email. Getting in takes the Conductor's
  join link (limited seats, an end date); from then on sign-in is email and password. No shared password.
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

## Architecture

- **Host**: the admin's home computer, Docker Compose (`pocketbase`, `web`, `cloudflared`), published
  through a Cloudflare Tunnel. chugalug.app is on the HSTS preload list, so HTTPS is mandatory; the
  tunnel provides the certificate and needs no port forwarding. Runtime state (database, GTFS, Places
  budget, recordings) lives in `~/.chug-a-lug` (`CHUG_DATA`), outside every git checkout.
- **Frontend**: SvelteKit PWA (Svelte 5, `@vite-pwa/sveltekit`); the BNSF line is drawn as SVG from the
  GTFS station order.
- **Backend**: PocketBase, a single binary with SQLite, file storage on local disk, and server-sent-event
  realtime. Server logic lives in `pocketbase/pb_hooks/`, schema in `pocketbase/pb_migrations/`.
- **Metra proxy**: SvelteKit server routes using `gtfs-realtime-bindings` and a pure-TypeScript GTFS loader.
  Polls Metra every 30 s, caches, computes "next train from station A to B", and serves recorded replay
  in simulation. The only component that talks to Metra.
- **Auth**: per-person accounts keyed by email. A newcomer follows the Conductor's join link
  (`just invite`) to `/join`, picks a password and confirms the email with a code. Sign-in is email and
  password; a forgotten password is reset by a link emailed through Resend SMTP. The Conductor is the
  account minted from `CONDUCTOR_EMAIL`.
- **Places**: Google Places (server-side, key never leaves the box) for the rated list near each station,
  text search by name, and venue photos fetched once and stored; OpenStreetMap (Overpass) is the
  fallback without a key.
- **Uploads**: PocketBase multipart, images compressed in the browser, videos capped at 90 MB because the
  Cloudflare free tier rejects requests over 100 MB.

The full original design is [docs/superpowers/specs/2026-09-19-chugalug-design.md](docs/superpowers/specs/2026-09-19-chugalug-design.md).

**Data model** (PocketBase collections): `itineraries` (draft or locked), `stops`, `places` and
`place_lookups` (venues and their photos), `legs` (computed: walk, one train, or two trains via a
downtown transfer), `votes`, `approval_votes`, `comments`, `checkins` (the Conductor's anchor),
`broadcasts` and `broadcast_acks` (Bulletins), `chat_messages`, `drink_entries` (the Tab), `media`
(Freight), `event_log`, `crawl_settings` (the current route); for crew access `users`, `join_links`,
`signups`, `access_log`; for simulation `simulation_clock` and `action_sequence`. Stations come
straight from GTFS.

## Getting started

```bash
just pb-download          # once: pinned PocketBase binary
just pb                   # terminal 1: PocketBase with --dev on ~/.chug-a-lug/pb_dev
just web                  # terminal 2: vite dev on http://localhost:5173
```

The full gate, one run at a time across all worktrees (the harnesses bind fixed ports):

```bash
cd web && npm test && npm run check && npm run test:e2e
bash scripts/test-hooks.sh
```

Deploy with `just up` (`docker compose up -d --build`) from the checkout you want live. Everything else,
`.env` included, is in [OPERATIONS.md](docs/OPERATIONS.md).

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
| Practice day | **Practice** | Plain | Any day that is not the current route's date; Live runs the route's timetable at today's time |
| Metra credit | **Schedule from Metra’s public feed. Not affiliated with Metra. Timetable published …** | Plain | Footer on every page; Metra's license. The date shows only when signed in, and only Metra's real publish date |
| Current route | **Current route** | Plain | The locked route the Conductor selected ("Make current"); Live, The Route and photos follow it |
| Wrap-up phase | **Closing Time** | Bar | |
| Admin | **Conductor** | Rail | |
| Users | **Crew** | Rail | |
| Sign-in page `/login` | **Sign in** | Plain | "Welcome back"; email and password, with a reset link by email |
| Sign-up page `/join` | **Sign up** | Plain | Name, email, password, then an emailed code; needs a join link |
| Join link | **Join link** | Plain | The one link the Conductor shares; it has seats and an end date |
| Conductor access panel `/crew/access` | **Manifest** | Rail | People, status, last seen, access log |
| Block / unblock a person | **Put off / Let back on** | Rail | Conductor only |
| Account page `/account` | **Your ticket** | Rail | Name edit, email, sign out |
| User roster | **Crew Board** | Rail | |
| Stop (a bar or restaurant on the route) | **Stop** | Plain | A station is always a Metra station |
| Start station | **Board at** | Plain | Draft header select; the station the crew boards at, at Start; the Start field then reads "At the boarding station by". Stop 1's arrival counts the ride in. Defaults to Aurora and is never empty. |
| Run home | **Run home to** | Plain | The planner's closing leg: the last train from the final stop back to Board at, which must arrive before midnight. Finish is its arrival. |
| Dwell time at a stop | **Layover** | Rail | |
| Train leg | **Run** | Rail, "the 8:40 run" | |
| Walk between station and stop | **Walk** | Plain | |
| Venue card | **Stop card** | Plain | |
| Venue details sheet | **Venue details** | Plain | Opens from Add Stop when a stop card is tapped, before it becomes a stop; photos, rating, hours, walk time, then **Add stop** |
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
| Crew chat message | **Message** | Plain | Anyone can post; never pinned |
| Computed chat milestone | **Milestone** | Plain | Worked out from the Tab and Freight, never stored |
| Event log | **Train Sheet** | Rail, the dispatcher's log | |
| Drink log | **Tab** | Bar | Opens as a sheet over Live from the tab bar's 🍻 Tab button |
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
| Home card for the current route | **Ticket** | Rail | Gold, with the route's title, date/start time and a day countdown; links to `/route`, or to `/plan` with no route yet |
| Home and Route Planner list layout | **Station board** | Rail | Split-flap rows: destination, subtitle, status chip |
| The one message composer | **Chat box** | Plain | Emoji tray, photo/video and camera, send; shared by Live's crew chat and the planner's comments |
| Midpoint of the unfolded line | **Turn around** | Rail | Divides the going stops (Aurora → Chicago) from the return stops (Chicago → Aurora) |
