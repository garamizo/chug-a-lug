# Venue Groups, Clone Route and Rename Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group the venue picker by kind, let any user clone a route, and have the planner chat record clones and renames.

**Architecture:**
- Route names get a normalised `title_key`, which the itineraries hooks enforce as unique.
- Notes are `comments` rows with a `kind` and a `meta`. Only hooks write them: the rename hook
  inside the same transaction as the rename, and the clone route inside the clone's own transaction.
- The name check and the write share one transaction, and PocketBase serialises write transactions,
  so concurrent requests cannot take the same name.
- Clone is a PocketBase hook route (`POST /api/crawl/clone`) that writes the route, its stops and
  both notes in one transaction and never deletes anything. It uses a client-minted id, so a retry
  (even an overlapping one) returns the same clone.
- The editor's title is an inline text box that renames on blur, through `PlanActions.rename`.

**Tech Stack:** SvelteKit (Svelte 5 runes) in `web/`, PocketBase JSVM hooks and migrations in
`pocketbase/`, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-27-clone-route-design.md`

## Global Constraints

- Every user-visible string lives in `web/src/lib/labels.ts`, and each new label gets a row in the
  README UI glossary (`README.md` ~:48).
- Route name: 1–80 characters after trimming, stored trimmed. It must be unique across all routes of
  any status, compared case-insensitively with runs of spaces collapsed. A route keeping its own name
  is never a clash.
- Hook errors for names are `BadRequestError('title_taken')` or `BadRequestError('title_invalid')`.
  The message is the code, and the client maps it to `copy.titleTaken` / `copy.titleInvalid`.
- A locked route can be renamed only by the admin. On a locked route the rename is staged and sent
  by Save (`POST /api/plan/commit`).
- Notes (`kind` ∈ `cloned_from | cloned_to | renamed`) are written only by the server. Clients cannot
  create one, cannot edit one, and cannot turn a comment into one. Only the admin can delete one.
- `ItineraryView` writes nothing itself; every write goes through its `actions` prop.
- Stage explicit paths (`git add <paths>`), never `git add -A`/`.`, and read `git status --short`
  before each commit. Never use `--no-verify`.
- Each task ends green: `cd web && npm test && npm run check`. Hook tasks also run
  `bash scripts/test-hooks.sh`, and UI tasks run `npm run test:e2e`. Run only one test harness at a
  time across worktrees: e2e uses ports 15173/18093, hooks use 18090.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01B8S2cXaqBTTQ5ttVgHiBQA
  ```

## Review Focus

1. **Double-tap or retry of Clone after a lost response, including overlapping requests.** The user
   expects one clone and one note per side. The retry map is keyed by source route (Task 5
   `cloneRoute.test.ts`), and the overlapping-request hook test covers the server (Task 4).
2. **Cloning a route whose "Copy of …" name is taken, or whose title is already 80 characters.** The
   user expects a free "(n)" name that still fits in 80 characters (Task 1 `cloneTitle` tests,
   Task 5 `cloneRoute` suffix test).
3. **Renaming to an existing name that differs only by case or spacing.** The user expects "taken",
   with their text left in the box (Task 1 hook test, Task 6 e2e).
4. **A rename whose note cannot be saved.** The user expects the title to be unchanged (Task 2
   atomicity hook test).
5. **A plain comment PATCHed into a note, or a clone id that names someone's existing route.** The
   first must be refused (Task 2 hook test, every kind). The second must return 409 and leave that
   route untouched (Task 4 hook test). Two people racing for one name must not both get it
   (Task 1 hook test).

---

## File Structure

| File | Responsibility |
|---|---|
| `web/src/lib/venueGroups.ts` (new) | Pure `groupByKind` for the picker |
| `web/src/lib/routeTitle.ts` (new) | Pure name rules shared by client and server: `normalizeTitle`, `cloneTitle`, `titleError` |
| `pocketbase/pb_hooks/routeTitle.js` (new) | The same name rules for the JSVM hooks |
| `pocketbase/pb_migrations/1758890000_route_titles.js` (new) | `itineraries.title_key` + backfill |
| `pocketbase/pb_migrations/1758890001_comment_notes.js` (new) | `comments.kind/meta` + rules |
| `pocketbase/pb_hooks/planning.pb.js` | Enforce names on create/update; atomic `renamed` note |
| `pocketbase/pb_hooks/targets.pb.js` | Notes may have an empty body |
| `web/src/lib/server/pb.ts` | `userPb(request)` |
| `web/src/lib/server/routeTitle.ts` (new) | `checkTitle(pb, title, routeId)` against `title_key` |
| `web/src/routes/api/plan/title-check/+server.ts` (new) | Early "taken" check for the locked editor |
| `web/src/routes/api/plan/commit/+server.ts` | Optional `title` in the Save payload |
| `pocketbase/pb_hooks/clone.pb.js` (new) | `POST /api/crawl/clone`: transactional clone |
| `web/src/lib/cloneRoute.ts` (new) | Client call: retry id kept per source route, "Copy of … (n)" names |
| `web/src/lib/planActions.ts`, `web/src/lib/live/staged.ts` | `rename` action; staged `title` |
| `web/src/lib/components/ItineraryView.svelte` | Title text box |
| `web/src/lib/components/Comments.svelte` | Render notes |
| `web/src/routes/(app)/plan/[id]/+page.svelte`, `.../edit/+page.svelte`, `.../add/+page.svelte`, `(app)/plan/+page.svelte` | Buttons, wiring, groups, create-form errors |
| `web/src/lib/labels.ts`, `web/src/lib/icons.ts`, `web/src/lib/types.ts`, `README.md` | Copy, `copy` icon, types, glossary |

---

### Task 1: Unique, valid route names

**Files:**
- Create: `web/src/lib/routeTitle.ts`, `pocketbase/pb_hooks/routeTitle.js`,
  `pocketbase/pb_migrations/1758890000_route_titles.js`, `web/tests/unit/routeTitle.test.ts`
- Modify: `pocketbase/pb_hooks/planning.pb.js`, `web/src/lib/labels.ts`, `web/src/lib/types.ts`,
  `web/tests/hooks/planning.test.ts`, `web/tests/e2e/helpers.ts`, `README.md`

**Interfaces:**
- Produces:
  - `normalizeTitle(input: unknown): { display: string; key: string } | null`
  - `cloneTitle(source: string, n: number): string`
  - `titleError(err: unknown): string | null`
  - `TITLE_MAX = 80`
  - labels `titleTaken`, `titleInvalid`, `cloneTitlePrefix`
  - field `itineraries.title_key`
  - JS module `routeTitle.js` exporting `{ normalize(input), taken(app, key, exceptId) }`

- [ ] **Step 1: Write the failing unit test** `web/tests/unit/routeTitle.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { cloneTitle, normalizeTitle, titleError, TITLE_MAX } from '../../src/lib/routeTitle';
import { copy } from '../../src/lib/labels';

describe('normalizeTitle', () => {
  it('trims for display and keys case- and space-insensitively', () => {
    expect(normalizeTitle('  Loop   Crawl ')).toEqual({ display: 'Loop   Crawl', key: 'loop crawl' });
  });
  it('refuses empty, blank, too long and non-strings', () => {
    expect(normalizeTitle('')).toBeNull();
    expect(normalizeTitle('   ')).toBeNull();
    expect(normalizeTitle('x'.repeat(TITLE_MAX + 1))).toBeNull();
    expect(normalizeTitle(42)).toBeNull();
    expect(normalizeTitle('x'.repeat(TITLE_MAX))?.display).toHaveLength(TITLE_MAX);
  });
});

describe('cloneTitle', () => {
  it('prefixes the first copy and numbers later ones', () => {
    expect(cloneTitle('Loop Crawl', 1)).toBe(`${copy.cloneTitlePrefix} Loop Crawl`);
    expect(cloneTitle('Loop Crawl', 2)).toBe(`${copy.cloneTitlePrefix} Loop Crawl (2)`);
  });
  it('cuts the base so the suffix still fits in 80', () => {
    const t = cloneTitle('x'.repeat(80), 12);
    expect(t.length).toBeLessThanOrEqual(TITLE_MAX);
    expect(t.endsWith(' (12)')).toBe(true);
    expect(cloneTitle('x'.repeat(80), 1).length).toBe(TITLE_MAX);
  });
});

describe('titleError', () => {
  it('maps the hook codes to copy, from a PocketBase error or a plain Error', () => {
    expect(titleError({ response: { message: 'title_taken' } })).toBe(copy.titleTaken);
    expect(titleError(new Error('title_invalid'))).toBe(copy.titleInvalid);
    expect(titleError(new Error('boom'))).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run tests/unit/routeTitle.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `web/src/lib/routeTitle.ts`

```ts
// Route names: 1–80 characters once trimmed, unique ignoring case and runs of spaces. The hook
// (pocketbase/pb_hooks/routeTitle.js) enforces the same rule; keep the two in step.
import { copy } from './labels';

export const TITLE_MAX = 80;

export function normalizeTitle(input: unknown): { display: string; key: string } | null {
  if (typeof input !== 'string') return null;
  const display = input.trim();
  if (display.length < 1 || display.length > TITLE_MAX) return null;
  return { display, key: display.replace(/\s+/g, ' ').toLowerCase() };
}

/** "Copy of X", then "Copy of X (2)"…, with X cut so the whole name stays within 80. */
export function cloneTitle(source: string, n: number): string {
  const suffix = n > 1 ? ` (${n})` : '';
  return `${copy.cloneTitlePrefix} ${source.trim()}`.slice(0, TITLE_MAX - suffix.length).trimEnd() + suffix;
}

/** The hooks answer a bad name with the code as the message; this turns it into copy. */
export function titleError(err: unknown): string | null {
  const e = err as { response?: { message?: string }; message?: string } | null;
  const code = e?.response?.message ?? e?.message;
  return code === 'title_taken' ? copy.titleTaken : code === 'title_invalid' ? copy.titleInvalid : null;
}
```

Add these to `copy` in `labels.ts`, beside `deleteRoute`:

```ts
  cloneTitlePrefix: 'Copy of',
  titleTaken: 'Another route already has that name.',
  titleInvalid: 'Give the route a name of 1 to 80 characters.',
```

Add `title_key?: string` to `Itinerary` in `types.ts`, and add the README glossary rows.

- [ ] **Step 4: Run the unit test.** Expected: PASS.

- [ ] **Step 5: Write the failing hook tests.** Append to the `describe('itineraries')` block in
  `web/tests/hooks/planning.test.ts`. Also make the helper default title unique, and rename the
  reused literal titles (`'Renamed'` ×3, `'Frozen'` ×2, `'Nope'`) to distinct ones per test (e.g.
  `'Renamed by owner'`, `'Renamed frozen'`, `'Frozen 1'`…), keeping each test's own
  `Frozen`/no-op pair consistent:

```ts
let titleSeq = 0;
const createItinerary = (token: string, body: Record<string, unknown> = {}) =>
  post('/api/collections/itineraries/records', { title: `Test draft ${++titleSeq}`, ...body }, token);
```

```ts
  it('names are unique ignoring case and spaces, 1–80 characters, stored trimmed', async () => {
    const a = await (await createItinerary(crew.token, { title: '  Unique Loop ' })).json();
    expect(a.title).toBe('Unique Loop');
    expect(a.title_key).toBe('unique loop');
    const dup = await createItinerary(other.token, { title: 'unique   LOOP' });
    expect(dup.status).toBe(400);
    expect((await dup.json()).message).toBe('title_taken');
    expect((await (await createItinerary(crew.token, { title: '   ' })).json()).message).toBe('title_invalid');
    const b = await (await createItinerary(crew.token, { title: 'Unique Other' })).json();
    const clash = await patch(`/api/collections/itineraries/records/${b.id}`, { title: 'UNIQUE LOOP' }, crew.token);
    expect(clash.status).toBe(400);
    expect((await clash.json()).message).toBe('title_taken');
    // Keeping your own name (even re-cased) is not a clash.
    expect((await patch(`/api/collections/itineraries/records/${a.id}`, { title: 'Unique loop' }, crew.token)).status).toBe(200);
    // A forged title_key is overwritten from the title.
    const forged = await (await patch(`/api/collections/itineraries/records/${b.id}`, { title_key: 'zzz' }, crew.token)).json();
    expect(forged.title_key).toBe('unique other');
  });

  it('racing requests cannot both take a free name', async () => {
    const creates = await Promise.all(Array.from({ length: 5 }, () => createItinerary(crew.token, { title: 'Race name' })));
    expect(creates.filter((r) => r.status === 200)).toHaveLength(1);
    const [x, y] = await Promise.all([createItinerary(crew.token), createItinerary(crew.token)].map(async (p) => (await p).json()));
    const renames = await Promise.all([x, y].map((r) => patch(`/api/collections/itineraries/records/${r.id}`, { title: 'Race rename' }, crew.token)));
    expect(renames.filter((r) => r.status === 200)).toHaveLength(1);
  });
```

- [ ] **Step 6: Run the hook tests and watch them fail**

Run: `bash scripts/test-hooks.sh` (from the worktree root).
Expected: the new test FAILS (no `title_key`, duplicates accepted).

- [ ] **Step 7: Implement.**

`pocketbase/pb_hooks/routeTitle.js`:

```js
// Route names: 1–80 characters once trimmed, unique ignoring case and runs of spaces.
// Mirrors web/src/lib/routeTitle.ts; keep the two in step.
module.exports = {
  normalize(input) {
    if (typeof input !== 'string') return null
    const display = input.trim()
    if (display.length < 1 || display.length > 80) return null
    return { display, key: display.replace(/\s+/g, ' ').toLowerCase() }
  },
  taken(app, key, exceptId) {
    try {
      app.findFirstRecordByFilter('itineraries', 'title_key = {:k} && id != {:id}', { k: key, id: exceptId || '' })
      return true
    } catch (_) { return false }
  }
}
```

`pocketbase/pb_migrations/1758890000_route_titles.js`:

```js
// Route names are unique ignoring case and spacing. The key lives beside the title so the hook can
// look it up exactly; no unique index, because older data may already hold duplicates.
migrate((app) => {
  const c = app.findCollectionByNameOrId('itineraries')
  c.fields.add(new TextField({ name: 'title_key', max: 200 }))
  app.save(c)
  for (const r of app.findAllRecords('itineraries')) {
    r.set('title_key', r.getString('title').trim().replace(/\s+/g, ' ').toLowerCase())
    app.saveNoValidate(r)
  }
}, (app) => {
  const c = app.findCollectionByNameOrId('itineraries')
  c.fields.removeByName('title_key')
  app.save(c)
})
```

In `planning.pb.js`, the itineraries create hook: replace its final bare `e.next()` with the code
below. The check and the save share one transaction. PocketBase runs write transactions one at a
time, so two requests cannot both see a name as free and both take it.

```js
  const titles = require(`${__hooks}/routeTitle.js`)
  const name = titles.normalize(r.getString('title'))
  if (!name) throw new BadRequestError('title_invalid')
  r.set('title', name.display)
  r.set('title_key', name.key)
  const app = e.app
  try {
    app.runInTransaction((tx) => {
      e.app = tx
      if (titles.taken(tx, name.key, '')) throw new BadRequestError('title_taken')
      e.next()
    })
  } finally { e.app = app }
```

In the update hook, after the existing non-admin checks and before `locking` is computed:

```js
  const titles = require(`${__hooks}/routeTitle.js`)
  const name = titles.normalize(e.record.getString('title'))
  if (!name) throw new BadRequestError('title_invalid')
  const nameChanged = name.key !== original.getString('title_key')
  e.record.set('title', name.display)
  e.record.set('title_key', name.key)
```

Then replace the update hook's bare `e.next()` with the block below. Task 2 adds the rename note
inside this same transaction. Everything after it (locking, archive, event_log, recompute) stays as
it is, outside the transaction.

```js
  const app = e.app
  try {
    app.runInTransaction((tx) => {
      e.app = tx
      if (nameChanged && titles.taken(tx, name.key, e.record.id)) throw new BadRequestError('title_taken')
      e.next()
    })
  } finally { e.app = app }
```

If the create hook's `e.next()` path does not find `title_key` on older records, that is expected:
the migration backfills them. Check `migrations.test.ts` for a schema snapshot of `itineraries` and
update it if one exists.

- [ ] **Step 8: Make the fixtures' names unique.**
  - In `web/tests/e2e/helpers.ts` `seedLockedCrawl`, change the title to
    `` `E2E Live Crawl ${Math.random().toString(36).slice(2, 8)}` `` (no test asserts on it; verify
    with `grep -rn "E2E Live Crawl" web/tests`).
  - Run `bash scripts/test-hooks.sh`, `cd web && npm test && npm run check && npm run test:e2e`.
  - Any new `title_taken` failure is a fixture reusing a name. Give it a unique name in that test.
    Do not weaken the rule.

Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add web/src/lib/routeTitle.ts web/tests/unit/routeTitle.test.ts pocketbase/pb_hooks/routeTitle.js \
  pocketbase/pb_migrations/1758890000_route_titles.js pocketbase/pb_hooks/planning.pb.js \
  web/src/lib/labels.ts web/src/lib/types.ts web/tests/hooks/planning.test.ts web/tests/e2e/helpers.ts README.md
git status --short
git commit -m "feat(plan): route names are unique and 1–80 characters"
```
(plus any other fixture files Step 8 touched, listed explicitly)

---

### Task 2: Notes in `comments`, and the atomic rename note

**Files:**
- Create: `pocketbase/pb_migrations/1758890001_comment_notes.js`, `web/tests/hooks/notes.test.ts`
- Modify: `pocketbase/pb_hooks/targets.pb.js`, `pocketbase/pb_hooks/planning.pb.js`, `web/src/lib/types.ts`

**Interfaces:**
- Consumes: `title_key`/name enforcement (Task 1).
- Produces:
  - `comments.kind` (`'' | 'cloned_from' | 'cloned_to' | 'renamed'`)
  - `comments.meta` (`{ route, title }` or `{ from, to }`)
  - `Comment` type fields `kind?` and `meta?`
  - one `renamed` note per real title change by a crew or admin user, and none for a superuser

- [ ] **Step 1: Read the current comment rules** so the migration's `down` restores exactly them:
  `grep -n "Rule" pocketbase/pb_migrations/1758400000_planning.js pocketbase/pb_migrations/1758860000_route_ownership.js pocketbase/pb_migrations/1758860001_comment_media.js`.
  Expected today:
  - create `U && @request.body.user = @request.auth.id`
  - update `U && user = @request.auth.id && @request.body.user:isset = false && <FIXED_TARGET>`
  - delete `U && (user = @request.auth.id || ADMIN)`

- [ ] **Step 2: Write the failing hook tests** `web/tests/hooks/notes.test.ts`

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, PB, del, get, loginToken, patch, post, superuserToken, truncate } from './setup';

let crew: { token: string; id: string };
let admin: { token: string; id: string };
let seq = 0;
const route = async (token: string, title = `Notes route ${++seq}`) =>
  (await post('/api/collections/itineraries/records', { title }, token)).json();
const notesOn = async (id: string, token: string) =>
  (await (await get(`/api/collections/comments/records?filter=${encodeURIComponent(`target_id="${id}" && kind!=""`)}`, token)).json()).items;

beforeAll(async () => {
  crew = await loginToken('Notes Crew');
  admin = await loginToken('Notes Boss', ADMIN_LOGIN_PASSWORD);
  for (const c of ['comments', 'stops', 'itineraries']) await truncate(c);
});

describe('rename notes', () => {
  it('a real rename writes one note by the renamer; a no-op writes none', async () => {
    const r = await route(crew.token, 'Before name');
    await patch(`/api/collections/itineraries/records/${r.id}`, { title: 'After name' }, crew.token);
    await patch(`/api/collections/itineraries/records/${r.id}`, { title: 'After name' }, crew.token);
    await patch(`/api/collections/itineraries/records/${r.id}`, { start_time: '12:00' }, crew.token);
    const notes = await notesOn(r.id, crew.token);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: 'renamed', user: crew.id, body: '', meta: { from: 'Before name', to: 'After name' } });
  });

  it('a refused rename of a locked route writes no note', async () => {
    const r = await route(crew.token);
    await patch(`/api/collections/itineraries/records/${r.id}`, { status: 'locked' }, admin.token);
    expect((await patch(`/api/collections/itineraries/records/${r.id}`, { title: 'Sneaky' }, crew.token)).status).toBe(403);
    expect(await notesOn(r.id, crew.token)).toHaveLength(0);
    expect((await patch(`/api/collections/itineraries/records/${r.id}`, { title: `Admin named ${seq}` }, admin.token)).status).toBe(200);
    expect(await notesOn(r.id, crew.token)).toHaveLength(1);
  });

  it('rolls the rename back when its note cannot be saved', async () => {
    const su = await superuserToken();
    const col = await (await get('/api/collections/comments', su)).json();
    const r = await route(crew.token, 'Atomic before');
    // Make every comment save fail: a required field nobody sets.
    await patch('/api/collections/comments', { fields: [...col.fields, { name: 'zz_required', type: 'text', required: true }] }, su);
    try {
      expect((await patch(`/api/collections/itineraries/records/${r.id}`, { title: 'Atomic after' }, crew.token)).status).toBe(400);
    } finally {
      await patch('/api/collections/comments', { fields: col.fields }, su);
    }
    expect((await (await get(`/api/collections/itineraries/records/${r.id}`, crew.token)).json()).title).toBe('Atomic before');
  });
});

describe('note rules', () => {
  it('a client cannot create a note, or PATCH one onto a plain comment', async () => {
    const r = await route(crew.token);
    const base = { user: crew.id, target_collection: 'itineraries', target_id: r.id };
    expect((await post('/api/collections/comments/records', { ...base, kind: 'renamed', meta: { from: 'a', to: 'b' } }, crew.token)).status).toBe(400);
    const plain = await (await post('/api/collections/comments/records', { ...base, body: 'hi' }, crew.token)).json();
    for (const kind of ['cloned_from', 'cloned_to', 'renamed']) {
      expect((await patch(`/api/collections/comments/records/${plain.id}`, { kind }, crew.token)).status).toBe(404);
    }
    expect((await patch(`/api/collections/comments/records/${plain.id}`, { meta: { route: r.id } }, crew.token)).status).toBe(404);
  });

  it('the author cannot edit or delete their note; the admin can delete it', async () => {
    const r = await route(crew.token, 'Del before');
    await patch(`/api/collections/itineraries/records/${r.id}`, { title: 'Del after' }, crew.token);
    const [note] = await notesOn(r.id, crew.token);
    expect((await patch(`/api/collections/comments/records/${note.id}`, { body: 'edited' }, crew.token)).status).toBe(404);
    expect((await del(`/api/collections/comments/records/${note.id}`, crew.token)).status).toBe(404);
    expect((await del(`/api/collections/comments/records/${note.id}`, admin.token)).status).toBe(204);
  });
});
```

Check `setup.ts` for `truncate`, `loginToken`, `del`, `get`, `patch` exports (`planning.test.ts`
imports them). A failed rule answers 400 on create, and 404 on update or delete. If PocketBase
answers differently, assert on the unchanged record instead of the status code (see CLAUDE.md: list
rules filter, they do not reject).

- [ ] **Step 3: Run and watch them fail.** Run `bash scripts/test-hooks.sh`. Expected: the notes
  tests FAIL.

- [ ] **Step 4: Implement the migration** `pocketbase/pb_migrations/1758890001_comment_notes.js`

```js
// Notes: comments the server writes when a route is cloned or renamed. Clients can neither write one
// nor turn their own comment into one, and only the Conductor can remove one, so the trail survives.
migrate((app) => {
  const U = "@request.auth.id != ''"
  const ADMIN = '@request.auth.is_admin = true'
  const FIXED_TARGET = '@request.body.target_collection:isset = false && @request.body.target_id:isset = false'
  const NO_NOTE = '@request.body.kind:isset = false && @request.body.meta:isset = false'
  const c = app.findCollectionByNameOrId('comments')
  c.fields.add(new SelectField({ name: 'kind', values: ['cloned_from', 'cloned_to', 'renamed'], maxSelect: 1 }))
  c.fields.add(new JSONField({ name: 'meta', maxSize: 4000 }))
  c.createRule = `${U} && @request.body.user = @request.auth.id && ${NO_NOTE}`
  c.updateRule = `${U} && user = @request.auth.id && kind = '' && @request.body.user:isset = false && ${FIXED_TARGET} && ${NO_NOTE}`
  c.deleteRule = `${U} && ((user = @request.auth.id && kind = '') || ${ADMIN})`
  app.save(c)
}, (app) => {
  const U = "@request.auth.id != ''"
  const ADMIN = '@request.auth.is_admin = true'
  const FIXED_TARGET = '@request.body.target_collection:isset = false && @request.body.target_id:isset = false'
  const c = app.findCollectionByNameOrId('comments')
  c.createRule = `${U} && @request.body.user = @request.auth.id`
  c.updateRule = `${U} && user = @request.auth.id && @request.body.user:isset = false && ${FIXED_TARGET}`
  c.deleteRule = `${U} && (user = @request.auth.id || ${ADMIN})`
  c.fields.removeByName('kind')
  c.fields.removeByName('meta')
  app.save(c)
})
```

(If Step 1 showed different current rules, build these from what it showed.)

- [ ] **Step 5: Let notes through `targets.pb.js`.** In the `onRecordCreate` hook, change the
  empty-body condition to skip notes:

```js
      if (e.record.collection().name === 'comments' && !e.record.getString('kind') &&
          !e.record.getString('body').trim() &&
          !e.record.getString('file') && !e.record.getUnsavedFiles('file').length) {
```

- [ ] **Step 6: Write the rename note atomically in `planning.pb.js`.** In the itineraries update
  hook:
  - Compute `const renamed = e.record.getString('title') !== original.getString('title')` after
    Task 1's normalisation.
  - Inside the transaction Task 1 added, right after `e.next()`, add the block below.

```js
      // The rename and its note land together: a title never changes without its history.
      if (renamed && isCrew) {
        const note = new Record(tx.findCollectionByNameOrId('comments'))
        note.set('user', e.auth.id)
        note.set('target_collection', 'itineraries')
        note.set('target_id', e.record.id)
        note.set('kind', 'renamed')
        note.set('meta', { from: original.getString('title'), to: e.record.getString('title') })
        tx.save(note)
      }
```

Add to `Comment` in `types.ts`:
`kind?: '' | 'cloned_from' | 'cloned_to' | 'renamed'; meta?: { route?: string; title?: string; from?: string; to?: string } | null;`

- [ ] **Step 7: Run everything.** `bash scripts/test-hooks.sh` and
  `cd web && npm test && npm run check`. Expected: all green, including `planning.test.ts` and
  `chat.test.ts` unchanged.

- [ ] **Step 8: Commit**

```bash
git add pocketbase/pb_migrations/1758890001_comment_notes.js pocketbase/pb_hooks/targets.pb.js \
  pocketbase/pb_hooks/planning.pb.js web/src/lib/types.ts web/tests/hooks/notes.test.ts
git status --short
git commit -m "feat(plan): renames leave a note in the route's chat, atomically"
```

---

### Task 3: Server name check, `userPb`, and titles through Save

**Files:**
- Create: `web/src/lib/server/routeTitle.ts`, `web/src/routes/api/plan/title-check/+server.ts`,
  `web/tests/unit/titleCheck.test.ts`
- Modify: `web/src/lib/server/pb.ts`, `web/src/routes/api/plan/commit/+server.ts`,
  `web/tests/unit/planCommit.test.ts`

**Interfaces:**
- Consumes: `normalizeTitle`, `titleError` (Task 1).
- Produces:
  - `userPb(request: Request): PocketBase`
  - `checkTitle(pb: PocketBase, input: unknown, routeId?: string): Promise<{ ok: true; title: string } | { ok: false; message: string }>`
  - `GET /api/plan/title-check?title=&route=`, which answers `{ ok: true }` or a 400 whose `message`
    is copy
  - `CommitBody.title?: string`

- [ ] **Step 1: Write the failing tests.**

`web/tests/unit/titleCheck.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../../src/lib/labels';

const state = vi.hoisted(() => ({ taken: false, filters: [] as string[] }));
vi.mock('$lib/server/pb', () => ({
  requireUser: vi.fn(async () => ({ id: 'u1' })),
  adminPb: vi.fn(async () => ({
    filter: (raw: string, p: Record<string, string>) => `${raw}|${JSON.stringify(p)}`,
    collection: () => ({ getList: async (_p: number, _n: number, o: { filter: string }) => { state.filters.push(o.filter); return { totalItems: state.taken ? 1 : 0, items: [] }; } })
  }))
}));
const { GET } = await import('../../src/routes/api/plan/title-check/+server');
const call = (q: string) => GET({ request: new Request(`http://x/api/plan/title-check?${q}`), url: new URL(`http://x/api/plan/title-check?${q}`) } as never);

beforeEach(() => { state.taken = false; state.filters = []; });

describe('GET /api/plan/title-check', () => {
  it('accepts a free name and looks it up by key, excluding the route itself', async () => {
    const res = await call('title=%20Loop%20%20Crawl&route=itinerary000001');
    expect(await res.json()).toEqual({ ok: true });
    expect(state.filters[0]).toContain('"k":"loop crawl"');
    expect(state.filters[0]).toContain('"id":"itinerary000001"');
  });
  it('refuses a taken or invalid name with copy', async () => {
    state.taken = true;
    await expect(call('title=Loop')).rejects.toMatchObject({ status: 400, body: { message: copy.titleTaken } });
    await expect(call('title=')).rejects.toMatchObject({ status: 400, body: { message: copy.titleInvalid } });
  });
});
```

In `web/tests/unit/planCommit.test.ts`:
- Add `titleTaken: false` and `userFail: false` to `state` (reset both in `beforeEach`).
- Add a `getList` to the `adminPb` mock's collection:
  `getList: async () => ({ totalItems: state.titleTaken ? 1 : 0, items: [] })`.
- Give `adminPb`'s mock a `filter: (raw: string) => raw`, which it already has.
- Add `userPb` to the `$lib/server/pb` mock:

```ts
  userPb: vi.fn(() => ({
    collection: (collection: string) => ({
      update: async (id: string, body: Record<string, unknown>) => {
        if (state.userFail) throw Object.assign(new Error('title_taken'), { status: 400, response: { message: 'title_taken' } });
        state.writes.push({ op: 'userUpdate', collection, id, body }); return { id };
      }
    })
  })),
```

Then set `state.itinerary` to include `title: 'Old name'` in `beforeEach` and add:

```ts
describe('title', () => {
  it('writes a changed title as the Conductor, before any stop write', async () => {
    const res = await call({ ...rideable, stops: [...rideable.stops, newStop], title: '  New name ' });
    expect(res.status).toBe(200);
    const i = state.writes.findIndex((w) => w.op === 'userUpdate');
    expect(state.writes[i]).toEqual({ op: 'userUpdate', collection: 'itineraries', id: 'itinerary000001', body: { title: 'New name' } });
    expect(state.writes.slice(0, i).some((w) => w.collection === 'stops')).toBe(false);
  });
  it('a name taken after the preflight stops the save before any stop write', async () => {
    state.userFail = true;
    await expect(call({ ...rideable, stops: [...rideable.stops, newStop], title: 'Raced' })).rejects.toMatchObject({ status: 400, body: { message: copy.titleTaken } });
    expect(state.writes.some((w) => w.collection === 'stops')).toBe(false);
  });
  it('skips an unchanged title', async () => {
    await call({ ...rideable, title: 'Old name' });
    expect(state.writes.some((w) => w.op === 'userUpdate')).toBe(false);
  });
  it('refuses a bad or taken title before any write', async () => {
    await expect(call({ ...rideable, title: '' })).rejects.toMatchObject({ status: 400 });
    state.titleTaken = true;
    await expect(call({ ...rideable, title: 'Taken' })).rejects.toMatchObject({ status: 400, body: { message: copy.titleTaken } });
    expect(state.writes).toEqual([]);
  });
});
```

(If the existing tests read errors as returned responses rather than thrown `HttpError`s, follow
the file's own convention for asserting a 400.)

- [ ] **Step 2: Run and watch them fail.**
  `cd web && npx vitest run tests/unit/titleCheck.test.ts tests/unit/planCommit.test.ts`.

- [ ] **Step 3: Implement.**

In `web/src/lib/server/pb.ts`:

```ts
/** A client acting as the browser's user, so PocketBase's rules and hooks see who did it. */
export function userPb(request: Request): PocketBase {
  const pb = new PocketBase(serverEnv.pbUrl);
  pb.autoCancellation(false);
  pb.authStore.save(request.headers.get('authorization') ?? '', null);
  return pb;
}
```

`web/src/lib/server/routeTitle.ts`:

```ts
import type PocketBase from 'pocketbase';
import { copy } from '$lib/labels';
import { normalizeTitle } from '$lib/routeTitle';

/** The hook's name rule, asked ahead of a write so a refusal comes before anything changes. */
export async function checkTitle(pb: PocketBase, input: unknown, routeId = ''): Promise<{ ok: true; title: string } | { ok: false; message: string }> {
  const name = normalizeTitle(input);
  if (!name) return { ok: false, message: copy.titleInvalid };
  const clash = await pb.collection('itineraries').getList(1, 1, {
    filter: pb.filter('title_key = {:k} && id != {:id}', { k: name.key, id: routeId }), fields: 'id'
  });
  return clash.totalItems ? { ok: false, message: copy.titleTaken } : { ok: true, title: name.display };
}
```

`web/src/routes/api/plan/title-check/+server.ts`:

```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminPb, requireUser } from '$lib/server/pb';
import { checkTitle } from '$lib/server/routeTitle';

// The locked editor stages a rename; this lets it say "taken" on blur rather than at Save.
export const GET: RequestHandler = async ({ request, url }) => {
  await requireUser(request);
  const result = await checkTitle(await adminPb(), url.searchParams.get('title') ?? '', url.searchParams.get('route') ?? '');
  if (!result.ok) throw error(400, result.message);
  return json({ ok: true });
};
```

In the commit endpoint:
- Add `title?: string` to `CommitBody`.
- Right after the `itinerary.status !== 'locked'` check, add:

```ts
    // A rename rides with Save. Checked before any write so a bad name changes nothing.
    let rename: string | null = null;
    if (body.title !== undefined) {
      const check = await checkTitle(pb, body.title, id);
      if (!check.ok) throw error(400, check.message);
      if (check.title !== itinerary.title) rename = check.title;
    }
```

After validation passes (the `blockers` check) and **before the first stop write**, add the block
below. Renaming first keeps the endpoint's retry story intact:
- If the name was taken after the preflight, or the note fails, the rename is refused (and rolled
  back by the hook's transaction) before anything else changes.
- If a later stop write fails, the retry sends the same title, which is now a no-op, and converges.

```ts
    // Written as the Conductor, not the superuser, so the rename note names who did it.
    if (rename) {
      try { await userPb(request).collection('itineraries').update(id, { title: rename }); }
      catch (err) { const message = titleError(err); if (message) throw error(400, message); throw err; }
    }
```

Import `userPb`, `checkTitle` and `titleError`. Make sure the endpoint's outer `catch` rethrows
`HttpError`s unchanged; read it, because it maps `ClockServiceError`s.

- [ ] **Step 4: Run.** `cd web && npm test && npm run check`. Expected: green.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/server/pb.ts web/src/lib/server/routeTitle.ts web/src/routes/api/plan/title-check/+server.ts \
  web/src/routes/api/plan/commit/+server.ts web/tests/unit/titleCheck.test.ts web/tests/unit/planCommit.test.ts
git status --short
git commit -m "feat(plan): Save carries a checked rename, written as the Conductor"
```

---

### Task 4: Clone, as one PocketBase transaction

**Files:**
- Create: `pocketbase/pb_hooks/clone.pb.js`, `web/tests/hooks/clone.test.ts`
- Modify: `web/src/lib/labels.ts`, `README.md`

**Interfaces:**
- Consumes: `routeTitle.js` (Task 1); note fields (Task 2).
- Produces: `POST /api/crawl/clone`, for signed-in users only. The body is
  `{ source: string; id: string; title: string }`.
  - Success answers `200 { id, title }`.
  - `400 title_taken` / `400 title_invalid` for a bad name.
  - `400 bad_clone_request` for bad ids, or when `id === source`.
  - `404 route_gone` when the source is missing.
  - `409 clone_conflict` when `id` exists and is not this caller's clone of `source`.

Why a hook route and not a SvelteKit endpoint: the route, its stops and both notes land in **one
transaction**, so there is no half-made clone to clean up, and the route never deletes anything. A
retry after a lost response finds the finished clone by its own `cloned_from` note, which cannot
exist without the rest. PocketBase serialises write transactions, so two overlapping retries with
the same id run one after the other: the second sees the first's clone and returns it. The
"Copy of …" names are made by the client from `labels.ts` (Task 5). A taken one answers
`title_taken`, and the client tries the next.

- [ ] **Step 1: Write the failing hook tests** `web/tests/hooks/clone.test.ts`

```ts
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, get, loginToken, patch, post, superuserToken, truncate } from './setup';

let owner: { token: string; id: string };
let cloner: { token: string; id: string };
let admin: { token: string; id: string };
let source: { id: string; title: string };
let n = 0;
const newId = () => `clonetest${String(++n).padStart(6, '0')}`;
const clone = (token: string, body: Record<string, unknown>) => post('/api/crawl/clone', body, token);
const list = async (collection: string, filter: string, token: string) =>
  (await (await get(`/api/collections/${collection}/records?perPage=200&filter=${encodeURIComponent(filter)}`, token)).json()).items;

beforeAll(async () => {
  owner = await loginToken('Clone Owner');
  cloner = await loginToken('Clone Taker');
  admin = await loginToken('Clone Boss', ADMIN_LOGIN_PASSWORD);
});

beforeEach(async () => {
  for (const c of ['comments', 'legs', 'stops', 'itineraries']) await truncate(c);
  const it = await (await post('/api/collections/itineraries/records', { title: 'Loop Crawl', event_date: '2026-12-26', start_time: '11:30', start_station: 'CUS', start_station_name: 'Union Station' }, owner.token)).json();
  await post('/api/collections/stops/records', { itinerary: it.id, order: 1, name: 'The Hop Haus', kind: 'bar', direction: 'out', station_id: 'LAGRANGE', station_name: 'La Grange Road', dwell_min: 75, walk_min: 4, notes: 'upstairs', meet_point: 'bar', osm_id: 'node/1' }, owner.token);
  await post('/api/collections/stops/records', { itinerary: it.id, order: 2, name: 'Berwyn Diner', kind: 'restaurant', direction: 'back', station_id: 'CUS', station_name: 'Union Station', dwell_min: 60, walk_min: 5 }, owner.token);
  await patch(`/api/collections/itineraries/records/${it.id}`, { status: 'locked' }, admin.token);
  source = { id: it.id, title: 'Loop Crawl' };
});

describe('POST /api/crawl/clone', () => {
  it('makes a draft of the caller\'s own with the stops and a note on both routes', async () => {
    const id = newId();
    const res = await clone(cloner.token, { source: source.id, id, title: 'Copy of Loop Crawl' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id, title: 'Copy of Loop Crawl' });
    const it = await (await get(`/api/collections/itineraries/records/${id}`, cloner.token)).json();
    expect(it).toMatchObject({ status: 'draft', created_by: cloner.id, vote_open: false, title_key: 'copy of loop crawl', event_date: '2026-12-26', start_time: '11:30', start_station: 'CUS', start_station_name: 'Union Station' });
    const stops = await list('stops', `itinerary="${id}"`, cloner.token);
    expect(stops.map((s: { name: string }) => s.name).sort()).toEqual(['Berwyn Diner', 'The Hop Haus']);
    expect(stops.find((s: { name: string }) => s.name === 'The Hop Haus')).toMatchObject({ order: 1, kind: 'bar', direction: 'out', dwell_min: 75, notes: 'upstairs', meet_point: 'bar', osm_id: 'node/1', photos_status: 'none' });
    const from = await list('comments', `target_id="${id}"`, cloner.token);
    expect(from).toHaveLength(1);
    expect(from[0]).toMatchObject({ kind: 'cloned_from', user: cloner.id, meta: { route: source.id, title: 'Loop Crawl' } });
    const to = await list('comments', `target_id="${source.id}"`, cloner.token);
    expect(to).toHaveLength(1);
    expect(to[0]).toMatchObject({ kind: 'cloned_to', user: cloner.id, meta: { route: id, title: 'Copy of Loop Crawl' } });
    // The source is untouched apart from its note.
    expect((await (await get(`/api/collections/itineraries/records/${source.id}`, cloner.token)).json()).status).toBe('locked');
  });

  it('a retry, even overlapping, returns the one clone and writes nothing more', async () => {
    const id = newId();
    const body = { source: source.id, id, title: 'Copy of Loop Crawl' };
    const [a, b] = await Promise.all([clone(cloner.token, body), clone(cloner.token, body)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await clone(cloner.token, { ...body, title: 'Copy of Loop Crawl (2)' })).status).toBe(200);
    expect(await list('stops', `itinerary="${id}"`, cloner.token)).toHaveLength(2);
    expect(await list('comments', `target_id="${source.id}"`, cloner.token)).toHaveLength(1);
    expect(await list('itineraries', `title_key~"copy of"`, cloner.token)).toHaveLength(1);
  });

  it('never touches an existing route that is not this clone', async () => {
    const mine = await (await post('/api/collections/itineraries/records', { title: 'Mine locked' }, cloner.token)).json();
    await patch(`/api/collections/itineraries/records/${mine.id}`, { status: 'locked' }, admin.token);
    expect((await clone(cloner.token, { source: source.id, id: mine.id, title: 'Copy of Loop Crawl' })).status).toBe(409);
    expect((await (await get(`/api/collections/itineraries/records/${mine.id}`, cloner.token)).json()).status).toBe('locked');
    expect((await clone(cloner.token, { source: source.id, id: source.id, title: 'Copy of Loop Crawl' })).status).toBe(400);
    expect(await list('stops', `itinerary="${source.id}"`, cloner.token)).toHaveLength(2);
  });

  it('refuses a taken or invalid name, a missing source and no login, creating nothing', async () => {
    const id = newId();
    const taken = await clone(cloner.token, { source: source.id, id, title: 'LOOP  crawl' });
    expect(taken.status).toBe(400);
    expect((await taken.json()).message).toBe('title_taken');
    expect((await (await clone(cloner.token, { source: source.id, id, title: ' ' })).json()).message).toBe('title_invalid');
    expect((await clone(cloner.token, { source: 'missingroute001', id, title: 'Copy of X' })).status).toBe(404);
    expect((await clone('', { source: source.id, id, title: 'Copy of X' })).status).toBe(401);
    expect((await get(`/api/collections/itineraries/records/${id}`, cloner.token)).status).toBe(404);
  });

  it('is all or nothing: a failing note leaves no clone behind', async () => {
    const su = await superuserToken();
    const col = await (await get('/api/collections/comments', su)).json();
    const id = newId();
    await patch('/api/collections/comments', { fields: [...col.fields, { name: 'zz_required', type: 'text', required: true }] }, su);
    try {
      expect((await clone(cloner.token, { source: source.id, id, title: 'Copy of Loop Crawl' })).status).toBeGreaterThanOrEqual(400);
    } finally {
      await patch('/api/collections/comments', { fields: col.fields }, su);
    }
    expect((await get(`/api/collections/itineraries/records/${id}`, cloner.token)).status).toBe(404);
    expect(await list('stops', `itinerary="${id}"`, su)).toHaveLength(0);
  });
});
```

If `get` of a missing record answers something other than 404 (a view rule filters it), assert on
an empty list instead (CLAUDE.md: rules filter, they do not reject). If `setup.ts` has no `truncate`
for `legs` under that name, mirror what `planning.test.ts` truncates.

- [ ] **Step 2: Run and watch them fail.** Run `bash scripts/test-hooks.sh`. Expected: the clone
  tests FAIL with 404 on `/api/crawl/clone`.

- [ ] **Step 3: Implement** `pocketbase/pb_hooks/clone.pb.js`

```js
// Clone: copy any route into a draft of the caller's own, with a note on both routes, in one
// transaction, so all of it lands or none of it does. The client names the new record's id and keeps
// it across retries; a retry finds the finished clone by its own `cloned_from` note (which cannot
// exist without the rest) and answers with it. Nothing here ever deletes. The name comes from the
// client ("Copy of …" lives in labels.ts); a taken one answers title_taken and the client tries the
// next. Helpers live inside the callback: top-level consts are not visible in hook callbacks.

routerAdd('POST', '/api/crawl/clone', (e) => {
  const ID = /^[a-z0-9]{15}$/
  // What a stop means for planning. Legs are recomputed by the stop hook after commit; votes,
  // comments, crew photos and anything from the day itself stay with the original.
  const STOP_FIELDS = ['order', 'name', 'kind', 'direction', 'station_id', 'station_name', 'place', 'place_id', 'osm_id',
    'address', 'lat', 'lon', 'hours', 'phone', 'website', 'confirmed_open', 'dwell_min', 'walk_min', 'notes', 'meet_point']
  const body = e.requestInfo().body
  const source = String(body.source || '')
  const id = String(body.id || '')
  if (!ID.test(source) || !ID.test(id) || source === id) throw new BadRequestError('bad_clone_request')
  const titles = require(`${__hooks}/routeTitle.js`)
  const name = titles.normalize(body.title)
  if (!name) throw new BadRequestError('title_invalid')
  const who = e.auth.id
  let answer = null

  $app.runInTransaction((tx) => {
    let existing = null
    try { existing = tx.findRecordById('itineraries', id) } catch (_) {}
    if (existing) {
      const proofs = tx.findRecordsByFilter('comments',
        "target_collection = 'itineraries' && target_id = {:id} && kind = 'cloned_from' && user = {:u}", '', 0, 0, { id, u: who })
      const ours = proofs.some((p) => { try { return JSON.parse(p.getString('meta')).route === source } catch (_) { return false } })
      if (!ours) throw new ApiError(409, 'clone_conflict')
      answer = { id, title: existing.getString('title') }
      return
    }
    let src
    try { src = tx.findRecordById('itineraries', source) } catch (_) { throw new NotFoundError('route_gone') }
    if (titles.taken(tx, name.key, '')) throw new BadRequestError('title_taken')

    const it = new Record(tx.findCollectionByNameOrId('itineraries'))
    it.set('id', id)
    it.set('title', name.display)
    it.set('title_key', name.key)
    it.set('status', 'draft')
    it.set('vote_open', false)
    it.set('created_by', who)
    for (const f of ['event_date', 'start_time', 'start_station', 'start_station_name']) it.set(f, src.get(f))
    tx.save(it)

    const stopsCol = tx.findCollectionByNameOrId('stops')
    for (const s of tx.findRecordsByFilter('stops', 'itinerary = {:id}', 'order,created', 0, 0, { id: source })) {
      const copy = new Record(stopsCol)
      for (const f of STOP_FIELDS) copy.set(f, s.get(f))
      copy.set('itinerary', id)
      copy.set('photos_status', s.getString('photos_status') === 'done' ? 'done' : 'none')
      tx.save(copy)
    }

    const commentsCol = tx.findCollectionByNameOrId('comments')
    const note = (target, kind, meta) => {
      const n = new Record(commentsCol)
      n.set('user', who)
      n.set('target_collection', 'itineraries')
      n.set('target_id', target)
      n.set('kind', kind)
      n.set('meta', meta)
      tx.save(n)
    }
    note(id, 'cloned_from', { route: source, title: src.getString('title') })
    note(source, 'cloned_to', { route: id, title: name.display })
    answer = { id, title: name.display }
  })
  return e.json(200, answer)
}, $apis.requireAuth('users'))
```

Notes for the implementer:
- `ApiError`, `NotFoundError` and `BadRequestError` are JSVM globals. If `new ApiError(409, …)` is
  not available in this PocketBase version, check `pb-dev.sh` for the binary version and use the
  equivalent (e.g. `new BadRequestError('clone_conflict')` with the test expecting 400).
- `tx.save` runs model hooks, not request hooks. So the itineraries create *request* hook (draft,
  defaults, name check) does not run here, and this route sets those fields itself. `targets.pb.js`
  `onRecordCreate` (a model hook) does run for the notes and checks their targets inside the same
  transaction.
- The stops' `onRecordAfterCreateSuccess` recompute hooks fire after commit, once per stop. That is
  acceptable at crawl sizes.

- [ ] **Step 4: Labels.** Add `routeGone: 'That route no longer exists.'` and
  `cloneRoute: 'Clone route'` to `copy`, with README rows.

- [ ] **Step 5: Run.** `bash scripts/test-hooks.sh` and `cd web && npm test && npm run check`.
  Expected: green.

- [ ] **Step 6: Commit**

```bash
git add pocketbase/pb_hooks/clone.pb.js web/tests/hooks/clone.test.ts web/src/lib/labels.ts README.md
git status --short
git commit -m "feat(plan): clone any route into your own draft, in one transaction, noted on both routes"
```

---

### Task 5: Client actions — rename, staged title, clone call

**Files:**
- Create: `web/src/lib/cloneRoute.ts`, `web/tests/unit/cloneRoute.test.ts`
- Modify: `web/src/lib/planActions.ts`, `web/src/lib/live/staged.ts`,
  `web/tests/unit/planActions.test.ts`, `web/tests/unit/staged.test.ts`

**Interfaces:**
- Consumes: `titleError`, `cloneTitle` (Task 1); `POST /api/crawl/clone` (Task 4); labels
  `routeGone`, `genericError`.
- Produces:
  - `PlanActions.rename?: (title: string) => Promise<void>`, which rejects with an `Error` whose
    message is copy
  - `StagedPlan.title?: string`
  - `setTitle(plan: StagedPlan, title: string): StagedPlan`
  - `commitPayload` includes `title` only when staged
  - `cloneRoute(source: { id: string; title: string }): Promise<string>`, which rejects with an
    `Error` whose message is copy

- [ ] **Step 1: Write the failing tests.**

Append to `web/tests/unit/staged.test.ts` (import `setTitle`):

```ts
describe('setTitle', () => {
  it('stages a title that Save sends; no title staged sends none', () => {
    expect(commitPayload(base(), 'itinerary000001')).not.toHaveProperty('title');
    expect(commitPayload(setTitle(base(), 'New name'), 'itinerary000001')).toMatchObject({ title: 'New name' });
  });
});
```

Append to `web/tests/unit/planActions.test.ts`:

```ts
describe('rename', () => {
  it('writes the title', async () => {
    await recordActions('itinerary000001', () => {}).rename!('New name');
    expect(calls.update.at(-1)).toEqual(['itinerary000001', { title: 'New name' }]);
  });
  it('rejects with copy when the name is taken', async () => {
    const pb = await import('$lib/pb');
    vi.spyOn(pb.pb, 'collection').mockReturnValue({
      update: async () => { throw Object.assign(new Error('title_taken'), { response: { message: 'title_taken' } }); }
    } as never);
    const { copy } = await import('$lib/labels');
    await expect(recordActions('itinerary000001', () => {}).rename!('Taken')).rejects.toThrow(copy.titleTaken);
  });
});
```

`web/tests/unit/cloneRoute.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../../src/lib/labels';

const sent = vi.hoisted(() => ({ bodies: [] as { source: string; id: string; title: string }[], replies: [] as (string | null)[] }));
vi.mock('$lib/pb', () => ({
  pb: {
    send: vi.fn(async (_path: string, init: { body: { source: string; id: string; title: string } }) => {
      sent.bodies.push(init.body);
      const code = sent.replies.shift() ?? null;
      if (code) throw Object.assign(new Error(code), { status: 400, response: { message: code } });
      return { id: init.body.id, title: init.body.title };
    })
  }
}));
const { cloneRoute } = await import('$lib/cloneRoute');
const src = { id: 'sourceroute0001', title: 'Loop Crawl' };

beforeEach(() => { sent.bodies = []; sent.replies = []; });

describe('cloneRoute', () => {
  it('tries "Copy of X", then "(2)", when a name is taken', async () => {
    sent.replies = ['title_taken'];
    await cloneRoute(src);
    expect(sent.bodies.map((b) => b.title)).toEqual([`${copy.cloneTitlePrefix} Loop Crawl`, `${copy.cloneTitlePrefix} Loop Crawl (2)`]);
    expect(sent.bodies[0].id).toBe(sent.bodies[1].id);
  });
  it('retries a failed clone under the same id, then mints a fresh one', async () => {
    sent.replies = ['boom'];
    await expect(cloneRoute(src)).rejects.toThrow();
    const first = await cloneRoute(src);
    expect(sent.bodies[1].id).toBe(sent.bodies[0].id);
    expect(first).toBe(sent.bodies[0].id);
    await cloneRoute(src);
    expect(sent.bodies[2].id).not.toBe(first);
  });
  it('keeps retry ids per source route', async () => {
    sent.replies = ['boom'];
    await expect(cloneRoute({ id: 'sourceroute000a', title: 'A' })).rejects.toThrow();
    await cloneRoute({ id: 'sourceroute000b', title: 'B' });
    expect(sent.bodies[1].id).not.toBe(sent.bodies[0].id);
  });
  it('turns the server codes into copy', async () => {
    sent.replies = ['route_gone'];
    await expect(cloneRoute({ id: 'sourceroute000c', title: 'C' })).rejects.toThrow(copy.routeGone);
    sent.replies = ['clone_conflict'];
    await expect(cloneRoute({ id: 'sourceroute000d', title: 'D' })).rejects.toThrow(copy.genericError);
  });
});
```

- [ ] **Step 2: Run and watch them fail.**
  `cd web && npx vitest run tests/unit/staged.test.ts tests/unit/planActions.test.ts tests/unit/cloneRoute.test.ts`.

- [ ] **Step 3: Implement.**

`staged.ts`:
- Change the type to
  `export type StagedPlan = { stops: StagedStop[]; anchorStopId: string | null; removed: string[]; title?: string };`
- Add:

```ts
/** A rename waits for Save like every other edit to The Route. */
export function setTitle(plan: StagedPlan, title: string): StagedPlan {
  return { ...plan, title };
}
```

- Change `commitPayload` to:

```ts
export function commitPayload(plan: StagedPlan, itineraryId: string) {
  return { itinerary: itineraryId, anchorStopId: plan.anchorStopId ?? '', stops: plan.stops, removed: plan.removed,
    ...(plan.title !== undefined ? { title: plan.title } : {}) };
}
```

`planActions.ts`: add the member to `PlanActions`:

```ts
  /** Present where the name may change. Rejects with copy the name box shows under itself. */
  rename?: (title: string) => Promise<void>;
```

In `recordActions` (import `titleError` from `$lib/routeTitle`):

```ts
    async rename(title) {
      try { await pb.collection('itineraries').update(itineraryId, { title }); }
      catch (err) { throw new Error(titleError(err) ?? ((err as Error).message || copy.genericError)); }
    },
```

`web/src/lib/cloneRoute.ts`:

```ts
// Cloning names the new route's id up front and keeps it until a clone of that route succeeds, so a
// retry after a lost response gets back the clone the server already made instead of another. The
// server clones in one transaction (pocketbase/pb_hooks/clone.pb.js); the "Copy of …" name is ours
// to choose, so a taken one moves on to "(2)", "(3)"….
import { pb } from '$lib/pb';
import { copy } from '$lib/labels';
import { newRecordId } from '$lib/live/staged';
import { cloneTitle, titleError } from '$lib/routeTitle';

const MAX_TRIES = 50;
const pending = new Map<string, string>();

export async function cloneRoute(source: { id: string; title: string }): Promise<string> {
  const id = pending.get(source.id) ?? newRecordId();
  pending.set(source.id, id);
  for (let n = 1; n <= MAX_TRIES; n++) {
    try {
      const res = await pb.send<{ id: string }>('/api/crawl/clone', { method: 'POST', body: { source: source.id, id, title: cloneTitle(source.title, n) } });
      pending.delete(source.id);
      return res.id;
    } catch (err) {
      if (titleError(err) === copy.titleTaken) continue;
      const code = (err as { response?: { message?: string } }).response?.message;
      throw new Error(code === 'route_gone' ? copy.routeGone : code === 'clone_conflict' ? copy.genericError : (err as Error).message || copy.genericError);
    }
  }
  throw new Error(copy.titleTaken);
}
```

- [ ] **Step 4: Run.** `cd web && npm test && npm run check`. Expected: green.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/cloneRoute.ts web/src/lib/planActions.ts web/src/lib/live/staged.ts \
  web/tests/unit/cloneRoute.test.ts web/tests/unit/planActions.test.ts web/tests/unit/staged.test.ts
git status --short
git commit -m "feat(plan): rename and clone actions for the planner screens"
```

---

### Task 6: UI — title box, clone buttons, notes in the chat

**Files:**
- Modify:
  - `web/src/lib/components/ItineraryView.svelte`
  - `web/src/lib/components/Comments.svelte`
  - `web/src/routes/(app)/plan/[id]/+page.svelte`
  - `web/src/routes/(app)/plan/[id]/edit/+page.svelte`
  - `web/src/routes/(app)/plan/+page.svelte`
  - `web/src/lib/icons.ts`, `web/src/lib/labels.ts`, `README.md`
- Test: `web/tests/e2e/cloneRoute.spec.ts` (new), plus `web/tests/unit/icons.test.ts` if it lists
  names

**Interfaces:**
- Consumes: `PlanActions.rename`, `setTitle`, `cloneRoute` (Task 5); `/api/plan/title-check`
  (Task 3); note fields (Task 2).
- Produces:
  - `ItineraryView` prop `selectTitle?: boolean`
  - test ids `route-title`, `route-title-error`, `clone-route`, `note-cloned_from`,
    `note-cloned_to`, `note-renamed`
  - icon `copy`
  - labels `routeName`, `noteClonedFrom`, `noteClonedTo`, `noteRenamedFrom`, `noteRenamedTo`

- [ ] **Step 1: Write the failing e2e** `web/tests/e2e/cloneRoute.spec.ts`. Copy the `beforeEach`
  route mocks and the "add Naperville Wine Bar" clicks from the first test in `planning.spec.ts`
  (`station-dot-NAPERVILLE` → `venue-node-2` → `sheet-add`).

```ts
import { test, expect, type Page } from '@playwright/test';
import { login, seedLockedCrawl, clearLockedCrawls } from './helpers';
import { copy } from '../../src/lib/labels';

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
const CREW = process.env.CREW_PASSWORD ?? 'crew-test-password';
const RUN = Date.now().toString(36);

test.beforeEach(async ({ page }) => {
  await page.route('**/api/places/nearby**', (route) => route.fulfill({ json: {
    station: { id: 'NAPERVILLE', name: 'NAPERVILLE', lat: 0, lon: 0 }, fetchedAt: '2026-09-19T00:00:00.000Z',
    venues: [{ source: 'osm', id: 'node/2', name: 'Naperville Wine Bar', kind: 'bar', lat: 41.7811, lon: -88.1467, distanceM: 91 }] } }));
  await page.route('**/api/places/attach', (route) => route.fulfill({ status: 503, json: { message: 'Google Places is not configured on the server.' } }));
  await page.route('**/api/places/photos', (route) => route.fulfill({ json: { status: 'none', place: null } }));
});

async function makeDraft(page: Page, title: string) {
  await page.getByTestId('nav-plan').click();
  await page.getByTestId('draft-title').fill(title);
  await page.getByTestId('create-draft').click();
  await expect(page).toHaveURL(/\/plan\/[a-z0-9]{15}\/edit$/);
  await page.getByTestId('station-dot-NAPERVILLE').click();
  await page.getByTestId('venue-node-2').click();
  await page.getByTestId('sheet-add').click();
  await expect(page).toHaveURL(/\/edit$/);
  return page.url().replace(/\/edit$/, '');
}

test('someone else clones a route, names it on arrival, and both chats record it', async ({ page, browser }) => {
  const original = `Clone Source ${RUN}`;
  await login(page, 'E2E Builder', CREW);
  const sourceUrl = await makeDraft(page, original);

  const other = await (await browser.newContext()).newPage();
  await login(other, 'E2E Cloner', CREW);
  await other.goto(sourceUrl);
  await other.getByTestId('clone-route').click();
  await expect(other).toHaveURL(/\/plan\/[a-z0-9]{15}\/edit/);
  const box = other.getByTestId('route-title');
  await expect(box).toBeFocused();
  await expect(box).toHaveValue(`${copy.cloneTitlePrefix} ${original}`);
  expect(await box.evaluate((el: HTMLInputElement) => el.selectionStart === 0 && el.selectionEnd === el.value.length)).toBe(true);
  await expect(other.getByText('Naperville Wine Bar')).toBeVisible();

  // A taken name is refused and stays in the box.
  await other.keyboard.type(original.toUpperCase());
  await other.keyboard.press('Tab');
  await expect(other.getByTestId('route-title-error')).toHaveText(copy.titleTaken);
  await expect(box).toHaveValue(original.toUpperCase());

  const renamed = `Southside ${RUN}`;
  await box.fill(renamed);
  await box.press('Enter');
  await expect(other.getByTestId('route-title-error')).toBeHidden();
  await other.getByTestId('done-editing').click();
  await expect(other.getByTestId('note-cloned_from')).toContainText(original);
  await expect(other.getByTestId('note-renamed')).toContainText(renamed);
  const cloneUrl = other.url();

  await page.goto(sourceUrl);
  const back = page.getByTestId('note-cloned_to');
  await expect(back).toContainText('E2E Cloner');
  await expect(back.getByRole('link')).toHaveAttribute('href', new URL(cloneUrl).pathname);
  // A crew member cannot delete a note (no hold menu for it).
  await expect(page.getByTestId('note-cloned_to')).not.toHaveAttribute('tabindex', '0');
});

test('the Conductor renames The Route through Save', async ({ page }) => {
  await clearLockedCrawls();
  await login(page, 'E2E Boss', ADMIN);
  const { itineraryId } = await seedLockedCrawl({ ownerName: 'E2E Boss', eventDate: '2026-12-26', startTime: '11:00',
    departAt: '2026-12-26T20:30:00.000Z', arriveAt: '2026-12-26T21:05:00.000Z' });
  await page.goto(`/plan/${itineraryId}/edit`);
  await expect(page.getByTestId('clone-route')).toHaveCount(0);
  const name = `Renamed Route ${RUN}`;
  await page.getByTestId('route-title').fill(name);
  await page.getByTestId('route-title').press('Enter');
  await page.getByTestId('save-plan').click();
  await page.getByTestId('bulletin-skip').click();
  await expect(page).toHaveURL(new RegExp(`/plan/${itineraryId}$`));
  await expect(page.getByTestId('note-renamed')).toContainText(name);
});
```

The Conductor test needs a date and anchor on which Save is allowed. If `save-plan` stays disabled,
copy the seeding and clock setup from the simplest passing save test in `liveEdit.spec.ts` rather
than inventing one.

- [ ] **Step 2: Run and watch it fail.**
  `cd web && npx playwright test tests/e2e/cloneRoute.spec.ts` (nothing else may be running on
  15173/18093). Expected: FAIL (no `clone-route`).

- [ ] **Step 3: Icon and labels.**
  - In `icons.ts`, add `'copy'` to `IconName` and
    `copy: ['M8 8h11v11H8z', 'M5 16V5h11']` to `ICONS`.
  - Add to `copy`:
    `routeName: 'Route name'`, `noteClonedFrom: 'cloned this route from'`,
    `noteClonedTo: 'cloned this route as'`, `noteRenamedFrom: 'renamed this route from'`,
    `noteRenamedTo: 'to'`.
  - Add README rows. Update `icons.test.ts` if it enumerates names.

- [ ] **Step 4: Title box in `ItineraryView.svelte`.**
  - Add `selectTitle` to the props destructure and type:
    `/** Focus the name with its text selected, for a route that was just cloned. */ selectTitle?: boolean;`.
  - In the script:

```ts
  // The name is edited in place. Leaving the box renames; a refused name stays in the box with the
  // reason under it, and the saved title only changes once the server accepts one.
  let titleInput = $state<HTMLInputElement>();
  let titleText = $state('');
  let titleError = $state('');
  let titleFocused = false;
  $effect(() => { const saved = itinerary.title; if (!titleFocused && !titleError) titleText = saved; });
  onMount(() => { if (selectTitle) void tick().then(() => { titleInput?.focus(); titleInput?.select(); }); });
  async function commitTitle() {
    titleFocused = false;
    const next = titleText.trim();
    if (!next || next === itinerary.title) { titleText = itinerary.title; titleError = ''; return; }
    try { await actions.rename!(next); titleError = ''; }
    catch (err) { titleError = (err as Error).message || copy.genericError; }
  }
  function titleKey(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); titleInput?.blur(); }
    else if (e.key === 'Escape') { titleText = itinerary.title; titleError = ''; titleInput?.blur(); }
  }
```

  - Replace `<h1>{itinerary.title}</h1>` with:

```svelte
  {#if canManage && actions.rename}
    <h1><input bind:this={titleInput} bind:value={titleText} class="title" maxlength="80" aria-label={copy.routeName}
      aria-invalid={!!titleError} data-testid="route-title" onfocus={() => (titleFocused = true)}
      onblur={() => void commitTitle()} onkeydown={titleKey} /></h1>
    {#if titleError}<p class="error" role="alert" data-testid="route-title-error">{titleError}</p>{/if}
  {:else}
    <h1>{itinerary.title}</h1>
  {/if}
```

  - Style, beside `.it h1`:
    `.it h1 .title { font: inherit; color: inherit; text-transform: inherit; width: 100%; margin: 0; padding: 0 0 2px; min-height: 0; background: transparent; border: 0; border-bottom: 1px dashed #555; border-radius: 0; }`
    and `.it h1 .title:focus { outline: none; border-bottom-color: var(--gold-soft); }`.

- [ ] **Step 5: Editor wiring (`plan/[id]/edit/+page.svelte`).**
  - Import `setTitle` from `$lib/live/staged`, `cloneRoute` from `$lib/cloneRoute`,
    `replaceState` from `$app/navigation`, and `page` from `$app/state`. If `$app/state` is not used
    anywhere yet, check `package.json` for `@sveltejs/kit` ≥ 2.12; otherwise use `$app/stores`.
  - Add to `stagedActions`:

```ts
    // Staged like the rest, but checked now so "taken" shows on blur, not at Save.
    rename: async (title) => {
      await api(`/api/plan/title-check?title=${encodeURIComponent(title)}&route=${data.id}`);
      if (plan) plan = setTitle(plan, title);
    },
```

  - Add the clone handler and the `?named=1` handling:

```ts
  // Arriving from Clone: the name box opens selected once; drop the flag so a reload does not.
  const selectTitle = page.url.searchParams.get('named') === '1';
  $effect(() => { if (selectTitle) replaceState(page.url.pathname, {}); });
  let cloning = $state(false);
  async function clone() {
    if (!draft) return;
    cloning = true; error = '';
    try { const id = await cloneRoute(draft.itinerary); await goto(`/plan/${id}/edit?named=1`); }
    catch (err) { error = (err as Error).message || copy.genericError; }
    finally { cloning = false; }
  }
```

  - In the nav bar, before the delete button, add the line below. Only a draft gets it: the locked
    editor holds unsaved staged edits that leaving would lose.

```svelte
  {#if draft && !live && $auth.user}<IconButton icon="copy" label={copy.cloneRoute} onclick={() => void clone()} disabled={cloning} testid="clone-route" />{/if}
```

  - On `ItineraryView`, pass `{selectTitle}` and show the staged name:
    `itinerary={live && plan?.title !== undefined ? { ...draft.itinerary, title: plan.title } : draft.itinerary}`.
  - Because `selectTitle` is a `const` read once at component creation, going from one clone to
    another re-creates the page. If it does not (same component, new `data.id`), move it into the
    `$effect` that already resets on `data.id`.

- [ ] **Step 6: Route page (`plan/[id]/+page.svelte`).**
  - Import `cloneRoute`.
  - Add the same `cloning`/`clone()` handler as the editor.
  - In the nav bar before the edit link, add:
    `{#if draft && $auth.user}<IconButton icon="copy" label={copy.cloneRoute} onclick={() => void clone()} disabled={cloning} testid="clone-route" />{/if}`.

- [ ] **Step 7: Create form (`plan/+page.svelte`).** Import `titleError` and change the catch to
  `catch (err) { error = titleError(err) ?? ((err as Error).message || copy.genericError); }`.

- [ ] **Step 8: Notes in `Comments.svelte`.**
  - Change `canDelete` to
    `const canDelete = (c: Comment) => c.kind ? !!$auth.user?.is_admin : c.user === me || !!$auth.user?.is_admin;`.
  - Add `class:note={!!c.kind}` to the `<article>`, and make the `mine` class
    `class:mine={mine && !c.kind}`.
  - Add `data-testid={c.kind ? `note-${c.kind}` : undefined}` to the `<article>`.
  - Inside the article, wrap the existing `who`/photo/body block as `{#if c.kind}…{:else}existing…{/if}`,
    where the note branch is:

```svelte
          <p>
            <strong>{c.expand?.user?.name ?? '…'}</strong>
            {#if c.kind === 'renamed'}{copy.noteRenamedFrom} “{c.meta?.from}” {copy.noteRenamedTo} “{c.meta?.to}”
            {:else}{c.kind === 'cloned_from' ? copy.noteClonedFrom : copy.noteClonedTo} <a href="/plan/{c.meta?.route}">{c.meta?.title}</a>{/if}
          </p>
```

  - Keep the `<time>` element for notes too, and add these styles:

```css
  article.note { align-self: center; max-width: 95%; background: transparent; border: 1px dashed #3a352b; border-radius: 10px; text-align: center; }
  article.note p { color: #b8ad96; font-size: 13px; }
  article.note a { color: #ffce5c; }
  article.note time { position: static; display: block; }
```

- [ ] **Step 9: Run everything.**
  `cd web && npm test && npm run check && npx playwright test tests/e2e/cloneRoute.spec.ts`, then
  the full `npm run test:e2e`. Fix any existing e2e that asserted the `<h1>` heading text on the
  editor: `planning.spec.ts:168` asserts `getByRole('heading', { name: 'E2E Crawl' })`. On an edit
  screen for a draft, that heading is now an input. Assert `getByTestId('route-title')`
  `toHaveValue('E2E Crawl')` there instead, or leave it if the assertion is on the view page.
  Expected: all green.

- [ ] **Step 10: Commit**

```bash
git add web/src/lib/components/ItineraryView.svelte web/src/lib/components/Comments.svelte \
  "web/src/routes/(app)/plan/[id]/+page.svelte" "web/src/routes/(app)/plan/[id]/edit/+page.svelte" \
  "web/src/routes/(app)/plan/+page.svelte" web/src/lib/icons.ts web/src/lib/labels.ts README.md \
  web/tests/e2e/cloneRoute.spec.ts
git status --short
git commit -m "feat(plan): clone button, name box that renames on blur, notes in the chat"
```
(plus `web/tests/unit/icons.test.ts` / `web/tests/e2e/planning.spec.ts` if touched)

---

### Task 7: Venue picker groups

**Files:**
- Create: `web/src/lib/venueGroups.ts`, `web/tests/unit/venueGroups.test.ts`
- Modify: `web/src/routes/(app)/plan/[id]/add/+page.svelte`, `web/src/lib/labels.ts`, `README.md`,
  `web/tests/e2e/planning.spec.ts`

**Interfaces:**
- Produces:
  - `groupByKind(venues: Venue[]): { kind: 'bar' | 'restaurant' | 'other'; venues: Venue[] }[]`
  - labels `venueGroup_bar`, `venueGroup_restaurant`, `venueGroup_other`
  - test ids `venue-group-<kind>`

- [ ] **Step 1: Write the failing unit test** `web/tests/unit/venueGroups.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { groupByKind } from '../../src/lib/venueGroups';
import type { Venue } from '../../src/lib/types';

const v = (id: string, kind: string): Venue => ({ source: 'google', id, name: id, kind, lat: 0, lon: 0 } as Venue);

describe('groupByKind', () => {
  it('orders bars, restaurants, places; keeps the ranking inside each; drops empty groups', () => {
    const groups = groupByKind([v('r1', 'restaurant'), v('b1', 'bar'), v('r2', 'restaurant'), v('b2', 'bar')]);
    expect(groups.map((g) => [g.kind, g.venues.map((x) => x.id)])).toEqual([['bar', ['b1', 'b2']], ['restaurant', ['r1', 'r2']]]);
  });
  it('puts anything that is not a bar or restaurant under places', () => {
    expect(groupByKind([v('o1', 'other'), v('x', 'museum')])).toEqual([{ kind: 'other', venues: [v('o1', 'other'), v('x', 'museum')] }]);
  });
  it('returns nothing for no venues', () => { expect(groupByKind([])).toEqual([]); });
});
```

- [ ] **Step 2: Run and watch it fail.** `cd web && npx vitest run tests/unit/venueGroups.test.ts`.

- [ ] **Step 3: Implement** `web/src/lib/venueGroups.ts`

```ts
// The picker lists bars first: nearby restaurants are as many as bars and would bury them.
import type { Venue } from './types';

export type VenueGroup = { kind: 'bar' | 'restaurant' | 'other'; venues: Venue[] };

export function groupByKind(venues: Venue[]): VenueGroup[] {
  const groups: VenueGroup[] = [{ kind: 'bar', venues: [] }, { kind: 'restaurant', venues: [] }, { kind: 'other', venues: [] }];
  for (const venue of venues) groups[venue.kind === 'bar' ? 0 : venue.kind === 'restaurant' ? 1 : 2].venues.push(venue);
  return groups.filter((g) => g.venues.length);
}
```

Add labels `venueGroup_bar: 'Bars'`, `venueGroup_restaurant: 'Restaurants'`,
`venueGroup_other: 'Places'` and README rows.

- [ ] **Step 4: Render the groups** in `plan/[id]/add/+page.svelte`. Replace the Nearby
  `<ul class="venues">…</ul>` with the markup below. The kind label is dropped from each row because
  the section already says it.

```svelte
    {#each groupByKind(nearby) as group (group.kind)}
      <details class="group" open={group.kind === 'bar'} data-testid="venue-group-{group.kind}">
        <summary>{copy[`venueGroup_${group.kind}`]} ({group.venues.length})</summary>
        <ul class="venues">
          {#each group.venues as v (v.id)}
            <li><button type="button" onclick={() => openVenue(tid(v))} disabled={!!busy} data-testid={tid(v)}>
              <strong>{v.name}</strong><span>{rated(v).replace(/^ · /, '')}{v.rating !== undefined ? ' · ' : ''}{v.distanceM ?? 0} m{v.address ? ` · ${v.address}` : ''}</span>
            </button></li>
          {/each}
        </ul>
      </details>
    {/each}
```

Add the style
`.group summary { cursor: pointer; font-weight: 700; padding: 10px 0; color: #ffce5c; } .group { border-bottom: 1px solid #2a2a2a; }`.
Import `groupByKind`.

- [ ] **Step 5: e2e.** In `planning.spec.ts`, add `AURORA` venues of all three kinds to `venuesFor`,
  and a test:

```ts
  AURORA: [
    { source: 'google', id: 'r9', name: 'Aurora Diner', kind: 'restaurant', lat: 41.76, lon: -88.31, distanceM: 50, rating: 4.9, ratingCount: 900 },
    { source: 'google', id: 'b9', name: 'Aurora Taproom', kind: 'bar', lat: 41.76, lon: -88.31, distanceM: 80, rating: 4.1, ratingCount: 40 },
    { source: 'google', id: 'o9', name: 'Aurora Arcade', kind: 'other', lat: 41.76, lon: -88.31, distanceM: 90 }
  ]
```

```ts
test('the picker opens on bars; restaurants and places wait folded with counts', async ({ page }) => {
  await login(page, 'E2E Skipper', ADMIN);
  await page.getByTestId('nav-plan').click();
  await page.getByTestId('draft-title').fill(`Grouped ${Date.now().toString(36)}`);
  await page.getByTestId('create-draft').click();
  await expect(page).toHaveURL(/\/plan\/[a-z0-9]{15}\/edit$/);
  await page.goto(page.url().replace(/\/edit$/, '/add?station=AURORA&side=left'));
  await expect(page.getByTestId('venue-group-bar')).toHaveAttribute('open', '');
  await expect(page.getByTestId('venue-b9')).toBeVisible();
  await expect(page.getByTestId('venue-group-restaurant')).not.toHaveAttribute('open');
  await expect(page.getByTestId('venue-group-restaurant').locator('summary')).toHaveText(`${copy.venueGroup_restaurant} (1)`);
  await expect(page.getByTestId('venue-r9')).toBeHidden();
  await page.getByTestId('venue-group-restaurant').locator('summary').click();
  await page.getByTestId('venue-r9').click();
  await expect(page.getByTestId('venue-sheet')).toContainText('Aurora Diner');
});
```

If `AURORA` is not a station on the planner line, `?station=AURORA` will not resolve. Use any
station id from `station-dot-*` that the existing tests do not already mock.

- [ ] **Step 6: Run.** `cd web && npm test && npm run check && npm run test:e2e`. Existing picker
  tests use `kind: 'bar'` venues, which sit in the open group, so they should pass unchanged.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/venueGroups.ts web/tests/unit/venueGroups.test.ts "web/src/routes/(app)/plan/[id]/add/+page.svelte" \
  web/src/lib/labels.ts README.md web/tests/e2e/planning.spec.ts
git status --short
git commit -m "feat(plan): the venue picker groups bars, restaurants and places"
```

---

### Task 8: Full verification

- [ ] **Step 1:** From the worktree, run `cd web && npm test && npm run check && npm run test:e2e`
  and `bash scripts/test-hooks.sh`. Expected: everything green. Paste the summary lines.
- [ ] **Step 2:** `git log --oneline main..` shows the spec, plan and seven feature commits.
  `git status --short` is clean.
- [ ] **Step 3:** Do not run `just up` or merge. Deploying and fast-forwarding `main` are the
  user's call. Mention that the migrations backfill `title_key` on the production database on the
  next PocketBase restart.
