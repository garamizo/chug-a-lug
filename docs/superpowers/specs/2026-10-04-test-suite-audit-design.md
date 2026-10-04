# Layout checks and a faster test gate — design

Status: draft for review. Branch `feat/test-audit`, stacked on `fix/login-password-layout` (e2c9888), which
fixes the login layout bug that prompted this work.

## 1. Why

The password field on `/login` rendered 30 px wide beside a full-width yellow "Show" button. Every test
passed, because no test looks at layout. The user spotted it at a glance. Two goals follow:

1. **Catch obvious layout breakage automatically**, without screenshots and without anyone (human or
   model) looking at images. Pixel-diff baselines and hosted visual services were considered and ruled
   out by the user; generic layout rules that run inside the existing Playwright suite were chosen.
2. **Make the gate faster.** The full gate (`npm test && npm run check && npm run test:e2e` plus
   `bash scripts/test-hooks.sh`) takes about 4.4 minutes, measured on 2026-10-04:

   | Suite | Tests | Wall time |
   |---|---|---|
   | Unit | 777 | 2.7 s |
   | `svelte-check` | — | 4.4 s |
   | Hooks (`test-hooks.sh`) | 177 (7 SIM-only, skipped in the normal pass) | 56 s |
   | e2e | 114 | 198 s, `workers: 1` |

Decisions taken with the user (2026-10-04):

- **No CI.** Everything stays in the local test commands.
- **Balance speed against ease of writing tests.** "If adding new tests starts requiring boilerplate
  code and constraints, we are better off with a slower test." Therefore e2e stays **serial on one
  stack**: no parallel lanes, no `@route` tags, no per-worker PocketBase, no per-test isolation rules.
  (The audit showed that about 70% of e2e runtime depends on the single current route, which locking
  a route archives for every other route on that date. Running those tests side by side would need
  either such rules or a per-worker stack harness.)
- **Hooks: speed-ups only.** No sharding across several PocketBases.

## 2. Layout checks

### 2.1 Shape

- `web/tests/e2e/layoutRules.ts` exports `layoutViolations(page): Promise<string[]>`. It runs one
  `page.evaluate` over the current document and returns a list of human-readable violations, for example
  `narrow-field: input#password 30×50 px (min 120) on /login`. `expectSaneLayout(page)` wraps it in
  `expect.soft(violations, ...).toEqual([])`, so one sweep reports every broken page.
- `web/tests/e2e/layoutSweep.spec.ts` visits a list of pages and states at the project's phone viewport
  (iPhone 13, 390×844) and calls `expectSaneLayout` on each, after the page's main content is visible.
  The tests are grouped by the setup they need, so each group pays for its sign-in and seed once:
  1. **Signed out:** `/login` (password step), `/login` (code step, via `use-code`), `/login/forgot`,
     `/reset-password#x` (form), `/reset-password` (dead link), `/join` (start).
  2. **Crew on the event day:** seed one locked route (`seedLockedCrawl`, clock at
     `2026-12-26T19:00Z`). Only the live-departure endpoints are stubbed (`/api/metra/next`,
     `/status`, `/alerts`); `/api/metra/stations` stays real (fixture GTFS), because the station picker
     reads its `.lines`. `layout.spec.ts`'s catch-all `/api/metra/**` stub would break the picker. Visit `/live`, `/live` with the Tab
     sheet open, `/live?stop=<id>` (stop sheet), `/route`, `/crew`, `/notifications`, `/account`,
     `/plan`, `/plan/<id>`, `/plan/<id>/stops/<stopId>`.
  3. **Conductor:** `/plan/<id>/edit` (locked-route staging), `/plan/<id>/add` (station picker),
     `/crew/access`, a new draft's `/plan/<draft>/edit` (via `create-draft`).
  4. **Practice day:** the same route with the clock on `2026-12-20`; `/live` (practice banner).
- Each state waits for a control that proves its content rendered (e.g. a station button on the
  picker, the Tab's counters), not just a heading.
- Adding a page later means adding one line to the relevant group's list. Nothing in app code changes
  to make a page checkable.

### 2.2 Rules

**Which elements are checked.**

- **Active layer.** If a modal is open — a native `dialog:modal` (StopSheet, VenueSheet and Lightbox
  use `showModal()`) or an element with `aria-modal="true"` (TabSheet) — only controls inside the
  topmost one are checked. Everything behind it is inert by design. The non-modal `BoardingPopup`
  (`role="dialog"` without `aria-modal`) is not a layer; it is a fixed overlay like the tab bar.
- **Hidden** elements are skipped: `display: none` on the element or an ancestor, `visibility:
  hidden`, `[hidden]`, `inert`, `aria-hidden="true"`, a closed `<dialog>`, `input[type=hidden]`, and
  visually-hidden text-for-screen-readers (a 1×1 box with `clip`/`clip-path`, the `.sr-only` pattern).
- **Scroll-reachable** elements are checked even when an ancestor's `overflow` clips them today
  (RouteStrip, FreightStrip, galleries): `covered` scrolls them into view first.
- A rendered control with a **zero-size box** is not skipped; `small-target` reports it.

| Rule | Fails when | Catches |
|---|---|---|
| `page-overflow` | `document.documentElement.scrollWidth > innerWidth + 1` | Something wider than the phone: sideways scrolling. Intentional scrollers (`RouteStrip`, `FreightStrip`, galleries, `Lightbox`) scroll inside their own `overflow-x: auto` box and do not widen the page. |
| `narrow-field` | A free-text field (`textarea`, or `input` of type `text`, `email`, `password`, `search`, `tel`, `url`, or no type) is narrower than 120 px | The 30 px password field. Compact controls (`time`, `date`, `number`, `select`) are left to `small-target`: the draft editor caps its `type=time` input at 110 px on purpose (`ItineraryView.svelte:237`). |
| `small-target` | A control (`button`, `a[href]`, form field, `[role=button]`, `summary`) is smaller than 24×24 px | Collapsed or squashed controls. 24 px is WCAG 2.5.8's minimum, not the app's 44–48 px aim, because the app has deliberate 30–36 px icon buttons and pills (§2.3). **Exempt:** text links in running text: an `a` whose computed `display` is `inline`, and `button.link`, the app's inline text-link button. |
| `covered` | After `scrollIntoView({ block: 'center', inline: 'nearest' })`, `document.elementFromPoint` at the control's centre is neither the control nor inside it | A control hidden under a fixed or sticky layer (tab bar, save bar, popup, banner), or two controls overlapping. |
| `text-spill` | A `button` whose children are all text has `scrollWidth > clientWidth + 2` and `text-overflow` is not `ellipsis` | A label that no longer fits its button. |

After `covered`, the sweep restores the scroll position of the page and of every nested scroller it
moved, and it reports each violation once per page.

### 2.3 What it will not catch, and exemptions

- It does not judge looks. The second half of the original bug (link buttons drawn as big yellow
  buttons) breaks no generic rule; only the squeezed input does. The spec accepts this: the rules
  target broken layout, not style.
- Deliberately small controls already in the app are above 24 px: `IconButton` at 32–36 px
  (`StopRow`, `AlertBubbles`, `ChatBox`, `TabSheet`, `plan/+page`), pills at 36 px, `.undo-last` at
  32 px, `RouteStrip` dots at 30 px.
- If a page legitimately breaks a rule, the sweep's list entry takes a `skip: ['rule']` with a
  one-line reason in the test file, never an attribute in app code.
- **First run:** violations the sweep finds on today's pages are triaged in this branch. Real bugs get
  a CSS fix plus the sweep as their test. False positives tighten the rule, or get a reasoned `skip`.
  If triage turns up more than a handful of real bugs, they are listed for the user rather than all
  fixed here.

### 2.4 Cost

About 22 page states and four setups. Estimated 10–15 s added to e2e.

## 3. e2e: serial, but leaner

Estimated 198 s → about 115–125 s before the layout sweep (≈ 130–140 s with it). Every change keeps the
behaviour the test proves; each deletion names the test that already proves the same thing through
the same browser path.

### 3.1 Helpers (biggest win, no test-writing rules added)

- **`login(page, name, password)` only signs in.** It sets the session cookie and returns. It no
  longer opens `/` and waits for the home screen; in about 85 of 114 tests the next step is a `goto`
  anyway, and the extra full load costs roughly 0.3–0.8 s on the Vite dev server. The contract a test
  author needs is one sentence: *sign in, then open the page you want.*
  - `CookieAuthStore` reads the cookie once, when the app boots (`src/lib/pb.ts:15`). So if the page
    already shows the app when `login` is called, `login` reloads it, and the new session takes effect
    either way. A page still on `about:blank` is left alone.
  - Every caller is migrated explicitly, not only the ones that land on `/`. Callers whose next step
    is not a `goto` get a `goto` plus a wait for that page's content. That covers the `planning.spec.ts`
    tests from L31 on and `cloneRoute`'s `makeDraft()`, several `layout.spec.ts` tests, `login.spec.ts:9`
    (it reloads), the approver pages in `boarding.spec.ts:80-99`, and `tests/sim/rehearsal.spec.ts:23-33`
    and `tests/sim/offline.spec.ts:4`.
  - The comment about the event-day race on `/` moves with the tests that still land there.
- **The superuser token is fetched once per worker** (`superuserToken()` memoised in
  `tests/e2e/helpers.ts`), instead of a password login on every helper call (2–4 per test).
- **`clearLockedCrawls()` deletes in parallel** (`Promise.all`) instead of one request at a time. Its
  behaviour (delete every itinerary) stays; it is renamed to `clearRoutes()` because it never only
  cleared locked ones.
- **Vite warm-up:** `server.warmup.clientFiles` in `vite.config.ts` lists `src/routes/**/+page.svelte`
  and `src/routes/**/+layout.svelte`, so the first test to open `/plan/<id>/edit` or `/live` stops
  paying the on-demand compile (planning's first test takes 7.7 s today). This also speeds up `npm run dev`.
- **Delete `tests/e2e/global-setup.ts`.** It deletes three users from a PocketBase that starts from a
  fresh temp dir every run. 'E2E Boss' is not used anywhere.

### 3.2 Fixed sleeps → waits on the actual event

| Where | Today | Instead |
|---|---|---|
| `liveUx.spec.ts:14` long press | `waitForTimeout(600)` ×4 | `page.clock.runFor(500)` between `mouse.down` and `mouse.up` (`HOLD_MS = 450`; both pages already install the clock) |
| `tab.spec.ts:81` | `waitForTimeout(1500)` | wait for the feed reload the app starts after the second save (`live/+page.svelte:87`): the `drink_entries` list response that begins after the second POST response. Then assert the count and `posts === 2` |
| `tab.spec.ts:138` | `waitForTimeout(700)` | `waitForResponse` on the DELETE, then assert one DELETE |
| `tab.spec.ts:176` | `waitForTimeout(1200)` | drop it; the following `toBeVisible` auto-waits |
| `planning.spec.ts:310,319` | 1500 ms route delay + 300 ms sleep | hold the stale response on a promise and release it after the fresh one renders. Await `route.fulfill()`, then wait until the page has processed it (`page.evaluate` over two animation frames), then assert the fresh comment is still shown |
| `boarding.spec.ts:33, 53-60` | waits for the real 5 s status poll | `page.clock.install()` before `goto`, then `page.clock.runFor(5000)` |

Rule for every replacement: wait for the response the app actually processes, then assert the end state.
Request arrival or response release alone is not a barrier. `boarding.spec.ts:67` (a deliberate negative wait) and `cloneRoute.spec.ts:217` (guards a late
navigation) stay.

### 3.3 Flaky and vacuous tests

- **`tab.spec.ts` "a 404 on Undo…"** fakes the 404 without deleting the drink. The app treats 404 as
  done, then its own feed reload reads the still-present row back, so the count returns to "1" when the
  reload lands before the assertion. Fix the test: let the real DELETE run, then answer 404
  (`const res = await route.fetch(); await route.fulfill({ status: 404, ... })`). The app is right: a
  real 404 means the row is already gone.
- **`bulletins.spec.ts:49` "Conductor can skip and still save"** cannot fail: with no clock installed
  the browser is on a practice day, and the layout never pins Bulletins on `/plan`. Delete it.
  Save-after-skip is proven by `liveEdit.spec.ts:21`, and "skip posts nothing" by unit
  `planCommit.test.ts:280`.
- **`crew.spec.ts:6`** asserts `crew-row.first()` contains `'0'`, a substring match on whoever ranks
  first. Deleted with the merge below.
- **`boarding.spec.ts:41`** leaves its request waiting for the rest of the run, which puts the boarding
  popup over every later crew page. It turns its request away at the end.
- **Fixed draft titles in `planning.spec.ts`** collide with title uniqueness when Playwright retries a
  test. They get the per-run suffix `cloneRoute.spec.ts:7` already uses.

### 3.4 Deletions and merges (114 → about 97 tests)

Merges only join tests that share the same setup and still read as one story; tests that would become
grab-bags stay separate.

| File | Change | Covered by / merged into |
|---|---|---|
| tab | delete "one tap logs a drink, Undo" (L8) | tab L180 (tap, toast Undo, counts), chat L3, crew L16 |
| tab | merge L30 (five counters, camera) into L193; L54 + L87 (save failures); L143 into L153 (undo-last) | — |
| liveUx | merge L29 + L154 into L167 (one upload: lightbox, back, label, double-tap); L89 + L106 into L47 (stop sheet: deep link, strip); L98 + L185 (Route tab → sheet → editor link); L160 + L193 (first beer → leaderboard) | — |
| liveUx → live | merge liveUx L40 (station walk link) into live L59 | — |
| live | merge L69 + L79 (alert bubbles); L92 and L101 into L59 | — |
| liveEdit | merge L70 into L21; L107 + L118 (preview/commit failures) | — |
| bulletins | delete L92 "post a Bulletin without changing plan" | the `pinBulletin` helper's own steps and assertions, used by L157/L173 |
| bulletins | merge L68 into L10; L157 + L173 (Got it, ok and failing) | — |
| offline | seed once for the six storage-failure cases (L117-162); drop "open throws" | it lands in the same `catch` as "getter throws" (`src/lib/offline.ts:43` vs `:60`) |
| crew | delete L6 | layout L34 (menu → Crew Board → own row) |
| layout | merge L6, L14, L29 (desktop width, pinned header, no date) | — |
| freight | merge L67 + L89 (chat photo before/after the crawl) | — |
| chat | merge L49 + L66 | — |
| practice | merge L106 into L38 | — |
| controls | merge L23 + L36 | — |

Kept on review, though the audit proposed deleting them:

- **`offline.spec.ts:164`** blocks all PocketBase traffic on Live and asserts the exact `copy.noSignal`
  text. `bulletins.spec.ts:173` aborts only the ack POST on `/plan` and checks for any alert.
- **`cloneRoute.spec.ts:78`** is the only successful locked-route rename through the *real*
  title-check endpoint. It presses Enter and asserts that Clone is unavailable in that editor; L96 and
  L149 mock the title check.

No hooks or unit test alone justifies deleting an e2e test: those check rules and logic, not browser
wiring.

## 4. Hooks: about 56 s → 30 s

- **Memoise `superuserToken()`** in `tests/hooks/setup.ts`. Today every helper call is a superuser
  password login (bcrypt, about 55 ms), about 300 per run; `seedRequests` in boarding alone does 78.
  Vitest isolates files, so this is one login per file. Estimated 10–15 s.
- **Sleeps:** `decisions.test.ts:169` (1.5 s) waits instead for a second, never-blocked realtime
  listener to receive the event, then gives the blocked one 100 ms. The "no mail was sent" waits at
  `access.test.ts:29,68,97` and `password.test.ts:87` drop to 200 ms. The 300 ms sleep at
  `boarding.test.ts:167` goes: `/resend` mails synchronously inside the request. About 3.5 s.
- **Polling** in `codeFor`, `resetLinkFor` and `waitFor` every 25 ms instead of 100 ms, all with a
  5 s deadline. `codeFor` and `resetLinkFor` count 50 attempts today, so a shorter interval alone would
  cut their allowance to 1.25 s. About 1 s.
- **Seed and truncate in parallel** (`Promise.all`) in `seedRequests` and `truncate`. About 1 s.
- **SIM pass runs concurrently** with the normal pass in `scripts/test-hooks.mjs`, on its own
  PocketBase at port **18091**. Its two files use no mail, no boarding and no truncation. Its
  `WEB_INTERNAL_URL` points at the closed port 9, as e2e's `OVERPASS_URL` does, so its recompute hook
  cannot reach `recompute.test.ts`'s listener on 18095. About 4–5 s.
- **Deletions and merges** (177 → 173 tests, no assertion lost):
  - delete `boarding.test.ts:280`, covered by `:54-65` (same 502, plus the expired row);
  - delete `password.test.ts:59`, covered by `access.test.ts:73-89` (same endpoint, plus the log row);
  - keep only the 10-unverified half of `boarding.test.ts:178`; its 20-waiting half is a subset of `:194`;
  - merge `decisions.test.ts:51` with `:79`, and `:71` into `:108`.
- **Stale scaffolding:** remove the `passwordAuth` toggle in `access.test.ts:77-88`; migration
  `1759000000_password_sign_in.js` now always enables it, so the PATCH is a no-op schema write.
- **Safety:** `tests/hooks/setup.ts:1`, `places.test.ts:12` and `planning.test.ts:300` fall back to
  `http://127.0.0.1:8090`, the live stack, when `PB_URL` is unset. They throw instead, so
  `npx vitest run tests/hooks` outside the harness cannot aim `truncate()` at production.

## 5. Unit

Already fast. Three redundant tests go:

- `metra-endpoints.test.ts:100`: asserts only inside `if (hit)`; `:122` covers the same path and always asserts.
- `liveDay.test.ts:106`: same assertions as `:85-96`.
- `serverPlan.test.ts:72`: `activeAnchor` is a one-line wrapper of `anchorOnEventDay`, covered by `anchor.test.ts:17`.

## 6. Documentation

- `CLAUDE.md` "One test run at a time": add the hooks ports **18090** (normal pass, already in use but
  unlisted), **18091** (SIM pass, new) and **18095** (recompute listener).
- `CLAUDE.md` "Conventions": a new page or page state gets a line in `layoutSweep.spec.ts`; `login()`
  only signs in, so open the page you need.
- `docs/OPERATIONS.md` and `README.md` test sections: no command changes; update anything that quotes
  test counts or describes `login()`.

## 7. Verification

- Before any deletion, the full gate is green on the branch base (the one known flake excepted). After
  each task, the full gate is green: `cd web && npm test && npm run check && npm run test:e2e`, plus
  `bash scripts/test-hooks.sh`, plus `npm run test:sim` and `npm run test:sim:offline` (they share
  `login()` and the browser config).
- The layout rules get their own proof: a fixture state that breaks each rule makes
  `layoutViolations` report it, and a clean page reports nothing.
  - For `narrow-field`, the test recreates the original cascade on `/login` with `page.addStyleTag`:
    `.password button` gets `width: 100%`, `flex: 0 1 auto` and `padding: 14px` back, as the global
    `button` rule gave it before `button.link` existed.
  - It first asserts that the password input really measures under 120 px, then that the violation is
    reported.
  - The modal and hidden-element eligibility rules get one case each: the Tab sheet open, and a stop
    sheet over Live. Neither reports background controls, and a control inside each layer is still checked.
- Timing is measured again with the same commands as §1 and reported against the table there.
- The `tab.spec.ts` 404 fix is checked by running that test 20 times (`--repeat-each 20`).

## 8. Not in scope

- Parallel e2e workers, lanes or per-worker stacks; hooks sharding (decided in §1).
- Screenshot baselines, hosted visual testing, CI.
- Desktop-width layout sweep: the app is phone-first and the suite's device is an iPhone 13. One
  desktop check already exists in `layout.spec.ts`.
- Rewriting tests that are slow but distinct (e.g. `planning.spec.ts:30`, boarding's three-phone
  test): they stay as they are apart from §3.1–3.2.
