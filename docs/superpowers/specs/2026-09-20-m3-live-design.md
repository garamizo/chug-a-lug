# M3 Live: design

The day-of app. M2 gave the crawl a Departure Board that knows which train to catch; M3 gives the
Conductor a way to change the plan when the day disagrees with it, and the Crew something to do with
their phones besides read a countdown.

Parent spec: [2026-09-19-chugalug-design.md](2026-09-19-chugalug-design.md). Predecessor:
[2026-09-20-m2-metra-proxy-design.md](2026-09-20-m2-metra-proxy-design.md).

## 1. Goal and scope

In scope:

- **Where the crawl is** becomes editable, and only from the route editor.
- **The live editor**: the locked route opened on the day, edited as a staged change, saved in one
  coherent commit.
- **Bulletins** drafted from that change, pinned on every screen until acknowledged.
- **The banner app-wide** on the event day.
- **The Tab**: one tap per drink, crew totals for the stop.
- **Freight**: photos and short videos, tagged with the stop the crawl is at.
- **Crew Board**: who has logged in, their Tab, whether they have seen the Bulletin.
- **Offline**: the locked route readable with no signal.

Out of scope, with reasons:

- **Per-crew check-in (Punch) and straggler alerts.** Ten people who can see each other do not need to
  tell an app where they are, and a roster of stale self-reports is worse than no roster. The
  `checkins` collection stays, but only the Conductor writes it, and only from the editor.
- **GPS and the `positions` collection.** Already a non-goal in M2 §3.1; nothing in M3 revives it.
  `users.share_position`, `users.left_early` and `users.home_station` are not created.
- **Album, lightbox, downloads, scoreboard, awards** (M5). M3 uploads and shows a thumbnail strip.
- **Retagging a photo** (M5, with the album).
- **Sim clock and replay** (M4). Every new pure function takes `now` as an argument so M4 drives it.
- **Push notifications.** A pinned card and the header dot are the whole notification story.

## 2. Where the crawl is

M2 resolved the current stop from the clock over the locked itinerary's legs, with a Conductor
correction that wins while it is newer than the planned arrival the clock would pick. M3 keeps that
function, `currentStop()`, unchanged. What changes is where the correction comes from and what it
means.

### 2.1 The anchor

The newest `checkins` row written by an admin whose `stop` belongs to the locked itinerary is
**the anchor** (`checkins` has no itinerary of its own; the stop carries it): "the crawl
was at this stop as of this time". It is written only by the live editor's Save, so its `at` is the
save time.

The anchor does two jobs:

1. It is `currentStop()`'s override, exactly as in M2.
2. It is where **recompute starts**. `recomputeLegs` gains an optional
   `anchor: { stopId, atMin }`: legs before the anchor stop are computed as they are today, from
   `itineraries.start_time`; the anchor stop's arrival is `anchor.atMin` instead of the arrival its
   incoming leg would give, and everything after it flows from there.

Job 2 is what makes job 1 self-consistent. After a save, the planned arrival of the anchor stop *is*
the save time, so the clock and the correction agree, and the clock only moves the crawl on when the
recomputed — therefore true — arrival of the next stop passes. There is no drift for the override to
paper over, and no stale-correction problem for the rest of the day.

### 2.2 Missing a train

A missed train is not a special case and gets no button of its own. The Conductor opens the editor,
points at the stop the crew is actually in, picks a layover that reaches a train that still runs, and
saves. The board then counts down to that train, and every downstream time is honest because the
anchor moved the whole tail of the day.

Until they do that, the board behaves as M2 wrote it: past the departure it shows the `missed` state,
and `pickTrip` already counts down to the next train that has not left. The Conductor is fixing the
plan, not rescuing the banner.

### 2.3 The board is read-only

M2's "Not here? Set our stop" picker is removed from the Departure Board. Everything the Conductor
can change lives on one screen, which is the editor. The board displays; it never writes.

## 3. The live editor

`/plan/<id>/edit` on an itinerary whose `status` is `locked`, for an admin. Non-admins opening it are
redirected to the read-only route, as today.

### 3.1 Staged, not live

M1's editor writes every change straight to the database. On the locked route that is wrong: the
Crew's boards would follow the Conductor through every half-finished intermediate state, and the
Bulletin would have nothing coherent to describe. So the locked-route editor holds the whole change
client-side:

- a **position** picker — which stop the crew is in now;
- the existing stop controls — layover, order, add, remove;

and a single **Save** at the bottom. Nothing reaches the database until Save. A red bar across the
top says the route is live and the crew will see the change when it is saved.

Adding a stop leaves the editor for the venue picker, which would throw the staged change away with
the component, so the whole staged plan is written to `sessionStorage` before navigating and restored
on the way back. "Fix the layovers, then add a bar" has to work in that order; it is the ordinary
sequence, not an edge case. New stops are given a real PocketBase id when they are staged rather than
a placeholder, so the preview, the anchor and a retried save all refer to the same record.

### 3.2 Preview

Staged edits need leg times before they are written. `POST /api/plan/preview` (authenticated):

```
{ itinerary, anchor: { stopId, at }, stops: [{ id, order, station_id, dwell_min, walk_min }] }
  -> { legs: [{ fromStopId, toStopId, kind, readyAt, departAt, arriveAt, segments }] }
```

It loads the GTFS schedule and calls the same pure `recomputeLegs` the server uses on write, with the
same anchor, and writes nothing. Staged stops that do not exist yet carry a client-generated
temporary id, which the response echoes back. What the editor previews is what Save produces.

### 3.3 The cohesion gate

Save is disabled while the staged plan is incoherent, with the reason rendered next to the button —
never a silent disabled control. Incoherent means any of:

- a leg from the anchor onward is `impossible` (no train reaches the next stop in time);
- no position is set;
- the anchor stop is not in the staged plan (it was removed).

Legs *before* the anchor are history and are never a reason to block a save. The reason line names
the leg and the fix in the app's own vocabulary: "No train from Hinsdale to LaGrange after 21:14 —
annul LaGrange or shorten the layover here."

### 3.4 Save

`POST /api/plan/commit` (admin only), one request, in this order:

1. **Reconcile.** Load the itinerary's stops. Every submitted id and every id in `removed` must be a
   stop of *this* itinerary, and the persisted set minus `removed` must be exactly the submitted
   existing stops. Anything else means the route moved under the editor — `409 stale`, nothing
   written, reload and start again. Without this the next step would validate one plan and step 4
   would recompute a different one.
2. **Validate.** Plan the legs from the submitted stops with the anchor at the server's now, and run
   the cohesion gate. Incoherent means `409` with the blockers; nothing is written. The client's gate
   is a courtesy; this is the guard.
3. **Apply the stops.** Deletes, then updates, then creates. A new stop carries an id the editor
   generated, so every write in this step is idempotent: a delete of an already-deleted stop is
   success, an update is naturally repeatable, and a create that collides with its own id means the
   previous attempt got that far.
4. **Anchor.** Create the `checkins` row with `at` = the server's now. New stops already exist by
   then, so the crew can be standing in one this very commit created.
5. **Recompute** (`await recomputeItinerary(id)`) — anchored, so the legs match what step 2 validated.
   Its `impossible` count comes back in the response; it should always be zero, and if it is not, the
   editor says so rather than leaving a broken route looking saved.
6. **Bulletin**, if the Conductor kept one, created with an id the editor generated so a retry cannot
   say the same thing twice.
7. **Train Sheet**: `event_log { kind: 'plan_edit', payload: diff }`.

PocketBase has no cross-request transaction, so this is ordered rather than atomic. What makes it
safe is that every write is idempotent under the ids the editor generated: the same payload can be
sent again after any failure and converges on the same route, with no duplicate stop and no second
Bulletin. The `stops` after-write hook also fires its own recompute per write; the existing
per-itinerary queue in `recomputeItinerary` serialises them, and every run reads the same anchor, so
the extra passes cost a little time and converge on the same legs.

Failure is reported on the editor, which keeps the staged change so the Conductor can retry rather
than reconstruct it.

## 4. Bulletins

### 4.1 Drafting

Save opens a "Tell the crew?" sheet, pre-filled from the diff between the saved plan and the one that
was there. One line per change, in UI vocabulary, with the itinerary's `kind` taken from the most
significant change (`reroute` > `extra` > `annul` > `hold` > `message`):

- position moved: "We are still at The Hop Haus."
- layover changed: "Holding at The Hop Haus until the 20:44."
- stop removed: "LaGrange is annulled."
- stop added: "Extra stop: Prairie Path Tap, Wheaton."
- order changed: "Rerouted: Wheaton before Glen Ellyn."

The Conductor can edit the text, or skip sending it. Skipping still saves the plan and still writes
the Train Sheet entry; only the pinned card is skipped.

The Conductor can also write a plain Bulletin with no plan change, from the same sheet reached by a
menu item — that is `kind: message`.

### 4.2 Acknowledging

An unacknowledged Bulletin renders as a pinned card under the banner on every `(app)` screen, with a
**Got it** button that creates a `broadcast_acks` row. Only the newest unacknowledged Bulletin is
pinned; older ones live on the notifications screen, which already has the empty "Bulletins" section
waiting for them. The header dot counts unacknowledged Bulletins alongside unseen service alerts.

Acks are per user and unique per `(broadcast, user)`. They are the one thing the Crew Board shows
about each person's attention, and nothing in the app blocks on them.

## 5. The banner app-wide

The Departure Board moves out of `/live` and into `(app)/+layout.svelte`, rendered when a locked
itinerary's `event_date` is today in Chicago. Two shapes from one component:

- **compact** — one line, pinned at the top of every screen: current stop, the run, "departs in".
  Tapping it goes to `/live`.
- **full** — the M2 card with the ticket, walk line and alert bubbles, on `/live` only.

The layout owns the data (itinerary, stops, legs, anchor, trips, alerts, poll timer) and passes it
down, so there is exactly one poller and one subscription set for the whole app. `/live` becomes a
consumer of that context rather than the owner of it, and stays the day-of home: full board, pinned
Bulletin, Tab, Freight strip.

## 6. The Tab

A row of six buttons under the board on `/live`: beer, wine, cocktail, shot, water, food. A tap
creates a `drink_entries` row for the current stop with `at` = now; there is no quantity field and no
edit. An **Undo** button beside the row deletes your own most recent entry for this stop; it is a UI
affordance only, and the collection rule lets you delete any entry of your own at any time.

Each button shows the **crew total** for this stop, live over a `drink_entries` subscription, with
your own count in the corner. Totals are per stop and reset visually when the crawl moves on; the
day's totals are the M5 scoreboard's job.

With no current stop — before the crawl, after it, or with no locked route — the row renders disabled.

## 7. Freight

A camera button on `/live` opens the phone's camera or library: one `<input type="file"
accept="image/*,video/*" multiple>`, with no `capture` attribute, so the phone offers both rather
than forcing the camera.

- Images are compressed with `browser-image-compression` to 2000 px / 0.8 quality before upload.
  Videos are uploaded as they are and rejected client-side over 90 MB, with the Cloudflare limit
  named in the message.
- The upload creates a `media` row with `file`, `kind`, `taken_at` (the file's `lastModified`, else
  now) and the stop the client is currently showing.
- `media.pb.js`, after create, validates that `stop` belongs to the locked itinerary and sets
  `tagged_by: 'clock'`; a missing or foreign stop is cleared to null with `tagged_by: 'none'` rather
  than rejected, so a photo is never lost to a tagging disagreement.
- Under the board, a horizontal strip of this stop's photos (PocketBase `400x300` thumbnails), newest
  first, so people can see their shot landed. Tapping one opens the full image in a new tab; the
  lightbox is M5's.

Uploads show a progress row and a plain failure message with a retry. A failed upload is never
silently dropped.

## 8. Crew Board

`/crew`, from the menu, enabled at last. One row per user in `users`: name, their Tab for the day
(total drinks, not per stop), and whether they have acknowledged the current Bulletin. No location
column — nothing in M3 knows where an individual is, and a column of guesses would be a lie.

## 9. Offline

- `@vite-pwa/sveltekit` with `generateSW` precaches the app shell. `/api/metra/*` and PocketBase
  record reads are runtime-cached network-first with a 24 h fallback.
- `$lib/offline.ts` mirrors the locked itinerary, its stops and its legs into IndexedDB on every
  change that arrives over realtime. `/live` and `/route` read the mirror when the network fetch
  fails, and render a "showing the last known plan" notice with the mirror's timestamp.
- Writes are not queued. A drink tap, an ack or an upload with no signal fails with "no signal —
  try again in a minute". Queued writes would need dedupe and conflict rules for a bar basement, and
  photos are too big to hold anyway.

## 10. Data model

One migration, `1758700000_live.js`, four collections. Rules: A = admin, U = authenticated, O = owner.

| Collection | Fields | Rules |
|---|---|---|
| `broadcasts` | `itinerary` rel, `kind` enum reroute/hold/annul/extra/message, `body` text ≤ 500, `created_by` rel users | list/view U, create A, update/delete none |
| `broadcast_acks` | `broadcast` rel, `user` rel | list/view U, create O; unique (broadcast, user) |
| `drink_entries` | `user` rel, `stop` rel, `kind` enum beer/wine/cocktail/shot/water/food, `at` date | list/view U, create O, delete O |
| `media` | `user` rel, `file` file ≤ 90 MB (thumbs 400x300, 1200x0), `kind` enum image/video, `taken_at` date, `stop` rel nullable, `tagged_by` enum clock/manual/none | list/view U, create O, update A |

Indexes: `broadcast_acks (broadcast, user)` unique; `drink_entries (stop)`; `media (stop)`; `broadcasts (created)`.

No changes to `users`, `checkins`, `stops`, `legs` or `event_log`. New `event_log.kind` values —
`plan_edit`, `bulletin` — need no migration, the field is free text.

## 11. Failure behaviour

| What fails | What the user sees |
|---|---|
| Commit rejected as incoherent (409) | The reason on the editor; the staged change is kept. |
| Commit fails part-way | "That did not all land — try again", the staged change kept. Retrying the same save is safe: the ids the editor generated make every write idempotent. |
| Commit rejected as stale (409) | "The Route changed while you were editing. Reload and make the change again." The editor reloads rather than pretending it can merge. |
| Recompute comes back with an unrideable leg | The save stands (it is already written) and the editor says which leg broke, so the Conductor fixes it in a second pass rather than discovering it on the platform. |
| Recompute unreachable | The commit still returns; the hook's own recompute retries on the next write. Legs may lag the plan for seconds, which the board's `computed_at` already exposes. |
| Upload too large / rejected | Named message with the 90 MB limit and a retry. |
| No signal | The mirror renders with its age; writes say "no signal". |
| No locked itinerary, or the event is not today | No banner, no Tab, no Freight. `/live` points back at the plan, as it does today. |

## 12. Departures from the parent spec

1. **No per-crew Punch, no roster of positions, no straggler alert** (§1). The parent spec's `checkins`
   for all Crew becomes an admin-only anchor; `positions` is never created.
2. **Plan edits are a staged commit**, not "ordinary record writes on `stops`" (parent §7). The
   recompute path and `legs` cache are unchanged; only who writes them and when.
3. **Recompute gains an anchor** (§2.1). The parent spec always computes from `start_time`; M3 computes
   the tail of the day from where the crawl actually is.
4. **Media is tagged from the anchor**, not from the admin's GPS or a 15-minute position window
   (parent §8). `tagged_by` is `clock` / `manual` / `none`.
5. **Bulletins are drafted from the diff** rather than written from scratch (parent §7 implies a manual
   message).

## 13. Testing

- **Unit**: `recomputeLegs` with an anchor (tail moves, history untouched, anchor stop missing);
  the cohesion gate (each blocking reason, and that a pre-anchor impossible leg does not block);
  the diff → Bulletin text for every change kind and for a combined change; drink tallies; the
  IndexedDB mirror's read-through and staleness label; the compact/full board shapes.
- **Hooks** (`scripts/test-hooks.sh`): `broadcasts` create refused for non-admins; `broadcast_acks`
  unique per user and owner-only; `drink_entries` owner-only create and delete; `media` tagging —
  a valid stop keeps `tagged_by: clock`, a foreign stop is cleared to `none`.
- **E2E** (Playwright, mobile, fixture GTFS, MSW for `/api/metra/*`): the Conductor opens the locked
  route, moves the position, picks a layover reaching a real train, sees Save enabled only once the
  plan is coherent, saves, and confirms the Bulletin; a crew member's board re-points to the new
  train, the pinned Bulletin appears and clears on Got it; a drink tap raises the crew total; a
  fixture photo uploads and appears in the strip; offline, `/route` still renders from the mirror
  with its notice.

## 14. Done when

On the event day with a locked route: the banner is on every screen, the Conductor can move the crawl
and the plan together from one screen without ever saving something that cannot be ridden, the crew
sees the change within seconds and taps it away, the Tab and the camera work at the current stop, and
the route still reads in a tunnel. `cd web && npm test && npm run check && npm run test:e2e` and
`bash scripts/test-hooks.sh` all green.
