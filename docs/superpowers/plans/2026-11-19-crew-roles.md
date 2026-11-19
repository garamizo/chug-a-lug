# Crew Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One permanent role per person (Crew, Trainspotter, Put off, plus the one fixed Conductor), set by the Conductor from a role window on the Crew Board and the Manifest. Only Crew count in the night's numbers.

**Architecture:** A `users.role` select replaces `users.blocked`; `is_admin` stays the Conductor marker. The server enforces access (Put off cannot sign in, Trainspotter cannot log a drink, one Conductor reconciled at startup). The phones filter the night's aggregates (Golden Spikes, milestones, reel, Tab counts, Crew Board) through one roster-based rider filter.

**Tech Stack:** PocketBase 0.40 JSVM hooks and migrations, SvelteKit 2 / Svelte 5, Vitest (unit + hooks), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-11-19-crew-roles-design.md`

## Global Constraints

- Role values exactly `crew | trainspotter | put_off`; **empty reads as `crew`** everywhere (server `crew.roleOf`, client `roleOf`).
- Exactly one Conductor: the `CONDUCTOR_EMAIL` account. The role endpoint refuses `is_admin` targets and self; no UI can make or unmake a Conductor. Under `SIM=1` nothing is demoted.
- User-visible strings only in `web/src/lib/labels.ts`; README UI glossary updated to match.
- Tests before code; each task ends green: `cd web && npm test && npm run check && npm run test:e2e`, plus `bash scripts/test-hooks.sh`. One test run at a time across worktrees (fixed ports).
- Stage explicit paths only; never `git add -A`. Commits end with the session's attribution lines.
- Chat, Roundhouse and Cheers are never filtered by role; only aggregates are.

## Review Focus

1. A role change while the person's app is open: a new Trainspotter's next drink is refused with the Trainspotter message, no Retry kept, Closing Time not held up (Task 5 test).
2. The roster arrives after the feed at Closing Time: the reel must not open with unfiltered rows (Task 3 `reelReady` test).
3. A drink, photo or message by a user missing from the roster (just joined): it still counts (Task 3 `riderFilter` test).
4. A put-off person's old planner comments and chat photos still show their name (Task 1 hooks test: their record is still readable by others).
5. The Conductor opens the role window on themselves or on a stale row for a user just deleted: no window on their own name; 404 shows inline (Task 4 test).

---

### Task 1: `role` replaces `blocked` on the server

**Files:**
- Create: `pocketbase/pb_migrations/1759500000_crew_roles.js`
- Modify: `pocketbase/pb_hooks/crew.js` (add `roleOf`, `isPutOff`; `ensureConductor`, `signInGuard`), `pocketbase/pb_hooks/access.pb.js` (every `getBool('blocked')`, the update hook's fresh-field list, the token-death `onRecordUpdate`), `pocketbase/pb_hooks/access.js` (`isConductor`), `pocketbase/pb_hooks/session.pb.js`, `pocketbase/pb_hooks/config.pb.js` (guard checks `role` field)
- Test: `web/tests/hooks/migrations.test.ts`, `web/tests/hooks/access.test.ts`, `web/tests/hooks/session.test.ts`, `web/tests/hooks/password.test.ts`, `web/tests/hooks/setup.ts`

**Interfaces:**
- Produces (hooks): `crew.roleOf(record) -> 'crew'|'trainspotter'|'put_off'`, `crew.isPutOff(record) -> boolean`.
- Produces (tests): `setRole(id: string, role: 'crew'|'trainspotter'|'put_off'): Promise<void>` in `web/tests/hooks/setup.ts` (superuser PATCH).
- Produces (schema): `users.role` select; `users.blocked` gone; `access_log.event` includes `role_changed`.

- [ ] **Step 1: Write the failing migration test** in `migrations.test.ts`, same fixture-migration pattern as "retire boarding drops the queue": a fixture at `1759400000_zroles_fixture.js` creates users `Aboard` (blocked false) and `Gone` (blocked true); a check at `1759500000_zcheck_roles.js` asserts `Aboard.role === 'crew'`, `Gone.role === 'put_off'`, no `blocked` field, `users.updateRule` contains `@request.body.role:isset = false` and no `blocked`, every other clause from the retire-boarding check still present, and `access_log.event` values include `role_changed`. A second test runs `migrate down 1` then `migrate up` and asserts after down: `blocked` restored (`Gone` true), `role` gone, updateRule has `blocked` again; after up again: roles back.
- [ ] **Step 2: Update existing hooks tests to the new field** (they fail now): `blocked: true` PATCHes become `role: 'put_off'` (access.test.ts lines ~73, 83, 208; password.test.ts `block` helper and line ~135 `user.role === 'put_off'`; session.test.ts); the "cannot change own privileges" list swaps `{ blocked: true }` for `{ role: 'crew' }` and `{ role: 'trainspotter' }` (both 404); add `setRole` to `setup.ts`. Add test `put-off people stay readable so their posts keep a name`: rider A put off via `setRole`, rider B lists `users` and finds A by id with `name`.
- [ ] **Step 3: Run** `bash scripts/test-hooks.sh` — expect the new and edited tests to FAIL.
- [ ] **Step 4: Write the migration.** Up: add `SelectField role` (values above, maxSelect 1, not required); `UPDATE users SET role = CASE WHEN blocked THEN 'put_off' ELSE 'crew' END` by SQL; remove `blocked`; in `updateRule` replace the clause `@request.body.blocked:isset = false` with `@request.body.role:isset = false` in place (leave a `null` rule `null`); add `role_changed` to `access_log.event` values. Down: the exact reverse, `blocked = (role = 'put_off')`. Self-contained (no `require` of hooks).
- [ ] **Step 5: Swap the hooks** to `crew.isPutOff(...)` at every former `getBool('blocked')`; the users update hook's fresh-field list becomes `['role', 'is_admin', 'email', 'emailVisibility', 'verified', 'last_seen']`; the token-death `onRecordUpdate` fires when `isPutOff(record) && !isPutOff(record.original())`; `ensureConductor` sets `role = 'crew'` (not `blocked`) and its early-return checks `!isPutOff(c)`; `config.pb.js` guard is `if (!users.fields.getByName('role')) return`. `sign_in_refused` logs `detail: 'put_off'` (was `'blocked'`).
- [ ] **Step 6: Run** `bash scripts/test-hooks.sh` — expect PASS (the old put-off/let-back-on endpoint tests still pass: `setBlocked` now writes `role`; Task 2 replaces it).
- [ ] **Step 7: Commit** `feat(crew): users.role replaces blocked` with the migration, hooks and tests.

### Task 2: Role endpoint, one Conductor, Trainspotters can't log drinks

**Files:**
- Modify: `pocketbase/pb_hooks/access.js` (replace `setBlocked` with `setRole`; `manifest` returns `role`), `pocketbase/pb_hooks/access.pb.js` (routes), `pocketbase/pb_hooks/crew.js` (`ensureConductor` demotion), `pocketbase/pb_hooks/live.pb.js` (media create-request hook)
- Test: `web/tests/hooks/access.test.ts`, `web/tests/hooks/live.test.ts`, `web/tests/hooks/migrations.test.ts`

**Interfaces:**
- Consumes: `crew.roleOf`, `crew.isPutOff`, `setRole` (Task 1).
- Produces: `POST /api/crawl/users/{id}/role` body `{ role }` → `200 { role }`; errors `403` (not Conductor), `400` (self, `is_admin` target, unknown role), `404`. `GET /api/crawl/manifest` people carry `role` (no `blocked`). Media create with `drink_kind` by a trainspotter → `400` with hook code `trainspotter`. Old `put-off` / `let-back-on` routes removed.

- [ ] **Step 1: Write failing tests** in `access.test.ts`, replacing "only a Conductor puts someone off…":
  - `the role endpoint is the Conductor's, never on themselves or another admin`: rider→403; boss on self→400; boss on a second admin (`loginToken(..., ADMIN_LOGIN_PASSWORD)`)→400; `{ role: 'conductor' }`→400; unknown id→404.
  - `putting someone off kills their token; Crew lets them back on`: boss sets `put_off` → `/api/crawl/me` 401, auth-refresh 401; sets `crew` → 200 `{ role: 'crew' }`; log rows `put_off` then `let_back_on`, both with `actor = boss.id`.
  - `crew ↔ trainspotter is logged as role_changed with from → to`: detail `crew → trainspotter`; the trainspotter's token still works.
  - The realtime test ("stops receiving realtime events") switches to the role endpoint.
  - `the manifest carries role`: person row has `role` and no `blocked`.
  - In `live.test.ts`: `a trainspotter cannot post a proof but can post a plain photo and a chat message`: proof → 400 with `trainspotter` code (assert the same way existing `proof_needs_stop` tests do), no drink row; plain image → 200; chat message → 200.
  - In `migrations.test.ts`: `startup leaves one Conductor outside rehearsals` — temp data dir: `migrate up` with empty hooks dir plus a fixture migration making `extra@test.invalid` an admin; then run `pocketbase migrate up` again with `--hooksDir ../pocketbase/pb_hooks`, `CONDUCTOR_EMAIL=conductor@test.invalid`, `SIM=0` (onBootstrap runs `ensureConductor`); then a third `migrate up` with empty hooks and a check migration asserting `extra` is not admin and `conductor@test.invalid` is. Same flow with `SIM=1`: `extra` stays admin.
- [ ] **Step 2: Run** `bash scripts/test-hooks.sh` — expect FAIL.
- [ ] **Step 3: Implement `exports.setRole(e)`** in `access.js`: guards in the order of the test; transaction on a fresh read (as `setBlocked` does); `refreshTokenKey()` on entering `put_off`; log `put_off` on entering, `let_back_on` on leaving `put_off`, else `role_changed`; every row with `detail: '<from> → <to>'` using role labels `Crew`, `Trainspotter`, `Put off`. No-op (same role) returns 200 without a log row. Route `routerAdd('POST', '/api/crawl/users/{id}/role', …)`; delete the two old routes.
- [ ] **Step 4: Extend `ensureConductor(app, raw)`**: after ensuring the Conductor, when `$os.getenv('SIM') !== '1'`, find every other admin (`is_admin = true && id != {:id}`), clear `is_admin` on each by SQL (one column, as `signInGuard` writes `last_seen`) and log `role_changed`, detail `Conductor → Crew`, per demoted user.
- [ ] **Step 5: Refuse trainspotter proofs** in the existing media `onRecordCreateRequest` (live.pb.js): when `isCrew && drink_kind` and `crew.roleOf(e.auth) === 'trainspotter'`, `throw new BadRequestError('trainspotter')` before anything else.
- [ ] **Step 6: Run** `bash scripts/test-hooks.sh` — PASS.
- [ ] **Step 7: Commit** `feat(crew): role endpoint, one Conductor, no Tab for Trainspotters`.

### Task 3: Riders on the phone — roster, filter, reel gate

**Files:**
- Create: `web/src/lib/roles.ts`
- Modify: `web/src/lib/types.ts` (`UserRecord.role: Role | ''`, drop `blocked`), `web/src/lib/live/day.svelte.ts` (roster, `riderFeed`, `spikeEvents`, `closingReel`, `reelReady`), `web/src/lib/components/CrewChat.svelte` (milestones from `riderFeed`), `web/src/lib/components/TabHost.svelte` (`TabRow entries` from `riderFeed.drinks`)
- Test: `web/tests/unit/roles.test.ts` (create), `web/tests/unit/liveDay.test.ts`

**Interfaces:**
- Produces in `$lib/roles.ts`:
  - `type Role = 'crew' | 'trainspotter' | 'put_off'`
  - `roleOf(u: { role?: string | null } | null | undefined): Role`
  - `riderFilter(roster: { id: string; role?: string | null }[]): (userId: string) => boolean` — false only for ids in the roster whose role is not `crew`.
  - `ridersOnly<T extends { user: string }>(rows: T[], isRider: (id: string) => boolean): T[]`
- Produces on `liveDay`: `roster: UserRecord[]` (memory only), `rosterOk: number` (request number of the last accepted roster read), `riderFeed: { drinks; media; messages; reactions }` (derived; reactions unfiltered).

- [ ] **Step 1: Write failing unit tests.** `roles.test.ts`: `roleOf({})`, `roleOf({ role: '' })`, `roleOf(null)` → `'crew'`; `riderFilter([{id:'a',role:'trainspotter'},{id:'b',role:'put_off'},{id:'c',role:''}])` → `a` false, `b` false, `c` true, unknown `z` true; `ridersOnly` keeps order. `liveDay.test.ts` (follow its existing mocking of `pb.collection(...).getFullList`):
  - `spike events and the reel skip a trainspotter and a put-off person` — three drinkers, roster marks two; `spikeEvents` and `closingReel()` mention only the crew one; a trainspotter's photo is absent from reel photo slides but present in `feed.media`.
  - `reelReady waits for a roster read in the qualifying round` — users read rejects while the feed resolves: `feed` published, `reelReady` false; next `loadFeed` with users resolving → true.
  - `a failed roster read keeps the last roster` — second read's users call rejects; `roster` unchanged, `feedError` false.
- [ ] **Step 2: Run** `cd web && npx vitest run tests/unit/roles.test.ts tests/unit/liveDay.test.ts` — FAIL.
- [ ] **Step 3: Implement `roles.ts`** and the type change (fix every `npm run check` error from `blocked` removal).
- [ ] **Step 4: Roster in `loadFeed`.** Read `users` (`getFullList<UserRecord>({ fields: 'id,name,role,is_admin', cache: 'no-store' })`) alongside the four feed reads but with its own `.catch(() => null)`, so it never rejects the batch. After the existing staleness check: publish the feed as today; if the users result is not null, set `roster` and `rosterOk = request`. `reelReady` additionally requires `this.rosterOk >= this.closingAsk`. `riderFeed` is `$derived` from `feed` and `roster` via `riderFilter`/`ridersOnly`; `spikeEvents` and `closingReel()` read `riderFeed` (reactions still `feed.reactions`). The existing `users` subscription already reloads the feed.
- [ ] **Step 5: Point CrewChat's `milestones(...)` and TabHost's `<TabRow entries=…>` at `liveDay.riderFeed`.** `chatEntries(...)` keeps `liveDay.feed` (chat is unfiltered).
- [ ] **Step 6: Run** `cd web && npm test && npm run check` — PASS.
- [ ] **Step 7: Commit** `feat(live): only Crew count in Spikes, milestones, the reel and Tab counts`.

### Task 4: Role window, Crew Board sections, Manifest

**Files:**
- Create: `web/src/lib/components/RoleWindow.svelte`
- Modify: `web/src/routes/(app)/crew/+page.svelte`, `web/src/routes/(app)/crew/access/+page.svelte`, `web/src/lib/labels.ts`
- Test: `web/tests/e2e/crew.spec.ts`, `web/tests/e2e/manifest.spec.ts`, `web/tests/e2e/layoutSweep.spec.ts`, `web/tests/e2e/helpers.ts`

**Interfaces:**
- Consumes: `POST /api/crawl/users/{id}/role` (Task 2); `roleOf`, `riderFilter`, `ridersOnly`, `Role` (Task 3).
- Produces: `RoleWindow` props `{ person: { id: string; name: string; role: Role }; onclose: () => void; onsaved: (role: Role) => void }`. Test ids: `role-window`, `role-option-<role>`, `role-save`, `role-error`; on the board `crew-name-button` (Conductor only), sections `crew-trainspotters`, `crew-put-off`; on the Manifest `open-role-window` replaces `toggle-block`.
- Labels (in `labels`): `trainspotter: 'Trainspotter'`, `roleWindow: 'Role'`. In `copy`: `roleCrew: 'Crew'`, `roleTrainspotter: 'Trainspotter'`, `rolePutOff: 'Put off'`, `roleCrewHint`, `roleTrainspotterHint: 'Plans routes and follows along; no Tab, no Golden Spikes'`, `rolePutOffHint: "Can't sign in; hidden from the Crew Board. What they posted stays."`, `rolePutOffConfirm`, `roleSave`, `trainspottersHeading: 'Trainspotters'`, `putOffHeading: 'Put off'`, `changeRole`. Remove `putOff`, `letBackOn`, `personAboard`, `personPutOff` once unused.
- Produces (e2e helper): `setRole(id: string, role: Role): Promise<void>` in `tests/e2e/helpers.ts`.

- [ ] **Step 1: Write failing e2e tests.** `crew.spec.ts`:
  - `the Conductor makes someone a Trainspotter from the Crew Board` — conductor + rider; open `/crew`, click the rider's `crew-name-button`, pick `role-option-trainspotter`, `role-save`; rider row appears inside `crew-trainspotters` with no drink counts.
  - `a put-off person is gone for the crew and dimmed for the Conductor` — via the window with confirm accepted (`page.once('dialog', d => d.accept())`); a second crew session's `/crew` has no row with that name; the Conductor's `crew-put-off` lists it.
  - `crew see plain names and the Conductor has no button on themselves` — crew page has zero `crew-name-button`; Conductor's own row has none.
  - `a role save that fails shows inline` — Conductor opens the window for a rider, the rider is deleted by superuser, save → `role-error` visible.
  `manifest.spec.ts`: rewrite the toggle test: `open-role-window` → Trainspotter → `person-status` shows `Trainspotter`, and the access log lists a `role_changed` row without reload.
  `layoutSweep.spec.ts`: one line in the Conductor sweep: `{ name: 'role window', open: async (p) => { await p.goto('/crew'); await p.getByTestId('crew-name-button').first().click(); }, ready: (p) => p.getByTestId('role-window') }`.
- [ ] **Step 2: Run** `cd web && npx playwright test tests/e2e/crew.spec.ts tests/e2e/manifest.spec.ts` — FAIL.
- [ ] **Step 3: Build `RoleWindow.svelte`** in the app's existing sheet/dialog style (match `BulletinSheet.svelte` / `Lightbox.svelte`): three radio options with hints, current role preselected, Put off asks `confirm(copy.rolePutOffConfirm)`, Save posts via `pb.send`, server message shown in `role-error`, `onsaved(role)` then `onclose()`.
- [ ] **Step 4: Crew Board.** Riders = `crew` filtered by `riderFilter(crew)` and ranked as today, scored from `ridersOnly(drinks, …)`, and its own `spikes(...)` call fed `ridersOnly` media/messages/drinks. Trainspotters section: names only (Bulletin seen marker kept). Put-off section only when `$auth.user?.is_admin`, dimmed. Names are `crew-name-button` only for the Conductor and never for `is_admin` people. `onsaved` calls `load()` early.
- [ ] **Step 5: Manifest.** Status shows the role label (`Conductor` for `is_admin`); `open-role-window` (hidden for `is_admin`) opens `RoleWindow`; `onsaved` calls `load()`.
- [ ] **Step 6: Run** `cd web && npm test && npm run check && npm run test:e2e` — PASS.
- [ ] **Step 7: Commit** `feat(crew): role window on the Crew Board and the Manifest`.

### Task 5: Trainspotter Tab, Highball as reference, docs

**Files:**
- Modify: `web/src/lib/components/TabBar.svelte`, `web/src/lib/components/TabHost.svelte`, `web/src/lib/live/proof.ts` (`failureMessage`), `web/src/lib/components/ApprovalPanel.svelte`, `web/src/lib/labels.ts`, `README.md` (UI glossary)
- Test: `web/tests/unit/proof.test.ts`, `web/tests/e2e/tab.spec.ts`, `web/tests/e2e/planning.spec.ts` (whichever spec covers the Highball tally)

**Interfaces:**
- Consumes: `roleOf` (Task 3), `trainspotter` hook code (Task 2), `setRole` e2e helper (Task 4).
- Labels in `copy`: `trainspotterNoTab: "Trainspotters don't run a Tab"`; `approvalIntro` → `'The Conductor opens the vote and locks the route. Votes are a show of hands, not a gate.'`.

- [ ] **Step 1: Write failing tests.** `proof.test.ts`: `a trainspotter refusal is final with its own message` — `sendProof` with an error carrying hook code `trainspotter` and status 400 → `{ status: 'failed', message: copy.trainspotterNoTab, retryable: false }`. `tab.spec.ts`: `a trainspotter's Tab button is disabled` — `setRole(id, 'trainspotter')`, log in, `tab-drinks` `toBeDisabled()` and has accessible description `copy.trainspotterNoTab`; the Tab sheet never opens. Highball spec: the tally `dl` has exactly two `dt` (Go, No go); no row of non-voters.
- [ ] **Step 2: Run** those tests — FAIL.
- [ ] **Step 3: Implement.** `failureMessage` maps `trainspotter` → `copy.trainspotterNoTab` (4xx is already non-retryable). `TabBar` button `disabled={roleOf($auth.user) === 'trainspotter'}` with `aria-describedby` / `title` from `copy.trainspotterNoTab`; `TabHost` keeps `ui.tabOpen` false for a trainspotter. `ApprovalPanel`: drop `users`, its read and `pending`, and the third `dt/dd`; new `approvalIntro`.
- [ ] **Step 4: README glossary**: add rows `Trainspotter` (signed up, not riding: plans routes, Cheers, Highball, chat; no Tab, no Golden Spikes, not in Closing Time) and `Role window` (Conductor only, from a Crew Board or Manifest name: Crew / Trainspotter / Put off); rewrite `Put off / Let back on` (a role, set from the role window; Let back on = Crew; also hidden from others' Crew Board, Spikes and Closing Time); `Highball` note: reference only. `labels.test.ts` keeps README and labels in sync — run it.
- [ ] **Step 5: Run the full gate** `cd web && npm test && npm run check && npm run test:e2e` and `bash scripts/test-hooks.sh` — PASS.
- [ ] **Step 6: Commit** `feat(tab): Trainspotters see the Tab disabled; Highball is a show of hands`.

## After the last task

Per the user's global instructions: run `superpowers:requesting-code-review` and one read-only Codex review (`codex:codex-rescue`) **in parallel** on `main..feat/crew-roles`, fix valid findings in one pass. Deploying (`just up` from this worktree or after a fast-forward of `main`) is the user's call; the migration converts production's 3 users (1 admin, 0 put off, checked read-only 2026-11-19).
