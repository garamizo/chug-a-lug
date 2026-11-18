# New Version on the Next Screen Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Once a new build is waiting, the next in-app link tap hands control to the new service worker and loads the tapped screen fresh on the new code, never while a send is in flight.

**Architecture:** A pure decision function plus a small watcher module (`web/src/lib/update.ts`) that takes `ServiceWorkerContainer`/`ServiceWorkerRegistration`-like objects, so it unit-tests with fakes. An app-wide send registry (`web/src/lib/sends.ts`) counts in-flight sends; ChatBox, the one place every chat/comment text and photo send passes through, wraps them. `Landing` persists its state in `sessionStorage` across the full load. The root layout connects them in its existing `onMount` and `beforeNavigate`.

**Tech Stack:** SvelteKit 2 + Svelte 5, `@vite-pwa/sveltekit` (Workbox `generateSW`), vitest (node env), Playwright (production project in `web/tests/sim`).

**Spec:** `docs/superpowers/specs/2026-11-17-update-on-screen-change-design.md`

## Global Constraints

- Production only: everything runs behind `import.meta.env.PROD && 'serviceWorker' in navigator`, like today's registration. Dev and `npm run test:e2e` must behave exactly as today.
- Do not change `web/vite.config.ts`'s PWA options (`registerType`, `injectRegister: false`, no `skipWaiting`/`clientsClaim`). The worker waits until the page sends `{ type: 'SKIP_WAITING' }`.
- Only `type === 'link'`, same-origin, `willUnload === false` navigations switch. `goto`, `popstate`, `leave`, `form` and shallow routing stay client-side.
- No new user-visible strings (no banner).
- Never full-load while anything is sending (registry count > 0 or `ui.tabBusy`).
- Repo rules: tests first; each task ends with `cd web && npm test && npm run check && npm run test:e2e` plus `bash scripts/test-hooks.sh` green; stage explicit paths; e2e ports 15173/18093 only, so no other worktree may run tests at the same time.

## Review Focus

1. **A send starts during the handoff and is held for Retry** (the Tab photo fails). Expected: the load waits until it is retried or undone, then the tapped screen loads; nothing in memory is lost. The wait has no time limit, as the spec says: once the new worker is active, an in-app move could hit a deleted old bundle and SvelteKit would then full-load on its own, cutting the send. Pinned in Task 4 (`waits for a send started during the handoff, however long`) and Task 5's third cycle.
2. **Another tap, Back, or a redirect during the handoff.** Expected: further link taps are ignored; a navigation that does complete (Back, `goto`) wins, and the load reloads *that* screen in place (`location.replace`) instead of the earlier tap's, so history stays intact. Pinned in Task 4 (`ignores taps while switching`, `a navigation during the handoff wins`).
3. **The worker never reaches `activated`, or posting to it throws.** Expected: the page loads anyway after ~3 s (or at once on a throw) and the watcher is not left stuck in `switching`. Pinned in Task 4 (`loads after the activation timeout`, `a throwing worker still loads`).
4. **Offline at the tap.** Expected: the full load is answered by the new worker's precached shell. Pinned in Task 5's first cycle (offline before the tap).
5. **`sessionStorage` throws** (private mode). Expected: `Landing` behaves as today. Pinned in Task 3.

---

### Task 1: Production update harness (spike)

Settles the spec's open mechanism: two builds that differ only in a build mark, swapped under the running production server.

**Files:**
- Modify: `web/src/routes/+layout.svelte` (head): `{#if BUILD_MARK}<meta name="app-build" content={BUILD_MARK} />{/if}` with `const BUILD_MARK = import.meta.env.VITE_BUILD_MARK ?? ''`.
- Modify: `web/src/vite-env.d.ts` or `web/src/app.d.ts` (whichever declares `ImportMetaEnv`; add it if neither does): `readonly VITE_BUILD_MARK?: string`.
- Modify: `web/scripts/smoke-sim-offline.mjs`: first `npm run build` with `VITE_BUILD_MARK=next`, rename `build` → `build-next` (remove any stale `build-next` first), then the existing plain build and `test:sim`.
- Modify: `web/tests/browser-config.ts`: production `testMatch` becomes `'**/{offline,update}.spec.ts'`.
- Create: `web/tests/sim/update.spec.ts`
- Create: `web/tests/sim/swap.ts`: `swapBuild(): Promise<void>` exchanges `build` and `build-next` (three renames via a temp name) and restarts the web server: `process.kill(pid, 'SIGUSR2')` from `SIM_WEB_CONTROL`, then polls until `generation` is +1 and `/login` answers 200 (pattern: `web/tests/sim/restart.spec.ts:17-19`).
- Modify: `.gitignore` (or `web/.gitignore`, wherever `build` is ignored): add `build-next`.

**Interfaces:**
- Produces: `swapBuild()` and `servedMark(): string` (`'next'` after an odd number of swaps, else `''`) in `swap.ts`, with `restoreBuild()` that swaps back when the count is odd; `readMark(page): Promise<string>` (the meta's content or `''`) and `awaitWaiting(page): Promise<void>` (calls `registration.update()`, polls until `registration.waiting` is set) in `swap.ts`. Playwright gives each test a fresh context (no auth, history or registration) while the server keeps whatever build was swapped in, so tests compare against `servedMark()`, never a literal.

- [ ] **Step 1: Write the harness test** in `update.spec.ts`, with `test.afterAll(restoreBuild)` so a rerun starts from the plain build:

```ts
test('a deploy installs a waiting worker under a controlled page', async ({ page }) => {
  await login(page, 'Offline Rehearsal Crew', process.env.CREW_PASSWORD!);
  await page.goto('/route');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const before = servedMark();
  expect(await readMark(page)).toBe(before);
  await swapBuild();
  await awaitWaiting(page); // the deploy is found and waits; Task 5 adds what a tap then does
});
```

- [ ] **Step 2: Run** `cd web && npm run test:sim:offline`. Expected: both specs PASS (this test documents today's behaviour: the worker waits).
- [ ] **Step 3: Spike checks, recorded in the commit message.** (a) the two builds' `build/client/sw.js` differ; (b) `context.route('**/api/collections/chat_messages/records', …)` sees the page's POST while the worker controls it (try it inline once in a scratch test, then delete the scratch). If (a) fails, set the mark through Vite `define` instead. If (b) fails, Task 5's held-send browser case moves to the manual check and the commit message says so. If the harness itself cannot be made to work in about an hour, stop, delete `update.spec.ts`, and say so in the final report; the plan then relies on unit tests plus the manual check (spec, Testing).
- [ ] **Step 4: Full gate** (Global Constraints) green.
- [ ] **Step 5: Commit** `web/src/routes/+layout.svelte`, the env typing file, `web/scripts/smoke-sim-offline.mjs`, `web/tests/browser-config.ts`, `web/tests/sim/update.spec.ts`, `web/tests/sim/swap.ts`, the `.gitignore`: `test(sim): production harness with a second build to update to`.

### Task 2: Send registry, wrapped in ChatBox

**Files:**
- Create: `web/src/lib/sends.ts`
- Modify: `web/src/lib/components/ChatBox.svelte:38,43` (`onsend(body)` and `onfiles(files)`)
- Test: `web/tests/unit/sends.test.ts`

**Interfaces:**
- Produces: `track<T>(p: Promise<T>): Promise<T>` (returns the same settlement), `sending(): boolean`, and for tests `createSends()` returning `{ track, sending }` (the module exports a default instance's bound functions).

ChatBox is the single choke point: CrewChat's text send and Live's `upload()` (passed as CrewChat's `onfiles`, `routes/(app)/live/+page.svelte:141`), Comments' `send` and `files` batch all run through `onsend`/`onfiles`. Wrapping the whole `onfiles` promise covers Live's upload from its first `clientClock.ready()`. The Tab is covered separately by `ui.tabBusy`. (Plan call: the spec names three wrap sites; one wrap in ChatBox covers the same promises, and future ChatBox users get it for free.)

- [ ] **Step 1: Failing tests** in `sends.test.ts`, each on `createSends()`:
  - `counts a send until it settles`: deferred promise; `sending()` true after `track`, false after resolve (`await` the tracked promise).
  - `a rejected send still uncounts`: tracked rejection; `await expect(t).rejects.toThrow()`; `sending()` false; the rejection reaches the caller.
  - `two sends count separately`: resolve one, still `true`; resolve the other, `false`.
- [ ] **Step 2: Run** `cd web && npx vitest run tests/unit/sends.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `sends.ts` (a counter decremented in `finally`), then in ChatBox `await track(onsend(body))` and `await track(onfiles(files))`.
- [ ] **Step 4: Run** the unit file: PASS. Full gate green (existing ChatBox/Live/Comments e2e must stay green).
- [ ] **Step 5: Commit** `web/src/lib/sends.ts web/src/lib/components/ChatBox.svelte web/tests/unit/sends.test.ts`: `feat(update): count chat and comment sends app-wide`.

### Task 3: Landing survives a full load

**Files:**
- Modify: `web/src/lib/landing.ts`
- Test: `web/tests/unit/landing.test.ts`

**Interfaces:**
- Produces on `Landing`: `restore(storage: Pick<Storage, 'getItem'> | null, navigationType: string | undefined): void` and `persist(storage: Pick<Storage, 'setItem'> | null): void`; exported `LANDING_KEY = 'chugalug:landing-moved'`. Module init calls `landing.restore(safeSession(), navType())` when `typeof window !== 'undefined'`, where the exported `safeSession(): Storage | null` returns `sessionStorage`, or `null` if access throws, and `navType()` reads `(performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type`. Restoring at module init matters: `(app)/+page.svelte:21` reads `landing.isEntry` while initialising, before any layout `onMount`.

- [ ] **Step 1: Failing tests** (a `Map`-backed fake storage):
  - `a full load after moving is not an entry`: `a.noteNavigation('/route'); a.persist(s)`; `b = new Landing(); b.restore(s, 'navigate')` → `b.isEntry === false`.
  - `leaving login still persists an entry`: `a.noteNavigation('/login'); a.persist(s)`; restored with `'navigate'` → `isEntry === true`.
  - `the person's own reload is an entry again`: stored moved, `restore(s, 'reload')` → `true`.
  - `Back to a rebuilt page keeps the stored state`: stored moved, `restore(s, 'back_forward')` → `false`; and the key is still in `s` afterwards.
  - `empty storage is an entry`: `restore(new Map-store, 'navigate')` → `true`.
  - `a throwing storage changes nothing`: `getItem`/`setItem` throw; `persist` and `restore` do not throw; `isEntry` as without storage.
  - `null storage changes nothing`.
- [ ] **Step 2: Run** `npx vitest run tests/unit/landing.test.ts`. Expected: FAIL (`restore` not a function).
- [ ] **Step 3: Implement**; stored value `'1'` for moved, `'0'` otherwise; every storage call in try/catch.
- [ ] **Step 4: Run** the unit file: PASS. Full gate green.
- [ ] **Step 5: Commit** `web/src/lib/landing.ts web/tests/unit/landing.test.ts`: `feat(update): Landing keeps its state across a full load`.

### Task 4: Update watcher and decision

**Files:**
- Create: `web/src/lib/update.ts`
- Test: `web/tests/unit/update.test.ts`

**Interfaces:**
- Produces:

```ts
export type Pending = 'none' | 'waiting' | 'active';
export function shouldSwitch(o: { pending: Pending; switching: boolean; type: string; sameOrigin: boolean; willUnload: boolean; busy: boolean }): boolean;
// The minimal shapes the watcher touches; real objects satisfy them.
export interface WorkerLike extends EventTarget { state: string; postMessage(m: unknown): void }
export interface RegistrationLike extends EventTarget { waiting: WorkerLike | null; installing: WorkerLike | null; active: WorkerLike | null; update(): Promise<unknown> }
export interface ContainerLike extends EventTarget {}
export interface DocLike extends EventTarget { visibilityState: string }
export interface SwitchOpts { isBusy: () => boolean; load: (href: string, replace: boolean) => void;
  activationMs?: number /* 3000 */; pollMs?: number /* 100 */ }
export interface UpdateWatcher { readonly pending: Pending; readonly switching: boolean;
  switchTo(href: string, o: SwitchOpts): Promise<void>; // never rejects
  retarget(href: string): void; // a later tap while switching: load this instead (again, if a load was issued)
  dispose(): void }
export function watchUpdates(container: ContainerLike, registration: RegistrationLike, doc: DocLike): UpdateWatcher;
```

Behaviour the tests pin (spec, Design 1–3):
- `pending` is `'waiting'` whenever `registration.waiting` is set, re-read at start, on `updatefound`, and on every `statechange` of an installing worker (including one already in `registration.installing` at start). An unasked `controllerchange` sets `'active'`. A `controllerchange` after this page posted `SKIP_WAITING` is not unasked.
- `doc` `visibilitychange` to `'visible'` calls `registration.update()`; a rejection is swallowed.
- `switchTo` when `'waiting'`: `switching = true`; post `{ type: 'SKIP_WAITING' }` to `registration.waiting`; wait for its `state === 'activated'` or `activationMs`; then poll `isBusy` every `pollMs` with **no time limit** (spec, Design 3: a send that started during the handoff must land; it always settles, and a held Tab Retry ends when retried or undone); then `load(target, replace)`. `target`/`replace` start as `(href, false)`; `retarget(h)` while switching sets them to `(h, false)`, and if a load was already issued it waits for idle again and calls `load(h, false)` (an aborted load cannot leave the page stuck); outside a switch it does nothing. When `'active'`: no message, same idle wait, same load. Any throw (`postMessage`, a missing `waiting`) skips straight to the idle wait and load. `switching` stays true from the tap until the page unloads (or `load` throws), so a second `switchTo` is ignored and later taps go through `retarget`.
- `dispose()` removes every listener.

- [ ] **Step 1: Failing tests.** Fakes: `class FakeWorker extends EventTarget { state = 'installed'; postMessage = vi.fn(); activate() { this.state = 'activated'; this.dispatchEvent(new Event('statechange')); } }`, `FakeRegistration` with the four fields and `update = vi.fn(async () => {})`, plain `EventTarget`s for container and doc. `vi.useFakeTimers()` for the timeouts.
  - `shouldSwitch`: true only for `{ pending: 'waiting' | 'active', switching: false, type: 'link', sameOrigin: true, willUnload: false, busy: false }`; false for each of `goto`, `popstate`, `leave`, `form`, cross-origin, `willUnload`, busy, `'none'`, switching.
  - `waiting at start counts`; `updatefound then installed with an active worker counts`; `a first install never counts` (no `active`, worker goes `installing` → `activated`, `waiting` stays null); `an installing worker present at start is followed`.
  - `an unasked controllerchange makes it active`; `the page's own handoff is not unasked` (`switchTo`, then `controllerchange` → `pending` not `'active'` because of it).
  - `checks on return to the front` (`doc.visibilityState = 'visible'`, dispatch → `update` called once); `a failed check is ignored` (`update` rejects; no unhandled rejection).
  - `hands over and loads`: `switchTo('/crew', …)`; `postMessage` called with `{ type: 'SKIP_WAITING' }`; `activate()`; `load` called with `('/crew', false)`.
  - `loads after the activation timeout`: never activate; advance 3000 ms; `load` called.
  - `waits for a send started during the handoff`: `isBusy` true until 500 ms after activation; `load` not called before, called after.
  - `waits for a send started during the handoff, however long`: `isBusy` true for 60 s after activation; `load` not called at 59 s, called with `('/crew', false)` after.
  - `a later tap retargets the load`: `switchTo('/crew')`, then `retarget('/route')` before activation; `load` called once, with `('/route', false)`.
  - `a tap after the load was issued loads again`: after the first `load`, `retarget` while busy → no load until idle, then `load` again with the newest href.
  - `retarget outside a switch does nothing`.
  - `a throwing worker still loads`: `postMessage` throws; `switchTo` resolves; `load('/crew', false)` called; `switching` true until then.
  - `active loads without messaging`: after an unasked `controllerchange`, `switchTo` → no `postMessage`, `load` called.
  - `ignores taps while switching`: `switching` is true between the call and the load (the layout uses it with `shouldSwitch`).
  - `dispose stops listening`: after `dispose()`, `updatefound`/`visibilitychange` change nothing.
- [ ] **Step 2: Run** `npx vitest run tests/unit/update.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `update.ts` to the interface above.
- [ ] **Step 4: Run** the unit file: PASS. Full gate green.
- [ ] **Step 5: Commit** `web/src/lib/update.ts web/tests/unit/update.test.ts`: `feat(update): watch for a waiting version and hand over at a tap`.

### Task 5: Wire it into the root layout

**Files:**
- Modify: `web/src/routes/+layout.svelte:46-54`
- Modify: `web/tests/sim/update.spec.ts`
- Modify: `README.md` / `docs/FEATURES.md` only where they describe updating the app (`grep -n -i "update\|reopen\|service worker" README.md docs/*.md`); say a new version arrives at the next tap. No change if neither describes it.

**Interfaces:**
- Consumes: `watchUpdates`, `shouldSwitch` (Task 4); `sending` (Task 2); `landing.persist` (Task 3); `ui.tabBusy`.

Layout changes:
- In `onMount`: `register('/sw.js').then((r) => { watcher = watchUpdates(navigator.serviceWorker, r, document); })`; return a cleanup that calls `watcher?.dispose()`.
- A second `beforeNavigate`, registered after the existing Landing one: if `!watcher` return; if `watcher.switching` and not `willUnload` → `cancel()` every type, and for a same-origin `link` also `watcher.retarget(to.url.href)`; else if `type !== 'link'` return; else if `shouldSwitch({ pending: watcher.pending, switching: false, type, sameOrigin: to?.url.origin === location.origin, willUnload, busy: sending() || ui.tabBusy })` → `cancel()` and `void watcher.switchTo(to.url.href, { isBusy: () => sending() || ui.tabBusy, load: (href, replace) => { landing.persist(safeSession()); if (replace) location.replace(href); else location.assign(href); } })`.
- No `afterNavigate`: nothing completes in-app while switching. A `pageshow` with `persisted` while switching (Back restored the document the load left) loads it fresh.

- [ ] **Step 1: Failing browser test** in `update.spec.ts`: **one** test, `three deploys, each taken up at a link tap`, `test.setTimeout(180_000)`, because the page, its registration and history must carry across deploys (Playwright gives every test a fresh context). Each cycle: `swapBuild()`, `awaitWaiting(page)`, then the tap. Before each tap set `window.__beforeTap = 1`; a full load clears it, an in-app move keeps it. "New mark" means `servedMark()` after that cycle's swap.
  - *Cycle 1, offline at the tap, landing:* from `/route` (the fixture is on the event day), `context.setOffline(true)`, click `a.brand` → URL `/`, `__beforeTap` undefined, `readMark` is the new mark, registration `waiting` null and `controller` set; after 2 s still `/` (no event-day redirect to `/live`). `goBack()` → `/route`; `goForward()` → `/`, not `/live`. `setOffline(false)`.
  - *Cycle 2, a send before the tap:* on `/live`, hold the `chat_messages` POST with `context.route` (the handler signals "held" through a promise the test awaits, then waits for a release promise). Fill `chat-input` with `update-held-<n>`, click `chat-send`, await "held". Click `tab-route` → URL `/route`, `__beforeTap` still 1 (busy: in-app move, worker still waiting). Release; await the POST's response and the `chat_messages` GET that `liveDay.loadFeed()` sends after it (`CrewChat.svelte:52-55`). Set `__beforeTap = 1`; click `tab-crew` → URL `/crew`, `__beforeTap` undefined, new mark. `page.goto('/live')` → the message is visible.
  - *Cycle 3, a send during a slow handoff:* on `/live`, delay the handoff by patching `ServiceWorker.prototype.postMessage` in the page to forward after 2 s. Hold the `chat_messages` POST as above. Click `tab-crew` (not visited since this document loaded) → URL still `/live`; within the 2 s send `update-during-<n>` and await "held". Wait 4 s → still `/live`, `__beforeTap` 1 (the load waits for the send). Release → URL `/crew`, `__beforeTap` undefined, new mark; `page.goto('/live')` shows the message.
  `test.afterAll(restoreBuild)`. If Task 1's spike found `context.route` blind under the worker, keep cycle 1 only and list cycles 2–3 under the manual check.
- [ ] **Step 2: Run** `npm run test:sim:offline`. Expected: FAIL in cycle 1 (the logo tap stays client-side: `__beforeTap` is still 1).
- [ ] **Step 3: Implement** the layout changes.
- [ ] **Step 4: Run** `npm run test:sim:offline`: PASS. Full gate green.
- [ ] **Step 5: Commit** `web/src/routes/+layout.svelte web/tests/sim/update.spec.ts` and any doc touched: `feat(update): a new version takes over at the next link tap`.
- [ ] **Step 6: Manual check after deploy** (for the person, after merge): open the installed app, deploy a change, bring the app back to the front, tap a tab: the new build is on screen; press Back, then tap a tab again. This deploy is the last that needs swipe-away-and-reopen: phones on earlier builds swipe the app away and reopen it once. The operator note is in `docs/OPERATIONS.md` ("Deploy a change").
