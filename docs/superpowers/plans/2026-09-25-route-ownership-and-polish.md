# Route Ownership, Chat Box and UI Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Routes belong to their builder (builder + Conductor edit/delete, enforced server-side), one WhatsApp-style chat box with photos on Live and the planner, icon buttons for common actions, and a ticket/departure-board redesign of home, the planner list and route detail with an unfolded out-and-back line.

**Architecture:** PocketBase rules and model hooks carry every permission and integrity guarantee; SvelteKit's superuser endpoints re-check ownership themselves. The client derives every gate from one pure `permissions.ts`. The redesign is a handful of shared presentational components (`Ticket`, `Board`, `BoardRow`, `IconButton`, `ChatBox`) fed by small pure modules (`home.ts`, `planList.ts`, `lineMap.unfold`) that carry the unit tests.

**Tech Stack:** SvelteKit 2 + Svelte 5 runes, TypeScript, PocketBase 0.40.4 (JS hooks + migrations), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-25-route-ownership-and-polish-design.md` — read it before starting any task.

## Global Constraints

- Work only in `.worktrees/ui-polish` on branch `feat/ui-polish`. `main` stays linear; land with `--ff-only`.
- Fresh worktree setup (once): `cd web && npm install`; symlink `.env` and `.secrets/` from the main checkout (`ln -s ../../.env .env`, `ln -s ../../.secrets .secrets` from the worktree root).
- One test run at a time across all worktrees (e2e binds 15173/18093). Never point anything at 8090 or 3000.
- User-visible strings live only in `web/src/lib/labels.ts`. README "UI glossary" is the source of truth for names.
- Tests before code. Every task ends green on: `cd web && npm test && npm run check && npm run test:e2e` and `bash scripts/test-hooks.sh` (from the worktree root).
- "Conductor" = `users.is_admin = true`; superusers count as admin in hooks.
- PocketBase list rules filter, they do not reject: an unauthorised update/delete is `404`, a failed create rule is `400`.
- Keep existing `data-testid`s unless a task says otherwise; new controls get new test ids named in the task.
- `ItineraryView` writes nothing itself; it calls its `actions` prop. Do not add PocketBase writes to shared controls.
- Every commit message ends with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01HzLoJUTUaAJ5HnoangxyB9
  ```

## Review Focus

1. **A crew member on someone else's draft via deep link** (`/plan/{id}/edit`, `/plan/{id}/add`) — expect a redirect to the read-only view and no stop written. Pinned in Task 5 (e2e deep-link case).
2. **Deleting the route another phone is watching on Live** — the other phone falls back to the next locked route or the empty state, and never resurrects the deleted one from its mirror. Pinned in Task 4 (unit) and Task 8 (e2e: second browser context after Conductor delete).
3. **Photo-only chat message** (empty text, one image) on the planner — must post and render as a thumbnail with no empty text bubble. Pinned in Task 12.
4. **Typing while a send is in flight on a slow connection** — the box empties on send and stays usable; text typed meanwhile is never cleared, and a failed send restores its text only into an empty box. The send button never submits whitespace. Pinned in Task 11 (unit on `draftAfterFailedSend`/`composerMode`, e2e slow-send and whitespace cases).
5. **A route whose stops are all return stops, or all off-line** — the unfolded view renders the empty outbound section with its stations and does not crash; off-line stops still list under the off-line heading. Pinned in Task 9 (unit on `unfold`).

---

## File Structure

| File | Responsibility |
|---|---|
| `pocketbase/pb_migrations/1758860000_route_ownership.js` | New stop rules, itinerary delete rule, comment/vote target-immutable update rules |
| `pocketbase/pb_migrations/1758860001_comment_media.js` | `comments.file`, optional `comments.body` |
| `pocketbase/pb_hooks/targets.pb.js` | Comment/vote target validation (create) and cleanup (itinerary/stop delete), body-or-file rule |
| `web/src/lib/server/places/attach.ts` | Ownership check before Google/writes |
| `web/src/lib/offline.ts` | `clearMirror(readStartedAt)` + pure `mirrorIsStale` |
| `web/src/lib/live/day.svelte.ts` | Call `clearMirror` on an authoritative no-route read |
| `web/src/lib/permissions.ts` | `canEditStops`, `canEditSettings`, `canDelete` |
| `web/src/lib/icons.ts` | SVG path data per icon name |
| `web/src/lib/components/IconButton.svelte` | Icon-only `<button>` |
| `web/src/lib/components/IconLink.svelte` | Reads icons from `icons.ts` |
| `web/src/lib/components/Ticket.svelte` | Gold ticket |
| `web/src/lib/components/Board.svelte`, `BoardRow.svelte` | Departure-board list |
| `web/src/lib/home.ts` | Countdown + home chip mapping |
| `web/src/lib/planList.ts` | Per-route stop/cheer counts and status chips |
| `web/src/lib/lineMap.ts` | `unfold()` |
| `web/src/lib/components/LineMap.svelte` | Single column, `section` prop, no panes |
| `web/src/lib/components/ItineraryView.svelte` | Board header, stats, unfolded line |
| `web/src/lib/chatBox.ts` | Pure composer helpers (`composerMode`, `insertAt`) |
| `web/src/lib/components/ChatBox.svelte` | The one composer |
| `web/src/lib/live/holdMenu.svelte.ts` | Long-press menu state shared by `CrewChat` and `Comments` |
| `web/src/lib/live/upload.ts` | `compressForUpload()` shared by Live and planner |
| `web/src/lib/components/Comments.svelte` | Bubble log + ChatBox + photos |
| `web/src/lib/components/CrewChat.svelte` | Uses ChatBox + photo upload |
| `web/src/routes/(app)/+page.svelte` | Home: ticket + board |
| `web/src/routes/(app)/plan/+page.svelte` | Planner board |
| `web/src/routes/(app)/plan/[id]/+page.svelte`, `edit/+page.svelte` | Top-bar icons, delete |
| `web/src/routes/(app)/live/+page.svelte` | Photo buttons removed; upload via chat |

---

### Task 1: Route ownership rules

**Files:**
- Create: `pocketbase/pb_migrations/1758860000_route_ownership.js`
- Test: `web/tests/hooks/planning.test.ts` (rewrite the `stops` "anyone can add" test; replace "owner can delete a draft but not a locked itinerary")

**Interfaces:**
- Produces: server rules later tasks rely on — builder/admin-only stop writes on drafts, admin-only on locked; admin may delete any itinerary.

- [ ] **Step 1: Write the failing hook tests**

In `web/tests/hooks/planning.test.ts`, replace the test `'anyone can add a stop to a draft with defaults; nobody but admin once locked'` with:

```ts
  it('only the builder or the Conductor can write stops on a draft; only the Conductor once locked', async () => {
    const { id } = await (await createItinerary(crew.token)).json();
    // Someone else's draft: create fails the rule (400); update/delete are filtered out (404).
    expect((await createStop(other.token, id)).status).toBe(400);
    const res = await createStop(crew.token, id);
    expect(res.status).toBe(200);
    const stop = await res.json();
    expect(stop.dwell_min).toBe(60);
    expect(stop.kind).toBe('bar');
    expect(stop.photos_status).toBe('none');
    expect(stop.order).toBe(1);
    expect((await patch(`/api/collections/stops/records/${stop.id}`, { dwell_min: 30 }, other.token)).status).toBe(404);
    expect((await del(`/api/collections/stops/records/${stop.id}`, other.token)).status).toBe(404);
    const second = await (await createStop(admin.token, id)).json();
    expect(second.order).toBe(2);
    expect((await patch(`/api/collections/stops/records/${second.id}`, { dwell_min: 45 }, crew.token)).status).toBe(200);
    // A stop cannot be moved onto another route, even by its builder.
    const { id: mine2 } = await (await createItinerary(crew.token)).json();
    expect((await patch(`/api/collections/stops/records/${stop.id}`, { itinerary: mine2 }, crew.token)).status).toBe(404);
    await patch(`/api/collections/itineraries/records/${id}`, { status: 'locked' }, admin.token);
    expect((await createStop(crew.token, id)).status).toBe(400);
    expect((await patch(`/api/collections/stops/records/${stop.id}`, { dwell_min: 30 }, crew.token)).status).toBe(404);
    expect((await createStop(admin.token, id)).status).toBe(200);
    expect((await patch(`/api/collections/stops/records/${stop.id}`, { dwell_min: 30 }, admin.token)).status).toBe(200);
  });
```

Replace `'owner can delete a draft but not a locked itinerary'` with:

```ts
  it('builder deletes only their draft; the Conductor deletes any route in any status', async () => {
    const { id: draft } = await (await createItinerary(crew.token)).json();
    expect((await del(`/api/collections/itineraries/records/${draft}`, other.token)).status).toBe(404);
    expect((await del(`/api/collections/itineraries/records/${draft}`, crew.token)).status).toBe(204);

    const { id: locked } = await (await createItinerary(crew.token)).json();
    await patch(`/api/collections/itineraries/records/${locked}`, { status: 'locked' }, admin.token);
    expect((await del(`/api/collections/itineraries/records/${locked}`, crew.token)).status).toBe(404);
    expect((await del(`/api/collections/itineraries/records/${locked}`, admin.token)).status).toBe(204);

    const { id: othersDraft } = await (await createItinerary(other.token)).json();
    expect((await del(`/api/collections/itineraries/records/${othersDraft}`, admin.token)).status).toBe(204);
  });

  it('deleting the current route clears crawl_settings.current_itinerary', async () => {
    const su = await superuserToken();
    const { id } = await (await createItinerary(admin.token, { title: 'Current' })).json();
    await patch(`/api/collections/itineraries/records/${id}`, { status: 'locked' }, admin.token);
    const settings = await (await get('/api/collections/crawl_settings/records?perPage=1', su)).json();
    const sid = settings.items[0]?.id;
    expect(sid).toBeTruthy();
    expect((await patch(`/api/collections/crawl_settings/records/${sid}`, { current_itinerary: id }, su)).status).toBe(200);
    expect((await del(`/api/collections/itineraries/records/${id}`, admin.token)).status).toBe(204);
    const after = await (await get(`/api/collections/crawl_settings/records/${sid}`, su)).json();
    expect(after.current_itinerary).toBe('');
  });
```

If `crawl_settings` has no row in the test PocketBase, create one first in the test with `post('/api/collections/crawl_settings/records', {}, su)` — check `pocketbase/pb_migrations/1758850000_crawl_settings.js` for how the singleton is seeded and follow it.

- [ ] **Step 2: Run to verify they fail**

Run from the worktree root: `bash scripts/test-hooks.sh`
Expected: the two rewritten tests FAIL (other crew's create returns 200; admin's delete of a locked route returns 404). The `crawl_settings` test may already pass — that confirms the spec's claim that PocketBase clears the optional relation; keep it as a regression guard.

- [ ] **Step 3: Write the migration**

`pocketbase/pb_migrations/1758860000_route_ownership.js`:

```js
// Routes belong to their builder: only the builder (while it is a draft) or the Conductor writes
// its stops, and the Conductor may delete a route in any status. Comment and vote targets can
// never be changed after creation (targets.pb.js validates them on create).
migrate((app) => {
  const U = "@request.auth.id != ''"
  const ADMIN = '@request.auth.is_admin = true'
  const OWN_DRAFT_OR_ADMIN = `${U} && ((itinerary.status = 'draft' && itinerary.created_by = @request.auth.id) || ${ADMIN})`

  const stops = app.findCollectionByNameOrId('stops')
  stops.createRule = OWN_DRAFT_OR_ADMIN
  stops.updateRule = `${OWN_DRAFT_OR_ADMIN} && @request.body.itinerary:isset = false`
  stops.deleteRule = OWN_DRAFT_OR_ADMIN
  app.save(stops)

  const itineraries = app.findCollectionByNameOrId('itineraries')
  itineraries.deleteRule = `${U} && ((status = 'draft' && created_by = @request.auth.id) || ${ADMIN})`
  app.save(itineraries)

  const FIXED_TARGET = '@request.body.target_collection:isset = false && @request.body.target_id:isset = false'
  for (const name of ['comments', 'votes']) {
    const c = app.findCollectionByNameOrId(name)
    c.updateRule = `${U} && user = @request.auth.id && @request.body.user:isset = false && ${FIXED_TARGET}`
    app.save(c)
  }
}, (app) => {
  const U = "@request.auth.id != ''"
  const ADMIN = '@request.auth.is_admin = true'
  const DRAFT_OR_ADMIN = `${U} && (itinerary.status = 'draft' || ${ADMIN})`
  const stops = app.findCollectionByNameOrId('stops')
  stops.createRule = DRAFT_OR_ADMIN
  stops.updateRule = DRAFT_OR_ADMIN
  stops.deleteRule = DRAFT_OR_ADMIN
  app.save(stops)
  const itineraries = app.findCollectionByNameOrId('itineraries')
  itineraries.deleteRule = `${U} && status = 'draft' && (created_by = @request.auth.id || ${ADMIN})`
  app.save(itineraries)
  for (const name of ['comments', 'votes']) {
    const c = app.findCollectionByNameOrId(name)
    c.updateRule = `${U} && user = @request.auth.id && @request.body.user:isset = false`
    app.save(c)
  }
})
```

Before relying on the down-migration strings, diff them against `pocketbase/pb_migrations/1758400000_planning.js:14-15,37-39,92,112` and copy them verbatim if they differ.

- [ ] **Step 4: Run to verify they pass**

Run: `bash scripts/test-hooks.sh`
Expected: all hook tests PASS. `web/tests/hooks/migrations.test.ts` may assert rule strings; update its expectations to the new rules if it does.

- [ ] **Step 5: Fix e2e/fixtures that write stops as a non-builder**

Run: `grep -rn "collection('stops')\|/collections/stops/records" web/tests/e2e web/tests/fixtures`. Any fixture that creates stops with a crew token on an itinerary that crew member did not create must use the builder's token or the superuser. Do not change what the test asserts.

- [ ] **Step 6: Commit**

```bash
git add pocketbase/pb_migrations/1758860000_route_ownership.js web/tests/hooks web/tests/e2e web/tests/fixtures
git commit -m "feat(pb): a route's stops belong to its builder; the Conductor may delete any route"
```

---

### Task 2: Comment and vote targets — media, validation and cleanup

**Files:**
- Create: `pocketbase/pb_migrations/1758860001_comment_media.js`
- Create: `pocketbase/pb_hooks/targets.pb.js`
- Modify: `web/src/lib/types.ts:58` (`Comment` gets `file?: string`)
- Test: `web/tests/hooks/planning.test.ts` (new `describe('comment and vote targets')`)

**Interfaces:**
- Consumes: Task 1 rules.
- Produces: `comments.file` (single file, image/video, thumbs `400x300`, `1200x0`); a comment needs `body` or `file`; create with a missing target → 400.

- [ ] **Step 1: Write the failing hook tests**

Append to `web/tests/hooks/planning.test.ts` (add `postForm` locally since `setup.ts` only posts JSON):

```ts
const postForm = (path: string, form: FormData, token: string) =>
  fetch(`${PB}${path}`, { method: 'POST', headers: { Authorization: token }, body: form });
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const comment = (token: string, user: string, target_collection: string, target_id: string, body = 'Hi') =>
  post('/api/collections/comments/records', { user, target_collection, target_id, body }, token);

describe('comment and vote targets', () => {
  it('needs text or a file; a photo-only comment is fine', async () => {
    const { id } = await (await createItinerary(crew.token)).json();
    expect((await comment(crew.token, crew.id, 'itineraries', id, '')).status).toBe(400);
    expect((await comment(crew.token, crew.id, 'itineraries', id, '   ')).status).toBe(400);
    const form = new FormData();
    form.set('user', crew.id); form.set('target_collection', 'itineraries'); form.set('target_id', id);
    form.set('file', new Blob([GIF], { type: 'image/gif' }), 'pic.gif');
    const res = await postForm('/api/collections/comments/records', form, crew.token);
    expect(res.status).toBe(200);
    expect((await res.json()).file).toMatch(/\.gif$/);
  });

  it('rejects a comment or vote whose target does not exist, with or without a file', async () => {
    expect((await comment(crew.token, crew.id, 'itineraries', 'aaaaaaaaaaaaaaa')).status).toBe(400);
    expect((await comment(crew.token, crew.id, 'stops', 'aaaaaaaaaaaaaaa')).status).toBe(400);
    expect((await comment(crew.token, crew.id, 'users', crew.id)).status).toBe(400);
    const vote = { user: crew.id, target_collection: 'itineraries', target_id: 'aaaaaaaaaaaaaaa', value: 'up' };
    expect((await post('/api/collections/votes/records', vote, crew.token)).status).toBe(400);
    const form = new FormData();
    form.set('user', crew.id); form.set('target_collection', 'itineraries'); form.set('target_id', 'aaaaaaaaaaaaaaa');
    form.set('file', new Blob([GIF], { type: 'image/gif' }), 'pic.gif');
    expect((await postForm('/api/collections/comments/records', form, crew.token)).status).toBe(400);
  });

  it('refuses to move a comment or vote to another target', async () => {
    const { id: a } = await (await createItinerary(crew.token)).json();
    const { id: b } = await (await createItinerary(crew.token)).json();
    const c = await (await comment(crew.token, crew.id, 'itineraries', a)).json();
    expect((await patch(`/api/collections/comments/records/${c.id}`, { target_id: b }, crew.token)).status).toBe(404);
    expect((await patch(`/api/collections/comments/records/${c.id}`, { body: 'Edited' }, crew.token)).status).toBe(200);
  });

  it('rejects a non-media attachment even when the client is bypassed', async () => {
    const { id } = await (await createItinerary(crew.token)).json();
    const form = new FormData();
    form.set('user', crew.id); form.set('target_collection', 'itineraries'); form.set('target_id', id);
    form.set('file', new Blob(['#!/bin/sh'], { type: 'text/plain' }), 'run.sh');
    expect((await postForm('/api/collections/comments/records', form, crew.token)).status).toBe(400);
  });

  it('a route delete that fails keeps its comments and votes (cleanup rolls back)', async () => {
    const su = await superuserToken();
    const { id } = await (await createItinerary(crew.token)).json();
    await comment(crew.token, crew.id, 'itineraries', id);
    // A throwaway collection with a required, non-cascading relation makes PocketBase refuse the delete.
    const itCol = await (await get('/api/collections/itineraries', su)).json();
    const hold = await post('/api/collections', { name: 'zz_hold', type: 'base', fields: [
      { name: 'it', type: 'relation', collectionId: itCol.id, maxSelect: 1, required: true, cascadeDelete: false }
    ] }, su);
    expect(hold.status).toBe(200);
    try {
      expect((await post('/api/collections/zz_hold/records', { it: id }, su)).status).toBe(200);
      expect((await del(`/api/collections/itineraries/records/${id}`, admin.token)).status).toBe(400);
      const left = await (await get(`/api/collections/comments/records?filter=${encodeURIComponent(`target_id="${id}"`)}`, crew.token)).json();
      expect(left.totalItems).toBe(1);
    } finally {
      await del('/api/collections/zz_hold', su);
    }
  });

  it('comments racing a route delete never outlive it', async () => {
    const { id } = await (await createItinerary(crew.token)).json();
    const writes = Array.from({ length: 12 }, (_, i) => comment(crew.token, crew.id, 'itineraries', id, `race ${i}`));
    const gone = del(`/api/collections/itineraries/records/${id}`, crew.token);
    await Promise.all([...writes, gone]);
    const su = await superuserToken();
    const left = await (await get(`/api/collections/comments/records?filter=${encodeURIComponent(`target_id="${id}"`)}`, su)).json();
    expect(left.totalItems).toBe(0);
  });

  it('deleting a stop removes its comments and votes; deleting a route removes its and its stops\'', async () => {
    const { id } = await (await createItinerary(crew.token)).json();
    const s1 = await (await createStop(crew.token, id)).json();
    const s2 = await (await createStop(crew.token, id)).json();
    await comment(crew.token, crew.id, 'stops', s1.id);
    await post('/api/collections/votes/records', { user: crew.id, target_collection: 'stops', target_id: s1.id, value: 'up' }, crew.token);
    expect((await del(`/api/collections/stops/records/${s1.id}`, crew.token)).status).toBe(204);
    const count = async (col: string, target: string) =>
      (await (await get(`/api/collections/${col}/records?filter=${encodeURIComponent(`target_id="${target}"`)}`, crew.token)).json()).totalItems;
    expect(await count('comments', s1.id)).toBe(0);
    expect(await count('votes', s1.id)).toBe(0);

    await comment(crew.token, crew.id, 'stops', s2.id);
    await comment(crew.token, crew.id, 'itineraries', id);
    await post('/api/collections/votes/records', { user: crew.id, target_collection: 'itineraries', target_id: id, value: 'up' }, crew.token);
    await patch(`/api/collections/itineraries/records/${id}`, { status: 'locked' }, admin.token);
    expect((await del(`/api/collections/itineraries/records/${id}`, admin.token)).status).toBe(204);
    expect(await count('comments', s2.id)).toBe(0);
    expect(await count('comments', id)).toBe(0);
    expect(await count('votes', id)).toBe(0);
  });
});
```

Import `PB` and `superuserToken` from `./setup` at the top of the file (`superuserToken` is already imported).

- [ ] **Step 2: Run to verify they fail**

Run: `bash scripts/test-hooks.sh`
Expected: FAIL — empty body is currently a 400 already (required), but the file-only, missing-target, cleanup and race cases fail (the rollback case may pass trivially until cleanup exists; it guards the transaction). If `del('/api/collections/zz_hold', su)` is not how this PocketBase deletes a collection, use `DELETE /api/collections/zz_hold` with the superuser token — same thing — and make sure `truncate` in `beforeAll` never touches it.

- [ ] **Step 3: Write the migration**

`pocketbase/pb_migrations/1758860001_comment_media.js`:

```js
// Planner chat takes photos and videos, like Live: a comment is text, a file, or both.
migrate((app) => {
  const comments = app.findCollectionByNameOrId('comments')
  comments.fields.getByName('body').required = false
  comments.fields.add(new FileField({
    name: 'file', maxSelect: 1, maxSize: 94371840, thumbs: ['400x300', '1200x0'],
    mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'image/heif', 'video/mp4', 'video/quicktime', 'video/webm']
  }))
  app.save(comments)
}, (app) => {
  const comments = app.findCollectionByNameOrId('comments')
  app.db().newQuery("DELETE FROM comments WHERE body = '' OR body IS NULL").execute()
  comments.fields.removeByName('file')
  comments.fields.getByName('body').required = true
  app.save(comments)
})
```

Keep the `mimeTypes` allowlist even though `media.file` has none: the server, not `prepare()`, is the gate (the non-media test pins it). If a real phone format is rejected in manual testing, add it to the list rather than removing the list.

- [ ] **Step 4: Write the hooks**

`pocketbase/pb_hooks/targets.pb.js`. Model hooks are not transactional on their own in PocketBase 0.40, so each wraps its entire chain — lookups, cleanup **and `e.next()`** — in `runInTransaction`, with `e.app` pointed at the transaction exactly as `pocketbase/pb_hooks/action_order.pb.js` does (using `$app` inside would deadlock SQLite's single writer). PocketBase runs transactions on one write connection, so a check-then-insert and a cleanup-then-delete cannot interleave, and a failed delete rolls its cleanup back.

```js
// Comments and votes point at their target by text. These hooks keep that link honest: a new one
// must point at a route or stop that exists, and deleting a route or stop takes its comments and
// votes with it. Each wraps its whole chain, e.next() included, in one transaction (see
// action_order.pb.js): a failed delete keeps its comments, and a comment cannot be validated
// against a route that is deleted before the comment lands.

onRecordCreate((e) => {
  const original = e.app
  try {
    original.runInTransaction((tx) => {
      e.app = tx
      const col = e.record.getString('target_collection')
      const id = e.record.getString('target_id')
      if (col !== 'itineraries' && col !== 'stops') throw new BadRequestError('Comments and cheers are for routes and stops.')
      try { tx.findRecordById(col, id) } catch (_) { throw new BadRequestError('That route or stop no longer exists.') }
      if (e.record.collection().name === 'comments' && !e.record.getString('body').trim() &&
          !e.record.getString('file') && !e.record.getUnsavedFiles('file').length) {
        throw new BadRequestError('Write something or attach a photo.')
      }
      e.next()
    })
  } finally { e.app = original }
}, 'comments', 'votes')

onRecordDelete((e) => {
  const original = e.app
  try {
    original.runInTransaction((tx) => {
      e.app = tx
      const col = e.record.collection().name
      for (const name of ['comments', 'votes']) {
        const rows = tx.findRecordsByFilter(name, 'target_collection = {:c} && target_id = {:id}', '', 0, 0, { c: col, id: e.record.id })
        for (const r of rows) tx.delete(r)
      }
      e.next()
    })
  } finally { e.app = original }
}, 'itineraries', 'stops')
```

If the cleanup test for a stop's comments after a **route** delete fails (cascaded stop deletes do not fire `onRecordDelete` in this PocketBase version), extend the `itineraries` branch inside the same transaction: before `e.next()`, `for (const s of tx.findRecordsByFilter('stops', 'itinerary = {:id}', '', 0, 0, { id: e.record.id }))` run the same two-collection sweep with `c: 'stops', id: s.id`.

If `getUnsavedFiles` is not exposed to JSVM in 0.40.4, check the file via `e.record.get('file')` (an unsaved upload is a `*filesystem.File`, a truthy value) — the file-only test decides.

- [ ] **Step 5: Update the type**

`web/src/lib/types.ts:58`:

```ts
export type Comment = RecordModel & { user: string; target_collection: string; target_id: string; body: string; file?: string; expand?: { user?: UserRecord } };
```

- [ ] **Step 6: Run to verify they pass**

Run: `bash scripts/test-hooks.sh` then `cd web && npm run check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add pocketbase/pb_migrations/1758860001_comment_media.js pocketbase/pb_hooks/targets.pb.js web/src/lib/types.ts web/tests/hooks/planning.test.ts
git commit -m "feat(pb): comments carry photos; comment and vote targets must exist and go with their route"
```

---

### Task 3: Places attach checks ownership

**Files:**
- Modify: `web/src/lib/server/places/attach.ts:13-14,52-57`
- Test: `web/tests/unit/attach.test.ts`

**Interfaces:**
- Produces: `export type AttachCaller = { id: string; is_admin: boolean }`. `routes/api/places/attach/+server.ts` already passes the full `UserRecord`, which has `id` — no change needed there.

- [ ] **Step 1: Write the failing test**

In `web/tests/unit/attach.test.ts`, change the `beforeEach` seed:

```ts
  pbState.itineraries.set('draftit', { id: 'draftit', status: 'draft', created_by: 'builder' });
  pbState.itineraries.set('lockedit', { id: 'lockedit', status: 'locked', created_by: 'builder' });
```

Update the two existing caller tests to pass ids (`{ id: 'builder', is_admin: false }`, `{ id: 'boss', is_admin: true }`), and add:

```ts
  it('refuses a crew member attaching on someone else\'s draft before any Google call or write', async () => {
    seedStop('stop8');

    await expect(attachPlace('stop8', { id: 'someone-else', is_admin: false })).rejects.toMatchObject({ status: 403 });

    expect(stop('stop8').photos_status).toBe('none');
    expect(searchText).not.toHaveBeenCalled();
    expect(placeDetails).not.toHaveBeenCalled();
    expect(pbState.places.size).toBe(0);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run tests/unit/attach.test.ts`
Expected: the new test FAILS (attach succeeds) and `npm run check` flags the `id` property.

- [ ] **Step 3: Implement**

```ts
/** Who asked for the attach. Optional so tests (and future server jobs) can skip the check. */
export type AttachCaller = { id: string; is_admin: boolean };
```

and replace the check block:

```ts
  // This writes as the superuser, so the stops rule (the builder's draft, or the Conductor) is
  // re-checked here instead of being bypassed — before any Google call spends the budget.
  if (caller && !caller.is_admin) {
    const it = await pb.collection('itineraries').getOne<Itinerary>(stop.itinerary).catch(() => null);
    if (!it || it.status !== 'draft') throw error(403, 'This itinerary is no longer a draft.');
    if (it.created_by !== caller.id) throw error(403, 'Only the route\'s builder or the Conductor can change it.');
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx vitest run tests/unit/attach.test.ts && npm run check`
Expected: PASS.

- [ ] **Step 5: Audit other superuser writes**

Run: `grep -rn "adminPb" web/src --include=*.ts | grep -v test`. For each file that writes `stops` or `itineraries`, confirm it is admin-only (`requireAdmin` or an `is_admin` check) or hook/server-internal. Record the result in the commit message body. Fix any non-admin path the same way as above, with a test.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/server/places/attach.ts web/tests/unit/attach.test.ts
git commit -m "fix(places): attach re-checks route ownership before spending Google budget"
```

---

### Task 4: Offline mirror forgets a deleted last route

**Files:**
- Modify: `web/src/lib/offline.ts` (add `mirrorIsStale`, `clearMirror`)
- Modify: `web/src/lib/live/day.svelte.ts:156-175` (`loadRoute`)
- Test: `web/tests/unit/offline.test.ts`, `web/tests/unit/offlineDay.test.ts`

**Interfaces:**
- Produces: `export function mirrorIsStale(mirror: Pick<Mirror, 'savedAt'>, readStartedAt: Date): boolean`; `export async function clearMirror(readStartedAt: Date): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

`web/tests/unit/offline.test.ts` — import `mirrorIsStale, clearMirror` and add:

```ts
describe('mirrorIsStale', () => {
  it('is stale when saved before the read that found no route began', () => {
    expect(mirrorIsStale({ savedAt: '2026-12-26T20:00:00.000Z' }, new Date('2026-12-26T20:00:01.000Z'))).toBe(true);
  });
  it('keeps a mirror saved at or after the read began (a newer save raced in)', () => {
    expect(mirrorIsStale({ savedAt: '2026-12-26T20:00:01.000Z' }, new Date('2026-12-26T20:00:01.000Z'))).toBe(false);
    expect(mirrorIsStale({ savedAt: '2026-12-26T20:00:02.000Z' }, new Date('2026-12-26T20:00:01.000Z'))).toBe(false);
  });
  it('clearMirror is a no-op without IndexedDB', async () => {
    await expect(clearMirror(new Date())).resolves.toBeUndefined();
  });
});
```

`web/tests/unit/offlineDay.test.ts` — add `clear: vi.fn()` to `mocks`, add `clearMirror: mocks.clear` to the `$lib/offline` mock, `mocks.clear.mockResolvedValue(undefined)` in `beforeEach`, and:

```ts
  it('forgets the mirror when the server says there is no route, so an offline reload cannot resurrect it', async () => {
    const day = new LiveDay();
    await day.loadRoute();
    mocks.list.mockResolvedValue([]);
    const before = Date.now();
    await day.loadRoute();
    expect(mocks.clear).toHaveBeenCalledOnce();
    expect((mocks.clear.mock.calls[0][0] as Date).getTime()).toBeLessThanOrEqual(Date.now());
    expect((mocks.clear.mock.calls[0][0] as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  it('does not clear the mirror when the read failed (offline)', async () => {
    const day = new LiveDay();
    mocks.list.mockRejectedValue(new Error('offline'));
    await day.loadRoute();
    expect(mocks.clear).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run tests/unit/offline.test.ts tests/unit/offlineDay.test.ts`
Expected: FAIL — `mirrorIsStale`/`clearMirror` not exported.

- [ ] **Step 3: Implement in `offline.ts`**

Add after `scopeMirror`:

```ts
/** True when the stored mirror predates a read that authoritatively found no route. */
export function mirrorIsStale(mirror: Pick<Mirror, 'savedAt'>, readStartedAt: Date): boolean {
  return Date.parse(mirror.savedAt) < readStartedAt.getTime();
}

/** Forget the stored route after the server says there is none — but never a save newer than
 *  that read, which belongs to a route that appeared since. One transaction, like scopeMirror. */
export async function clearMirror(readStartedAt: Date): Promise<void> {
  const db = await open();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.oncomplete = tx.onerror = tx.onabort = () => resolve();
        const store = tx.objectStore(STORE), request = store.get(KEY);
        request.onsuccess = () => { if (request.result && mirrorIsStale(request.result as Mirror, readStartedAt)) store.delete(KEY); };
      } catch { resolve(); }
    });
  } finally { close(db); }
}
```

- [ ] **Step 4: Call it from `loadRoute`**

In `web/src/lib/live/day.svelte.ts`, import `clearMirror` alongside the other offline imports. Capture the read start right before the read, and clear on the no-route branch:

```ts
    try {
      const readStartedAt = new Date();
      const read = await (fresh && early!.runId === runId ? early!.read : this.readRoute());
      if (request !== this.routeRead || runId !== clientClock.runId) return;
      if (!read) {
        const had = this.itinerary;
        this.itinerary = null; this.stops = []; this.legs = []; this.anchor = null;
        this.fromMirror = false; this.mirrorSavedAt = null;
        void clearMirror(readStartedAt);
        this.syncPlan();
        if (had) this.enterScope();
        return;
      }
```

When `early` is used, its read started at the time `early.at` was recorded, which is earlier than `readStartedAt` above; a mirror saved between the two would then be kept, which is the safe direction. Leave it.

- [ ] **Step 5: Run to verify they pass**

Run: `cd web && npx vitest run tests/unit/offline.test.ts tests/unit/offlineDay.test.ts && npm run check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/offline.ts web/src/lib/live/day.svelte.ts web/tests/unit/offline.test.ts web/tests/unit/offlineDay.test.ts
git commit -m "fix(offline): forget the mirrored route once the server says there is none"
```

---

### Task 5: Client permission helpers and gates

**Files:**
- Create: `web/src/lib/permissions.ts`
- Modify: `web/src/routes/(app)/plan/[id]/+page.svelte:31-32`, `web/src/routes/(app)/plan/[id]/edit/+page.svelte:44-47`, `web/src/routes/(app)/plan/[id]/add/+page.svelte` (redirect when not allowed), `web/src/lib/labels.ts:96`
- Test: `web/tests/unit/permissions.test.ts`, `web/tests/e2e/planning.spec.ts` (new test)

**Interfaces:**
- Produces:
  ```ts
  type Who = { id: string; is_admin?: boolean } | null | undefined;
  type Route = Pick<Itinerary, 'status' | 'created_by'>;
  export function canEditStops(it: Route, who: Who): boolean;
  export function canEditSettings(it: Route, who: Who): boolean;
  export function canDelete(it: Route, who: Who): boolean;
  export function isLockedEdit(it: Route, who: Who): boolean; // Conductor editing a non-draft
  ```

- [ ] **Step 1: Write the failing unit test**

`web/tests/unit/permissions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canDelete, canEditSettings, canEditStops, isLockedEdit } from '../../src/lib/permissions';

const builder = { id: 'b' }, other = { id: 'o' }, boss = { id: 'c', is_admin: true };
const draft = { status: 'draft' as const, created_by: 'b' };
const locked = { status: 'locked' as const, created_by: 'b' };
const archived = { status: 'archived' as const, created_by: 'b' };

describe('permissions', () => {
  it('the builder edits and deletes only their draft', () => {
    expect(canEditStops(draft, builder)).toBe(true);
    expect(canEditSettings(draft, builder)).toBe(true);
    expect(canDelete(draft, builder)).toBe(true);
    for (const it of [locked, archived]) {
      expect(canEditStops(it, builder)).toBe(false);
      expect(canDelete(it, builder)).toBe(false);
    }
  });
  it('other crew can do nothing, signed out even less', () => {
    for (const it of [draft, locked, archived]) {
      for (const who of [other, null, undefined]) {
        expect(canEditStops(it, who)).toBe(false);
        expect(canEditSettings(it, who)).toBe(false);
        expect(canDelete(it, who)).toBe(false);
      }
    }
  });
  it('the Conductor edits and deletes every route', () => {
    for (const it of [draft, locked, archived]) {
      expect(canEditStops(it, boss)).toBe(true);
      expect(canDelete(it, boss)).toBe(true);
    }
    expect(isLockedEdit(locked, boss)).toBe(true);
    expect(isLockedEdit(draft, boss)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run tests/unit/permissions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`web/src/lib/permissions.ts`:

```ts
// Who may change a route. Mirrors the PocketBase rules (1758860000_route_ownership.js): the
// builder, while it is a draft, or the Conductor, always. The server is the real gate; these only
// decide which controls to show.
import type { Itinerary } from './types';

type Who = { id: string; is_admin?: boolean } | null | undefined;
type Route = Pick<Itinerary, 'status' | 'created_by'>;

const ownDraft = (it: Route, who: Who) => !!who && it.status === 'draft' && it.created_by === who.id;

export const canEditStops = (it: Route, who: Who): boolean => !!who?.is_admin || ownDraft(it, who);
export const canEditSettings = canEditStops;
export const canDelete = canEditStops;
/** The Conductor editing a locked or archived route goes through the staged editor. */
export const isLockedEdit = (it: Route, who: Who): boolean => !!who?.is_admin && it.status !== 'draft';
```

- [ ] **Step 4: Wire the gates**

`routes/(app)/plan/[id]/+page.svelte` — replace `isAdmin`/`canEdit` with:

```ts
  import { canDelete, canEditStops } from '$lib/permissions';
  const isAdmin = $derived(!!$auth.user?.is_admin);
  const canEdit = $derived(!!draft && canEditStops(draft.itinerary, $auth.user));
  const mayDelete = $derived(!!draft && canDelete(draft.itinerary, $auth.user));
```

(`mayDelete` is used by Task 10.)

`routes/(app)/plan/[id]/edit/+page.svelte` — replace lines defining `editable`/`canManage`:

```ts
  const editable = $derived(!!draft && canEditStops(draft.itinerary, $auth.user));
  const canManage = $derived(!!draft && canEditSettings(draft.itinerary, $auth.user));
```

`routes/(app)/plan/[id]/add/+page.svelte` — read its load path; after the itinerary is known add the same guard the edit page uses:

```ts
  $effect(() => { if (itinerary && !canEditStops(itinerary, $auth.user)) void goto(`/plan/${itinerary.id}`, { replaceState: true }); });
```

(Use whatever variable holds the itinerary there; if the add page does not load the itinerary, load it with `pb.collection('itineraries').getOne(data.id)` in its existing load.)

`labels.ts:96`:

```ts
  plannerIntro: 'Anyone can build a route. You edit your own; the Conductor can edit any and locks The Route.',
```

- [ ] **Step 5: Write the e2e test**

Append to `web/tests/e2e/planning.spec.ts` (reuse the file's `login` and `beforeEach` routes):

```ts
test('another crew member can read and cheer a draft but not change it, even by deep link', async ({ page, browser }) => {
  await login(page, 'E2E Builder', process.env.CREW_PASSWORD ?? 'crew-test-password');
  await page.getByTestId('nav-plan').click();
  await page.getByTestId('draft-title').fill('Builder Only');
  await page.getByTestId('create-draft').click();
  await expect(page).toHaveURL(/\/plan\/[a-z0-9]{15}\/edit$/);
  const draftUrl = page.url().replace(/\/edit$/, '');

  const other = await browser.newPage();
  await login(other, 'E2E Onlooker', process.env.CREW_PASSWORD ?? 'crew-test-password');
  await other.goto(draftUrl);
  await expect(other.getByTestId('vote-up')).toBeVisible();
  await expect(other.getByTestId('edit-draft')).toHaveCount(0);
  await expect(other.getByTestId('delete-route')).toHaveCount(0);
  await other.goto(`${draftUrl}/edit`);
  await expect(other).toHaveURL(draftUrl);
  await other.goto(`${draftUrl}/add?station=NAPERVILLE&side=left`);
  await expect(other).toHaveURL(draftUrl);
  await other.close();
});
```

Check `web/tests/e2e/global-setup.ts` for the crew password env name and use it.

- [ ] **Step 6: Run everything**

Run: `cd web && npm test && npm run check && npm run test:e2e -- planning.spec.ts`
Expected: PASS (the `delete-route` assertion passes trivially until Task 10 adds the button).

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/permissions.ts web/src/routes/\(app\)/plan web/src/lib/labels.ts web/tests/unit/permissions.test.ts web/tests/e2e/planning.spec.ts
git commit -m "feat(planner): one permission helper; only the builder or the Conductor gets edit controls"
```

---

### Task 6: Icon set and IconButton

**Files:**
- Create: `web/src/lib/icons.ts`, `web/src/lib/components/IconButton.svelte`
- Modify: `web/src/lib/components/IconLink.svelte`, `web/src/lib/components/StopRow.svelte` (corner buttons), `web/src/lib/labels.ts`
- Test: `web/tests/unit/icons.test.ts`, `web/tests/e2e/controls.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  export type IconName = 'back' | 'edit' | 'delete' | 'add' | 'up' | 'down' | 'send' | 'attach' | 'camera' | 'emoji' | 'keyboard';
  export const ICONS: Record<IconName, string[]>; // SVG path `d` strings, 24x24 viewBox, stroked
  ```
  `<IconButton icon label onclick testid? tone?='default'|'danger'|'primary' disabled? size?=44 type?='button'|'submit' />`
  `<IconLink href label icon testid? />` — `icon: IconName`.

- [ ] **Step 1: Write the failing tests**

`web/tests/unit/icons.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ICONS } from '../../src/lib/icons';

describe('icons', () => {
  it('has path data for every common action', () => {
    for (const name of ['back', 'edit', 'delete', 'add', 'up', 'down', 'send', 'attach', 'camera', 'emoji', 'keyboard'] as const) {
      expect(ICONS[name].length, name).toBeGreaterThan(0);
      for (const d of ICONS[name]) expect(d, name).toMatch(/^[Mm]/);
    }
  });
});
```

In `web/tests/e2e/controls.spec.ts`, extend `'return links are a back arrow and editing is a pen, both named for screen readers'` (read it first) with an assertion on a draft's edit screen:

```ts
  // Stop controls are icons with accessible names, not glyphs.
  await expect(page.getByTestId('remove-0')).toHaveAccessibleName('Remove');
  await expect(page.getByTestId('remove-0').locator('svg')).toHaveCount(1);
```

(use the actual `copy.remove` string).

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run tests/unit/icons.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `icons.ts`**

```ts
// One stroke-icon set for the whole app (24x24, round caps). Words stay in labels.ts and become
// each control's accessible name.
export type IconName = 'back' | 'edit' | 'delete' | 'add' | 'up' | 'down' | 'send' | 'attach' | 'camera' | 'emoji' | 'keyboard';

export const ICONS: Record<IconName, string[]> = {
  back: ['M15 5l-7 7 7 7'],
  edit: ['M4 20h4L19 9l-4-4L4 16v4z', 'M13.5 6.5l4 4'],
  delete: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  add: ['M12 5v14', 'M5 12h14'],
  up: ['M6 15l6-6 6 6'],
  down: ['M6 9l6 6 6-6'],
  send: ['M4 12l16-8-6 16-3-7-7-1z'],
  attach: ['M20 11l-8.5 8.5a5 5 0 01-7-7L13 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L14 7'],
  camera: ['M4 8h3l2-3h6l2 3h3v11H4z', 'M12 16a3 3 0 100-6 3 3 0 000 6z'],
  emoji: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2', 'M9 10h.01', 'M15 10h.01'],
  keyboard: ['M3 7h18v10H3z', 'M7 11h.01', 'M11 11h.01', 'M15 11h.01', 'M8 14h8']
};
```

- [ ] **Step 4: Implement `IconButton.svelte` and refactor `IconLink.svelte`**

`IconButton.svelte`:

```svelte
<script lang="ts">
  // A button that is only an icon. The words stay in labels.ts and become its accessible name.
  import { ICONS, type IconName } from '$lib/icons';
  let { icon, label, onclick, testid, tone = 'default', disabled = false, size = 44, type = 'button' }: {
    icon: IconName; label: string; onclick?: (e: MouseEvent) => void; testid?: string;
    tone?: 'default' | 'danger' | 'primary'; disabled?: boolean; size?: number; type?: 'button' | 'submit';
  } = $props();
</script>

<button {type} class="icon {tone}" style:--size="{size}px" aria-label={label} title={label} {disabled} {onclick} data-testid={testid}>
  <svg viewBox="0 0 24 24" width={Math.round(size / 2)} height={Math.round(size / 2)} aria-hidden="true">
    {#each ICONS[icon] as d}<path {d} />{/each}
  </svg>
</button>

<style>
  .icon { display: inline-grid; place-items: center; width: var(--size); height: var(--size); min-height: 0; margin: 0; padding: 0;
    border-radius: 50%; background: transparent; border: 1px solid #444; color: var(--gold-soft, #ffce5c); flex: none; }
  .icon:hover:not(:disabled) { background: #2a2a2a; }
  .icon:disabled { opacity: .4; }
  .danger { color: var(--danger, #ff8a80); border-color: #5a2a26; }
  .primary { background: var(--gold, #ffb400); color: #111; border-color: var(--gold, #ffb400); }
  .primary:hover:not(:disabled) { background: #ffc633; }
  svg { fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
</style>
```

`IconLink.svelte` — change the prop type to `icon: IconName`, render `{#each ICONS[icon] as d}<path {d} />{/each}` inside one `<svg viewBox="0 0 24 24" width="22" height="22">`, keep its existing classes (`back` margin, `edit` border).

- [ ] **Step 5: Use icons in `StopRow.svelte`**

Replace the three `.tiny` buttons in `.corner` with:

```svelte
      {#if canUp}<IconButton icon="up" size={32} label={copy.moveUp} onclick={() => onmove?.(-1)} testid="up-{index}" />{/if}
      {#if canDown}<IconButton icon="down" size={32} label={copy.moveDown} onclick={() => onmove?.(1)} testid="down-{index}" />{/if}
      <IconButton icon="delete" tone="danger" size={32} label={copy.remove} onclick={() => { if (confirm(copy.removeConfirm)) onremove(); }} testid="remove-{index}" />
```

Delete the now-unused `.tiny` styles; keep the `.head` padding rules (they count corner children).

- [ ] **Step 6: Run everything**

Run: `cd web && npm test && npm run check && npm run test:e2e -- controls.spec.ts planning.spec.ts bulletins.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/icons.ts web/src/lib/components/IconButton.svelte web/src/lib/components/IconLink.svelte web/src/lib/components/StopRow.svelte web/tests
git commit -m "feat(ui): one stroke-icon set and an IconButton; stop controls are icons"
```

---

### Task 7: Visual tokens, Ticket, Board and the new home

**Files:**
- Create: `web/src/lib/home.ts`, `web/src/lib/components/Ticket.svelte`, `web/src/lib/components/Board.svelte`, `web/src/lib/components/BoardRow.svelte`
- Modify: `web/src/routes/+layout.svelte` (tokens on `:root`), `web/src/routes/(app)/+page.svelte`, `web/src/lib/labels.ts`
- Test: `web/tests/unit/home.test.ts`, `web/tests/e2e/layout.spec.ts` (home assertions)

**Interfaces:**
- Produces:
  ```ts
  export function daysUntil(eventDate: string, today: string): number; // whole Chicago days, may be negative
  export type Chip = { text: string; tone: 'go' | 'gold' | 'muted' | 'red' };
  export function countdownText(eventDate: string, today: string): string | null; // "92 days" | "Tomorrow" | "Today" | null (past)
  export function plannerChip(drafts: number): Chip;
  export function liveChip(state: { hasRoute: boolean; isEventDay: boolean; eventDate: string | null }): Chip;
  export const wrapUpChip: Chip;
  ```
  `<Ticket kicker title when countdown href testid />`, `<Board heads={[left, right]}>{children}</Board>`, `<BoardRow href? icon title subtitle chip testid? actions?>` (`actions` is a snippet rendered under the subtitle).

- [ ] **Step 1: Add label strings**

In `labels.ts` `copy`, add:

```ts
  ticketKicker: 'The Route · Admit crew',
  noRouteYet: 'No route yet',
  noRouteHint: 'Build one or cheer one in the Route Planner',
  boardDestination: 'Destination',
  boardStatus: 'Status',
  boardRoute: 'Route',
  chipBoarding: 'Boarding',
  chipPractice: 'Practice',
  chipToday: 'Today',
  chipSoon: 'Soon',
  countdownDays: 'days',
  countdownTomorrow: 'Tomorrow',
  countdownToday: 'Today',
  draftsCount: 'drafts',
  draftsOne: 'draft',
  voteOpenShort: 'vote open',
  wrapUpHint: 'After the crawl',
  logOut: 'Log out',
```

(Reuse any existing key with the same text instead of duplicating it — `grep` first.)

- [ ] **Step 2: Write the failing unit test**

`web/tests/unit/home.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { countdownText, daysUntil, liveChip, plannerChip, wrapUpChip } from '../../src/lib/home';

describe('home', () => {
  it('counts whole Chicago days to the event', () => {
    expect(daysUntil('2026-12-26', '2026-09-25')).toBe(92);
    expect(daysUntil('2026-12-26', '2026-12-26')).toBe(0);
    expect(daysUntil('2026-12-26', '2026-12-27')).toBe(-1);
    // Across the March DST change the answer is still whole days.
    expect(daysUntil('2027-03-15', '2027-03-13')).toBe(2);
  });
  it('writes the countdown', () => {
    expect(countdownText('2026-12-26', '2026-09-25')).toBe('92 days');
    expect(countdownText('2026-12-26', '2026-12-25')).toBe('Tomorrow');
    expect(countdownText('2026-12-26', '2026-12-26')).toBe('Today');
    expect(countdownText('2026-12-26', '2026-12-27')).toBeNull();
  });
  it('chips', () => {
    expect(plannerChip(3)).toEqual({ text: 'Boarding', tone: 'go' });
    expect(plannerChip(0)).toEqual({ text: 'Boarding', tone: 'go' });
    expect(liveChip({ hasRoute: false, isEventDay: false, eventDate: null })).toEqual({ text: 'Soon', tone: 'muted' });
    expect(liveChip({ hasRoute: true, isEventDay: false, eventDate: '2026-12-26' })).toEqual({ text: 'Practice', tone: 'gold' });
    expect(liveChip({ hasRoute: true, isEventDay: true, eventDate: '2026-12-26' })).toEqual({ text: 'Today', tone: 'red' });
    expect(wrapUpChip).toEqual({ text: 'Soon', tone: 'muted' });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd web && npx vitest run tests/unit/home.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `home.ts`**

```ts
// What the home screen says: the countdown on the ticket and the status chips on the board.
import { copy } from './labels';

/** Whole days between two YYYY-MM-DD dates (both already Chicago dates). */
export function daysUntil(eventDate: string, today: string): number {
  const utc = (d: string) => { const [y, m, day] = d.split('-').map(Number); return Date.UTC(y, m - 1, day); };
  return Math.round((utc(eventDate) - utc(today)) / 86_400_000);
}

export function countdownText(eventDate: string, today: string): string | null {
  const n = daysUntil(eventDate, today);
  if (n < 0) return null;
  if (n === 0) return copy.countdownToday;
  if (n === 1) return copy.countdownTomorrow;
  return `${n} ${copy.countdownDays}`;
}

export type Chip = { text: string; tone: 'go' | 'gold' | 'muted' | 'red' };

export const plannerChip = (_drafts: number): Chip => ({ text: copy.chipBoarding, tone: 'go' });

export function liveChip(s: { hasRoute: boolean; isEventDay: boolean; eventDate: string | null }): Chip {
  if (!s.hasRoute) return { text: copy.chipSoon, tone: 'muted' };
  if (s.isEventDay) return { text: copy.chipToday, tone: 'red' };
  return { text: copy.chipPractice, tone: 'gold' };
}

export const wrapUpChip: Chip = { text: copy.chipSoon, tone: 'muted' };
```

- [ ] **Step 5: Tokens and the three components**

In `web/src/routes/+layout.svelte`'s `<style>`, add:

```css
  :global(:root) { --gold: #ffb400; --gold-soft: #ffce5c; --gold-deep: #6b4c10; --metra: #29C233; --board-bg: #0b0b0b; --danger: #ff8a80;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace; }
  @keyframes -global-flip { from { transform: rotateX(90deg); opacity: 0; } to { transform: none; opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { :global(.flip) { animation: none !important; } }
```

`Ticket.svelte`:

```svelte
<script lang="ts">
  let { kicker, title, when, countdown, href, testid }: { kicker: string; title: string; when?: string; countdown?: string | null; href: string; testid?: string } = $props();
</script>

<a class="ticket" {href} data-testid={testid}>
  <span class="k">{kicker}</span>
  <strong class="t">{title}</strong>
  {#if when || countdown}<span class="row"><span>{when}</span>{#if countdown}<span class="count">{countdown}</span>{/if}</span>{/if}
</a>

<style>
  .ticket { position: relative; display: block; color: #1a1406; text-decoration: none; border-radius: 14px; padding: 14px 18px;
    margin: 12px 0 14px; background: linear-gradient(135deg, #ffcf4a, var(--gold)); box-shadow: 0 6px 0 var(--gold-deep); }
  .ticket:active { transform: translateY(3px); box-shadow: 0 3px 0 var(--gold-deep); }
  .ticket::before, .ticket::after { content: ''; position: absolute; top: 58%; width: 20px; height: 20px; border-radius: 50%; background: #111; }
  .ticket::before { left: -10px; } .ticket::after { right: -10px; }
  .k { display: block; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; font-weight: 800; opacity: .7; }
  .t { display: block; font-size: 24px; font-weight: 900; margin: 2px 0 10px; overflow-wrap: anywhere; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; border-top: 2px dashed rgba(0,0,0,.35);
    padding-top: 8px; font-size: 13px; font-weight: 800; text-transform: uppercase; }
  .count { font-size: 24px; font-weight: 900; text-transform: none; }
</style>
```

`Board.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  let { heads, children, testid }: { heads: [string, string]; children: Snippet; testid?: string } = $props();
</script>

<div class="board" role="list" data-testid={testid}>
  <div class="hd" aria-hidden="true"><span>{heads[0]}</span><span>{heads[1]}</span></div>
  {@render children()}
</div>

<style>
  .board { background: var(--board-bg); border: 2px solid #333; border-radius: 12px; overflow: hidden; margin: 12px 0; }
  .hd { display: flex; justify-content: space-between; background: #1d1d1d; padding: 6px 12px; font-size: 11px;
    letter-spacing: .14em; text-transform: uppercase; color: var(--gold); font-weight: 800; }
</style>
```

`BoardRow.svelte`:

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { Chip } from '$lib/home';
  let { href, icon, title, subtitle, chip, testid, index = 0, actions }: {
    href?: string; icon?: string; title: string; subtitle?: string; chip?: Chip; testid?: string; index?: number; actions?: Snippet;
  } = $props();
</script>

<div class="row" role="listitem">
  {#if icon}<span class="ic" aria-hidden="true">{icon}</span>{/if}
  <div class="body">
    {#if href}<a {href} class="t flip" style:animation-delay="{index * 60}ms" data-testid={testid}>{title}</a>
    {:else}<span class="t flip off" style:animation-delay="{index * 60}ms" data-testid={testid}>{title}</span>{/if}
    {#if subtitle}<small>{subtitle}</small>{/if}
    {#if actions}<div class="acts">{@render actions()}</div>{/if}
  </div>
  {#if chip}<span class="chip {chip.tone}">{chip.text}</span>{/if}
</div>

<style>
  .row { display: flex; gap: 10px; align-items: center; padding: 12px; border-top: 1px solid #222; }
  .ic { font-size: 22px; width: 28px; text-align: center; }
  .body { flex: 1; min-width: 0; }
  .t { display: block; font-family: var(--mono); font-size: 17px; font-weight: 700; color: var(--gold-soft); text-transform: uppercase;
    text-decoration: none; overflow-wrap: anywhere; animation: flip .35s ease-out both; transform-origin: top; }
  a.t::after { content: ''; position: absolute; inset: 0; } /* whole row is the tap target */
  .row { position: relative; }
  .acts { position: relative; z-index: 1; display: flex; gap: 6px; margin-top: 8px; }
  .t.off { color: #777; }
  small { display: block; color: #999; font-size: 13px; margin-top: 2px; }
  .chip { font-family: var(--mono); font-size: 11px; font-weight: 800; padding: 4px 7px; border-radius: 4px; text-transform: uppercase; white-space: nowrap; }
  .go { background: var(--metra); color: #031; } .gold { background: var(--gold); color: #111; }
  .muted { background: #2a2a2a; color: #888; } .red { background: #c0261c; color: #fff; }
</style>
```

- [ ] **Step 6: Rewrite home**

`web/src/routes/(app)/+page.svelte` (keep the existing redirect effect and comments):

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { pb, auth, subscribe, logout } from '$lib/pb';
  import { label, copy } from '$lib/labels';
  import { fmtDate } from '$lib/time';
  import { liveDay } from '$lib/live/day.svelte';
  import { countdownText, liveChip, plannerChip, wrapUpChip } from '$lib/home';
  import Ticket from '$lib/components/Ticket.svelte';
  import Board from '$lib/components/Board.svelte';
  import BoardRow from '$lib/components/BoardRow.svelte';

  // (keep the existing comment about liveDay following the current route)
  const locked = $derived(liveDay.itinerary);
  $effect(() => { if (liveDay.isEventDay) void goto('/live', { replaceState: true }); });

  let drafts = $state(0), voting = $state(false);
  async function loadCounts() {
    try {
      const [d, v] = await Promise.all([
        pb.collection('itineraries').getList(1, 1, { filter: "status = 'draft'", fields: 'id' }),
        pb.collection('itineraries').getList(1, 1, { filter: "status = 'draft' && vote_open = true", fields: 'id' })
      ]);
      drafts = d.totalItems; voting = v.totalItems > 0;
    } catch { /* keep the last counts */ }
  }
  onMount(() => { void loadCounts(); return subscribe('itineraries', '', loadCounts); });

  const plannerSub = $derived(`${drafts} ${drafts === 1 ? copy.draftsOne : copy.draftsCount}${voting ? ` · ${copy.voteOpenShort}` : ''}`);
</script>

<p class="hello">{copy.welcome}</p>
<h1 data-testid="name">{$auth.user?.name}</h1>

{#if locked}
  <Ticket testid="nav-route" href="/route" kicker={copy.ticketKicker} title={locked.title}
    when="{fmtDate(locked.event_date)} · {locked.start_time}" countdown={countdownText(locked.event_date, liveDay.today)} />
{:else}
  <Ticket testid="nav-route" href="/plan" kicker={copy.ticketKicker} title={copy.noRouteYet} when={copy.noRouteHint} />
{/if}

<Board heads={[copy.boardDestination, copy.boardStatus]}>
  <BoardRow index={0} icon="🗺️" href="/plan" testid="nav-plan" title={label('planningPhase')} subtitle={plannerSub} chip={plannerChip(drafts)} />
  <BoardRow index={1} icon="🎟️" href={liveDay.hasRoute ? '/live' : undefined} testid={liveDay.hasRoute ? 'nav-live' : undefined}
    title={label('livePhase')} subtitle={liveDay.hasRoute ? copy.liveHint : copy.comingSoon}
    chip={liveChip({ hasRoute: liveDay.hasRoute, isEventDay: liveDay.isEventDay, eventDate: locked?.event_date ?? null })} />
  <BoardRow index={2} icon="🍻" title={label('wrapUpPhase')} subtitle={copy.wrapUpHint} chip={wrapUpChip} />
</Board>

<p class="foot">{copy.notYou}</p>

<style>
  .hello { margin: 16px 0 0; color: #999; font-size: 15px; }
  h1 { margin: 0 0 4px; }
  .foot { color: #777; font-size: 13px; text-align: center; margin-top: 20px; }
</style>
```

Check what `liveDay.today` returns (`day.svelte.ts:46`) — it must be a Chicago `YYYY-MM-DD`; if it is a Date, use `todayInTz(liveDay.realNow)`. Drop the `logout` import if `$lib/pb` has none (the footer text is enough; the menu owns logout). The old `copy.welcome` "Welcome aboard," is reused.

- [ ] **Step 7: e2e — home**

In `web/tests/e2e/layout.spec.ts`, inside `'off the event day there is no tab bar and home stays home'` (read it first), add:

```ts
  await expect(page.getByTestId('role')).toHaveCount(0);
  await expect(page.getByText('Conductor', { exact: true })).toHaveCount(0);
  await expect(page.getByTestId('nav-plan')).toBeVisible();
  await expect(page.getByTestId('nav-route')).toBeVisible();
```

Run `grep -rn "getByTestId('role')" web/tests/e2e` and delete any assertion on the removed role line.

- [ ] **Step 8: Run everything and commit**

Run: `cd web && npm test && npm run check && npm run test:e2e -- layout.spec.ts login.spec.ts practice.spec.ts`
Expected: PASS.

```bash
git add web/src/lib/home.ts web/src/lib/components/Ticket.svelte web/src/lib/components/Board.svelte web/src/lib/components/BoardRow.svelte web/src/routes web/src/lib/labels.ts web/tests
git commit -m "feat(home): the current route as a gold ticket over a departure board"
```

---

### Task 8: Planner list as a departure board, with delete

**Files:**
- Create: `web/src/lib/planList.ts`
- Modify: `web/src/routes/(app)/plan/+page.svelte`, `web/src/lib/labels.ts`
- Test: `web/tests/unit/planList.test.ts`, `web/tests/e2e/planning.spec.ts`

**Interfaces:**
- Consumes: `Board`, `BoardRow`, `Chip` (Task 7), `IconButton` (Task 6), `canDelete`, `canEditSettings` (Task 5).
- Produces:
  ```ts
  export function countBy(ids: string[]): Map<string, number>;
  export function routeChip(it: Pick<Itinerary, 'status' | 'vote_open' | 'id'>, currentId: string | null): Chip;
  export function sortRoutes<T extends Pick<Itinerary, 'status' | 'created'>>(items: T[]): T[]; // drafts first, then newest
  export function deleteConfirm(it: Pick<Itinerary, 'status' | 'id' | 'event_date'>, currentId: string | null, today: string): string;
  ```
  Shared delete action for Task 10: `export async function deleteRoute(it, currentId, today): Promise<boolean>` in `planList.ts` (confirm + `pb.collection('itineraries').delete`), returning whether it deleted.

- [ ] **Step 1: Labels**

Add to `copy`:

```ts
  newRoutePlaceholder: 'Name a new route…',
  newRoute: 'New route',
  byBuilder: 'by',
  stopsShort: 'stops',
  editRoute: 'Edit route',
  deleteRoute: 'Delete route',
  chipDraft: 'Draft',
  chipVoteOpen: 'Vote open',
  chipLocked: 'Locked',
  chipCurrent: 'Current',
  chipArchived: 'Archived',
  deleteLockedConfirm: 'Delete this route for everyone? Its stops, crew chat, check-ins, Tab and Bulletins go with it.',
  deleteCurrentConfirm: 'This is the current route: Live will move to the next locked route.',
  deleteTodayConfirm: 'The crew is riding this route today.',
```

- [ ] **Step 2: Write the failing unit test**

`web/tests/unit/planList.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { countBy, deleteConfirm, routeChip, sortRoutes } from '../../src/lib/planList';
import { copy } from '../../src/lib/labels';

describe('planList', () => {
  it('counts ids', () => {
    expect([...countBy(['a', 'b', 'a'])]).toEqual([['a', 2], ['b', 1]]);
    expect(countBy([]).size).toBe(0);
  });
  it('chips each status, current first', () => {
    expect(routeChip({ id: 'x', status: 'draft', vote_open: false }, null)).toEqual({ text: 'Draft', tone: 'go' });
    expect(routeChip({ id: 'x', status: 'draft', vote_open: true }, null)).toEqual({ text: 'Vote open', tone: 'go' });
    expect(routeChip({ id: 'x', status: 'locked', vote_open: false }, 'x')).toEqual({ text: 'Current', tone: 'gold' });
    expect(routeChip({ id: 'x', status: 'locked', vote_open: false }, 'y')).toEqual({ text: 'Locked', tone: 'gold' });
    expect(routeChip({ id: 'x', status: 'archived', vote_open: false }, null)).toEqual({ text: 'Archived', tone: 'muted' });
  });
  it('drafts first, then newest', () => {
    const r = (id: string, status: 'draft' | 'locked' | 'archived', created: string) => ({ id, status, created });
    expect(sortRoutes([r('a', 'locked', '2026-09-03'), r('b', 'draft', '2026-09-01'), r('c', 'draft', '2026-09-02'), r('d', 'archived', '2026-09-04')]).map((x) => x.id))
      .toEqual(['c', 'b', 'd', 'a']);
  });
  it('warns harder for locked, current and today', () => {
    expect(deleteConfirm({ id: 'x', status: 'draft', event_date: '2026-12-26' }, null, '2026-09-25')).toBe(copy.deleteDraftConfirm);
    const locked = deleteConfirm({ id: 'x', status: 'locked', event_date: '2026-12-26' }, 'y', '2026-09-25');
    expect(locked).toBe(copy.deleteLockedConfirm);
    const current = deleteConfirm({ id: 'x', status: 'locked', event_date: '2026-12-26' }, 'x', '2026-09-25');
    expect(current).toContain(copy.deleteCurrentConfirm);
    const today = deleteConfirm({ id: 'x', status: 'locked', event_date: '2026-12-26' }, 'x', '2026-12-26');
    expect(today.startsWith(copy.deleteTodayConfirm)).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd web && npx vitest run tests/unit/planList.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `planList.ts`**

```ts
// The planner's departure board: counts, status chips, order, and the delete confirmation.
import { pb } from './pb';
import { copy } from './labels';
import type { Chip } from './home';
import type { Itinerary } from './types';

export function countBy(ids: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
  return m;
}

export function routeChip(it: Pick<Itinerary, 'status' | 'vote_open' | 'id'>, currentId: string | null): Chip {
  if (it.status === 'draft') return { text: it.vote_open ? copy.chipVoteOpen : copy.chipDraft, tone: 'go' };
  if (it.status === 'locked') return { text: it.id === currentId ? copy.chipCurrent : copy.chipLocked, tone: 'gold' };
  return { text: copy.chipArchived, tone: 'muted' };
}

export function sortRoutes<T extends Pick<Itinerary, 'status' | 'created'>>(items: T[]): T[] {
  return [...items].sort((a, b) => Number(b.status === 'draft') - Number(a.status === 'draft') || String(b.created).localeCompare(String(a.created)));
}

export function deleteConfirm(it: Pick<Itinerary, 'status' | 'id' | 'event_date'>, currentId: string | null, today: string): string {
  if (it.status === 'draft') return copy.deleteDraftConfirm;
  const parts = [copy.deleteLockedConfirm];
  if (it.id === currentId) parts.push(copy.deleteCurrentConfirm);
  if (it.id === currentId && it.event_date === today) parts.unshift(copy.deleteTodayConfirm);
  return parts.join(' ');
}

/** Confirm, then delete. Returns whether the route is gone. Throws on a failed delete. */
export async function deleteRoute(it: Pick<Itinerary, 'status' | 'id' | 'event_date'>, currentId: string | null, today: string): Promise<boolean> {
  if (!confirm(deleteConfirm(it, currentId, today))) return false;
  await pb.collection('itineraries').delete(it.id);
  return true;
}
```

- [ ] **Step 5: Rewrite the planner list page**

`web/src/routes/(app)/plan/+page.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { pb, auth, subscribe } from '$lib/pb';
  import { label, copy } from '$lib/labels';
  import { liveDay } from '$lib/live/day.svelte';
  import { canDelete, canEditSettings } from '$lib/permissions';
  import { countBy, deleteRoute, routeChip, sortRoutes } from '$lib/planList';
  import Board from '$lib/components/Board.svelte';
  import BoardRow from '$lib/components/BoardRow.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import type { Itinerary, UserRecord } from '$lib/types';

  type Row = Itinerary & { expand?: { created_by?: UserRecord } };
  let items = $state<Row[]>([]);
  let stops = $state(new Map<string, number>());
  let cheers = $state(new Map<string, number>());
  let title = $state(''), busy = $state(false), error = $state('');

  async function load() {
    try {
      const [its, st, vs] = await Promise.all([
        pb.collection('itineraries').getFullList<Row>({ sort: '-created', expand: 'created_by' }),
        pb.collection('stops').getFullList<{ itinerary: string }>({ fields: 'itinerary' }),
        pb.collection('votes').getFullList<{ target_id: string }>({ filter: "target_collection = 'itineraries' && value = 'up'", fields: 'target_id' })
      ]);
      items = sortRoutes(its); stops = countBy(st.map((s) => s.itinerary)); cheers = countBy(vs.map((v) => v.target_id));
    } catch { error = copy.loadError; }
  }
  onMount(() => {
    void load();
    const offs = [subscribe('itineraries', '', load), subscribe('stops', '', load), subscribe('votes', '', load)];
    return () => offs.forEach((off) => off());
  });

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !title.trim()) return;
    busy = true; error = '';
    try {
      const record = await pb.collection('itineraries').create<Itinerary>({ title: title.trim(), created_by: $auth.user?.id });
      await goto(`/plan/${record.id}/edit`);
    } catch (err) { error = (err as Error).message || copy.genericError; }
    finally { busy = false; }
  }

  const currentId = $derived(liveDay.itinerary?.id ?? null);
  const hrefFor = (it: Row) => (it.status === 'locked' && it.id === currentId ? '/route' : `/plan/${it.id}`);
  const subtitle = (it: Row) => `${copy.byBuilder} ${it.expand?.created_by?.name ?? '…'} · ${stops.get(it.id) ?? 0} ${copy.stopsShort} · 🍻 ${cheers.get(it.id) ?? 0}`;

  async function remove(it: Row) {
    error = '';
    try { if (await deleteRoute(it, currentId, liveDay.today)) await load(); }
    catch (err) { error = (err as Error).message || copy.genericError; }
  }
</script>

<h1>{label('planningPhase')}</h1>
<p class="intro">{copy.plannerIntro}</p>

<form class="new" onsubmit={create} aria-busy={busy}>
  <label for="title" class="sr">{copy.draftTitle}</label>
  <input id="title" bind:value={title} placeholder={copy.newRoutePlaceholder} maxlength="80" required data-testid="draft-title" disabled={busy} />
  <IconButton type="submit" icon="add" tone="primary" label={copy.newRoute} disabled={busy} testid="create-draft" size={48} />
</form>
{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if items.length === 0}<p>{copy.noDrafts}</p>{/if}
<Board heads={[copy.boardRoute, copy.boardStatus]} testid="route-board">
  {#each items as it, i (it.id)}
    <BoardRow index={i} href={hrefFor(it)} testid="route-link-{it.id}" title={it.title} subtitle={subtitle(it)} chip={routeChip(it, currentId)}>
      {#snippet actions()}
        {#if canEditSettings(it, $auth.user)}<IconButton icon="edit" size={36} label={copy.editRoute} onclick={() => goto(`/plan/${it.id}/edit`)} testid="edit-route-{it.id}" />{/if}
        {#if canDelete(it, $auth.user)}<IconButton icon="delete" tone="danger" size={36} label={copy.deleteRoute} onclick={() => void remove(it)} testid="delete-route-{it.id}" />{/if}
      {/snippet}
    </BoardRow>
  {/each}
</Board>

<style>
  .intro { color: #aaa; margin-top: 0; }
  .new { display: flex; gap: 8px; align-items: center; margin: 16px 0; }
  .new input { flex: 1; margin: 0; border-radius: 24px; }
  .sr { position: absolute; left: -9999px; }
</style>
```

Note: `BoardRow` must accept the `actions` snippet only when at least one icon renders — passing an always-present snippet that renders nothing leaves an empty `.acts` div; acceptable, but set `.acts:empty { display: none; }` in `BoardRow`. The old `draft-link-{id}` test id is replaced by `route-link-{id}`: `grep -rn "draft-link-" web/tests` and update.

Edit: the route's `edit` icon for a locked route (Conductor) goes to `/plan/{id}/edit`, which is the staged editor — correct.

- [ ] **Step 6: e2e — delete from the board, and a watcher falls back**

Append to `web/tests/e2e/planning.spec.ts`:

```ts
test('the builder deletes their draft from the board with the trash icon', async ({ page }) => {
  await login(page, 'E2E Tidy', process.env.CREW_PASSWORD ?? 'crew-test-password');
  await page.getByTestId('nav-plan').click();
  await page.getByTestId('draft-title').fill('Short Lived');
  await page.getByTestId('create-draft').click();
  await expect(page).toHaveURL(/\/edit$/);
  const id = page.url().match(/plan\/([a-z0-9]{15})/)![1];
  await page.goto('/plan');
  await expect(page.getByTestId(`route-link-${id}`)).toContainText(/short lived/i);
  await expect(page.getByTestId(`route-link-${id}`).locator('..')).toContainText('by E2E Tidy');
  page.once('dialog', (d) => d.accept());
  await page.getByTestId(`delete-route-${id}`).click();
  await expect(page.getByTestId(`route-link-${id}`)).toHaveCount(0);
});
```

In `web/tests/e2e/practice.spec.ts` (it already seeds locked routes and uses two browsers — read `'the Conductor makes a route current and another phone’s Live follows it'`), add a test: seed one locked route with `seedLockedCrawl`, open `/live` on a crew page, Conductor deletes it from `/plan` (`delete-route-{id}`, accept dialog), then on the crew page expect `no-active-route` to be visible, then `await crewPage.context().setOffline(true); await crewPage.reload();` and expect `no-active-route` still visible (not the deleted route's title). If offline reload cannot load the app shell in this harness, instead assert via `page.evaluate` that IndexedDB has no mirror (read the DB/store names from `web/src/lib/offline.ts`).

- [ ] **Step 7: Run everything and commit**

Run: `cd web && npm test && npm run check && npm run test:e2e -- planning.spec.ts practice.spec.ts`
Expected: PASS.

```bash
git add web/src/lib/planList.ts web/src/routes/\(app\)/plan/+page.svelte web/src/lib/labels.ts web/src/lib/components/BoardRow.svelte web/tests
git commit -m "feat(planner): every route on one departure board, with builder, counts and icon actions"
```

---

### Task 9: The unfolded line

**Files:**
- Modify: `web/src/lib/lineMap.ts` (add `unfold`), `web/src/lib/components/LineMap.svelte`, `web/src/lib/components/ItineraryView.svelte`, `web/src/lib/labels.ts`
- Test: `web/tests/unit/lineMap.test.ts`, `web/tests/e2e/planning.spec.ts` (update the side-right part of the big test), any spec using `side-left`/`side-right`/`map-row-`

**Interfaces:**
- Consumes: `placeStops`, `Placement`, `MapRow`.
- Produces:
  ```ts
  export type Section = 'out' | 'back';
  export type SectionRow = { station: Station; stops: number[] };
  export function unfold(p: Placement): { out: SectionRow[]; back: SectionRow[] };
  ```
  `LineMap` props: `{ stations, color?, selected?, onpick?, pickLabel?, section?: Section, cell?: Snippet<[Station, number]> }`. Test ids: out section `map-row-{id}` / `station-dot-{id}`; back section `map-row-back-{id}` / `station-dot-back-{id}`.

- [ ] **Step 1: Write the failing unit test**

Append to `web/tests/unit/lineMap.test.ts` (import `unfold`):

```ts
describe('unfold', () => {
  it('lists every station twice: toward Chicago top-down, then back out bottom-up', () => {
    const p = placeStops(stations, dir('NAPERVILLE+', 'CUS+', 'LAGRANGE-'));
    const u = unfold(p);
    expect(u.out.map((r) => [r.station.id, r.stops])).toEqual([['AURORA', []], ['NAPERVILLE', [0]], ['LAGRANGE', []], ['CUS', [1]]]);
    expect(u.back.map((r) => [r.station.id, r.stops])).toEqual([['CUS', []], ['LAGRANGE', [2]], ['NAPERVILLE', []], ['AURORA', []]]);
  });
  it('an all-return route leaves the outbound section empty but present', () => {
    const u = unfold(placeStops(stations, dir('LAGRANGE-', 'AURORA-')));
    expect(u.out.every((r) => r.stops.length === 0)).toBe(true);
    expect(u.out).toHaveLength(4);
    expect(u.back.flatMap((r) => r.stops)).toEqual([0, 1]);
  });
  it('does not include off-line stops and does not mutate the placement', () => {
    const p = placeStops(stations, stops('ELMHURST', 'LAGRANGE'));
    const before = JSON.stringify(p);
    const u = unfold(p);
    expect([...u.out, ...u.back].flatMap((r) => r.stops)).toEqual([1]);
    expect(p.offLine).toEqual([0]);
    expect(JSON.stringify(p)).toBe(before);
  });
  it('handles no stations', () => {
    expect(unfold(placeStops([], []))).toEqual({ out: [], back: [] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run tests/unit/lineMap.test.ts`
Expected: FAIL — `unfold` not exported.

- [ ] **Step 3: Implement `unfold`**

Append to `web/src/lib/lineMap.ts`:

```ts
/** Which half of the unfolded line: toward Chicago (the left side) or back out (the right side). */
export type Section = 'out' | 'back';
export type SectionRow = { station: Station; stops: number[] };

/**
 * The line drawn as the day is ridden: every station top to bottom with the stops reached heading
 * toward Chicago, then every station again bottom to top with the stops reached on the way back.
 * Off-line stops stay in `placement.offLine`.
 */
export function unfold(p: Placement): { out: SectionRow[]; back: SectionRow[] } {
  return {
    out: p.rows.map((r) => ({ station: r.station, stops: [...r.left] })),
    back: [...p.rows].reverse().map((r) => ({ station: r.station, stops: [...r.right] }))
  };
}

export const sideOfSection = (s: Section): Side => (s === 'back' ? 'right' : 'left');
```

Run the test: PASS.

- [ ] **Step 4: Simplify `LineMap.svelte` to one column**

Replace its script and markup:

```svelte
<script lang="ts">
  // One line drawn top to bottom with a row per station: the circle on the line, the station's
  // cell to its right (label and stop cards). The unfolded route draws two of these — toward
  // Chicago, then back out — so `section` namespaces the test ids.
  import type { Snippet } from 'svelte';
  import type { Station } from '$lib/types';
  import type { Section } from '$lib/lineMap';

  let { stations, color = '#29C233', selected, section = 'out', onpick, pickLabel, cell }: {
    stations: Station[]; color?: string; selected?: string; section?: Section;
    /** When set, each station's circle is a button. */
    onpick?: (station: Station) => void; pickLabel?: (station: Station) => string;
    cell?: Snippet<[Station, number]>;
  } = $props();
  const tid = (kind: string, id: string) => (section === 'back' ? `${kind}-back-${id}` : `${kind}-${id}`);
</script>

<div class="map" style:--line={color} role="list" data-section={section}>
  {#each stations as station, i (station.id)}
    <div class="row" role="listitem" data-testid={tid('map-row', station.id)} data-served={station.served === false ? 'false' : 'true'}>
      <div class="track" class:first={i === 0} class:last={i === stations.length - 1}>
        {#if station.served === false}
          <span class="dot off" aria-hidden="true"></span>
        {:else if onpick}
          <button type="button" class="pick" data-testid={tid('station-dot', station.id)} aria-label={pickLabel?.(station) ?? station.name}
            aria-pressed={selected === station.id} onclick={() => onpick(station)}><span class="dot plus" class:on={selected === station.id} aria-hidden="true"></span></button>
        {:else}
          <span class="dot" class:on={selected === station.id} aria-hidden="true"></span>
        {/if}
      </div>
      <div class="cell">{@render cell?.(station, i)}</div>
    </div>
  {/each}
</div>
```

Styles: keep the `.track`, `.dot`, `.pick`, `.plus` rules; change `.row` to `grid-template-columns: var(--track) minmax(0, 1fr); column-gap: 10px;`, move `--track: 36px; --dot-y: 24px;` onto `.map`, delete `.viewport`, `.panes*`, `.left` rules.

`Schematic.svelte` uses `LineMap` with `left`/`right` snippets — read it and switch it to `cell` (render whatever it rendered on the side it used). Run `npm run check` to catch every caller.

- [ ] **Step 5: Render the unfolded line in `ItineraryView.svelte`**

Remove `focused`, `map`, the `.tabs` markup and styles, the `label` snippet's focus gating, and the `left`/`right` snippets. Add:

```ts
  import { PLANNER_ROUTE, placeStops, plannerStations, sideOfSection, unfold, type Section } from '$lib/lineMap';
  const sections = $derived(unfold(placement));
```

Markup replacing the `{:else if stations.length}` branch:

```svelte
{:else if stations.length}
  {#each [['out', sections.out], ['back', sections.back]] as [section, rows] (section)}
    {@const sec = section as Section}
    {@const list = (rows as typeof sections.out).map((r) => r.station)}
    <h3 class="dir" data-testid="section-{sec}">{sec === 'out' ? '▼' : '▲'} {sec === 'out' ? copy.inbound : copy.outbound}</h3>
    <LineMap stations={list} color={lineColor} section={sec}
      onpick={editable ? (s) => { rememberScroll(); actions.add(s.id, sideOfSection(sec)); } : undefined}
      pickLabel={(s) => `${copy.addAt} ${stationLabel(s)}`}>
      {#snippet cell(station, i)}
        {@render label(station, i, list.length)}
        {#each (rows as typeof sections.out)[i].stops as k (sorted[k].id)}{@render card(k)}{/each}
      {/snippet}
    </LineMap>
    {#if sec === 'out'}<p class="turn" aria-hidden="true">↩ {copy.turnAround}</p>{/if}
  {/each}
  {#if placement.offLine.length}
    <h3>{copy.offLine}</h3>
    <div class="list">{#each placement.offLine as k (sorted[k].id)}{@render card(k)}{/each}</div>
  {/if}
```

Change the `label` snippet signature to `(station: Station, i: number, n: number)` and use `i === 0 || i === n - 1` for `terminal`. Keep `copy.inbound` ("Aurora → Chicago") for `out` and `copy.outbound` ("Chicago → Aurora") for `back` — they already name the directions this way. Add `turnAround: 'Turn around'` to `copy`. Styles:

```css
  .dir { font-size: 12px; letter-spacing: .14em; text-transform: uppercase; color: var(--gold); margin: 18px 0 6px 46px; }
  .turn { text-align: center; color: var(--metra); font-weight: 700; font-size: 13px; margin: 8px 0; }
  .name { display: block; padding: 14px 0 6px; font-size: 13px; color: #888; line-height: 1.3; }
```

Stop cards now always sit to the right of the line; in `StopRow.svelte` remove any `data-side`-dependent alignment (keep the `data-side` attribute — tests read it).

- [ ] **Step 6: Update the e2e flow**

In the big planning test (`web/tests/e2e/planning.spec.ts:57-75`), replace the pane steps:

```ts
  // Both are going stops, each in its station's row of the outbound half.
  await expect(page.getByTestId('map-row-NAPERVILLE').getByTestId('stop-row-0')).toHaveAttribute('data-side', 'left');
  await expect(page.getByTestId('map-row-LAGRANGE').getByTestId('stop-row-1')).toHaveAttribute('data-side', 'left');

  // A circle tapped on the way-back half makes a return stop, slotted after the going stops.
  await expect(page.getByTestId('section-back')).toBeVisible();
  await page.getByTestId('station-dot-back-NAPERVILLE').click();
  await expect(page).toHaveURL(/side=right$/);
  await expect(page.getByTestId('dir-back')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('venue-node-2').click();
  await expect(page.getByTestId('map-row-back-NAPERVILLE').getByTestId('stop-row-2')).toHaveAttribute('data-side', 'right');
  await expect(page.getByTestId('map-row-NAPERVILLE').getByTestId('stop-row-2')).toHaveCount(0);
```

and change `map-row-NAPERVILLE` to `map-row-back-NAPERVILLE` for `stop-row-3` a few lines later. Then: `grep -rn "side-left\|side-right\|map-row-\|station-dot-" web/tests/e2e` and fix each to the section-aware ids (a return stop lives under `map-row-back-…`).

- [ ] **Step 7: Run everything and commit**

Run: `cd web && npm test && npm run check && npm run test:e2e`
Expected: PASS.

```bash
git add web/src/lib/lineMap.ts web/src/lib/components/LineMap.svelte web/src/lib/components/ItineraryView.svelte web/src/lib/components/Schematic.svelte web/src/lib/components/StopRow.svelte web/src/lib/labels.ts web/tests
git commit -m "feat(route): unfold the line — out toward Chicago, turn around, every station again on the way back"
```

---

### Task 10: Route detail header, actions and voting

**Files:**
- Modify: `web/src/lib/components/ItineraryView.svelte` (header + stats), `web/src/routes/(app)/plan/[id]/+page.svelte` (top bar, delete), `web/src/routes/(app)/plan/[id]/edit/+page.svelte` (delete becomes an icon in the nav), `web/src/lib/components/Votes.svelte` (pills), `web/src/lib/components/ApprovalPanel.svelte` (big Go / No-go), `web/src/lib/components/LegRow.svelte` (green), `web/src/lib/labels.ts`
- Test: `web/tests/unit/routeStats.test.ts`, `web/tests/e2e/planning.spec.ts`

**Interfaces:**
- Consumes: `canDelete`, `canEditStops` (Task 5), `deleteRoute` (Task 8), `IconButton`, `IconLink` (Task 6).
- Produces: `export function finishAt(leaveTimes: (Date | null)[]): Date | null` in `web/src/lib/routeStats.ts` (last non-null leave time). `ItineraryView` gains optional `builder?: string` and `current?: boolean` props.

- [ ] **Step 1: Labels**

```ts
  kindDraftRoute: 'Draft route',
  kindTheRoute: 'The Route',
  kindArchived: 'Archived route',
  statStops: 'stops',
  statStart: 'start',
  statFinish: 'finish',
```

- [ ] **Step 2: Failing unit test**

`web/tests/unit/routeStats.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { finishAt } from '../../src/lib/routeStats';

describe('finishAt', () => {
  it('is the last known leave time', () => {
    const a = new Date('2026-12-26T18:00:00Z'), b = new Date('2026-12-26T22:40:00Z');
    expect(finishAt([a, b])).toEqual(b);
    expect(finishAt([a, null])).toEqual(a);
    expect(finishAt([])).toBeNull();
  });
});
```

Run: `cd web && npx vitest run tests/unit/routeStats.test.ts` → FAIL. Implement `web/src/lib/routeStats.ts`:

```ts
/** When the crawl finishes: the last stop's leave time that is known. */
export function finishAt(leaveTimes: (Date | null)[]): Date | null {
  for (let i = leaveTimes.length - 1; i >= 0; i--) if (leaveTimes[i]) return leaveTimes[i];
  return null;
}
```

Run again → PASS.

- [ ] **Step 3: Board-style header in `ItineraryView.svelte`**

Replace the `<header class="it">` block (keep the start-time control branch intact inside it):

```svelte
<header class="it">
  <span class="k">{itinerary.status === 'draft' ? copy.kindDraftRoute : itinerary.status === 'locked' ? copy.kindTheRoute : copy.kindArchived}</span>
  <h1>{itinerary.title}</h1>
  <div class="chips">
    {#if builder}<span class="chip">{copy.byBuilder} {builder}</span>{/if}
    <span class="chip">{fmtDate(itinerary.event_date)}</span>
    {#if itinerary.vote_open}<span class="chip go">{copy.voteOpenShort}</span>{/if}
    {#if current}<span class="chip gold">{copy.chipCurrent}</span>{/if}
  </div>
  <div class="stats">
    <div><strong>{sorted.length}</strong><small>{copy.statStops}</small></div>
    <div>
      {#if canManage && actions.setStartTime}
        <input type="time" aria-label={copy.startTime} bind:value={startTime} onchange={() => { if (/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) && startTime !== itinerary.start_time) void actions.setStartTime?.(startTime); }} data-testid="start-time" />
      {:else}<strong>{itinerary.start_time}</strong>{/if}
      <small>{copy.statStart}</small>
    </div>
    <div><strong>{finish ? fmtTime(finish) : '—'}</strong><small>{copy.statFinish}</small></div>
  </div>
</header>
```

with `const finish = $derived(finishAt(sorted.map((_, i) => leaveAt(i))));` and imports of `fmtTime`, `finishAt`. Styles:

```css
  .it { background: var(--board-bg); border: 2px solid #333; border-radius: 12px; padding: 12px 14px; margin: 4px 0 12px; }
  .it .k { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--gold); font-weight: 800; }
  .it h1 { font-family: var(--mono); color: var(--gold-soft); text-transform: uppercase; font-size: 24px; margin: 4px 0 8px; overflow-wrap: anywhere; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { font-size: 12px; font-weight: 700; padding: 3px 9px; border-radius: 999px; background: #222; color: #ccc; }
  .chip.go { background: var(--metra); color: #031; } .chip.gold { background: var(--gold); color: #111; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); text-align: center; border-top: 1px solid #222; margin-top: 10px; padding-top: 8px; }
  .stats strong { display: block; font-family: var(--mono); font-size: 20px; color: var(--gold); }
  .stats small { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: #888; }
  .stats input { width: 100%; max-width: 110px; margin: 0 auto; padding: 4px; font-family: var(--mono); font-size: 18px; text-align: center; }
```

Keep `getByRole('heading', { name })` working: the title stays in an `<h1>` with its original text (uppercase is CSS only).

- [ ] **Step 4: Top bar with edit and delete on the view page**

`routes/(app)/plan/[id]/+page.svelte`:

```svelte
<nav class="bar">
  <IconLink href="/plan" icon="back" label={copy.backToPlanner} />
  <span class="sp"></span>
  {#if draft && canEdit}<IconLink href="/plan/{draft.itinerary.id}/edit" icon="edit" label={copy.editDraft} testid="edit-draft" />{/if}
  {#if draft && mayDelete}<IconButton icon="delete" tone="danger" label={copy.deleteRoute} onclick={() => void removeRoute()} testid="delete-route" />{/if}
</nav>
```

with

```ts
  async function removeRoute() {
    if (!draft) return;
    error = '';
    try { if (await deleteRoute(draft.itinerary, liveDay.itinerary?.id ?? null, liveDay.today)) await goto('/plan'); }
    catch (err) { error = (err as Error).message || copy.genericError; }
  }
```

and `.bar { display: flex; gap: 8px; align-items: center; } .sp { flex: 1; }`. Pass `builder` to `ItineraryView`: load the builder name by adding `expand: 'created_by'` to the itinerary read in `$lib/draft` (`loadDraft`/`draftFrom`) — read `web/src/lib/draft.ts`, add `expand: 'created_by'` to the itinerary `getOne`, and pass `builder={draft.itinerary.expand?.created_by?.name}` and `current={liveDay.itinerary?.id === draft.itinerary.id}`. Add `expand?: { created_by?: UserRecord }` to the `Itinerary` type if `npm run check` asks.

`routes/(app)/plan/[id]/edit/+page.svelte`: move delete from the bottom `secondary` button into the `<nav>` as the same `IconButton` (test id `delete-route`), shown when `canDelete(draft.itinerary, $auth.user)` and **not** `live` (the staged editor deletes from the view page, never mid-edit). Remove the old `delete-draft` button and `deleteDraft()`; replace it with `removeRoute()` as above. `grep -rn "delete-draft" web/tests` and switch to `delete-route`.

On `/route` (`routes/(app)/route/+page.svelte`) pass `builder` only if the route read already carries it — do not add a query there; `current` is `true`.

- [ ] **Step 5: Pills, Go / No-go, green legs**

`Votes.svelte` style replacement (markup unchanged):

```css
  .votes { display: flex; gap: 8px; margin: 12px 0 16px; }
  .votes button { margin: 0; min-height: 40px; padding: 8px 12px; border-radius: 999px; font-size: 15px; }
  .active { background: var(--gold); color: #111; border-color: var(--gold); }
```

`ApprovalPanel.svelte`: in the `{#if open}` row, give the Go button `class="go"` and No-go `class="nogo"` (keep `class:active` and test ids), and style:

```css
  .row button.go { background: var(--metra); color: #031; font-size: 20px; min-height: 56px; }
  .row button.nogo { background: transparent; color: var(--danger); border: 2px solid #5a2a26; font-size: 20px; min-height: 56px; }
  .active { outline: 3px solid #fff; outline-offset: 2px; }
```

`LegRow.svelte`: read it, and colour the train leg text `var(--metra)` with `font-family: var(--mono)`; keep content and test ids.

- [ ] **Step 6: e2e**

In the big planning test, after `done-editing` lands on `draftUrl`, add:

```ts
  await expect(page.getByTestId('delete-route')).toBeVisible();
  await expect(page.locator('header.it')).toContainText('by E2E Skipper');
  await expect(page.locator('header.it')).toContainText('stops');
```

Append a test: the Conductor opens a locked route's `/plan/{id}` (seed via `seedLockedCrawl` from `helpers.ts`), clicks `delete-route`, the dialog message contains `copy.deleteLockedConfirm`'s first words ("Delete this route for everyone"), accepts, lands on `/plan`, and the route is gone from `route-board`.

- [ ] **Step 7: Run everything and commit**

Run: `cd web && npm test && npm run check && npm run test:e2e`
Expected: PASS.

```bash
git add web/src/lib web/src/routes web/tests
git commit -m "feat(route): board header with builder and stats, icon edit/delete, cheers pills, big Go / No-go"
```

---

### Task 11: ChatBox, and Live's photos move into it

**Files:**
- Create: `web/src/lib/chatBox.ts`, `web/src/lib/components/ChatBox.svelte`
- Modify: `web/src/lib/live/upload.ts` (add `compressForUpload`), `web/src/lib/components/CrewChat.svelte`, `web/src/routes/(app)/live/+page.svelte`, `web/src/lib/components/FreightStrip.svelte`, `web/src/lib/labels.ts`
- Test: `web/tests/unit/chatBox.test.ts`, `web/tests/e2e/chat.spec.ts`, `freight.spec.ts`, `tab.spec.ts`, `liveUx.spec.ts`, `offline.spec.ts`

**Interfaces:**
- Produces:
  ```ts
  // chatBox.ts
  export const CHAT_EMOJI: readonly string[]; // 16 entries
  export type ComposerMode = 'send' | 'camera';
  export function composerMode(text: string, mediaEnabled: boolean): ComposerMode;
  export function insertAt(text: string, insert: string, start: number, end: number): { text: string; caret: number };
  export function draftAfterFailedSend(current: string, submitted: string): string;
  // upload.ts
  export async function compressForUpload(file: File): Promise<Prepared>; // prepare() with the browser-image-compression worker
  ```
  `<ChatBox onsend={(text) => Promise<void>} onfiles?={(files: File[]) => Promise<void>} busy? mediaOff?: string maxlength placeholder inputTestid sendTestid fileTestid? cameraTestid? />`

- [ ] **Step 1: Labels**

```ts
  emojiTray: 'Emoji',
  keyboard: 'Keyboard',
  attachMedia: 'Photo or video',
  noTabStopForPhotos: 'Photos open once the crew reaches its first stop',
```

(`copy.takePhoto`, `copy.sendMessage`, `copy.messagePlaceholder` already exist.)

- [ ] **Step 2: Failing unit test**

`web/tests/unit/chatBox.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CHAT_EMOJI, composerMode, draftAfterFailedSend, insertAt } from '../../src/lib/chatBox';

describe('chat box', () => {
  it('offers sixteen crawl emoji', () => {
    expect(CHAT_EMOJI).toHaveLength(16);
    expect(new Set(CHAT_EMOJI).size).toBe(16);
  });
  it('is a camera until there is real text', () => {
    expect(composerMode('', true)).toBe('camera');
    expect(composerMode('   ', true)).toBe('camera');
    expect(composerMode('hi', true)).toBe('send');
    expect(composerMode('', false)).toBe('send');
  });
  it('a failed send gives the text back only if nothing new was typed', () => {
    expect(draftAfterFailedSend('', 'On my way')).toBe('On my way');
    expect(draftAfterFailedSend('  ', 'On my way')).toBe('On my way');
    expect(draftAfterFailedSend('Also bring cash', 'On my way')).toBe('Also bring cash');
  });
  it('inserts at the caret, replacing a selection', () => {
    expect(insertAt('Save me', '🍕', 7, 7)).toEqual({ text: 'Save me🍕', caret: 9 });
    expect(insertAt('ab', '🍻', 1, 1)).toEqual({ text: 'a🍻b', caret: 3 });
    expect(insertAt('abc', 'X', 1, 2)).toEqual({ text: 'aXc', caret: 2 });
  });
});
```

Run → FAIL. Implement `web/src/lib/chatBox.ts`:

```ts
// The chat box's pure parts: the emoji tray, which button the round button is, and caret inserts.
export const CHAT_EMOJI = ['🍻', '🍺', '🥂', '🍕', '🚆', '🎅', '🎄', '🔥', '😂', '🙌', '👍', '❤️', '🥴', '🤮', '⏰', '📍'] as const;

export type ComposerMode = 'send' | 'camera';

/** WhatsApp style: the round button is the camera while there is nothing to send. */
export const composerMode = (text: string, mediaEnabled: boolean): ComposerMode => (mediaEnabled && !text.trim() ? 'camera' : 'send');

/** Sending clears the box at once; a failed send restores its text unless the person has already
 *  typed something new, which is never thrown away. */
export const draftAfterFailedSend = (current: string, submitted: string): string => (current.trim() ? current : submitted);

/** `start`/`end` are UTF-16 offsets (what an input's selectionStart/End report). */
export function insertAt(text: string, insert: string, start: number, end: number): { text: string; caret: number } {
  return { text: text.slice(0, start) + insert + text.slice(end), caret: start + insert.length };
}
```

Run → PASS.

- [ ] **Step 3: `compressForUpload`**

In `web/src/lib/live/upload.ts` add (moving the logic out of the Live page):

```ts
import compressionWorkerUrl from 'browser-image-compression/dist/browser-image-compression.js?url';

/** `prepare()` with the real compressor, loaded only when a photo is actually picked. */
export function compressForUpload(file: File): Promise<Prepared> {
  return prepare(file, async (f) => {
    const { default: compressImage } = await import('browser-image-compression');
    return compressImage(f, { maxWidthOrHeight: 2000, initialQuality: 0.8, useWebWorker: true, libURL: new URL(compressionWorkerUrl, location.href).href });
  });
}
```

If unit tests import `upload.ts` and Vitest cannot resolve the `?url` import, move `compressForUpload` into a new `web/src/lib/live/compress.ts` instead and import it from there in the pages.

- [ ] **Step 4: `ChatBox.svelte`**

```svelte
<script lang="ts">
  // The one composer: text, a tray of crawl emoji, gallery and camera pickers, and a round button
  // that is the camera until there is something to send. Pinned to the bottom of the page.
  import { tick } from 'svelte';
  import { copy } from '$lib/labels';
  import { CHAT_EMOJI, composerMode, draftAfterFailedSend, insertAt } from '$lib/chatBox';
  import IconButton from './IconButton.svelte';

  let { onsend, onfiles, busy = false, mediaOff, maxlength = 280, placeholder, inputTestid, sendTestid, fileTestid, cameraTestid }: {
    onsend: (text: string) => Promise<void>; onfiles?: (files: File[]) => Promise<void>; busy?: boolean;
    /** Why photos are off right now; attach and camera are hidden while set. */
    mediaOff?: string; maxlength?: number; placeholder: string;
    inputTestid: string; sendTestid: string; fileTestid?: string; cameraTestid?: string;
  } = $props();

  let text = $state(''), tray = $state(false);
  let input: HTMLInputElement | undefined = $state(), gallery: HTMLInputElement | undefined = $state(), camera: HTMLInputElement | undefined = $state();
  const media = $derived(!!onfiles && !mediaOff);
  const mode = $derived(composerMode(text, media));

  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    // WhatsApp style: the box empties at once and stays usable while the message is in flight.
    // Never clear it on completion — that would eat whatever was typed meanwhile.
    text = '';
    try { await onsend(body); } catch { text = draftAfterFailedSend(text, body); }
  }
  async function pick(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length && onfiles) await onfiles(files);
  }
  async function addEmoji(e: string) {
    const start = input?.selectionStart ?? text.length, end = input?.selectionEnd ?? text.length;
    const next = insertAt(text, e, start, end);
    if (next.text.length > maxlength) return;
    text = next.text;
    await tick();
    input?.setSelectionRange(next.caret, next.caret);
  }
</script>

<form class="composer" onsubmit={(e) => { e.preventDefault(); void send(); }}>
  {#if tray}
    <div class="tray" role="group" aria-label={copy.emojiTray}>
      {#each CHAT_EMOJI as e}<button type="button" class="emo" onclick={() => void addEmoji(e)}>{e}</button>{/each}
    </div>
  {/if}
  <div class="line">
    <div class="field">
      <IconButton icon={tray ? 'keyboard' : 'emoji'} size={34} label={tray ? copy.keyboard : copy.emojiTray} onclick={() => { tray = !tray; if (!tray) input?.focus(); }} testid="emoji-toggle" />
      <label class="sr" for={inputTestid}>{placeholder}</label>
      <input id={inputTestid} bind:this={input} bind:value={text} {maxlength} {placeholder} autocomplete="off" data-testid={inputTestid} />
      {#if media}
        <IconButton icon="attach" size={34} label={copy.attachMedia} disabled={busy} onclick={() => gallery?.click()} testid="attach-media" />
        <input class="file" bind:this={gallery} type="file" accept="image/*,video/*" multiple disabled={busy}
          onchange={(e) => { void pick(e.currentTarget.files); e.currentTarget.value = ''; }} data-testid={fileTestid} />
        <input class="file" bind:this={camera} type="file" accept="image/*" capture="environment" disabled={busy}
          onchange={(e) => { void pick(e.currentTarget.files); e.currentTarget.value = ''; }} data-testid={cameraTestid} />
      {/if}
    </div>
    {#if mode === 'camera'}
      <IconButton icon="camera" tone="primary" size={48} label={copy.takePhoto} disabled={busy} onclick={() => camera?.click()} testid="camera-button" />
    {:else}
      <IconButton type="submit" icon="send" tone="primary" size={48} label={copy.sendMessage} disabled={busy || !text.trim()} testid={sendTestid} />
    {/if}
  </div>
  {#if mediaOff && onfiles}<p class="off">{mediaOff}</p>{/if}
</form>

<style>
  .composer { position: sticky; bottom: 0; background: #111; padding: 8px 0; margin-top: 12px; z-index: 4; }
  :global(body:has(.tabbar)) .composer { bottom: calc(64px + env(safe-area-inset-bottom)); }
  :global(body:has(.practice-banner)) .composer { bottom: calc(24px + env(safe-area-inset-bottom)); }
  .line { display: flex; gap: 8px; align-items: center; }
  .field { flex: 1; min-width: 0; display: flex; align-items: center; gap: 2px; background: #202020; border: 1px solid #444; border-radius: 24px; padding: 3px 4px; }
  .field :global(.icon) { border: 0; }
  .field input { flex: 1; min-width: 0; margin: 0; padding: 8px 4px; border: 0; background: transparent; font-size: 16px; }
  .field input:focus { outline: none; }
  .tray { display: flex; flex-wrap: wrap; gap: 4px; background: #1b1b1b; border: 1px solid #333; border-radius: 14px; padding: 6px; margin-bottom: 6px; }
  .emo { width: 40px; height: 40px; min-height: 0; margin: 0; padding: 0; font-size: 22px; background: transparent; border: 0; border-radius: 10px; }
  .emo:hover { background: #2a2a2a; }
  .file { display: none; }
  .off { margin: 4px 0 0; font-size: 12px; color: #888; text-align: center; }
  .sr { position: absolute; left: -9999px; }
</style>
```

Note: `font-size: 16px` on the input stops iOS zooming on focus. `display:none` inputs still accept Playwright `setInputFiles`.

- [ ] **Step 5: CrewChat uses ChatBox and uploads**

In `CrewChat.svelte`: add props `onfiles?: (files: File[]) => Promise<void>`, `uploading = false`, `mediaOff?: string`. Replace `send()` with:

```ts
  async function send(body: string) {
    sending = true; sendError = '';
    try {
      await clientClock.ready();
      await pb.collection('chat_messages').create({ itinerary: itineraryId, user: userId, body });
      await liveDay.loadFeed();
    } catch (err) { sendError = copy.noSignal; throw err; }
    finally { sending = false; }
  }
```

(`ChatBox` only clears its text when `onsend` resolves, so a failed send keeps the draft.) Delete the `draft` state and the `<form class="composer">` block and its styles, and render:

```svelte
  <ChatBox onsend={send} {onfiles} busy={sending || uploading} {mediaOff} maxlength={280} placeholder={copy.messagePlaceholder}
    inputTestid="chat-input" sendTestid="chat-send" fileTestid="freight-input" cameraTestid="freight-camera" />
```


- [ ] **Step 6: Live page drops its photo buttons**

In `routes/(app)/live/+page.svelte`:
- Change `upload(files: FileList | null)` to `upload(selected: File[])` and use `compressForUpload(file)` in place of the inline `prepare(...)` call; remove the `compressionWorkerUrl` import and `fileInput` state.
- Delete the whole `<div class="photo-action">…</div>` block and its styles (`.photo-action`, `.camera`, `.file`, `.action.photo` if only used there). The `.actions` row keeps the Bulletin button — make it full width if it is now alone.
- `FreightStrip`: remove `busy`, `showPicker`, `onpick` props and the `{#if showPicker}` block from `FreightStrip.svelte`; the Live usage becomes `<FreightStrip media={liveDay.media} />`.
- CrewChat usage:

```svelte
{#if liveDay.itinerary && $auth.user}<CrewChat itineraryId={liveDay.itinerary.id} userId={$auth.user.id}
  onfiles={(files) => upload(files)} {uploading} mediaOff={tabStop ? undefined : copy.noTabStopForPhotos} />{/if}
```

Keep the upload error display (`{#if error}<p role="alert">`) where it is.

- [ ] **Step 7: Update the e2e specs**

`freight-input` and `freight-camera` keep their test ids (now inside the chat box), so most specs keep working. Fix what moved:
- `chat.spec.ts:3` and `tab.spec.ts:29` — read them; they open "live actions … camera choices": the camera input is now `freight-camera` inside the chat box; delete assertions on `action-photo`.
- `freight.spec.ts:59-73` ("Freight stays closed … ") — `freight-input` count 0 still holds (inputs are not rendered while `mediaOff`); add `await expect(page.getByTestId('attach-media')).toHaveCount(0);`.
- Add to `chat.spec.ts`:

```ts
test('the chat box sends with Enter, never sends blanks, and inserts emoji at the caret', async ({ page }) => {
  // reuse this file's existing login + seeded live route setup (read the first test and copy its setup lines)
  await page.getByTestId('chat-input').fill('   ');
  await expect(page.getByTestId('camera-button')).toBeVisible();
  await page.getByTestId('chat-input').fill('Save me a seat');
  await page.getByTestId('emoji-toggle').click();
  await page.getByRole('button', { name: '🍕' }).click();
  await expect(page.getByTestId('chat-input')).toHaveValue('Save me a seat🍕');
  await page.getByTestId('chat-input').press('Enter');
  await expect(page.getByTestId('crew-chat')).toContainText('Save me a seat🍕');
  await expect(page.getByTestId('chat-input')).toHaveValue('');
});
```

Add a slow-send case to `chat.spec.ts` (same setup):

```ts
test('typing during a slow send is never lost, and a failed send gives its text back', async ({ page }) => {
  // (same login + live route setup as the test above)
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  await page.route('**/api/collections/chat_messages/records', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await held;
    await route.abort('failed');
  });
  await page.getByTestId('chat-input').fill('First');
  await page.getByTestId('chat-input').press('Enter');
  await expect(page.getByTestId('chat-input')).toHaveValue('');
  await page.getByTestId('chat-input').fill('Second, typed while waiting');
  release();
  await expect(page.getByTestId('chat-input')).toHaveValue('Second, typed while waiting');
  await page.getByTestId('chat-input').fill('');
  await page.unroute('**/api/collections/chat_messages/records');
  await page.route('**/api/collections/chat_messages/records', (route) => route.request().method() === 'POST' ? route.abort('failed') : route.continue());
  await page.getByTestId('chat-input').fill('Retry me');
  await page.getByTestId('chat-input').press('Enter');
  await expect(page.getByTestId('chat-input')).toHaveValue('Retry me');
});
```

- [ ] **Step 8: Run everything and commit**

Run: `cd web && npm test && npm run check && npm run test:e2e`
Expected: PASS.

```bash
git add web/src/lib web/src/routes web/tests
git commit -m "feat(chat): one WhatsApp-style chat box on Live; photos and camera live in it"
```

---

### Task 12: Planner chat — bubbles, photos, long-press delete

**Files:**
- Create: `web/src/lib/live/holdMenu.svelte.ts`, `web/src/lib/chatColour.ts`
- Modify: `web/src/lib/components/Comments.svelte` (rewrite), `web/src/lib/components/CrewChat.svelte` (use the shared hold menu + colour), `web/src/routes/(app)/plan/[id]/+page.svelte`, `web/src/routes/(app)/plan/[id]/stops/[stopId]/+page.svelte` (Comments last)
- Test: `web/tests/unit/chatColour.test.ts`, `web/tests/e2e/planning.spec.ts`

**Interfaces:**
- Consumes: `ChatBox` (Task 11), `compressForUpload`, `uploadBatch` (`$lib/live/upload`), `openLightbox` (`$lib/nav`), `Comment.file` (Task 2).
- Produces:
  ```ts
  // chatColour.ts
  export function nameColour(id: string): string;
  // holdMenu.svelte.ts
  export class HoldMenu {
    openFor: string | null;
    start(e: PointerEvent, id: string): void; move(e: PointerEvent): void; cancel(): void;
    closeOutside(e: PointerEvent): void; open(id: string): void; close(): void;
  }
  ```

- [ ] **Step 1: Failing unit test and the colour helper**

`web/tests/unit/chatColour.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { nameColour } from '../../src/lib/chatColour';

describe('nameColour', () => {
  it('is stable per person and one of the palette', () => {
    expect(nameColour('abc')).toBe(nameColour('abc'));
    expect(nameColour('abc')).toMatch(/^#[0-9a-f]{6}$/);
  });
});
```

Run → FAIL. Create `web/src/lib/chatColour.ts` by moving `NAME_COLOURS` and `nameColour` verbatim out of `CrewChat.svelte` (export the function); import it back in `CrewChat`. Run → PASS.

- [ ] **Step 2: Extract the hold menu**

`web/src/lib/live/holdMenu.svelte.ts` — move `menuFor`, `hold`, `HOLD_MS`, `holdStart`, `holdMove`, `holdCancel`, `closeMenu` out of `CrewChat.svelte`:

```ts
// Press and hold (or right-click, or Enter) a chat bubble to open its menu, WhatsApp style.
const HOLD_MS = 450;

export class HoldMenu {
  openFor = $state<string | null>(null);
  #hold: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null;

  start(e: PointerEvent, id: string) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.cancel();
    this.#hold = { timer: setTimeout(() => { this.#hold = null; this.openFor = id; navigator.vibrate?.(15); }, HOLD_MS), x: e.clientX, y: e.clientY };
  }
  move(e: PointerEvent) { if (this.#hold && Math.hypot(e.clientX - this.#hold.x, e.clientY - this.#hold.y) > 10) this.cancel(); }
  cancel() { if (this.#hold) clearTimeout(this.#hold.timer); this.#hold = null; }
  open(id: string) { this.cancel(); this.openFor = id; }
  close() { this.openFor = null; }
  closeOutside(e: PointerEvent) { if (this.openFor && !(e.target instanceof Element && e.target.closest('.menu'))) this.openFor = null; }
}
```

In `CrewChat.svelte` replace the moved code with `const menu = new HoldMenu();` and rename uses (`menuFor` → `menu.openFor`, `holdStart(e, entry)` → `if (entry.target) menu.start(e, entry.id)`, etc.). Run `cd web && npm run check && npm run test:e2e -- chat.spec.ts` → PASS before continuing.

- [ ] **Step 3: Rewrite `Comments.svelte`**

```svelte
<script lang="ts">
  // The planner's chat: the same bubbles and chat box as Live, for a route or a single stop.
  import { onMount } from 'svelte';
  import { pb, auth, subscribe } from '$lib/pb';
  import { copy } from '$lib/labels';
  import { fmtDateTime } from '$lib/time';
  import { nameColour } from '$lib/chatColour';
  import { HoldMenu } from '$lib/live/holdMenu.svelte';
  import { compressForUpload, uploadBatch } from '$lib/live/upload';
  import { openLightbox } from '$lib/nav';
  import ChatBox from './ChatBox.svelte';
  import type { Comment, LightboxItem } from '$lib/types';

  let { targetCollection, targetId }: { targetCollection: string; targetId: string } = $props();
  let comments = $state<Comment[]>([]);
  let busy = $state(false), error = $state('');
  const me = $derived($auth.user?.id ?? '');
  const menu = new HoldMenu();
  const filter = $derived(pb.filter('target_collection = {:c} && target_id = {:t}', { c: targetCollection, t: targetId }));

  async function load() {
    try { comments = await pb.collection('comments').getFullList<Comment>({ filter, sort: 'created', expand: 'user' }); } catch { /* keep last */ }
  }
  onMount(() => { void load(); return subscribe('comments', filter, load); });

  const base = () => ({ user: me, target_collection: targetCollection, target_id: targetId });
  async function send(body: string) {
    busy = true; error = '';
    try { await pb.collection('comments').create({ ...base(), body }); await load(); }
    catch (err) { error = (err as Error).message || copy.genericError; throw err; }
    finally { busy = false; }
  }
  async function files(list: File[]) {
    busy = true; error = '';
    try {
      error = await uploadBatch(list, async (file) => {
        const prepared = await compressForUpload(file);
        const form = new FormData();
        for (const [k, v] of Object.entries(base())) form.set(k, v);
        form.set('file', prepared.file);
        await pb.collection('comments').create(form);
      }, load);
    } finally { busy = false; }
  }
  async function remove(c: Comment) {
    menu.close();
    try { await pb.collection('comments').delete(c.id); await load(); } catch (err) { error = (err as Error).message; }
  }
  const canDelete = (c: Comment) => c.user === me || !!$auth.user?.is_admin;
  const isVideo = (c: Comment) => /\.(mp4|mov|webm)$/i.test(c.file ?? '');
  const withFiles = $derived(comments.filter((c) => c.file));
  const viewer = $derived<LightboxItem[]>(withFiles.map((c) => ({ url: pb.files.getURL(c, c.file!, { thumb: '1200x0' }), full: pb.files.getURL(c, c.file!), kind: isVideo(c) ? 'video' : 'image', caption: c.expand?.user?.name ?? '' })));
</script>

<svelte:window onpointerdown={(e) => menu.closeOutside(e)} onkeydown={(e) => { if (e.key === 'Escape') menu.close(); }} />

<section class="chat" data-testid="comments">
  <h2>{copy.comments}</h2>
  <div class="log" role="log" aria-live="polite">
    {#each comments as c (c.id)}
      {@const mine = c.user === me}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <article class:mine class:open={menu.openFor === c.id} tabindex={canDelete(c) ? 0 : undefined}
        onpointerdown={(e) => { if (canDelete(c)) menu.start(e, c.id); }} onpointermove={(e) => menu.move(e)} onpointerup={() => menu.cancel()} onpointercancel={() => menu.cancel()} onpointerleave={() => menu.cancel()}
        oncontextmenu={(e) => { if (!canDelete(c)) return; e.preventDefault(); menu.open(c.id); }}
        onkeydown={(e) => { if (canDelete(c) && e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); menu.open(c.id); } }}>
        {#if !mine}<strong class="who" style:color={nameColour(c.user)}>{c.expand?.user?.name ?? '…'}</strong>{/if}
        {#if c.file}
          <button type="button" class="photo" aria-label={isVideo(c) ? copy.openFreightVideo : copy.openFreightPhoto} data-testid="comment-photo-{c.id}"
            onclick={() => openLightbox(viewer, withFiles.findIndex((x) => x.id === c.id))}>
            {#if isVideo(c)}<span class="video">▶</span>{:else}<img src={pb.files.getURL(c, c.file, { thumb: '400x300' })} alt="" width="160" height="120" loading="lazy" draggable="false" />{/if}
          </button>
        {/if}
        {#if c.body}<p>{c.body}<span class="pad"></span></p>{/if}
        <time datetime={c.created}>{fmtDateTime(c.created)}</time>
        {#if menu.openFor === c.id}
          <div class="menu"><button type="button" class="del" onclick={() => void remove(c)} data-testid="comment-delete-{c.id}">{copy.deleteMessage}</button></div>
        {/if}
      </article>
    {:else}<p class="empty">{copy.noComments}</p>{/each}
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <ChatBox onsend={send} onfiles={files} {busy} maxlength={1000} placeholder={copy.commentPlaceholder}
    inputTestid="comment-input" sendTestid="comment-post" fileTestid="comment-file" cameraTestid="comment-camera" />
</section>
```

Styles: copy `CrewChat.svelte`'s `article`, `.mine`, `.open`, `.who`, `p`, `.pad`, `time`, `.menu`, `.menu button`, `.del`, `.photo`, `.photo img`, `.video`, `.empty`, `h2`, `.log` rules verbatim (after Task 11 these no longer include composer styles). The timestamp is `fmtDateTime` because planner chats span days. A photo-only comment renders the photo and time with no empty `<p>`.

- [ ] **Step 4: Chat last on the pages**

`routes/(app)/plan/[id]/+page.svelte`: order is `ItineraryView`, `Votes`, `ApprovalPanel`, Conductor's make-current, then `Comments` last. `stops/[stopId]/+page.svelte`: move `<Comments …>` to be the last element. Update any e2e that clicks `comment-post` without filling text first (the send button is hidden while the box is empty — fill first, as the planning test already does).

- [ ] **Step 5: e2e — photo-only planner chat and long-press delete**

In the big planning test, after the existing `comment-post` assertions add:

```ts
  const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  await page.getByTestId('comment-file').setInputFiles({ name: 'route.gif', mimeType: 'image/gif', buffer: GIF });
  await expect(page.getByTestId('comments').locator('[data-testid^="comment-photo-"]')).toHaveCount(1);
  // Delete is in the bubble's menu: right-click opens it.
  await page.getByTestId('comments').getByText('Nice route').click({ button: 'right' });
  page.once('dialog', (d) => d.accept());
  await page.locator('[data-testid^="comment-delete-"]').click();
  await expect(page.getByTestId('comments')).not.toContainText('Nice route');
```

(Remove the `page.once('dialog'…)` line if `remove()` does not confirm — it does not in the code above.)

- [ ] **Step 6: Run everything and commit**

Run: `cd web && npm test && npm run check && npm run test:e2e`
Expected: PASS.

```bash
git add web/src/lib web/src/routes web/tests
git commit -m "feat(planner): route and stop chat share Live's bubbles and chat box, with photos"
```

---

### Task 13: Glossary, copy sweep and final verification

**Files:**
- Modify: `README.md` (UI glossary), `web/src/lib/labels.ts` (remove unused keys), `web/tests/unit/labels.test.ts`

- [ ] **Step 1: Remove dead copy**

Run: `for k in newDraft deleteDraft post addFreight; do echo "$k: $(grep -rn "copy\.$k\b" web/src | wc -l)"; done` and similarly for every key this plan replaced (`role`-related, `draftTitlePlaceholder`, `plannerTeaser`, `inbound`/`outbound` are still used). Delete keys with zero uses. Keep `labels.admin`/`labels.users` (still used in other screens — verify with grep before deleting).

- [ ] **Step 2: Glossary**

In `README.md` under "## UI glossary", add rows (match the table's existing format) for: **Ticket** (home card for The Route with the countdown), **Departure board** (home and Route Planner lists), **Chat box** (the one composer: emoji, photo/video, camera, send), **Turn around** (the unfolded line's midpoint). Note that the builder and the Conductor are the only people who can change a route.

- [ ] **Step 3: Labels test**

Add to `web/tests/unit/labels.test.ts`:

```ts
  it('has copy for the new board, chat box and delete flows', () => {
    for (const k of ['ticketKicker', 'chipBoarding', 'chipCurrent', 'deleteRoute', 'deleteLockedConfirm', 'emojiTray', 'attachMedia', 'turnAround', 'statFinish']) {
      expect((copy as Record<string, string>)[k], k).toBeTruthy();
    }
  });
```

- [ ] **Step 4: Full verification**

Run, in order, and read every result:

```bash
cd web && npm test && npm run check && npm run test:e2e
cd .. && bash scripts/test-hooks.sh
```

Expected: all green. Then open the app in a browser at phone width (use the `run` skill or `npm run dev` on a non-production port) and check: home ticket + board; planner board with icons; a draft's detail with the unfolded line; Live's chat box with camera/send toggle.

- [ ] **Step 5: Commit**

```bash
git add README.md web/src/lib/labels.ts web/tests/unit/labels.test.ts
git commit -m "docs: glossary for the ticket, departure board, chat box and unfolded line"
```
