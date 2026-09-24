# Live UX batch: stop sheet, route strip, tab bar, lightbox, one-tap Tab, crew chat, leaderboard

Status: design approved in conversation 2026-09-23. Branch `feat/live-ux`.

## Why

Live is the screen the crew stares at all day, and today it keeps sending people away from it:

- Every stop link on Live (`routes/(app)/live/+page.svelte`, current stop and "Still to come") goes to
  the planning page `/plan/<id>/stops/<id>`, which carries edit fields, votes and a "Back to draft" link.
  The Departure Board disappears until the person finds their way back.
- On the real event day (`REHEARSAL=0`) the home page shows Live as "Coming soon": the link at
  `routes/(app)/+page.svelte:22` is gated on `clientClock.enabled`, not on the event date. The only way
  in is the compact banner.
- Logging a drink is three taps (open the dialog, tap, close) with no feedback and no visible count.
- Freight thumbnails open the raw file in a new browser tab.
- Crew Board and Notifications hard-code "Back to Live".
- The chat is read-only for the crew: Tab activity plus Conductor Bulletins.

## Scope

In: items 1, 2, 3, 5, 6, 9, 10 of the proposal: stop sheet, route strip, event-day tab bar with
auto-landing, photo lightbox, one-tap Tab, crew chat with messages/reactions/milestones/photos,
mini-leaderboard.

Out: Departure Board animation and alert sounds (item 7), arrival punch (8), wake lock (4), pre-event
checklist (11), push notifications, Closing Time album. The planning stop page is unchanged and remains
the only place a stop's details are edited.

## Live layout

Top to bottom on the event day:

```
┌ route strip: ✓──✓──🚂──○──○ ┐
│ Departure Board (ticket)     │
│ Two Brothers  ⓘ              │   ← opens the stop sheet
├─ Tab · you: 3 ──────────────┤
│ 🥃  🍸  🍺  💧  🍔             │   ← one tap each
│ [📸 Photo]   [📣 Bulletin]    │
├─ 🏆 Ana 5 · Ben 4 · you 3 → ┤   ← Crew Board
├─ Crew chat ─────────────────┤
│ Ana 🍺 beer · Two Bros  🍻2  │
│ [ message…            ][↑]  │
└─[Live][Route][Crew][Menu]───┘
```

The Tab dialog, the cup button and the "Still to come" list are removed.

## Section 1: getting around

### 1. Stop sheet

`lib/components/StopSheet.svelte`, a bottom-sheet `<dialog>`.

- **Opening** uses SvelteKit shallow routing: `pushState('', { sheet: { stop: id } })`, with the URL
  `/live?stop=<id>`. Back closes the sheet, Live stays mounted underneath (the board keeps counting,
  polling continues), and a cold load of `/live?stop=<id>` opens it directly. Chosen over a component-
  local flag (back would leave Live) and a child route (the board would unmount).
- **Content:** name, kind, station, walk minutes; Saturday hours line emphasised with the other days
  behind a disclosure; "confirmed open" badge; notes read-only; Google photos plus Freight from that
  stop, both opening the lightbox.
- **Actions:** "Walk there" → Google Maps directions URL with `travelmode=walking` and the place id when
  known; "Call" → `tel:` only when a phone is present. Conductor sees "Edit details" linking to the
  planning page.
- **Paging:** swipe left/right or arrow buttons move to the previous/next stop in route order, replacing
  (not pushing) the history state so back still closes the sheet in one step.
- **Data:** stops come from `liveDay.stops`; the `places` record is fetched once per opened stop
  (`expand: 'place'`) and mirrored into the IndexedDB offline store alongside stops. Offline without a
  mirrored place, the sheet shows the stop fields it has and hides the gallery. The sheet writes
  nothing. Website links keep the existing `^https?://` guard.
- Also opened from The Route page's stop rows on the event day.

### 2. Route strip

`lib/components/RouteStrip.svelte`, with the classification in a pure `lib/live/strip.ts`:
`stripStops(stops, here) → { stop, state: 'done' | 'current' | 'next', arriveAt }[]`. Before the crawl
nothing is done and the first stop is `next`; after it every stop is done. Horizontally scrollable,
the current stop scrolled into view on mount and on change. Tapping a dot opens the stop sheet.

### 3. Tab bar and landing

`lib/components/TabBar.svelte`, fixed to the bottom of `(app)/+layout.svelte`: Live · Route · Crew ·
Menu (Menu opens the existing `AppMenu`). Page content gets bottom padding equal to the bar plus
`env(safe-area-inset-bottom)`.

- Shown when `liveDay.isToday` (the locked route's date equals Chicago's today, or Railroad Time's
  date in a rehearsal). This is the same gate Live already uses.
- On those days `/` redirects to `/live` (`goto(..., { replaceState: true })`) once `liveDay` has
  resolved the route, so a slow load never bounces a planner.
- The home page's Live entry is gated on `liveDay.isToday` instead of `clientClock.enabled`, fixing
  the event-day bug above. Off-day behaviour is unchanged.
- The "Back to Live" links on Crew Board and Notifications are hidden while the tab bar is shown.

### 5. Lightbox

`lib/components/Lightbox.svelte`: full-screen, swipe between items, native pinch zoom, `<video
controls playsinline>` for videos, a download link for the original. Opened with shallow routing
(`{ lightbox: { items, index } }`) so back closes it. Used by FreightStrip, the stop sheet gallery and
chat photo entries.

## Section 2: more fun

### Shared live feed (refactor)

`CrewChat` loads route-wide drinks and Bulletins on its own; `liveDay.loadDrinks`/`loadMedia` load only
the current stop; the Crew Board loads every drink separately. The chat, milestones, leaderboard and
Tab counter need the same route-wide rows, so `liveDay` gains a `feed` owned by the existing single
poller and realtime subscriptions:

`feed = { drinks, media, messages, reactions, users }`, all filtered to the locked itinerary
(`stop.itinerary = id` / `itinerary = id`), reloaded on realtime events for those collections, on the
existing 30 s timer and on `online`. The existing per-stop `drinks`/`media` become derived from the
feed. `CrewChat` stops fetching and reads `liveDay.feed`. Load failures keep the last good feed and
set the existing chat error line.

### 6. One-tap Tab

The `TabRow` grid moves onto Live under the board with header "Tab · you: N", where N is the person's
day total across all stops (`crewScore` total for today).

- **Tap:** optimistic +1 on that button and the header, clink animation (CSS, `prefers-reduced-motion`
  respected), `navigator.vibrate?.(30)`, then `drink_entries.create` as today (event-time check
  included). On success a toast "+1 🍺 · Undo" shows for ~4 s; Undo deletes that entry. On failure the
  optimistic bump reverts and `copy.noSignal` shows. Each tap is a separate entry; no debounce.
- **Closed:** when `tabStop` is null (before/after the crawl, source neither `clock` nor `override`)
  the row is disabled with `copy.tabClosed`.
- Photo and Bulletin become a smaller two-button row beneath it; their behaviour is unchanged.

### 9. Crew chat

**New collections** (one migration, `pb_migrations/<ts>_crew_chat.js`, rules in the same style as
`1758700000_live.js`):

| Collection | Fields | Rules |
|---|---|---|
| `chat_messages` | `itinerary` (relation), `user` (relation), `body` (text, required, max 280), `at` (date) | list/view: signed in. create: signed in and `@request.body.user = @request.auth.id`. delete: own. update: none. |
| `reactions` | `user` (relation), `target_kind` (select: drink, bulletin, message, media), `target_id` (text), `itinerary` (relation) | list/view: signed in. create: own user. delete: own. update: none. Unique index on `(user, target_kind, target_id)`. |

A hook on `chat_messages` create sets `user` to the signed-in person (as `broadcasts` does for
`created_by`) and stamps `at` from `clock.js` `eventNow`, so rehearsals order messages on Railroad Time.
Messages are not written to the event log.

**Chat UI** (`CrewChat.svelte`):

- Entries: drinks, Bulletins, messages, photos and milestones, merged by `chatEntries` (extended), oldest
  first, the latest 40 shown with "Show earlier" to reveal more.
- Composer at the bottom: text input (maxlength 280) and send. On failure the text stays in the box and
  `copy.noSignal` shows. Writes are not queued.
- 🍻 on drink, Bulletin, message and photo entries, labelled "Cheers", with a count. Tapping toggles
  your own reaction (create, or delete your row). A duplicate-create error from the unique index is
  treated as already reacted and triggers a reload.
- Your own messages have a delete action.
- Photo entries show a thumbnail and open the lightbox.
- Only Conductor Bulletins are pinned; messages never are.

**Milestones:** pure `lib/live/milestones.ts`, `milestones(drinks, media, users, stops) → ChatEntry[]`,
recomputed from the feed, never stored:

- Crew alcoholic total (shot + cocktail + beer) reaching 10, 25, 50, 100.
- First of each drink kind of the day.
- "X took the lead": whenever the leader by `crewScore`/`compareScores` changes to a different person,
  replayed in entry order. Ties do not change the leader.
- First photo at each stop.

Each milestone takes the `at` of the entry that triggered it and a deterministic id
(`milestone:<rule>:<value>`), so every phone shows the same list. Undoing the triggering entry removes
the milestone. Milestones cannot be reacted to.

### 10. Mini-leaderboard

`lib/live/leaderboard.ts`, `topLine(drinks, users, me, date) → { name, total }[]`: the top three by the
Crew Board's ranking plus the viewer if not among them. Rendered as one tappable line linking to
`/crew`. Hidden when nobody has logged anything.

## Labels

All new strings go in `web/src/lib/labels.ts`. 🍻 is labelled "Cheers", matching the glossary's
like/Cheers. The README UI glossary gains two plain rows: chat message → **Message**, and computed
chat milestone → **Milestone**. The README's Phase 2 section is updated to describe the new Live layout.

## Testing

Tests first, per repo convention; every task ends green with
`cd web && npm test && npm run check && npm run test:e2e` and `bash scripts/test-hooks.sh`.

- **Unit:** `stripStops` (before, during, after, override), Saturday-hours selection, `milestones`
  (thresholds, first-of-kind, lead changes and ties, undo removes, determinism), `topLine` (viewer in
  and out of top three, empty), `chatEntries` merge order with the new kinds, optimistic Tab
  bump/rollback.
- **Hooks:** `chat_messages` rejects posting as someone else and stamps event time; `reactions` rejects
  a second reaction by the same person to the same entry and deleting someone else's. List rules filter
  rather than reject, so assert on empty pages, not status codes.
- **E2E:** stop sheet opens from the strip and the board, back closes it and Live is still there;
  "Walk there" URL; tab bar only on the event day; `/` redirects on the event day and not off-day;
  home page Live link on the event day with the simulation off; lightbox open/back; one-tap drink with
  toast Undo; message send; reaction toggle across two sessions; a milestone appearing after the 10th
  drink; leaderboard line links to Crew Board.

## Risks

- Shallow routing state is lost on a hard reload; the `?stop=` query covers the sheet, and the lightbox
  simply closes. Acceptable.
- Moving drinks and media loading into the feed touches the live polling code the Tab and Freight
  depend on; the per-stop derivations keep their existing tests as the regression net.
- Route-wide feed size: about 10 people, one day. A few hundred rows; no paging needed server-side.
