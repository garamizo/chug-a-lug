# Venue Groups, Clone Route and Rename Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group the venue picker by kind, let any user clone a route, and have the planner chat record clones and renames.

**Architecture:**
- Route names get a normalised `title_key`, which the itineraries hooks enforce as unique.
- Notes are `comments` rows with a `kind` and a `meta`. Only the server writes them: the rename hook
  inside the same transaction as the rename, and the clone endpoint.
- The clone endpoint writes as the user (through their token) so the existing ownership hooks apply,
  and it uses a client-minted id so a retry cannot make two clones.
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

1. **Double-tap or retry of Clone after a lost response.** The user expects one clone and one note
   per side. The retry map is keyed by source route (Task 5 `cloneRoute.test.ts`), and the server's
   completion check covers it (Task 4).
2. **Cloning a route whose "Copy of …" name is taken, or whose title is already 80 characters.** The
   user expects a free "(n)" name that still fits in 80 characters (Task 1 `cloneTitle` tests,
   Task 4 suffix test).
3. **Renaming to an existing name that differs only by case or spacing.** The user expects "taken",
   with their text left in the box (Task 1 hook test, Task 6 e2e).
4. **A rename whose note cannot be saved.** The user expects the title to be unchanged (Task 2
   atomicity hook test).
5. **A plain comment PATCHed into a note.** It must be refused (Task 2 hook test, every kind).

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
| `web/src/routes/api/plan/clone/+server.ts` (new) | Clone endpoint |
| `web/src/lib/cloneRoute.ts` (new) | Client call with a retry id kept per source route |
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

In `planning.pb.js`, the itineraries create hook, before `e.next()`:

```js
  const titles = require(`${__hooks}/routeTitle.js`)
  const name = titles.normalize(r.getString('title'))
  if (!name) throw new BadRequestError('title_invalid')
  if (titles.taken(e.app, name.key, '')) throw new BadRequestError('title_taken')
  r.set('title', name.display)
  r.set('title_key', name.key)
```

In the update hook, after the existing non-admin checks and before `locking` is computed:

```js
  const titles = require(`${__hooks}/routeTitle.js`)
  const name = titles.normalize(e.record.getString('title'))
  if (!name) throw new BadRequestError('title_invalid')
  if (name.key !== original.getString('title_key') && titles.taken(e.app, name.key, e.record.id)) {
    throw new BadRequestError('title_taken')
  }
  e.record.set('title', name.display)
  e.record.set('title_key', name.key)
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
  - Replace the bare `e.next()` with the block below.
  - Everything after it (locking, archive, event_log, recompute) stays as it is, outside the
    transaction.

```js
  // The rename and its note land together: a title never changes without its history.
  const app = e.app
  try {
    app.runInTransaction((tx) => {
      e.app = tx
      e.next()
      if (renamed && isCrew) {
        const note = new Record(tx.findCollectionByNameOrId('comments'))
        note.set('user', e.auth.id)
        note.set('target_collection', 'itineraries')
        note.set('target_id', e.record.id)
        note.set('kind', 'renamed')
        note.set('meta', { from: original.getString('title'), to: e.record.getString('title') })
        tx.save(note)
      }
    })
  } finally { e.app = app }
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
- Add `titleTaken: false` to `state` (reset it in `beforeEach`).
- Add a `getList` to the `adminPb` mock's collection:
  `getList: async () => ({ totalItems: state.titleTaken ? 1 : 0, items: [] })`.
- Give `adminPb`'s mock a `filter: (raw: string) => raw`, which it already has.
- Add `userPb` to the `$lib/server/pb` mock:

```ts
  userPb: vi.fn(() => ({
    collection: (collection: string) => ({
      update: async (id: string, body: Record<string, unknown>) => { state.writes.push({ op: 'userUpdate', collection, id, body }); return { id }; }
    })
  })),
```

Then set `state.itinerary` to include `title: 'Old name'` in `beforeEach` and add:

```ts
describe('title', () => {
  it('writes a changed title as the Conductor, after the stops', async () => {
    const res = await call({ ...rideable, title: '  New name ' });
    expect(res.status).toBe(200);
    const i = state.writes.findIndex((w) => w.op === 'userUpdate');
    expect(state.writes[i]).toEqual({ op: 'userUpdate', collection: 'itineraries', id: 'itinerary000001', body: { title: 'New name' } });
    expect(state.writes.slice(i + 1).some((w) => w.collection === 'stops')).toBe(false);
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

After the stop writes and before the anchor/recompute step (read the file to find the exact spot:
the last `stops` create/update/delete loop), add:

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

### Task 4: Clone endpoint

**Files:**
- Create: `web/src/routes/api/plan/clone/+server.ts`, `web/tests/unit/cloneEndpoint.test.ts`
- Modify: `web/src/lib/labels.ts`, `README.md`

**Interfaces:**
- Consumes: `userPb`, `checkTitle` (Task 3); `cloneTitle`, `titleError` (Task 1); note fields
  (Task 2).
- Produces: `POST /api/plan/clone` with body `{ itinerary: string; id: string }`, answering
  `{ id: string; title?: string }`. A missing source returns 404 with `copy.routeGone`, and an `id`
  that belongs to someone else returns 409.

- [ ] **Step 1: Write the failing test** `web/tests/unit/cloneEndpoint.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { copy } from '../../src/lib/labels';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({
  itineraries: {} as Record<string, Row>, stops: [] as Row[], comments: [] as Row[],
  userWrites: [] as { collection: string; body: Row }[], adminDeletes: [] as string[],
  failStopAt: -1, takenKeys: new Set<string>()
}));
const SRC = 'sourceroute0001', NEW = 'newclonedrt0001';

vi.mock('$lib/server/pb', () => ({
  requireUser: vi.fn(async () => ({ id: 'cloner', is_admin: false })),
  adminPb: vi.fn(async () => ({
    filter: (raw: string, p: Record<string, string>) => `${raw}|${JSON.stringify(p)}`,
    collection: (c: string) => ({
      getOne: async (id: string) => { const r = state.itineraries[id]; if (!r) throw Object.assign(new Error('nf'), { status: 404 }); return r; },
      getFullList: async () => state.stops,
      getList: async (_p: number, _n: number, o: { filter: string }) => {
        if (c === 'itineraries') { const k = JSON.parse(o.filter.split('|')[1]).k; return { totalItems: state.takenKeys.has(k) ? 1 : 0, items: [] }; }
        const done = state.comments.some((n) => n.kind === 'cloned_to' && (n.meta as Row).route === NEW);
        return { totalItems: done ? 1 : 0, items: [] };
      },
      create: async (body: Row) => { state.comments.push(body); return body; },
      delete: async (id: string) => { state.adminDeletes.push(id); delete state.itineraries[id]; }
    })
  })),
  userPb: vi.fn(() => ({
    collection: (c: string) => ({
      create: async (body: Row) => {
        if (c === 'stops' && state.userWrites.filter((w) => w.collection === 'stops').length === state.failStopAt) throw Object.assign(new Error('boom'), { status: 500 });
        state.userWrites.push({ collection: c, body });
        if (c === 'itineraries') state.itineraries[body.id as string] = { ...body, created_by: 'cloner' };
        return body;
      }
    })
  }))
}));
const { POST } = await import('../../src/routes/api/plan/clone/+server');
const call = (body: unknown) => POST({ request: new Request('http://x/api/plan/clone', { method: 'POST', body: JSON.stringify(body) }) } as never);

beforeEach(() => {
  state.itineraries = { [SRC]: { id: SRC, title: 'Loop Crawl', event_date: '2026-12-26', start_time: '11:00', start_station: 'CUS', start_station_name: 'Union Station', status: 'locked', created_by: 'owner' } };
  state.stops = [
    { id: 's1', order: 1, name: 'The Hop Haus', kind: 'bar', direction: 'out', station_id: 'LAGRANGE', station_name: 'La Grange Road', place: 'place0000000001', place_id: 'g1', osm_id: '', address: '1 Main', lat: 41.8, lon: -87.8, hours: '', phone: '', website: '', confirmed_open: true, dwell_min: 75, walk_min: 4, notes: 'upstairs', meet_point: 'bar', photos_status: 'done' },
    { id: 's2', order: 2, name: 'Berwyn Beer Hall', kind: 'restaurant', direction: 'back', station_id: 'CUS', station_name: 'Union Station', place: '', place_id: '', osm_id: 'node/2', address: '', lat: 0, lon: 0, hours: '', phone: '', website: '', confirmed_open: false, dwell_min: 60, walk_min: 5, notes: '', meet_point: '', photos_status: 'failed' }
  ];
  state.comments = []; state.userWrites = []; state.adminDeletes = []; state.failStopAt = -1; state.takenKeys = new Set();
});

describe('POST /api/plan/clone', () => {
  it('creates the clone as the user, copies stop fields, and notes both routes (source last)', async () => {
    const res = await call({ itinerary: SRC, id: NEW });
    expect(await res.json()).toMatchObject({ id: NEW, title: `${copy.cloneTitlePrefix} Loop Crawl` });
    const it = state.userWrites.find((w) => w.collection === 'itineraries')!.body;
    expect(it).toEqual({ id: NEW, title: `${copy.cloneTitlePrefix} Loop Crawl`, event_date: '2026-12-26', start_time: '11:00', start_station: 'CUS', start_station_name: 'Union Station' });
    const stops = state.userWrites.filter((w) => w.collection === 'stops').map((w) => w.body);
    expect(stops[0]).toMatchObject({ itinerary: NEW, order: 1, name: 'The Hop Haus', place: 'place0000000001', dwell_min: 75, notes: 'upstairs', meet_point: 'bar', direction: 'out', photos_status: 'done' });
    expect(stops[0]).not.toHaveProperty('id');
    expect(stops[1]).toMatchObject({ kind: 'restaurant', photos_status: 'none', osm_id: 'node/2' });
    expect(state.comments.map((c) => [c.target_id, c.kind, c.user])).toEqual([[NEW, 'cloned_from', 'cloner'], [SRC, 'cloned_to', 'cloner']]);
    expect(state.comments[0].meta).toEqual({ route: SRC, title: 'Loop Crawl' });
    expect(state.comments[1].meta).toEqual({ route: NEW, title: `${copy.cloneTitlePrefix} Loop Crawl` });
  });

  it('numbers the name when "Copy of" is taken', async () => {
    state.takenKeys.add(`${copy.cloneTitlePrefix} loop crawl`.toLowerCase());
    expect((await (await call({ itinerary: SRC, id: NEW })).json()).title).toBe(`${copy.cloneTitlePrefix} Loop Crawl (2)`);
  });

  it('deletes the half-made clone when a stop fails', async () => {
    state.failStopAt = 1;
    await expect(call({ itinerary: SRC, id: NEW })).rejects.toBeTruthy();
    expect(state.adminDeletes).toEqual([NEW]);
    expect(state.comments.some((c) => c.target_id === SRC)).toBe(false);
  });

  it('a retry after completion returns the same clone and writes nothing', async () => {
    await call({ itinerary: SRC, id: NEW });
    const writes = state.userWrites.length, notes = state.comments.length;
    expect((await (await call({ itinerary: SRC, id: NEW })).json()).id).toBe(NEW);
    expect(state.userWrites.length).toBe(writes);
    expect(state.comments.length).toBe(notes);
  });

  it('a retry after a half-made clone rebuilds it', async () => {
    state.itineraries[NEW] = { id: NEW, created_by: 'cloner', title: 'x' };
    await call({ itinerary: SRC, id: NEW });
    expect(state.adminDeletes).toEqual([NEW]);
    expect(state.comments.filter((c) => c.kind === 'cloned_to')).toHaveLength(1);
  });

  it('refuses a missing source, a bad id and someone else\'s id', async () => {
    await expect(call({ itinerary: 'missingroute001', id: NEW })).rejects.toMatchObject({ status: 404 });
    await expect(call({ itinerary: SRC, id: 'short' })).rejects.toMatchObject({ status: 400 });
    state.itineraries[NEW] = { id: NEW, created_by: 'someone', title: 'x' };
    await expect(call({ itinerary: SRC, id: NEW })).rejects.toMatchObject({ status: 409 });
  });
});
```

- [ ] **Step 2: Run and watch it fail.** `cd web && npx vitest run tests/unit/cloneEndpoint.test.ts`.

- [ ] **Step 3: Implement** `web/src/routes/api/plan/clone/+server.ts`

```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminPb, requireUser, userPb } from '$lib/server/pb';
import { checkTitle } from '$lib/server/routeTitle';
import { cloneTitle, titleError } from '$lib/routeTitle';
import { copy } from '$lib/labels';
import type { Itinerary, Stop } from '$lib/types';

const ID = /^[a-z0-9]{15}$/;
const MAX_TRIES = 50;
// What a stop means for planning. Legs are recomputed by the stop hook; votes, comments, crew photos
// and anything from the day itself stay with the original.
const STOP_FIELDS = ['order', 'name', 'kind', 'direction', 'station_id', 'station_name', 'place', 'place_id', 'osm_id',
  'address', 'lat', 'lon', 'hours', 'phone', 'website', 'confirmed_open', 'dwell_min', 'walk_min', 'notes', 'meet_point'] as const;
const status = (err: unknown) => (err as { status?: number }).status;

// Any crew member may copy any route into a draft of their own. The client mints the new route's id
// and keeps it across retries, so a response lost after success cannot produce a second clone. The
// source's `cloned_to` note is written last and is the proof a clone finished.
export const POST: RequestHandler = async ({ request }) => {
  const user = await requireUser(request);
  const body = (await request.json().catch(() => ({}))) as { itinerary?: unknown; id?: unknown };
  const sourceId = String(body.itinerary ?? '');
  const id = String(body.id ?? '');
  if (!ID.test(sourceId) || !ID.test(id)) throw error(400, 'itinerary and id required');

  const admin = await adminPb();
  const find = (rid: string) => admin.collection('itineraries').getOne<Itinerary>(rid).catch((err) => {
    if (status(err) === 404) return null;
    throw err;
  });
  const source = await find(sourceId);
  if (!source) throw error(404, copy.routeGone);

  const existing = await find(id);
  if (existing) {
    if (existing.created_by !== user.id) throw error(409, copy.genericError);
    const done = await admin.collection('comments').getList(1, 1, {
      filter: admin.filter("target_collection = 'itineraries' && target_id = {:src} && kind = 'cloned_to' && meta.route = {:id}", { src: sourceId, id }),
      fields: 'id'
    });
    if (done.totalItems) return json({ id });
    await admin.collection('itineraries').delete(id);
  }

  const stops = await admin.collection('stops').getFullList<Stop>({
    filter: admin.filter('itinerary = {:id}', { id: sourceId }), sort: 'order,created'
  });
  const mine = userPb(request);

  let title = '';
  for (let n = 1; !title; n++) {
    if (n > MAX_TRIES) throw error(409, copy.titleTaken);
    const candidate = cloneTitle(source.title, n);
    if (!(await checkTitle(admin, candidate)).ok) continue;
    try {
      await mine.collection('itineraries').create({
        id, title: candidate, event_date: source.event_date, start_time: source.start_time,
        start_station: source.start_station, start_station_name: source.start_station_name
      });
      title = candidate;
    } catch (err) {
      if (titleError(err) === copy.titleTaken) continue; // lost a race for the name: try the next
      throw err;
    }
  }

  try {
    for (const s of stops) {
      const fields = Object.fromEntries(STOP_FIELDS.map((f) => [f, (s as Record<string, unknown>)[f]]));
      await mine.collection('stops').create({ ...fields, itinerary: id, photos_status: s.photos_status === 'done' ? 'done' : 'none' });
    }
    const note = { user: user.id, target_collection: 'itineraries', body: '' };
    await admin.collection('comments').create({ ...note, target_id: id, kind: 'cloned_from', meta: { route: sourceId, title: source.title } });
    await admin.collection('comments').create({ ...note, target_id: sourceId, kind: 'cloned_to', meta: { route: id, title } });
  } catch (err) {
    await admin.collection('itineraries').delete(id).catch(() => { /* best effort; a retry rebuilds */ });
    throw err;
  }
  return json({ id, title });
};
```

Add `routeGone: 'That route no longer exists.'` and `cloneRoute: 'Clone route'` to `copy`, plus
README rows. If `labels.test.ts` checks every copy key against the README, it will tell you which
rows are missing.

- [ ] **Step 4: Run.** `cd web && npm test && npm run check`. Expected: green.

- [ ] **Step 5: Hook-level check of the real rules.** Add to `web/tests/hooks/notes.test.ts`: a
  superuser can create a `cloned_to` note with an empty body on a route (this is the endpoint's path,
  and it proves `targets.pb.js` and the create rule let the server through).

```ts
  it('the server (superuser) can write a note with no body', async () => {
    const r = await route(crew.token);
    const su = await superuserToken();
    const res = await post('/api/collections/comments/records', { user: crew.id, target_collection: 'itineraries', target_id: r.id, kind: 'cloned_to', meta: { route: r.id, title: 'x' } }, su);
    expect(res.status).toBe(200);
    // The endpoint's completion check filters on a JSON path; prove PocketBase answers it.
    const q = encodeURIComponent(`target_id="${r.id}" && kind="cloned_to" && meta.route="${r.id}"`);
    expect((await (await get(`/api/collections/comments/records?filter=${q}`, su)).json()).totalItems).toBe(1);
  });
```

If the JSON-path filter returns 0, switch the endpoint's completion check to fetching the source's
`cloned_to` notes and matching `meta.route` in code, and update the unit mock to match.

Run `bash scripts/test-hooks.sh`. Expected: green.

- [ ] **Step 6: Commit**

```bash
git add web/src/routes/api/plan/clone/+server.ts web/tests/unit/cloneEndpoint.test.ts web/tests/hooks/notes.test.ts web/src/lib/labels.ts README.md
git status --short
git commit -m "feat(plan): clone any route into your own draft, noted on both routes"
```

---

### Task 5: Client actions — rename, staged title, clone call

**Files:**
- Create: `web/src/lib/cloneRoute.ts`, `web/tests/unit/cloneRoute.test.ts`
- Modify: `web/src/lib/planActions.ts`, `web/src/lib/live/staged.ts`,
  `web/tests/unit/planActions.test.ts`, `web/tests/unit/staged.test.ts`

**Interfaces:**
- Consumes: `titleError` (Task 1); `/api/plan/clone` (Task 4).
- Produces:
  - `PlanActions.rename?: (title: string) => Promise<void>`, which rejects with an `Error` whose
    message is copy
  - `StagedPlan.title?: string`
  - `setTitle(plan: StagedPlan, title: string): StagedPlan`
  - `commitPayload` includes `title` only when staged
  - `cloneRoute(sourceId: string): Promise<string>`

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

const sent = vi.hoisted(() => ({ bodies: [] as { itinerary: string; id: string }[], fail: 0 }));
vi.mock('$lib/api', () => ({
  api: vi.fn(async (_path: string, init: { json: { itinerary: string; id: string } }) => {
    sent.bodies.push(init.json);
    if (sent.fail > 0) { sent.fail--; throw new Error('No signal'); }
    return { id: init.json.id };
  })
}));
const { cloneRoute } = await import('$lib/cloneRoute');

beforeEach(() => { sent.bodies = []; sent.fail = 0; });

describe('cloneRoute', () => {
  it('retries a failed clone under the same id, then mints a fresh one', async () => {
    sent.fail = 1;
    await expect(cloneRoute('sourceroute0001')).rejects.toThrow();
    const first = await cloneRoute('sourceroute0001');
    expect(sent.bodies[0].id).toBe(sent.bodies[1].id);
    expect(first).toBe(sent.bodies[0].id);
    await cloneRoute('sourceroute0001');
    expect(sent.bodies[2].id).not.toBe(first);
  });
  it('keeps retry ids per source route', async () => {
    sent.fail = 1;
    await expect(cloneRoute('sourceroute000a')).rejects.toThrow();
    await cloneRoute('sourceroute000b');
    expect(sent.bodies[1].id).not.toBe(sent.bodies[0].id);
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
// retry after a lost response finds the clone the server already made instead of making another.
import { api } from '$lib/api';
import { newRecordId } from '$lib/live/staged';

const pending = new Map<string, string>();

export async function cloneRoute(sourceId: string): Promise<string> {
  const id = pending.get(sourceId) ?? newRecordId();
  pending.set(sourceId, id);
  const res = await api<{ id: string }>('/api/plan/clone', { method: 'POST', json: { itinerary: sourceId, id } });
  pending.delete(sourceId);
  return res.id;
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
    try { const id = await cloneRoute(draft.itinerary.id); await goto(`/plan/${id}/edit?named=1`); }
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
