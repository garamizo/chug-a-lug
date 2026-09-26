# Route ownership, chat box and UI polish — design

Date: 2026-09-25 · Branch: `feat/ui-polish` · Status: proposed

## Why

The planner treats every draft as shared scratch space: any crew member can add, move or remove
stops on anyone's draft, and nobody can clean up a locked or archived route. The home screen shows
a role label ("Conductor"/"Crew") nobody needs, spaces its links far apart, and the planner and
route detail screens are plain lists. Chat is three different composers (Live crew chat, Live photo
buttons, planner comments) with text buttons.

Success means:

1. A route belongs to its builder. The builder and the Conductor can edit and delete it; nobody
   else can change it. The server enforces this, not just the UI.
2. Home, the planner list and route detail share one train-station visual language (gold ticket,
   departure board, Metra-green line) and fit more on a phone screen.
3. Common operations (delete, edit, add, move, send, attach) are icon buttons.
4. There is one WhatsApp-style chat box, at the bottom of Live and of the planner pages, that
   sends text, emoji, photos and videos.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Can other crew still add stops to someone else's draft? | **No.** Only the builder and the Conductor. |
| Home layout | Gold **ticket** for the current route + **departure board** for the other destinations. |
| Planner list layout | **Departure board**, one row per route, with the builder's name. |
| Route detail layout | **One scroll** (not tabs). |
| Outbound/return map | **Unfold the line**: outbound stations top-down, then "turn around", then every station again bottom-up. The two-pane swipe goes away. |
| Chat | One WhatsApp-style box (emoji, attach, camera, send icon) at the **bottom of the page**, not a separate screen. |
| Photos in planner chat | **Yes**: planner comments may carry a photo or video. |

Assumptions (stated to the user, not objected to): editing a *locked* route stays Conductor-only,
its builder included; the Conductor may delete locked and archived routes, with a warning that
names what goes with it.

## 1. Permissions

### Rules

| Action | Builder (own route) | Conductor (any) | Other crew |
|---|---|---|---|
| Create/update/delete stops on a draft | yes | yes | **no** (was yes) |
| Change title/event_date/start_time on a draft | yes | yes | no (unchanged) |
| Edit a locked route (staged editor, `POST /api/plan/commit`) | no | yes | no (unchanged) |
| Delete a draft | yes | yes | no (unchanged) |
| Delete a locked or archived route | no | **yes** (was no) | no |
| Cheer, comment, approval vote | yes | yes | yes (unchanged) |

"Conductor" is `users.is_admin = true`; superusers are treated as admin, as in
`pocketbase/pb_hooks/planning.pb.js`.

### Migration `pocketbase/pb_migrations/1758860000_route_ownership.js`

- `stops.createRule/updateRule/deleteRule`: from
  `U && (itinerary.status = 'draft' || ADMIN)` (`1758400000_planning.js:37-39`) to
  `U && ((itinerary.status = 'draft' && itinerary.created_by = @request.auth.id) || ADMIN)`.
  The same expression serves all three rules: today's `createRule` already traverses
  `itinerary.status` on create, so `itinerary.created_by` resolves the same way. An update must
  not move a stop to another route: `updateRule` also requires `@request.body.itinerary:isset = false`.
- `itineraries.deleteRule`: from `U && status = 'draft' && (created_by = auth || ADMIN)` to
  `U && ((status = 'draft' && created_by = @request.auth.id) || ADMIN)`.
- Down migration restores both previous rules verbatim.

### Privileged write paths

Collection rules only guard direct PocketBase writes. Every SvelteKit endpoint that writes stops
as the superuser (`adminPb()`) must apply the same ownership check itself:

- `POST /api/places/attach` (`web/src/lib/server/places/attach.ts`): today `AttachCaller` is
  `{ is_admin }` and a non-admin is only checked for `status === 'draft'` (`attach.ts:52-56`).
  `AttachCaller` becomes `{ id, is_admin }` (the route handler passes `locals` user's id), and a
  non-admin must also be the itinerary's `created_by`. The check runs **before** any Google call
  or write, so a refused request spends no Places budget and leaves `photos_status` untouched.
- `POST /api/plan/preview` only reads; `POST /api/plan/commit` and `lib/server/recompute.ts` are
  already admin- or hook-only. The implementation plan re-audits `grep adminPb` for any other
  stop or itinerary write before landing.

### Deleting a locked route

PocketBase cascades the delete (`cascadeDelete: true`) to stops, legs, broadcasts, crew chat
(`1758840000_crew_chat.js`), approval votes and, through stops, to check-ins and drink entries.
`media.stop` is `cascadeDelete: false`, so photos survive with a cleared stop. `votes` and
`comments` point at their target by text (`target_collection`/`target_id`), so nothing cascades to
them. Cleanup and validation both run in model hooks, which execute inside the write's own
transaction (SQLite serialises writers), so a comment cannot slip in between a check and a delete:

- `onRecordDelete` on `itineraries` (before `e.next()`) deletes the votes and comments whose target
  is the route or one of its stops, then lets the cascade run.
- `onRecordDelete` on `stops` does the same for comments and votes on that stop, so removing a
  single stop from a draft cleans up too.
- `onRecordCreate` on `comments` and `votes` (not the request hook) rejects a target that does not
  exist in `target_collection` (only `itineraries` and `stops` are accepted). An upload that
  finishes after the route is gone therefore fails with 400, and its file is never stored.
- `comments.updateRule` and `votes.updateRule` add `@request.body.target_collection:isset = false
  && @request.body.target_id:isset = false`, so a target can never be changed after creation.
`crawl_settings.current_itinerary` is optional and non-cascading: PocketBase clears it and the
client/hook fallback (`$lib/live/route.ts`, `pb_hooks/current.js`) picks the newest locked route.

- The confirm for a draft stays short (`deleteDraftConfirm`).
- The confirm for a locked or archived route is a new, explicit string: it deletes the route and
  its chat, check-ins, Tab and Bulletins, and if it is the current route Live moves to the next
  newest locked route.
- Deleting the current route **on its event day** is allowed but the confirm says so first
  ("The crew is riding this route today").
- After a delete the client navigates to `/plan`; `liveDay` reloads through its existing
  `crawl_settings`/`itineraries` subscriptions.
- **Offline mirror.** Today `liveDay.loadRoute()` (`web/src/lib/live/day.svelte.ts`) clears its
  in-memory route when `readRoute()` returns null but leaves the IndexedDB mirror, so a later
  offline reload would resurrect a deleted last route through `readMirror()`. New
  `clearMirror(readStartedAt: Date)` in `web/src/lib/offline.ts` deletes the stored mirror in one
  readwrite transaction **only if** its `savedAt` is older than the authoritative read that
  returned no route; a save that raced in afterwards survives. `loadRoute()` calls it on the
  null-read branch. When the current route is deleted but another locked route exists, the
  existing path already overwrites the mirror with the fallback route. The same fix covers a
  route being unlocked back to draft, which has the same gap today.

### Client gates

A single helper in `web/src/lib/permissions.ts`, unit-tested and used by every screen:

```ts
canEditStops(it, user)   // (it.status === 'draft' && it.created_by === user.id) || user.is_admin
canEditSettings(it, user) // same as canEditStops today
canDelete(it, user)      // (it.status === 'draft' && it.created_by === user.id) || user.is_admin
```

They replace the ad-hoc `editable`/`canEdit`/`canManage` expressions in
`routes/(app)/plan/[id]/+page.svelte` and `routes/(app)/plan/[id]/edit/+page.svelte`. The edit
screen's redirect (`if (draft && !editable) goto(...)`) keeps working off the new helper.
`labels.ts` `plannerIntro` changes to say the builder edits their own route and the Conductor can
edit any.

## 2. Icons

- New `web/src/lib/components/IconButton.svelte`, a `<button>` twin of `IconLink.svelte`: same
  44 px circle, same stroke SVG style, `label` becomes `aria-label` + `title`, optional `tone`
  (`danger` for delete).
- Shared icon set in one place (`web/src/lib/icons.ts`, SVG path data): `back`, `edit`, `delete`
  (trash), `add` (+), `up`, `down`, `send` (paper plane), `attach` (paperclip), `camera`,
  `emoji` (smiley), `keyboard`. `IconLink` reads from the same set.
- Used for: delete route (planner row, detail top bar, edit screen), remove stop (replaces `×` in
  `StopRow.svelte`), move stop up/down (replace the `↑`/`↓` glyphs), add stop (no-map fallback in
  `ItineraryView.svelte`), the "new route" submit, and every chat box control.
- Actions whose words matter stay text buttons: Lock the route, Open/Close vote, Make current,
  Save, Go / No-go.
- Existing `data-testid`s are kept on the new buttons so e2e selectors stay stable.

## 3. Chat box

### Component

`web/src/lib/components/ChatBox.svelte` — the only composer in the app.

- Layout: a rounded field containing an emoji toggle (left), the text input, attach and camera
  icons (right); outside it a round primary button.
- The round button is **camera** while the field is empty (and media is allowed), **send** once
  there is text. Enter sends. Without media support it is always send.
- Emoji toggle opens a tray of 16 fixed crawl emojis (`🍻 🍺 🥂 🍕 🚆 🎅 🎄 🔥 😂 🙌 👍 ❤️ 🥴 🤮 ⏰ 📍`,
  kept in `labels.ts` as data); tapping inserts at the caret; the toggle icon becomes a keyboard
  while the tray is open. No emoji library.
- Attach opens a hidden `<input type="file" accept="image/*,video/*" multiple>`; camera a hidden
  `<input type="file" accept="image/*" capture="environment">`.
- Props: `onsend(text): Promise<void>`, `onfiles?(files: File[]): Promise<void>` (absent → no
  attach/camera), `busy`, `disabledMedia?: string` (reason shown as the icons' title when media
  is off), `maxlength`, `placeholder`, `testid` prefix.
- Sticky to the bottom of the page with the existing TabBar/practice-banner clearance rules moved
  from `CrewChat.svelte`'s `.composer` styles.
- Keeps the `chat-input`/`chat-send` test ids on Live and `comment-input`/`comment-post` on the
  planner.

### Live (`routes/(app)/live/+page.svelte`)

- `CrewChat` stays last on the page and uses `ChatBox` in place of its form.
- The `.photo-action` block (📸 Photo button, hidden `freight-input`, Take-photo label) is
  removed; the Bulletin action remains in `.actions`.
- `FreightStrip` loses its picker (the `showPicker` branch and the prop) and stays a thumbnail
  strip.
- `ChatBox.onfiles` calls the page's existing `upload()` (the `prepare`/`uploadBatch` pipeline),
  which still tags media to the current Tab stop; with no Tab stop `disabledMedia` is set, same as
  today's `disabled={!tabStop}`. Uploaded media already appear in the chat as photo entries.

### Planner (route detail and single stop)

- `Comments.svelte` becomes a bubble log with the Live look: own messages right-aligned, others
  left with a coloured name (`nameColour` reused from `CrewChat`), timestamps inside the bubble,
  photos as thumbnails that open the existing `Lightbox`.
- Delete moves from the underlined "Delete" link to the long-press/right-click menu used by
  `CrewChat`. The hold/menu logic is extracted into a small shared module so both use it.
- `Comments` renders `ChatBox` with `onfiles` enabled, sticky at the bottom of
  `routes/(app)/plan/[id]/+page.svelte` and `routes/(app)/plan/[id]/stops/[stopId]/+page.svelte`,
  which both keep it as their last section.

### Migration `pocketbase/pb_migrations/1758860001_comment_media.js`

- `comments.body`: `required: false` (keep `max: 1000`).
- `comments.file`: new `file` field, `maxSelect: 1`, same `maxSize` and `thumbs` as `media.file`,
  MIME types limited to image/* and video/*.
- Hook (`pb_hooks/planning.pb.js`, the `onRecordCreate` model hook for `comments` described under
  "Deleting a locked route"): reject when the body is blank and there is no file, and when the
  target does not exist.
- Upload from the planner reuses `prepare()` from `$lib/live/upload` for image downscaling; a
  multi-file pick creates one comment per file.
- Down migration removes `file` and restores `body.required = true` (rows with no body are
  deleted first, since they would violate it).

## 4. Home (`routes/(app)/+page.svelte`)

- Heading: "Welcome aboard," + the user's name. The `data-testid="role"` line is removed.
- **Ticket** (`web/src/lib/components/Ticket.svelte`): gold, with perforation notches and a
  dashed tear line. Shows `liveDay.itinerary` title, `fmtDate(event_date)` and `start_time`, and
  a countdown in whole Chicago days (`todayInTz` vs `event_date`; "Today" on the day, hidden
  after). Links to `/route` (`data-testid="nav-route"`). With no route: "No route yet" and a
  hint to vote in the planner, linking to `/plan`.
- **Departure board** (`web/src/lib/components/Board.svelte` + `BoardRow.svelte`): header row
  "DESTINATION / STATUS", then:
  - Planner (`nav-plan`): subtitle "N drafts · vote open" (the vote part only when some draft has
    `vote_open`); status chip `BOARDING`.
  - Live (`nav-live` when `liveDay.hasRoute`): subtitle `liveHint`; chip `PRACTICE` when a route
    exists and today is not its event date, `TODAY` on the event date (home redirects to Live
    then, so it shows only for an instant); without a route, not a link and chip `SOON`.
  - Wrap-up: not a link, chip `SOON`.
- Draft count: one `getList(1, 1, { filter: "status = 'draft'" })` for `totalItems`, plus one
  for `vote_open = true`, loaded on mount and refreshed by the existing `itineraries`
  subscription helper.
- The event-day redirect to `/live` is unchanged. "Not you? Log out" stays as a small footer.
- Chip text, the pure mapping from state to chip, lives in `web/src/lib/home.ts` and is
  unit-tested.

## 5. Planner list (`routes/(app)/plan/+page.svelte`)

- Title and a one-line intro, then the new-route bar: an input and a round **add** icon button
  (`create-draft`, `draft-title` test ids kept).
- One `Board` listing every route, newest first, drafts before the rest. Each row:
  - Monospace title (links to `/plan/{id}` for drafts and archived, `/route` for the current
    locked route, `/plan/{id}` for other locked routes).
  - Subtitle: `by <builder name> · N stops · 🍻 N`.
  - Status chip: `DRAFT` (green), `VOTE OPEN`, `LOCKED`, `CURRENT` (gold), `ARCHIVED` (grey).
  - Edit and delete icon buttons when `canEditSettings` / `canDelete` allow.
- Data: `getFullList('itineraries', { sort: '-created', expand: 'created_by' })`; stop counts from
  one `getFullList('stops', { fields: 'itinerary' })`; cheers from one
  `getFullList('votes', { filter: "target_collection = 'itineraries' && value = 'up'", fields: 'target_id' })`.
  Counting is a pure function in `web/src/lib/planList.ts`, unit-tested.

## 6. Route detail (`ItineraryView` and its three hosts)

### Header and actions

- Top bar: back icon left; edit and delete icon buttons right, per the permission helpers (on
  `/plan/[id]`), or none (on `/route`).
- Board-style header: kind label (`DRAFT ROUTE` / `THE ROUTE` / `ARCHIVED`), monospace title,
  chips (`by <builder>`, date, `vote open` when set), and three stats: stops, start time, and
  finish (the last stop's `leaveAt`). The start-time control for the builder stays in the header
  when `actions.setStartTime` is present.
- Cheers: the two `Votes` buttons become pills under the header.
- `ApprovalPanel`: Go / No-go become large side-by-side buttons (green / outlined red) with the
  tally under them; the Conductor's Open/Close vote and Lock stay text buttons.
- Chat (`Comments` with `ChatBox`) last.

### Unfolded line

Replaces the two-pane swipe in `LineMap.svelte` / `ItineraryView.svelte`.

- `ItineraryView` renders the line twice with the same `LineMap` (no `panes`):
  1. **Outbound** section header, stations top to bottom, cells carrying stops whose
     `placement.side[i] === 'left'`.
  2. A "turn around" divider.
  3. **Way back** section header, the station list **reversed**, cells carrying stops whose side
     is `'right'`.
  Every station is labelled in both sections. Unserved stations keep their muted style and
  "no trains" note.
- `LineMap` keeps its API but only one cell column is used; the `panes` prop, the snapping
  viewport, `focusSide` and `onside` are removed, as are the Inbound/Outbound tab buttons and the
  `focused` state in `ItineraryView`.
- `placeStops` and `insertionIndex` in `web/src/lib/lineMap.ts` are unchanged; a new pure helper
  `unfold(placement, stations)` returns `{ out: Row[], back: Row[] }` so the ordering is
  unit-tested without the DOM.
- Picking a station on the outbound line calls `actions.add(id, 'left')`; on the way back,
  `actions.add(id, 'right')` — the same side values the add screen already maps to
  `direction: 'out' | 'back'`.
- Stop cards: gold numbered badge centred on the line, photo, name, arrive–leave, station; the
  leg to the next stop renders under the card in Metra green (`LegRow` restyled, same content).
- The scroll restore after adding a stop (`rememberScroll`) is unchanged.
- The same view serves `/plan/[id]`, `/plan/[id]/edit` (draft and live staged editor) and
  `/route`, so all three get the unfolded line. The staged editor's "crew is here" button keeps
  rendering under each card.

## 7. Visual system

- Shared CSS custom properties on `:root` in `routes/+layout.svelte`: `--gold #ffb400`,
  `--gold-soft #ffce5c`, `--gold-deep #6b4c10`, `--metra #29C233`, `--board-bg #0b0b0b`,
  `--danger #ff8a80`; existing hard-coded colours touched by this work move to them.
- Board text uses a monospace stack (`ui-monospace, SFMono-Regular, Menlo, monospace`).
- A split-flap "flip in" on board titles on first render (CSS only, ~300 ms, staggered per row),
  disabled under `prefers-reduced-motion: reduce`.
- Every new user-visible string goes in `web/src/lib/labels.ts`; the README UI glossary is
  updated for any renamed element (the chat box, the ticket, the board).

## 8. Out of scope

- Transferring ownership of a route, co-builders, or per-route invitations.
- Undo for deletes.
- A full emoji picker, message editing, replies or read receipts.
- Changing the Live Departure Board, TabRow, Leaderboard or StopSheet layouts beyond removing the
  photo buttons.

## 9. Testing

Tests are written before the code they cover; each task ends with
`cd web && npm test && npm run check && npm run test:e2e` and `bash scripts/test-hooks.sh` green.

- **Hook tests** (`web/tests/hooks/planning.test.ts`, new `comments` cases):
  - another crew member cannot create, update or delete stops on someone else's draft (list rules
    filter; create/update/delete must fail);
  - the builder still can; the Conductor can on any draft and any locked route;
  - the builder cannot delete their locked route; the Conductor can delete a locked and an
    archived route, `crawl_settings.current_itinerary` is cleared afterwards, and the route's
    votes and comments (and its stops' comments) are gone;
  - a comment with neither body nor file is rejected; body-only and file-only are accepted;
  - a comment or vote targeting a deleted route or stop is rejected (400), with and without a
    file; changing a comment's or vote's target on update is refused; deleting a single draft
    stop removes its comments and votes.
- **Server unit tests** (`web/tests/unit/attach.test.ts`): a non-owner crew member's attach on
  someone else's draft is refused with 403 before any Google fetch or stop write (the fetch and
  PocketBase mocks record no calls); the builder and the Conductor still attach.
- **Offline unit tests** (`web/tests/unit/offlineDay.test.ts`/`offline.test.ts`): deleting the
  last locked route clears the mirror, and a subsequent offline load finds no route;
  `clearMirror` leaves a mirror saved after the read began.
- **Unit tests**: `permissions.ts`, `home.ts` chip mapping and countdown (Chicago dates),
  `planList.ts` counts, `lineMap.ts` `unfold()` ordering (outbound top-down, return bottom-up,
  every station twice, off-line stops untouched), `labels.test.ts` for new keys.
- **e2e**:
  - planning: builder deletes a draft via the trash icon; another crew member sees no edit/delete
    icons and no add-stop affordance on someone else's draft; the Conductor deletes a locked
    route after the stronger confirm;
  - unfolded line: tapping a station on the way back creates a `direction: 'back'` stop that
    renders in the way-back section;
  - chat box: send text with Enter and with the send icon, emoji tray inserts, photo from the
    planner comment appears as a thumbnail, Live photo upload still lands in the Freight strip
    and the crew chat;
  - home: no role text; ticket shows the current route; board rows link correctly.
- Existing e2e specs that have one crew member add stops to another's draft are rewritten to act
  as the builder or the Conductor. Specs that use the removed `side-left`/`side-right` tabs or
  the old `freight-input` location move to the new controls.
