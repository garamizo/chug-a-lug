# Roadmap

What is left before the crawl on **Saturday, December 26, 2026**, and what comes after. How the built
features behave is in [FEATURES.md](FEATURES.md); how to run the box is in [OPERATIONS.md](OPERATIONS.md).

Status as of 2026-11-15.

## Before launch

### Blocking: the event cannot run without these

- [ ] **Plan and lock the real route.** The current route is "Example Route". Build the real draft,
  tick "Confirmed open on event day" with a phone number for each stop, run the Highball, lock it and
  **Make current**.
- [ ] **Invite the crew.** `just invite <seats> <days>` makes the join link; send it to the ~10 people
  and watch them arrive in the Manifest. Prod has one user today, the Conductor.
- [ ] **Field test (freeze).** A real train ride on Saturday Dec 12 or 19 with 2–3 phones, Android and
  iPhone. Bug fixes only after it.
- [ ] **Holiday-week timetable check.** Metra may publish holiday-week changes in mid-December. The app
  re-reads the feed when `published.txt` changes; after any December publish, open the real route and
  confirm its legs still ride on Dec 26.

### Should do: risk goes up without these

- [ ] **Host backup cron.** OPERATIONS says `just backup` runs from host cron at 04:30, but no crontab
  entry exists; only PocketBase's own 04:00 UTC zip runs. Add the cron line or drop the claim.
  Off-machine copies were declined (all data is test data so far); revisit once real crew data exists.
- [ ] **Rehearse the disaster fallback once.** Restore the latest snapshot on a VPS and move the tunnel
  ([OPERATIONS](OPERATIONS.md#disaster-fallback-home-internet-or-power-is-out-on-event-day)).
- [ ] **Power and network on event day.** A UPS for the home box (Decision 8); confirm the router
  restarts unattended.
- [ ] **Phone acceptance, auth.** The manual checks in
  [OPERATIONS → Manual acceptance](OPERATIONS.md#manual-acceptance): join link from a chat app,
  password reset mail through Resend, iPhone home-screen sign-in, Put off.
- [ ] **Phone acceptance, ticket mail and logo.** A real code mail in Gmail on Android with dark mode
  on, and whether `color-scheme: dark` fixed the white logo square on the Samsung PWA (a hypothesis,
  not a proven cause).
- [ ] **M4 rehearsal on phones.** Fill in [the rehearsal template](rehearsals/m4-template.md) with three
  phones. Automated rehearsal passes; physical-phone acceptance does not exist yet.
- [ ] **A real Saturday recording.** `~/.chug-a-lug/recordings/` is empty. Record a December Saturday
  (`just record`) so the Shakedown Run can replay real delays and alerts, not just the fixture.
- [ ] **Green gate before the freeze.** `npm run test:sim:offline` fails at `tests/sim/offline.spec.ts:6`
  (stale "Synchronized" assertion) and `tests/sim/rehearsal.spec.ts:129` flakes under load.
- [ ] **Google Places monthly cap** set in the Google console (Decision 3 assumes it).

### Nice to have before launch

- Ticket mail: Outlook ignores `max-width`; the unit test lacks a `width:100%` assertion.
- Decide the fate of the `design/auth-ui-proposal` worktree (an uncommitted `/auth-preview` prototype).

## Milestones

| Milestone | Target | Status |
|---|---|---|
| M0 Skeleton | early Oct | Done 2026-09-19 ([plan](superpowers/plans/2026-09-19-m0-skeleton.md)) |
| M1 Planning | end Oct | Done 2026-09-19 ([plan](superpowers/plans/2026-09-19-m1-planning.md)) |
| M2 Metra proxy | mid Nov | Done 2026-09-20 ([plan](superpowers/plans/2026-09-20-m2-metra-proxy.md)) |
| M3 Live | end Nov | Done 2026-09-20 ([plan](superpowers/plans/2026-09-20-m3-live.md)) |
| M4 Simulation | Sat Dec 5 | Built ([spec](superpowers/specs/2026-09-21-m4-simulation-design.md), [plan](superpowers/plans/2026-09-21-m4-simulation.md)); physical-phone and real-recording acceptance pending |
| Crew access and auth | — | Done: join link, email + password, reset mail, Manifest, Cloudflare hardening (Oct–Nov) |
| M5 Wrap-up | Dec 12 | Not started — see below |
| Freeze + field test | Sat Dec 12 or 19 | Not done |
| Launch | Sat Dec 26 | Crawl |

## M5: wrap-up (Closing Time)

Goal: the memories and the bragging rights. Nothing here is needed *on* Dec 26: drinks, Freight and the
event log are already stored per route, so M5 can land after the crawl if time runs short. The Crew
Board already ranks drinks for the day.

**Must have**
- Album (Roundhouse) per stop, swipeable lightbox, download originals one by one or as a zip.
  Includes admin retagging of Freight (Decision 5).
- Scoreboard (Hall of Fame): drinks per person, per stop, per drink type; stop likes.
- Awards (Golden Spikes): a handful of computed ones plus admin-assigned ones.

**Nice to have**
- Event log replay: a timeline of the day with photos placed on it.
- On-time stats: planned vs actual departure per leg.
- Export the itinerary and stats as a shareable page for next year's planning.

## Later ideas

**Planning**
- Auto-suggest a route: greedy ordering of chosen stops by walk time with the train timetable as hard
  deadlines (Decision 10: a nice-to-have, not a phase).
- "Tickets" checklist: Metra weekend pass (verify the current price on metra.com), Ventra app, kids' fares.

**Live**
- Mini map with the three lines and live train dots.
- Meeting point per stop shown on the broadcast when someone taps "I'm lost".
- Home station per user and a personal "last train home" deadline on their departure banner.
- Round tracker / expense split.
- Push notifications for people who added the app to their home screen (iOS 16.4+).

**Platform**
- Chunked (tus) uploads, if the 90 MB cap bites.

## Open questions

- Start and end stations, which drive the "last train home" logic.
- Which phones are Android vs iPhone, for the PWA, offline and upload testing matrix.
