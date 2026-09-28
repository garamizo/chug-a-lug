# Venue groups, cloning a route, and rename notes — design

Date: 2026-09-27 · Branch: `feat/clone-route`

## Why

1. **The venue picker buries bars.** "Nearby" on `plan/[id]/add` is one list ranked by rating
   (`rankNearby`, `web/src/lib/server/places/rank.ts`), and Google returns about as many
   restaurants as bars (`NEARBY_GROUPS`, `google.ts`), so the bars the crawl is for sink under
   restaurants.
2. **There is no way to build on someone else's route.** A crew member who likes a route but wants
   to change it has to start from scratch, because only the builder (while it is a draft) or the
   Conductor can edit it (`1758860000_route_ownership.js`).
3. **Clones must stay traceable.** When a route is cloned, both routes say so in their planner chat,
   and every later rename is also recorded there, so "Copy of Loop Crawl" renamed to
   "Southside Loop" can still be traced back to its original. No other change posts a note.

## Decisions (agreed in brainstorming)

- Any signed-in user can clone any route: draft, locked or archived.
- In the picker, Nearby shows three collapsible sections: **Bars** (open), **Restaurants** and
  **Places** (both collapsed). Each header shows a count. Search results stay a flat list.
- Renaming follows the settings rules: the builder can rename their draft, and the Conductor can
  rename any route. **A locked route can be renamed only by the admin**, and on a locked route the
  rename is staged and saved through `POST /api/plan/commit` with the rest of the edit.
- The notes are **structured comments** written only by the server, rendered from `labels.ts`.
  They are not plain-text comments posted in the user's name.

## 1. Venue picker groups

- Add a pure helper `groupByKind(venues: Venue[])` in `web/src/lib/venueGroups.ts`. It returns
  `[{ kind: 'bar' | 'restaurant' | 'other', venues }]` in the fixed order bar, restaurant, other.
  - It leaves out empty groups.
  - It keeps the input order inside each group, which is `rankNearby`'s order: rating, then rating
    count, then distance.
- `plan/[id]/add/+page.svelte` renders Nearby as one `<details>` per group.
  - The `<summary>` reads `copy.venueGroup_<kind>` followed by the count, e.g. "Restaurants (14)".
  - `open` is set on the `bar` group only.
  - Test ids: `venue-group-bar|restaurant|other`.
  - The row markup (`tid(v)`, the `openVenue` flow, `VenueSheet`) is unchanged, so existing e2e
    selectors still resolve once the group is open.
- `openVenueObj` still looks up the venue across all of `nearby`. Collapsing a group does not
  unmount or change the sheet.
- The attribution line stays below the three groups. Search by name and Manual add are unchanged.
- New labels: `venueGroup_bar` "Bars", `venueGroup_restaurant` "Restaurants",
  `venueGroup_other` "Places". Add them to the README glossary.

## 2. Notes in the planner chat (`comments`)

**Migration `1758890000_comment_notes.js`** adds two fields to `comments`:

- `kind`: a select with values `cloned_from | cloned_to | renamed`, not required. Empty means an
  ordinary comment.
- `meta`: JSON. The shapes are:
  - `cloned_from`: `{ route, title }`, the original route.
  - `cloned_to`: `{ route, title }`, the clone.
  - `renamed`: `{ from, to }`.

It also tightens the rules:

- `createRule`: add `&& @request.body.kind:isset = false && @request.body.meta:isset = false`.
  Only the server, as superuser or inside hooks, writes notes.
- `updateRule`: add `&& kind = '' && @request.body.kind:isset = false && @request.body.meta:isset = false`.
  Nobody can edit a note, and nobody can turn an ordinary comment into one by PATCHing
  `kind`/`meta` onto it.
- `deleteRule`: `(user = auth && kind = '') || admin`. The actor cannot delete their own note, so
  the trail survives. The Conductor can still clean up.
- The down migration restores the previous rules and removes the fields.

**`targets.pb.js`:**

- The "Write something or attach a photo" check skips records whose `kind` is set.
- The target-exists check still applies to notes.
- The update check is unaffected, because notes cannot be updated.

**`Comments.svelte`:**

- A comment with a `kind` renders as a centred, muted system line instead of a bubble, e.g.
  "Ana cloned this route as *Copy of Loop Crawl*".
  - The wording comes from `copy.noteClonedFrom`, `copy.noteClonedTo` and `copy.noteRenamed`, as
    functions of `(who, …)`.
  - The other route's title is a link to `/plan/<route>`.
  - If that route has been deleted, the link leads to the existing load error. That is acceptable,
    and the title is still readable.
- The hold menu offers delete on a note to the admin only.
- `Comment` in `types.ts` gains `kind?: '' | 'cloned_from' | 'cloned_to' | 'renamed'` and
  `meta?: …`.

## 3. Rename

**Server.** In `planning.pb.js`, the itineraries `onRecordUpdateRequest` hook compares the title
before and after `e.next()`. When the title changed, it saves a `renamed` comment with:

- `target_collection 'itineraries'` and `target_id` = the route
- `user` = the crew member making the request
- `meta { from, to }`

The title update and its note are **atomic**. The hook wraps `e.next()` and the note save in
`e.app.runInTransaction`, swapping `e.app` for the transaction app as `targets.pb.js` does. If the
note cannot be saved, the rename is rolled back too, so a title can never change without its
history. The existing lock and archive work and the recompute trigger run after the transaction,
unchanged.

If the request came from a superuser with no crew identity, it writes no note, because `user` is
required. Every product path renames with a crew token (see below). The existing freeze already
refuses a non-admin rename of a non-draft route.

**Client actions.** `PlanActions` gains an optional `rename?: (title: string) => void | Promise<void>`.

- `recordActions.rename` writes `itineraries.update(id, { title })`. This is the draft path, and
  the hook records the note.
- The live editor's actions stage the title instead. `StagedPlan` gains an optional `title`, set
  only by a rename, and `commitPayload` sends it only when it is set.
- `ItineraryView` still writes nothing itself. There is no rename button. When
  `canManage && actions.rename`, the `<h1>` *is* the text box: an `<input>` styled like the heading,
  with test id `route-title` and accessible name `copy.routeName`, `maxlength 80`.
  - **Blur sends the edit.** If the trimmed value differs from the saved title, blur calls
    `actions.rename`. Enter blurs the box. Escape restores the saved title and blurs.
  - If the value is empty or unchanged, nothing is sent, and an empty box goes back to the saved
    title.
  - **A rejected name stays in the box**, with the server's reason shown under it
    (`role="alert"`). The saved title does not change until the server accepts one.
  - `rename` may therefore reject with an error. `ItineraryView` renders that error, and each
    action implementation decides which errors are about the name.
  - The text box appears in the editor only. The read-only route page keeps the plain `<h1>`.
  - `canManage` is `canEditSettings`: the builder's draft, or the admin.
  - On a locked route, blur *stages* the title and sends nothing; Save sends it (see Commit).
    Before staging, the client does a quick uniqueness check against `/api/plan/title-check`, so
    the Conductor hears "taken" at blur rather than at Save.

**Name rules (server).** A route name is valid when it is:

- 1–80 characters after trimming. It is stored trimmed.
- **Unique** among all routes, of any status, compared case-insensitively after trimming. The same
  route keeping its own name does not count as a clash.

Where the rules are enforced:

- `planning.pb.js` checks them on itinerary create and on every title update. It throws a
  PocketBase field error (`title`, code `title_taken` or `title_invalid`).
- The client maps the code to `copy.titleTaken` or `copy.titleInvalid`, so the wording stays in
  `labels.ts`.
- The existing `/plan` create form gets the same errors.
- No database unique index: existing data may already hold duplicates, and the migration must not
  fail on them. The hook is the gate. It checks the name and saves in **one transaction**, and
  PocketBase runs write transactions one at a time, so two concurrent requests cannot both take a
  free name. The clone route does the same inside its own transaction.
- `GET /api/plan/title-check?title=&route=` (any signed-in user) answers `{ ok, code? }` using the
  same rule. It is used only for the locked editor's early warning.

**Commit.** `CommitBody` gains an optional `title`.

- Validate it **before any stop write**: a string, 1–80 characters after trimming, and unique (the
  same rule as the hook). A bad or taken title returns 400 with the same code, and nothing is
  written.
- If it differs from the stored title, write it **before any stop write** (after validation), through a PocketBase client
  authenticated **with the Conductor's own token** from the request's `Authorization` header. Add a
  helper `userPb(request)` in `web/src/lib/server/pb.ts`. That way the hook records who renamed the
  route, and the existing admin rule is the gate.
- A retry that sends the same title is a no-op: the hook sees no change, so no second note is
  written. Renaming first means a name taken after the preflight stops the Save before anything
  else changes, and a later stop failure retries into a no-op rename.
- The Save gate treats a title change as a change.
  - `planDiff`/`bulletinText` ignore the title: a rename is not news for the crew on the platform,
    so the Bulletin sheet drafts nothing for a title-only change.
  - The implementation plan has to verify how the sheet behaves with an empty draft.

## 4. Clone

Clone is a PocketBase hook route, **`POST /api/crawl/clone`** in `pocketbase/pb_hooks/clone.pb.js`,
for signed-in users only. The body is `{ source, id, title }`.

**One transaction.** The new route, its stops and both notes are written in a single
`runInTransaction`: all of them land or none do. There is no cleanup step, and the route never
deletes anything. This was changed after the Codex review of the plan: an endpoint that cleans up
after partial failure can be steered into deleting routes, and overlapping retries can delete each
other's work.

**Idempotent by id.** The client mints `id` with `newRecordId()`, one per source route, keeps it
across retries, and forgets it after a success (`web/src/lib/cloneRoute.ts`).

- If `id` already exists and carries a `cloned_from` note by this caller whose `meta.route` is
  `source`, the clone finished earlier. The route answers `{ id, title }` and writes nothing. The
  note can only exist together with the rest, because of the single transaction.
- If `id` exists and is anything else, including the source itself or another of the caller's own
  routes, the answer is `409 clone_conflict` and nothing changes.
- `id === source` answers `400 bad_clone_request`.
- PocketBase runs write transactions one at a time, so an overlapping retry waits and then takes the
  first case.

**Names.** The client chooses the name:
- It sends `copy.cloneTitle` ("Copy of …") first, and on `title_taken` tries "(2)", "(3)" and so on.
  The base is cut so the whole name fits in 80 characters.
- The route checks the name inside its transaction with the same rule as the hooks.

**Copied**, with the new route as a draft owned by the caller (`created_by`, `status: draft`,
`vote_open: false`):
- `event_date`, `start_time`, `start_station`, `start_station_name`
- each stop's `order`, `name`, `kind`, `direction`, `station_id`, `station_name`, `place`,
  `place_id`, `osm_id`, `address`, `lat`, `lon`, `hours`, `phone`, `website`, `confirmed_open`,
  `dwell_min`, `walk_min`, `notes` and `meet_point`
- `photos_status`, but only when it is `done` (otherwise `none`). Google photos live on the shared
  `place`; crew uploads (`stop_photos`) are not copied.

Not copied: legs (the stop hook's recompute rebuilds them after commit), comments, votes, approvals,
check-ins, drinks, media, chat and Bulletins.

**Notes**, both with `user` = the caller:
- on the clone: `cloned_from { route: source, title: source title }`
- on the source: `cloned_to { route: id, title }`

**Errors:**
- `400 title_taken | title_invalid | bad_clone_request`
- `404 route_gone`
- `409 clone_conflict`
- `401` without login

The client maps these codes to copy.

**UI:** an icon-only button (`IconButton`, like edit and delete), `clone-route`, with a new `copy`
icon in `icons.ts`. `copy.cloneRoute` "Clone route" is used only as its accessible name and tooltip.
It posts to the endpoint through `api()`, then goes to `goto('/plan/<id>/edit?named=1')`.

In the new route's editor, `?named=1` focuses the title box with **all its text selected**, so the
user can just type over "Copy of …". Blur then saves the new name, and the hook writes the
`renamed` note. Afterwards the editor drops the query with `replaceState`, so reloading does not
select the text again. It is disabled while the request is in flight, and errors show in the
page's existing `error` line. It appears in the nav bar of:

- `plan/[id]/+page.svelte`, for any signed-in user and any status
- `plan/[id]/edit/+page.svelte`, **for a draft only**. A draft's edits are already written, so the
  clone copies exactly what is on screen.

It is not offered in the locked (staged) editor. That editor keeps unsaved staged edits in
component state, and navigating away would throw them away (parking happens only for the venue
picker). The Conductor clones a locked route from its route page instead.

## Labels (all in `labels.ts`, glossary rows in README)

- `venueGroup_bar|restaurant|other`
- `cloneRoute`, `cloneTitle(title)`
- `noteClonedFrom`, `noteClonedTo`, `noteRenamedFrom`, `noteRenamedTo`: phrases placed after the
  author's name, so the route title can be a link
- `routeName` (the accessible name of the title box), `titleTaken`, `titleInvalid`

## Testing (written first; each task ends green)

- **Unit:**
  - `groupByKind`: order, empty groups left out, ranking kept.
  - `cloneRoute`: the "(n)" retry on `title_taken`, the retry id kept per source, and error codes
    mapped to copy.
  - `planCommit`: a title written through the user client before any stop write, bad titles
    refused with 400, a name taken after the preflight stopping the Save before stop writes, and an
    unchanged title not written.
  - `staged`: a staged title is carried in `commitPayload`, and none is sent when none is staged.
  - `planActions.rename`, including a `title_taken` rejection surfacing as `copy.titleTaken`.
  - Name rule helper: trim, length, case-insensitive clash, and the same route not clashing with
    itself.
  - Clone title suffixing: "(2)" when "Copy of X" is taken, with the base cut so the suffix fits
    in 80 characters.
  - `labels`.
- **Hooks** (`scripts/test-hooks.sh`):
  - Clone (real PocketBase):
    - The copied fields, owner and draft status, and both notes.
    - Overlapping and later retries return the one clone.
    - An `id` naming the caller's own locked route, or the source itself, is refused and that route
      is untouched.
    - A taken or invalid name, or a missing source, creates nothing.
    - A failing note leaves no clone behind.
  - Racing creates, and racing renames, to one free name: exactly one succeeds.
  - A draft rename writes one `renamed` note with the right user and meta, and a no-op update writes
    none.
  - A non-admin rename of a locked route gets 403 and writes no note.
  - Create and rename with a duplicate name (different case, extra spaces) get 400 `title_taken`.
    An empty or 81-character name gets `title_invalid`. Re-saving a route's own title passes.
  - A client cannot create a comment with `kind`/`meta`, cannot PATCH `kind`/`meta` onto their
    ordinary comment (try each kind), cannot edit a note, and cannot delete their own note. The
    admin can delete a note.
  - Atomicity: if the note save fails (e.g. forced through a hook-test fixture), the title is
    unchanged.
  - A note with an empty body passes `targets.pb.js`.
- **E2E:**
  - The picker shows Bars open and Restaurants collapsed with counts, and a restaurant row is
    reachable after expanding its group.
  - User B clones user A's route: B lands in the clone's editor, the stops match, and the title is
    "Copy of …", **fully selected in the title box**. B types a new name and tabs out. Typing an
    existing route's name shows "taken" and keeps the box's text. The clone's chat shows "cloned from" and "renamed", and the
    original's chat shows "cloned as" with the *new* title's link target.
  - The admin renames a locked route through Save, and the note appears.

## Out of scope

- Updating the title stored in an existing `cloned_to` note when the clone is renamed later. The
  note keeps the title at clone time. The clone's own `renamed` notes carry the history, and the
  link is by id, so it still resolves.
- Cloning stop-level comments, votes or photos taken by users.
- Notes for any change other than clone and rename.
