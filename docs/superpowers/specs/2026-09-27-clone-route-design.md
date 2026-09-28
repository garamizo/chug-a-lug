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
- The live editor's actions stage the title instead. `StagedPlan` gains `title: string`, seeded
  from the itinerary in `stagePlan`, and `commitPayload` sends it.
- `ItineraryView` still writes nothing itself. When `canManage && actions.rename`, the `<h1>`
  becomes a button (test id `rename-route`) that turns into a text input (1–80 characters, trimmed).
  Enter or blur calls `actions.rename`, and Escape cancels.
  - It is offered in the editor only, not on the read-only route page.
  - `canManage` is `canEditSettings`: the builder's draft, or the admin.

**Commit.** `CommitBody` gains an optional `title`.

- Validate it: a string, 1–80 characters after trimming.
- If it differs from the stored title, write it after the stop writes, through a PocketBase client
  authenticated **with the Conductor's own token** from the request's `Authorization` header. Add a
  helper `userPb(request)` in `web/src/lib/server/pb.ts`. That way the hook records who renamed the
  route, and the existing admin rule is the gate.
- A retry that sends the same title is a no-op: the hook sees no change, so no second note is
  written.
- The Save gate treats a title change as a change.
  - `planDiff`/`bulletinText` ignore the title: a rename is not news for the crew on the platform,
    so the Bulletin sheet drafts nothing for a title-only change.
  - The implementation plan has to verify how the sheet behaves with an empty draft.

## 4. Clone

**Endpoint `POST /api/plan/clone`** (`web/src/routes/api/plan/clone/+server.ts`), body
`{ itinerary, id }`. `id` is the clone's record id, minted by the client with `newRecordId()` when
the page loads. The client keeps it across retries and mints a fresh one only after a success. This
follows the commit endpoint's stable-id idempotency.

0. **Retry check.**
   - If an itinerary with `id` already exists, and it is `created_by` this user, and the source has
     a `cloned_to` note whose `meta.route = id`, the clone finished earlier. Return `{ id }` and
     write nothing.
   - If it exists without that note, it is a half-made clone from a failed attempt. Delete it with
     `adminPb()` and continue.
   - If it exists but belongs to someone else, return 409.

1. `requireUser(request)`: any signed-in user. Validate that the id is 15 characters `[a-z0-9]`.
2. Read the source route and its stops (sorted by `order,created`) with `adminPb()`. A missing
   route returns 404.
3. Create the new itinerary, with the record id `id`, using `userPb(request)`, so the create hook forces `status: draft` and
   sets `created_by` to the cloner. The new itinerary has:
   - `title`: `copy.cloneTitle(source.title)` ("Copy of …"), cut to 80 characters
   - `event_date`, `start_time`, `start_station`, `start_station_name` copied from the source
4. Create each stop with `userPb`. The new route is the user's own draft, so the stop rules allow
   it. Copied fields:
   - `order`, `name`, `kind`, `direction`, `station_id`, `station_name`
   - `place`, `place_id`, `osm_id`, `address`, `lat`, `lon`, `hours`, `phone`, `website`
   - `confirmed_open`, `dwell_min`, `walk_min`, `notes`, `meet_point`
   - `photos_status`: copied only when it is `done`, otherwise `none`

   Photos live with the `place` in `attach.ts`. The plan must confirm that the stop page's gallery
   reads from the place and not from per-stop `stop_photos`. If it reads per-stop photos, copy
   those rows too.

   Not copied: legs (the stop-create hook's recompute regenerates them), comments, votes,
   approvals, check-ins, drinks, media, and chat or Bulletins.
5. Write the two notes with `adminPb()`, `user` = the cloner, in this order:
   - on the new route: `cloned_from { route: source.id, title: source.title }`
   - on the source, **last**: `cloned_to { route: new.id, title: new.title }`

   Because the source note is written last, it is the completion marker that step 0 looks for.
6. Return `{ id: new.id }`.

**Failure:** if anything after step 3 fails, delete the new itinerary with `adminPb()`, best effort.
Stops, comments and notes cascade through the existing hooks and relations. Then return the error.
The source is never modified, apart from its note, which is written last.

**Recompute:** every stop create queues a recompute (`recompute.js`), which the internal endpoint
answers with 202 and queues. N queued recomputes for one clone are acceptable at crawl sizes
(about 10 stops). The last one sees every stop.

**UI:** an icon button, `clone-route`, with a new `copy` icon in `icons.ts` and the label
`copy.cloneRoute` "Clone route". It posts to the endpoint through `api()`, then goes to
`goto('/plan/<id>/edit')`. It is disabled while the request is in flight, and errors show in the
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
- `noteClonedFrom(who, title)`, `noteClonedTo(who, title)`, `noteRenamed(who, from, to)`
- `renameRoute` (the accessible name of the title button)

## Testing (written first; each task ends green)

- **Unit:**
  - `groupByKind`: order, empty groups left out, ranking kept.
  - Clone endpoint with PocketBase mocked, like `planCommit`/`planEndpoints`: copied fields,
    owner via the user token, 404, cleanup on a failed stop create, and both notes.
  - Clone retries: a retry after full completion returns the same id and writes no second note. A
    retry after a half-made clone deletes it and rebuilds. Someone else's `id` gets 409.
  - `planCommit`: a title written through the user client, bad titles refused with 400, and an
    unchanged title not written.
  - `staged`: the title is seeded and carried in `commitPayload`.
  - `planActions.rename`.
  - `labels`.
- **Hooks** (`scripts/test-hooks.sh`):
  - A draft rename writes one `renamed` note with the right user and meta, and a no-op update writes
    none.
  - A non-admin rename of a locked route gets 403 and writes no note.
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
    "Copy of …". B renames it. The clone's chat shows "cloned from" and "renamed", and the
    original's chat shows "cloned as" with the *new* title's link target.
  - The admin renames a locked route through Save, and the note appears.

## Out of scope

- Updating the title stored in an existing `cloned_to` note when the clone is renamed later. The
  note keeps the title at clone time. The clone's own `renamed` notes carry the history, and the
  link is by id, so it still resolves.
- Cloning stop-level comments, votes or photos taken by users.
- Notes for any change other than clone and rename.
