# Layout Checks and a Faster Test Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a generic, screenshot-free layout sweep to the e2e suite and cut the full test gate from about 4.4 to about 3 minutes, without adding rules for whoever writes the next test.

**Architecture:** A browser-side checker (`layoutRules.ts`) evaluates five geometric rules on the current page; a sweep spec visits every page state at phone width and calls it. The e2e suite stays serial on one stack and gets faster through cheaper helpers (cookie-only `login`, cached superuser token, Vite warm-up), event-based waits instead of sleeps, and conservative merges. The hooks suite gets a cached superuser token, shorter waits and a concurrent SIM pass.

**Tech Stack:** Playwright 1.63 (Chromium, iPhone 13 device), Vitest, SvelteKit 5 + Vite dev server, PocketBase test servers from `scripts/pb-test-server.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-04-test-suite-audit-design.md`. Read it before starting; line references below (`L123`) are to the test files as they are on the branch base `e5c73a0`.

## Global Constraints

- Work only in the worktree `/home/garamizo/chug-a-lug/.worktrees/test-audit` on `feat/test-audit`.
- One test run at a time across all worktrees: e2e binds 15173 and 18093, hooks bind 18090 (and 18091 after Task 6), fakes bind 12525–12528. Never point anything at 8090 or 3000 (the live stack).
- Stage explicit paths only (`git add <paths>`); read `git status --short` before every commit; never `--no-verify`.
- User-visible strings live only in `web/src/lib/labels.ts` (no new strings are expected in this plan).
- e2e stays `workers: 1`. Do not add tags, lanes, projects or per-test isolation rules.
- No CI, no screenshot baselines.
- Every task ends with the full gate green: `cd web && npm test && npm run check && npm run test:e2e`, plus `bash scripts/test-hooks.sh`, plus `cd web && npm run test:sim && npm run test:sim:offline`. Run them sequentially. A single failure of the known flake `tab.spec.ts` "a 404 on Undo…" is acceptable before Task 4 only.
- Deletions keep every behaviour: each deleted test's behaviour is proven by the named covering test. If you find the covering test does not prove it, keep the test and note it in the commit message.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01Wzy8ZLug6DuzuPmBMF3Pzv
  ```

## Review Focus

1. **A page already showing the app when `login()` is called** (a second `login` in one test, or `login` after `goto('/login')`): the new session must take effect, since `CookieAuthStore` reads the cookie only at boot. Pinned by the "login on an open page" test in Task 1.
2. **A modal sheet open during the sweep** (Tab sheet, stop sheet, Lightbox stacked on a stop sheet): only the topmost layer is checked, and a broken control inside that layer still fails. Pinned by the layer cases in Task 2.
3. **Controls inside horizontal scrollers** (RouteStrip, galleries) that are off-screen until scrolled: still checked, and the scroller's position is restored afterwards. Pinned by the scroller case in Task 2.
4. **Hooks mail polling under a faster interval**: the deadline stays 5 s, so slow mail still arrives in time. Pinned by keeping the existing mail-dependent hooks tests green after Task 6 (no new test: the deadline is a constant, checked in review).
5. **Hooks run with `PB_URL` unset**: the helpers throw instead of reaching 8090. Pinned by the `PB_URL` guard test in Task 6.

---

### Task 1: e2e helpers: cookie-only `login`, cached superuser token, `clearRoutes`, warm-up

**Files:**
- Modify: `web/tests/e2e/helpers.ts` (`login`, `superuserToken`, `clearLockedCrawls`)
- Modify: every caller of `login` / `clearLockedCrawls` in `web/tests/e2e/*.spec.ts` and `web/tests/sim/*.spec.ts`
- Modify: `web/tests/browser-config.ts` (remove `globalSetup` for the ordinary suite)
- Delete: `web/tests/e2e/global-setup.ts`
- Modify: `web/vite.config.ts` (add `server.warmup`)
- Test: `web/tests/e2e/login.spec.ts`

**Interfaces:**
- Produces: `login(page: Page, name: string, password: string): Promise<void>`: sets the session cookie; if `page.url()` is not `about:blank`, reloads the page; never navigates otherwise.
- Produces: `superuserToken(): Promise<string>`: memoised per worker process.
- Produces: `clearRoutes(): Promise<void>`: deletes every itinerary in parallel (renamed from `clearLockedCrawls`; the old name is removed).

- [ ] **Step 1: Baseline the sim suites** (not measured during brainstorming)

Run: `cd web && npm run test:sim && npm run test:sim:offline`
Expected: both pass. If not, stop and report: the base is not green.

- [ ] **Step 2: Write the failing test for the new `login` contract**

Append to `web/tests/e2e/login.spec.ts`:

```ts
test('login only signs in: the next page opened is already signed in, and an open page picks up the new session', async ({ page }) => {
  await login(page, 'E2E Cookie Only', 'crew-test-password');
  expect(page.url()).toBe('about:blank');
  await page.goto('/account');
  await expect(page.getByTestId('account-name')).toHaveValue('E2E Cookie Only');

  // A second login on a page that already runs the app: the app re-reads the cookie.
  await login(page, 'E2E Cookie Second', 'crew-test-password');
  await page.goto('/account');
  await expect(page.getByTestId('account-name')).toHaveValue('E2E Cookie Second');
});
```

Check first that `account-name` is an input (`grep -n account-name web/src/routes/\(app\)/account/+page.svelte`); if it is text, use `toHaveText`.

- [ ] **Step 3: Run it to verify it fails**

Run: `cd web && npx playwright test tests/e2e/login.spec.ts -g "login only signs in"`
Expected: FAIL at `expect(page.url()).toBe('about:blank')` (today `login` opens `/`).

- [ ] **Step 4: Implement the helpers**

In `web/tests/e2e/helpers.ts`, replace `login`, `superuserToken` and `clearLockedCrawls` with:

```ts
/**
 * Signs `name` in by cookie and opens nothing: open the page you want next. The app reads the cookie
 * once, at boot (`CookieAuthStore`), so a page that already runs the app is reloaded to pick it up.
 */
export async function login(page: Page, name: string, password: string) {
  const { token, record } = await sessionFor(name, password === ADMIN);
  await page.context().addCookies([{ name: COOKIE, value: encodeURIComponent(JSON.stringify({ token, record })), url: BASE }]);
  if (page.url() !== 'about:blank') await page.reload();
}

let superuser: Promise<string> | undefined;
/** One superuser login per worker: every helper needs it, and each login is a bcrypt check. */
export function superuserToken(): Promise<string> {
  superuser ??= (async () => {
    const res = await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identity: SU_EMAIL, password: SU_PASSWORD })
    });
    if (!res.ok) throw new Error(`Superuser login failed: ${res.status}`);
    return (await res.json()).token as string;
  })();
  superuser.catch(() => { superuser = undefined; });
  return superuser;
}

/** Removes every itinerary, drafts included, so one test's route cannot become another's. */
export async function clearRoutes(): Promise<void> {
  const token = await superuserToken();
  const res = await fetch(`${PB}/api/collections/itineraries/records?perPage=200&fields=id`, { headers: { Authorization: token } });
  await Promise.all(((await res.json()).items as { id: string }[]).map((row) =>
    fetch(`${PB}/api/collections/itineraries/records/${row.id}`, { method: 'DELETE', headers: { Authorization: token } })));
}
```

Remove the `exactly()` helper if nothing else uses it (`grep -n "exactly(" web/tests/e2e/helpers.ts`). Keep the event-day race comment from the old `login` body: move it into Step 5's `openHome` helper.

- [ ] **Step 5: Migrate every caller**

1. Rename `clearLockedCrawls` → `clearRoutes` everywhere:
   `grep -rln clearLockedCrawls web/tests | xargs sed -i 's/clearLockedCrawls/clearRoutes/g'`
2. List every `login(` call and its next line:
   `grep -n -A2 "await login(" web/tests/e2e/*.spec.ts web/tests/sim/*.spec.ts`
3. For each call, apply the first rule that fits:
   - The next page step is `page.goto(...)` (possibly after seeding or `clock.install`): leave it.
   - The test wanted the home screen (its next step clicks `nav-plan`, reads `name`, checks the menu, or calls `makeDraft`): insert `await openHome(page, name)` right after the `login`.
   - It calls `page.reload()` next (`login.spec.ts:9`, `boarding.spec.ts` `b.reload()`): replace the reload with `await openHome(page, name)`.
   - Secondary pages logged in and then only watched (`boarding.spec.ts` approver `m`, the `other` pages in planning/cloneRoute/liveEdit/chat): add `await <page>.goto('/')` or the page they are meant to watch, before their first assertion.
   - `tests/sim/rehearsal.spec.ts:23`: the page is already on `/login`, so `login` reloads it and the login page sends the signed-in user on; keep the following `expect(... nav-live or tab-bar)` as is. Lines 32–33 are followed by `goto('/live')`: leave them.
   - `tests/sim/offline.spec.ts:4`: followed by `goto('/route')`: leave it.
4. Add `openHome` to `web/tests/e2e/helpers.ts`:

```ts
/**
 * Opens `/` as a signed-in user and waits for it to settle. On the event day the tab bar can render on
 * `/` for the instant before the home page's own effect redirects to `/live`, so a check-then-assert
 * loses that race: accept whichever lands durably, the exact name on the home screen or the tab bar.
 */
export async function openHome(page: Page, name: string) {
  await page.goto('/');
  const nameShown = page.getByTestId('name').filter({ hasText: exactly(name) });
  const tabBarShown = page.getByTestId('tab-bar');
  await expect(nameShown.or(tabBarShown).first()).toBeVisible();
}
```

(Keep `exactly()`; `openHome` uses it.)

- [ ] **Step 6: Delete the no-op global setup and add the Vite warm-up**

- `git rm web/tests/e2e/global-setup.ts`.
- In `web/tests/browser-config.ts`, change `globalSetup: sim ? './tests/sim/global-setup.ts' : './tests/e2e/global-setup.ts',` to `globalSetup: sim ? './tests/sim/global-setup.ts' : undefined,`.
- In `web/vite.config.ts`, inside `defineConfig({ ... })`, add:

```ts
  server: {
    // Compile route modules at dev-server start, not on the first visit: the first e2e test to open
    // the editor or Live otherwise pays several seconds of on-demand compile.
    warmup: { clientFiles: ['./src/routes/**/+page.svelte', './src/routes/**/+layout.svelte'] }
  },
```

If `defineConfig` already has a `server` key, merge into it.

- [ ] **Step 7: Run the new test, then the whole gate**

Run: `cd web && npx playwright test tests/e2e/login.spec.ts`
Expected: PASS (2 tests).
Then the full gate from Global Constraints. Expected: all green (the known flake excepted). Note the e2e wall time in the commit message.

- [ ] **Step 8: Commit**

```bash
git add web/tests/e2e web/tests/sim web/tests/browser-config.ts web/vite.config.ts
git status --short
git commit -m "test(e2e): login only signs in; cached superuser token; clearRoutes; warm Vite routes"
```

---

### Task 2: The layout checker and its proof

**Files:**
- Create: `web/tests/e2e/layoutRules.ts`
- Create: `web/tests/e2e/layoutRules.spec.ts`

**Interfaces:**
- Produces: `type LayoutRule = 'page-overflow' | 'narrow-field' | 'small-target' | 'covered' | 'text-spill'`
- Produces: `layoutViolations(page: Page, skip?: LayoutRule[]): Promise<string[]>`: each string is `"<rule>: <description> on <path>"`.
- Produces: `expectSaneLayout(page: Page, skip?: LayoutRule[]): Promise<void>`: `expect.soft(violations, 'layout on <path>').toEqual([])`.

- [ ] **Step 1: Write the failing proof tests**

Create `web/tests/e2e/layoutRules.spec.ts`. Synthetic pages via `page.setContent` prove each rule in isolation; one case reproduces the original bug on the real `/login`.

```ts
import { expect, test, type Page } from '@playwright/test';
import { layoutViolations } from './layoutRules';

const page390 = async (page: Page, body: string) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setContent(`<!doctype html><html><head><style>body{margin:0;font:16px sans-serif}</style></head><body>${body}</body></html>`);
};
const rules = (v: string[]) => v.map((s) => s.split(':')[0]);

test('a clean page reports nothing', async ({ page }) => {
  await page390(page, `<main style="padding:16px"><label>Email<input type="email" style="width:100%;height:44px"></label>
    <p>Read <a href="#x">the rules</a> first.</p><button style="width:100%;height:48px">Go</button></main>`);
  expect(await layoutViolations(page)).toEqual([]);
});

test('page-overflow: something wider than the phone', async ({ page }) => {
  await page390(page, `<div style="width:600px;height:20px"></div>`);
  expect(rules(await layoutViolations(page))).toContain('page-overflow');
});

test('page-overflow ignores a scroller that scrolls inside its own box', async ({ page }) => {
  await page390(page, `<div style="overflow-x:auto;width:100%"><div style="width:900px;display:flex;gap:8px">
    ${Array.from({ length: 12 }, (_, i) => `<button style="width:60px;height:40px">S${i}</button>`).join('')}</div></div>`);
  const before = await page.evaluate(() => document.querySelector('div')!.scrollLeft);
  expect(await layoutViolations(page)).toEqual([]);
  // The off-screen buttons were checked (covered scrolls them in) and the scroller is put back.
  expect(await page.evaluate(() => document.querySelector('div')!.scrollLeft)).toBe(before);
});

test('narrow-field: a free-text field under 120 px; a compact time field is fine', async ({ page }) => {
  await page390(page, `<div style="display:flex"><input id="pw" type="password" style="width:30px;height:44px">
    <button style="flex:1;height:44px">Show</button></div><input type="time" style="width:110px;height:44px">`);
  const v = await layoutViolations(page);
  expect(v.filter((s) => s.startsWith('narrow-field'))).toHaveLength(1);
  expect(v.find((s) => s.startsWith('narrow-field'))).toContain('input#pw');
});

test('small-target: a squashed control, but not a text link in a sentence', async ({ page }) => {
  await page390(page, `<button style="width:20px;height:20px;padding:0">x</button>
    <p>Then <a href="#y">tap here</a> or <button class="link" style="all:unset;text-decoration:underline">here</button>.</p>
    <button style="width:0;height:0;padding:0;border:0;overflow:hidden">gone</button>`);
  const v = (await layoutViolations(page)).filter((s) => s.startsWith('small-target'));
  expect(v).toHaveLength(2);           // the 20 px one and the zero-size one
  expect(v.join()).not.toContain('tap here');
});

test('covered: a control under a fixed bar is reported', async ({ page }) => {
  await page390(page, `<div style="height:2000px"></div><button id="under" style="width:100%;height:48px">Save</button>
    <div style="position:fixed;left:0;right:0;top:0;bottom:0;background:#000"></div>`);
  expect((await layoutViolations(page)).join()).toContain('covered: button#under');
});

test('text-spill: a label wider than its button', async ({ page }) => {
  await page390(page, `<button style="width:60px;height:48px;white-space:nowrap;overflow:hidden">A very long label</button>
    <button style="width:60px;height:48px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Also long but ellipsed</button>`);
  const v = (await layoutViolations(page)).filter((s) => s.startsWith('text-spill'));
  expect(v).toHaveLength(1);
  expect(v[0]).toContain('A very long');
});

test('only the topmost modal layer is checked, and a broken control inside it still fails', async ({ page }) => {
  await page390(page, `<button style="width:100%;height:48px">Behind</button>
    <dialog id="d" style="width:300px"><button id="tiny" style="width:10px;height:10px;padding:0">x</button>
    <button style="width:100%;height:48px">Close</button></dialog>
    <div role="dialog" aria-modal="true" hidden><button>never</button></div>`);
  await page.evaluate(() => (document.getElementById('d') as HTMLDialogElement).showModal());
  const v = await layoutViolations(page);
  expect(v.join()).not.toContain('Behind');
  expect(v.join()).toContain('small-target: button#tiny');
});

test('an aria-modal sheet is a layer too; controls behind its scrim are not covered', async ({ page }) => {
  await page390(page, `<button style="width:100%;height:48px">Behind</button>
    <div style="position:fixed;inset:0;background:#0008"></div>
    <div role="dialog" aria-modal="true" style="position:fixed;left:0;right:0;bottom:0;height:300px;background:#222">
    <button style="width:100%;height:48px">Beer</button></div>`);
  expect(await layoutViolations(page)).toEqual([]);
});

test('hidden things are skipped: display none, hidden, inert, aria-hidden, closed dialog, sr-only', async ({ page }) => {
  await page390(page, `<button style="display:none;width:1px">a</button><div hidden><input style="width:5px"></div>
    <div inert><button style="width:5px;height:5px;padding:0">b</button></div>
    <div aria-hidden="true"><button style="width:5px;height:5px;padding:0">c</button></div>
    <dialog><button style="width:5px">d</button></dialog>
    <input type="text" style="position:absolute;width:1px;height:1px;padding:0;border:0;clip:rect(0 0 0 0);overflow:hidden">`);
  expect(await layoutViolations(page)).toEqual([]);
});

test('the original bug: a Show button taking the row squeezes the password field, and the sweep says so', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('password-input').waitFor();
  // The cascade before button.link existed: the global button rule made Show full-width.
  await page.addStyleTag({ content: '.password button { width: 100% !important; flex: 0 1 auto !important; padding: 14px !important; min-height: 48px !important; }' });
  expect((await page.getByTestId('password-input').boundingBox())!.width).toBeLessThan(120);
  expect((await layoutViolations(page)).join('\n')).toMatch(/narrow-field: input#password .* on \/login/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx playwright test tests/e2e/layoutRules.spec.ts`
Expected: FAIL: `Cannot find module './layoutRules'`.

- [ ] **Step 3: Implement the checker**

Create `web/tests/e2e/layoutRules.ts`:

```ts
import { expect, type Page } from '@playwright/test';

/**
 * Generic layout rules, checked inside the browser on the current page (spec 2026-10-04 §2.2).
 * They catch broken layout (squeezed, covered, spilling, wider than the phone), not style.
 */
export type LayoutRule = 'page-overflow' | 'narrow-field' | 'small-target' | 'covered' | 'text-spill';

export async function layoutViolations(page: Page, skip: LayoutRule[] = []): Promise<string[]> {
  const found = await page.evaluate(() => {
    const out: [string, string][] = [];
    const CONTROLS = 'button, a[href], input, select, textarea, [role=button], summary';
    const FREE_TEXT = new Set(['', 'text', 'email', 'password', 'search', 'tel', 'url']);

    const describe = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cls = [...el.classList].filter((c) => !c.startsWith('svelte-')).map((c) => `.${c}`).join('');
      const testid = el.getAttribute('data-testid');
      const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 30);
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls}${testid ? `[data-testid=${testid}]` : ''}` +
        `${text ? ` "${text}"` : ''} ${Math.round(r.width)}×${Math.round(r.height)} px`;
    };

    // The active layer: the topmost open modal (native dialog:modal or aria-modal), else the document.
    const modals = [...document.querySelectorAll('dialog, [aria-modal="true"]')].filter((el) =>
      el instanceof HTMLDialogElement ? el.matches(':modal') : el.checkVisibility({ visibilityProperty: true }));
    const innermost = modals.filter((m) => !modals.some((o) => o !== m && m.contains(o)));
    const layer: ParentNode = innermost.at(-1) ?? document;

    const srOnly = (el: Element) => {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      return r.width <= 1 && r.height <= 1 && (s.clip.startsWith('rect') || s.clipPath !== 'none' || s.overflow === 'hidden');
    };
    const hidden = (el: Element) =>
      !el.checkVisibility({ visibilityProperty: true }) || !!el.closest('[hidden], [inert], [aria-hidden="true"]') ||
      (el instanceof HTMLInputElement && el.type === 'hidden') || srOnly(el);
    const controls = [...layer.querySelectorAll(CONTROLS)].filter((el) => !hidden(el));

    // page-overflow
    const doc = document.documentElement;
    if (doc.scrollWidth > innerWidth + 1) {
      const wide = [...document.body.querySelectorAll('*')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.right > innerWidth + 1 && !(el.parentElement && el.parentElement.getBoundingClientRect().right > innerWidth + 1);
      }).slice(0, 3).map(describe);
      out.push(['page-overflow', `page is ${doc.scrollWidth} px wide (viewport ${innerWidth})${wide.length ? `: ${wide.join('; ')}` : ''}`]);
    }

    for (const el of controls) {
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      // narrow-field: free-text fields only; time/date/number/select are compact by design.
      const freeText = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && FREE_TEXT.has(el.getAttribute('type') ?? ''));
      if (freeText && r.width < 120) out.push(['narrow-field', `${describe(el)} (min 120)`]);
      // small-target: WCAG 2.5.8 minimum; text links in running text are exempt.
      const inlineText = (el.tagName === 'A' && s.display === 'inline') || el.matches('button.link');
      if (!inlineText && (r.width < 24 || r.height < 24)) out.push(['small-target', `${describe(el)} (min 24×24)`]);
      // text-spill: a text-only button whose label is wider than its box.
      if (el.tagName === 'BUTTON' && el.children.length === 0 && el.scrollWidth > el.clientWidth + 2 && s.textOverflow !== 'ellipsis')
        out.push(['text-spill', `${describe(el)} needs ${el.scrollWidth} px`]);
    }

    // covered: scroll each control to the middle and hit-test its centre; then restore every scroller.
    const scrollers = [document.scrollingElement!, ...document.querySelectorAll('*')].filter((el) =>
      el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth);
    const saved = scrollers.map((el) => [el, el.scrollLeft, el.scrollTop] as const);
    for (const el of controls) {
      if (getComputedStyle(el).pointerEvents === 'none') continue;
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
      if (r.width === 0 || r.height === 0) continue; // already reported as small-target
      const hit = document.elementFromPoint(x, y);
      const ok = !!hit && (hit === el || el.contains(hit) || (hit instanceof HTMLLabelElement && hit.control === el));
      if (!ok) out.push(['covered', `${describe(el)} is under ${hit ? describe(hit) : 'nothing'}`]);
    }
    for (const [el, left, top] of saved) { el.scrollLeft = left; el.scrollTop = top; }
    return out;
  });
  const path = new URL(page.url()).pathname || page.url();
  const seen = new Set<string>();
  return found.filter(([rule]) => !skip.includes(rule as LayoutRule))
    .map(([rule, what]) => `${rule}: ${what} on ${path}`)
    .filter((line) => !seen.has(line) && !!seen.add(line));
}

export async function expectSaneLayout(page: Page, skip: LayoutRule[] = []): Promise<void> {
  const path = new URL(page.url()).pathname + new URL(page.url()).search;
  expect.soft(await layoutViolations(page, skip), `layout on ${path}`).toEqual([]);
}
```

Notes for the implementer:
- `page.setContent` pages have URL `about:blank`; `new URL('about:blank').pathname` is `'blank'`, which is fine for messages.
- `checkVisibility` is Chromium-native; the suite runs Chromium only.
- If a proof test fails because of a rule detail, fix the rule, not the test, unless the test contradicts spec §2.2.

- [ ] **Step 4: Run the proof tests**

Run: `cd web && npx playwright test tests/e2e/layoutRules.spec.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Full gate, then commit**

Run the full gate. Expected: green.

```bash
git add web/tests/e2e/layoutRules.ts web/tests/e2e/layoutRules.spec.ts
git status --short
git commit -m "test(e2e): generic layout rules with a proof for each, including the squeezed password field"
```

---

### Task 3: The layout sweep, and triage of what it finds

**Files:**
- Create: `web/tests/e2e/layoutSweep.spec.ts`
- Possibly modify: app CSS for real bugs the sweep finds (`web/src/**/*.svelte`)

**Interfaces:**
- Consumes: `expectSaneLayout`, `LayoutRule` (Task 2); `login`, `openHome`, `clearRoutes`, `seedLockedCrawl`, `openTab`, `stubTurnstile` (helpers, Task 1).

- [ ] **Step 1: Write the sweep**

Create `web/tests/e2e/layoutSweep.spec.ts`:

```ts
import { expect, test, type Locator, type Page } from '@playwright/test';
import { clearRoutes, login, openTab, seedLockedCrawl, stubTurnstile } from './helpers';
import { expectSaneLayout, type LayoutRule } from './layoutRules';

// Every page and page state, at the suite's phone viewport (iPhone 13). A new page or state gets one
// line here. `skip` takes rules a page legitimately breaks, each with a reason in a comment.
type State = { name: string; open: (page: Page) => Promise<unknown>; ready: (page: Page) => Locator; skip?: LayoutRule[] };

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
const CREW = process.env.CREW_PASSWORD ?? 'crew-test-password';
const EVENT_DAY = new Date('2026-12-26T19:00:00Z');
const PRACTICE_DAY = new Date('2026-12-20T19:00:00Z');

/** Live departures only; /api/metra/stations stays real because the station picker reads its lines. */
async function stubDepartures(page: Page) {
  await page.route(/\/api\/metra\/(next|status|alerts)/, (r) => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, trips: [], alerts: [] } }));
}

async function sweep(page: Page, states: State[]) {
  for (const s of states) {
    await test.step(s.name, async () => {
      await s.open(page);
      await expect(s.ready(page).first()).toBeVisible();
      await expectSaneLayout(page, s.skip);
    });
  }
}

test('signed-out pages', async ({ page }) => {
  await stubTurnstile(page);
  await sweep(page, [
    { name: 'login, password', open: (p) => p.goto('/login'), ready: (p) => p.getByTestId('password-input') },
    { name: 'login, code', open: (p) => p.getByTestId('use-code').click(), ready: (p) => p.getByTestId('send-code') },
    { name: 'forgot password', open: (p) => p.goto('/login/forgot'), ready: (p) => p.getByTestId('send-link') },
    { name: 'reset form', open: (p) => p.goto('/reset-password#layout-sweep'), ready: (p) => p.getByTestId('set-password') },
    { name: 'reset, dead link', open: (p) => p.goto('/reset-password'), ready: (p) => p.getByTestId('reset-dead') },
    { name: 'join', open: (p) => p.goto('/join'), ready: (p) => p.getByTestId('send-code') }
  ]);
});

async function eventDay(page: Page, name: string, when = EVENT_DAY) {
  await stubDepartures(page);
  await login(page, name, ADMIN);
  await clearRoutes();
  const ids = await seedLockedCrawl({ ownerName: name, eventDate: '2026-12-26', startTime: '12:00',
    departAt: '2026-12-26T20:34:00Z', arriveAt: '2026-12-26T20:49:00Z', extraVenueAtFirstStation: true });
  await page.clock.install({ time: when });
  return ids;
}

test('crew pages on the event day', async ({ page, browser }) => {
  const ids = await eventDay(page, 'E2E Sweep Owner');
  const crew = await (await browser.newContext()).newPage();
  await stubDepartures(crew);
  await crew.clock.install({ time: EVENT_DAY });
  await login(crew, 'E2E Sweep Crew', CREW);
  await sweep(crew, [
    { name: 'live', open: (p) => p.goto('/live'), ready: (p) => p.getByTestId('departure-board') },
    { name: 'live, Tab open', open: (p) => openTab(p), ready: (p) => p.getByTestId('drink-beer') },
    { name: 'live, stop sheet', open: (p) => p.goto(`/live?stop=${ids.secondStopId}`), ready: (p) => p.getByTestId('sheet-name') },
    { name: 'route', open: (p) => p.goto('/route'), ready: (p) => p.getByTestId('locked-on') },
    { name: 'crew board', open: (p) => p.goto('/crew'), ready: (p) => p.getByTestId('crew-row') },
    { name: 'notifications', open: (p) => p.goto('/notifications'), ready: (p) => p.getByTestId('bulletin-list') },
    { name: 'account', open: (p) => p.goto('/account'), ready: (p) => p.getByTestId('account-save') },
    { name: 'plan list', open: (p) => p.goto('/plan'), ready: (p) => p.getByTestId('draft-title') },
    { name: 'route view', open: (p) => p.goto(`/plan/${ids.itineraryId}`), ready: (p) => p.getByTestId('current-route') },
    { name: 'stop page', open: (p) => p.goto(`/plan/${ids.itineraryId}/stops/${ids.firstStopId}`), ready: (p) => p.getByTestId('notes') }
  ]);
  await crew.context().close();
});

test('Conductor pages', async ({ page }) => {
  const ids = await eventDay(page, 'E2E Sweep Conductor');
  await sweep(page, [
    { name: 'locked-route editor', open: (p) => p.goto(`/plan/${ids.itineraryId}/edit`), ready: (p) => p.getByTestId('save-plan') },
    { name: 'station picker', open: (p) => p.goto(`/plan/${ids.itineraryId}/add`), ready: (p) => p.getByTestId('station-select') },
    { name: 'crew access', open: (p) => p.goto('/crew/access'), ready: (p) => p.getByTestId('manifest-person') },
    { name: 'draft editor', open: async (p) => {
        await p.goto('/plan');
        await p.getByTestId('draft-title').fill(`Sweep Draft ${Date.now()}`);
        await p.getByTestId('create-draft').click();
        await expect(p).toHaveURL(/\/plan\/[a-z0-9]{15}\/edit$/);
      }, ready: (p) => p.getByTestId('save-status').or(p.getByTestId('station-select')) }
  ]);
});

test('Live on a practice day', async ({ page }) => {
  await eventDay(page, 'E2E Sweep Practice', PRACTICE_DAY);
  await sweep(page, [
    { name: 'practice live', open: (p) => p.goto('/live'), ready: (p) => p.getByTestId('departure-board') }
  ]);
});
```

Before running, verify each `ready` test id exists on its page (`grep -rn 'data-testid="<id>"' web/src`). In particular the draft editor's ready locator is a guess: open the draft editor's markup (`web/src/routes/(app)/plan/[id]/edit/+page.svelte` and `ItineraryView.svelte`) and pick a test id that renders for an empty draft. Replace any id that does not exist with one that does on that page; do not drop a state.

- [ ] **Step 2: Run the sweep and collect violations**

Run: `cd web && npx playwright test tests/e2e/layoutSweep.spec.ts --reporter=line`
Expected: either PASS, or soft failures listing violations as `rule: element … on /path`. Navigation or `ready` failures are setup bugs in the sweep: fix them before triage.

- [ ] **Step 3: Triage each violation**

For each reported line decide one of:
- **Real bug** (a control a person cannot use or read properly): fix the CSS in the component, keep the sweep as its test. One commit per bug: `fix(web): <what> (found by the layout sweep)`.
- **False positive from a rule detail** (the rule misjudges a legitimate pattern used in several places): tighten the rule in `layoutRules.ts` and add a proof case for the legitimate pattern to `layoutRules.spec.ts`.
- **One page legitimately breaks one rule**: add `skip: ['<rule>']` to that state with a `// why` comment.

If more than five real bugs turn up, fix none of the extra ones beyond five: list them in the task report for the user instead, with a `skip` and a `// TODO(user): <bug>` comment, and say so.

- [ ] **Step 4: Run the sweep until clean, then the full gate**

Run: `cd web && npx playwright test tests/e2e/layoutSweep.spec.ts tests/e2e/layoutRules.spec.ts`
Expected: PASS. Then the full gate. Expected: green.

- [ ] **Step 5: Commit**

```bash
git add web/tests/e2e/layoutSweep.spec.ts web/tests/e2e/layoutRules.ts web/tests/e2e/layoutRules.spec.ts
git status --short
git commit -m "test(e2e): layout sweep over every page state at phone width"
```

(Bug-fix commits from Step 3 go in before this one, each with its own explicit paths.)

---

### Task 4: e2e waits on the actual event, the flake, and retry-safe fixtures

**Files:**
- Modify: `web/tests/e2e/liveUx.spec.ts:9-16` (`longPress`)
- Modify: `web/tests/e2e/tab.spec.ts` (L63-85, L112-123, L125-141, L153-178)
- Modify: `web/tests/e2e/planning.spec.ts:294-321` and fixed draft titles
- Modify: `web/tests/e2e/boarding.spec.ts` (L5-39, L41-71)
- Modify: `web/tests/e2e/bulletins.spec.ts` (delete L49-66)

**Interfaces:**
- Consumes: helpers from Task 1. Produces nothing new.

- [ ] **Step 1: Prove the flake first**

Run: `cd web && npx playwright test tests/e2e/tab.spec.ts -g "404 on Undo" --repeat-each 20`
Expected: at least one FAIL with `Expected "0", Received "1"`. If it passes 20/20, still apply the fix (the mechanism is confirmed by reading `live/+page.svelte:96-116` and `day.svelte.ts:287-290`) and note it.

- [ ] **Step 2: Fix the 404 test**

In the "a 404 on Undo" test, replace the route handler with one that really deletes, then reports 404:

```ts
  await page.route('**/api/collections/drink_entries/records/**', async (r) => {
    if (r.request().method() !== 'DELETE') return r.continue();
    await r.fetch();   // the row really goes, as when someone else removed it first
    await r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ code: 404, message: 'not found', data: {} }) });
  });
```

Run the `--repeat-each 20` command again. Expected: 20 passed.

- [ ] **Step 3: Replace the long-press sleep**

In `liveUx.spec.ts`, `longPress` becomes (every caller's page has `clock.install`; `HOLD_MS` is 450 in `src/lib/live/holdMenu.svelte.ts:2`):

```ts
async function longPress(page: Page, target: Locator) {
  await target.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + 12, box.y + 8);
  await page.mouse.down();
  await page.clock.runFor(500);   // past HOLD_MS (450) on the page's own clock
  await page.mouse.up();
}
```

Check every `longPress` caller's page installed the clock (`grep -n "longPress\|clock.install" web/tests/e2e/liveUx.spec.ts`); if a second page did not, add `await other.clock.install({ time: new Date('2026-12-26T19:00:00Z') })` before its `goto`.

- [ ] **Step 4: Replace the tab sleeps with response barriers**

"overlapping taps…": replace `await page.waitForTimeout(1500);` with a wait for the feed reload that starts after the second save's response:

```ts
  // Barrier: the reload the app starts after a save (live/+page.svelte:87), begun after both POSTs answered.
  let answered = 0;
  const reloaded = new Promise<void>((resolve) => {
    page.on('response', (res) => {
      const req = res.request(), url = req.url();
      if (!url.includes('/api/collections/drink_entries/records')) return;
      if (req.method() === 'POST') answered++;
      else if (req.method() === 'GET' && answered >= 2) resolve();
    });
  });
```

Register this listener right after the `page.route(...)` call (before the clicks), and where the sleep was, write `await reloaded;`. Keep the assertions that follow.

"a repeat Undo tap…": replace `await page.waitForTimeout(700);` with:

```ts
  await page.waitForResponse((res) => res.request().method() === 'DELETE' && res.url().includes('/api/collections/drink_entries/records/'));
```

Register it as `const deleted = page.waitForResponse(...)` before the first `tab-undo` click, and `await deleted;` where the sleep was.

"the undo-last fallback…": delete `await page.waitForTimeout(1200);`; the following `toBeVisible` auto-waits (default 5 s, the delay is 800 ms).

- [ ] **Step 5: Replace the planning stale-comments sleep**

In "a slow first comments load…", replace the route handler and the tail:

```ts
  let release!: () => void;
  const fresh = new Promise<void>((r) => (release = r));
  let stale: Promise<void> | undefined;
  let first = true;
  await page.route(/\/api\/collections\/comments\/records\?.*itineraries/, async (route) => {
    if (!first) return route.continue();
    first = false;
    const response = await route.fetch();
    stale = (async () => { await fresh; await route.fulfill({ response }).catch(() => {}); })();
    await stale;
  });
  await page.goto(draftUrl);
  await page.getByTestId('comment-input').fill('Right on time');
  await page.getByTestId('comment-post').click();
  await expect(page.getByTestId('comments')).toContainText('Right on time');
  release();
  await expect.poll(() => stale).toBeDefined();
  await stale;
  // Barrier: two animation frames, so the page has processed the stale answer before the check.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(page.getByTestId('comments')).toContainText('Right on time');
```

- [ ] **Step 6: Retry-safe draft titles in planning**

At the top of `planning.spec.ts`, add `const RUN = Math.random().toString(36).slice(2, 6);` and append `` ` ${RUN}` `` to every fixed title passed to `draft-title` fill, title inputs or seeds (L33, L180, L203, L225, L241, L254, L297, L326, L368; find them with `grep -n "fill('E2E\|fill(\"E2E\|title:" web/tests/e2e/planning.spec.ts`). Where a test later asserts the title text, assert the suffixed text.

- [ ] **Step 7: Boarding without the real 5 s poll, and no leftover request**

In "a visitor boards…": after the API let-aboard succeeds, replace the 10 s wait for the poll with a reload (the page resumes and fetches status at once; the poll → aboard transition stays covered by the three-phone test):

```ts
  await page.reload();
  await expect(page.getByTestId('aboard')).toBeVisible();
```

In "a status poll answered…":
- Add `await page.clock.install();` right before `await page.goto('/join');`. Installed without `pauseAt`, the fake clock still advances with real time, so the Turnstile stub's `setTimeout` keeps working.
- Fire the poll instead of waiting up to 5 s for it: replace the line `await polled;` with `await page.clock.runFor(5000); await polled;`. Everything else in the test stays in order.
- At the end of the test, turn the request away so no boarding popup lingers on later crew pages:

```ts
  const su = await superuserToken();
  const req = (await (await fetch(`${PB}/api/collections/boarding_requests/records?filter=${encodeURIComponent(`email="${email}"`)}`, { headers: { Authorization: su } })).json()).items[0];
  const boss = await sessionFor(`E2E Poll Cleaner ${n}`, true);
  expect((await fetch(`${PB}/api/crawl/boarding/${req.id}/turn-away`, { method: 'POST', headers: { Authorization: boss.token } })).status).toBe(200);
```

Check the turn-away route name: `grep -n "turn-away" web/../pocketbase/pb_hooks/*.js`. Keep the deliberate `waitForTimeout(500)` negative check.

- [ ] **Step 8: Delete the vacuous Bulletin test**

Delete `bulletins.spec.ts` "Conductor can skip and still save" (L49-66). Covered: save-after-skip by `liveEdit.spec.ts:21`; "skip posts nothing" by unit `planCommit.test.ts:280`.

- [ ] **Step 9: Run the touched files, then the full gate**

Run: `cd web && npx playwright test tests/e2e/{tab,liveUx,planning,boarding,bulletins}.spec.ts`
Expected: PASS. Then the full gate. Expected: green, with no flake allowance from here on.

- [ ] **Step 10: Commit**

```bash
git add web/tests/e2e/tab.spec.ts web/tests/e2e/liveUx.spec.ts web/tests/e2e/planning.spec.ts web/tests/e2e/boarding.spec.ts web/tests/e2e/bulletins.spec.ts
git status --short
git commit -m "test(e2e): wait on responses, not sleeps; fix the 404-Undo flake; retry-safe titles; boarding leaves no request"
```

---

### Task 5: e2e merges and deletions

**Files:**
- Modify: `web/tests/e2e/{tab,liveUx,live,liveEdit,bulletins,offline,crew,layout,freight,chat,practice,controls}.spec.ts`

**Interfaces:** none new.

How to merge (applies to every row below): keep the target test's setup; append the source test's actions and assertions after the target's last assertion, adapted to the target's state (same page, same seeded route); keep every assertion of both; give the merged test a title that names both behaviours; delete the source test. When the source test needs a fresh state the target has already changed (e.g. a count back at 0), insert the smallest step that restores it (e.g. tap Undo) rather than reseeding.

- [ ] **Step 1: Record the starting count**

Run: `cd web && npx playwright test --list | tail -1`
Expected: about 130 tests (114, plus Task 1's login test, Task 2's twelve proofs and Task 3's four sweeps, minus Task 4's deletion). Note the number.

- [ ] **Step 2: tab.spec.ts**

- Delete "one tap logs a drink at the current stop, and Undo takes it back" (L8). Covered by L180 "a second tap… retargets Undo", chat L3 and crew L16; `tab-total` is asserted by "overlapping taps".
- Merge "Tab offers five illustrated personal counters and a camera picker" (L30) into "the tab bar opens the Tab…" (L193): its four assertions go right after `tabDay`.
- Merge "a saved drink stays counted when the refresh after it fails" (L87) into "a drink that cannot be saved…" (L54): after the existing assertions, `await page.unroute('**/api/collections/drink_entries/records**');`, then the GET-abort route, cocktail tap and its assertions.
- Merge "after the toast is gone, your newest drink here can still be undone" (L143) into "the undo-last fallback…" (L153): at the end, `await page.clock.runFor(5_000); await expect(page.getByTestId('tab-toast')).toBeHidden(); await page.getByTestId('tab-undo-last').click(); await expect(page.getByTestId('drink-beer').locator('.count')).toHaveText('0');`

Run: `cd web && npx playwright test tests/e2e/tab.spec.ts` → PASS.

- [ ] **Step 3: liveUx.spec.ts and live.spec.ts**

- Merge L29 "Freight photo opens viewer…" and L154 "photo in chat gets accessible label" into L167 "fast double tap on close": one upload; assert the chat photo's accessible label; open the viewer, `goBack`, assert closed; reopen and double-tap close.
- Merge L89 "a shared stop link opens the sheet…" and L106 "route strip shows where crew is" into L47 "tapping the current stop opens the sheet": strip assertions first, then the existing sheet flow, then `goto('/live?stop=<secondStopId>')` and its close assertions.
- Merge L98 "event-day Route opens stops in the sheet" with L185 "Conductor reaches the locked-route editor from Live": Route tab → sheet → close → `edit-route`.
- Merge L160 "chat celebrates the first beer" with L193 "leaderboard line podium": tap beer → milestone → close Tab → leaderboard "you 1" → `/crew`.
- Move L40 "ticket's station opens walking directions" into live.spec L59 "ticket leads with the station" (two assertions on `station-walk`).
- live.spec: merge L69 + L79 (alert bubbles: close one, reload, it stays closed; click the other → `/notifications`); merge L92 "banner rides along" and L101 "nobody can correct position from the board" into L59.

Run: `cd web && npx playwright test tests/e2e/liveUx.spec.ts tests/e2e/live.spec.ts` → PASS.

- [ ] **Step 4: liveEdit, bulletins, offline**

- liveEdit: merge L70 "Save disabled while the preview is checking" into L21 (after `set-here-0`: gate the preview, `set-here-1`, assert Save disabled and the checking status, release, Save, anchor = middle stop); merge L107 + L118 (preview abort → `checkFailed` → commit abort → No signal with Save enabled → unroute → Save → URL).
- While here, make `latestAnchor` accept an itinerary: `latestAnchor(itineraryId?: string)` adds `&filter=${encodeURIComponent(`stop.itinerary="${itineraryId}"`)}` when given; pass the seeded id at its one caller.
- bulletins: delete L92 "post a Bulletin without changing the plan" (the `pinBulletin` helper used by L157/L173 performs and asserts the same steps); merge L68 "Save cannot replace a drafted Bulletin while the sheet is open" into L10 (assert `save-plan` disabled before `bulletin-send`); merge L157 + L173 (one `pinBulletin`: abort the ack → pin restored + alert; unroute; hold the ack → hidden at once; release; reload → hidden).
- offline: run `arrive()` once for the storage-failure loop (L117-162) by seeding in a `test.beforeAll` with its own `browser.newPage()` for the owner login, and keep one test per failure mode; drop the "open throws" case (same `catch` as "getter throws", `src/lib/offline.ts:43` vs `:60`). **Keep L164** (spec §3.4).

Run: `cd web && npx playwright test tests/e2e/{liveEdit,bulletins,offline}.spec.ts` → PASS.

- [ ] **Step 5: crew, layout, freight, chat, practice, controls**

- crew: delete L6 "the Crew Board lists everyone who logged in". Covered by layout L34 (menu → Crew Board → own row).
- layout: merge L6, L14, L29 into one desktop test (1280 px: width check; resize to 1280×300 for the pinned-header scroll; no date in the banner).
- freight: merge L67 + L89 (seed once; `clock.install(before)`, upload, assert; `clock.setFixedTime(after)`, reload, upload, assert two images and no strip).
- chat: merge L49 + L66 (same `liveChat()` setup; the slow-send routes come after the Enter/blank/emoji checks).
- practice: merge L106 into L38 (post the two lines before `goto`).
- controls: merge L23 + L36 (same seed).

Run: `cd web && npx playwright test tests/e2e/{crew,layout,freight,chat,practice,controls}.spec.ts` → PASS.

- [ ] **Step 6: Count, full gate, commit**

Run: `cd web && npx playwright test --list | tail -1`
Expected: Step 1's number minus about 18 (about 112: the original 114 become about 96).
Then the full gate. Expected: green.

```bash
git add web/tests/e2e/tab.spec.ts web/tests/e2e/liveUx.spec.ts web/tests/e2e/live.spec.ts web/tests/e2e/liveEdit.spec.ts web/tests/e2e/bulletins.spec.ts web/tests/e2e/offline.spec.ts web/tests/e2e/crew.spec.ts web/tests/e2e/layout.spec.ts web/tests/e2e/freight.spec.ts web/tests/e2e/chat.spec.ts web/tests/e2e/practice.spec.ts web/tests/e2e/controls.spec.ts web/tests/e2e/helpers.ts
git status --short
git commit -m "test(e2e): merge tests that share a setup; delete ones another test already proves"
```

---

### Task 6: Hooks: cached token, shorter waits, concurrent SIM pass, no 8090 fallback

**Files:**
- Modify: `web/tests/hooks/setup.ts` (`PB`, `superuserToken`, `truncate`, `codeFor`, `resetLinkFor`, `waitFor`)
- Modify: `web/tests/hooks/places.test.ts:12`, `web/tests/hooks/planning.test.ts:300-305`
- Modify: `web/tests/hooks/{decisions,access,password,boarding}.test.ts`
- Modify: `scripts/test-hooks.mjs`
- Create: `web/tests/unit/hooksSetupGuard.test.ts`

**Interfaces:**
- Produces: `PB` in `tests/hooks/setup.ts` throws at import when `PB_URL` is unset.
- Produces: `superuserToken(): Promise<string>` memoised per test file.

- [ ] **Step 1: Write the failing guard test**

Create `web/tests/unit/hooksSetupGuard.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('hooks test helpers', () => {
  const saved = process.env.PB_URL;
  afterEach(() => { process.env.PB_URL = saved; vi.resetModules(); });

  it('refuse to run without PB_URL, rather than fall back to the live stack on 8090', async () => {
    delete process.env.PB_URL;
    vi.resetModules();
    await expect(import('../hooks/setup')).rejects.toThrow(/PB_URL/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run tests/unit/hooksSetupGuard.test.ts`
Expected: FAIL (the import resolves with the 8090 default).

- [ ] **Step 3: Change `setup.ts`**

```ts
if (!process.env.PB_URL) throw new Error('PB_URL is unset: run the hooks through scripts/test-hooks.sh, never against the live stack');
export const PB = process.env.PB_URL;
```

```ts
let superuser: Promise<string> | undefined;
/** One superuser login per test file (vitest isolates files): each login is a bcrypt check. */
export function superuserToken(): Promise<string> {
  superuser ??= (async () => {
    const response = await post('/api/collections/_superusers/auth-with-password', { identity: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    if (!response.ok) throw new Error(`Superuser login failed: ${response.status}`);
    return (await response.json()).token as string;
  })();
  superuser.catch(() => { superuser = undefined; });
  return superuser;
}
```

`truncate` deletes in parallel:

```ts
export async function truncate(collection: string): Promise<void> {
  const token = await superuserToken();
  const list = await fetch(`${PB}/api/collections/${collection}/records?perPage=500&fields=id`, { headers: { Authorization: token } });
  if (!list.ok) throw new Error(`List ${collection} failed: ${list.status}`);
  await Promise.all(((await list.json()).items as Array<{ id: string }>).map((record) =>
    fetch(`${PB}/api/collections/${collection}/records/${record.id}`, { method: 'DELETE', headers: { Authorization: token } })));
}
```

`codeFor` and `resetLinkFor` poll every 25 ms against a 5 s deadline (today: 50 × 100 ms):

```ts
/** Polls `probe` every 25 ms for up to 5 s. */
async function poll<T>(probe: () => Promise<T | undefined>, what: string): Promise<T> {
  const until = Date.now() + 5000;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > until) throw new Error(what);
    await new Promise((r) => setTimeout(r, 25));
  }
}
export const codeFor = (to: string) => poll(async () =>
  (await mails(to)).map((m) => /\b(\d{6})\b/.exec(m.text)?.[1]).filter(Boolean).at(-1) as string | undefined, `No code mailed to ${to}`);
export const resetLinkFor = (to: string) => poll(async () => {
  const hit = (await mails(to)).map((m) => /(https?:\/\/[^\s"<]+\/reset-password#([\w.-]+))/.exec(`${m.text}\n${m.html}`)).filter(Boolean).at(-1);
  return hit ? { url: hit[1], token: hit[2] } : undefined;
}, `No reset link mailed to ${to}`);
```

Keep their doc comments. In `waitFor`, change the sleep from `100` to `25` (its `ms` deadline is unchanged).

In `places.test.ts:12` use `get pbUrl() { return PB; }` (import `PB` from `./setup`), and in `planning.test.ts:300-305` replace `process.env.PB_URL ?? 'http://127.0.0.1:8090'` with `PB`.

- [ ] **Step 4: Run the guard test**

Run: `cd web && npx vitest run tests/unit/hooksSetupGuard.test.ts`
Expected: PASS.

- [ ] **Step 5: Shorter waits in the hooks tests**

- `decisions.test.ts` "a put-off person stops receiving realtime events at once": open a control listener that is never blocked, and wait for it instead of 1.5 s:

```ts
    const stream = await listen(rider.token, ['chat_messages']);
    const control = await listen(boss.token, ['chat_messages']);
    try {
      // ... unchanged until say('after') ...
      await say('after');
      await waitFor(async () => control.events.some((ev) => ev.data?.record?.body === 'after'), 5000);
      await new Promise((r) => setTimeout(r, 100));   // grace for a late delivery to the rider
      expect(stream.events.some((ev) => ev.data?.record?.body === 'after')).toBe(false);
    } finally { stream.close(); control.close(); }
```

Check `listen` accepts a Conductor token and returns `{ events, close }` (`grep -n "function listen" -A15 web/tests/hooks/decisions.test.ts web/tests/hooks/setup.ts`).
- `access.test.ts:29,68,97` and `password.test.ts:87`: change the "no mail was sent" sleeps to `200` ms.
- `boarding.test.ts:167`: delete `await new Promise((res) => setTimeout(res, 300));` (`/resend` mails synchronously inside the request).
- `boarding.test.ts` `seedRequests`: create the rows with `Promise.all` over one `su()` header object:

```ts
async function seedRequests(count: number, status: 'unverified' | 'waiting') {
  const headers = await su();
  await Promise.all(Array.from({ length: count }, () => fetch(`${PB}/api/collections/boarding_requests/records`, { method: 'POST', headers,
    body: JSON.stringify({ name: `Seed ${uid()}`, name_key: `seed ${uid()}`, email: `seed${uid()}@test.invalid`, method: 'email', status,
      ip: randomIp(), status_at: new Date().toISOString().replace('T', ' '), code_sent_at: new Date().toISOString().replace('T', ' ') }) })));
}
```

Also batch the 20 PATCHes at `boarding.test.ts:202-204` with `Promise.all`.

- [ ] **Step 6: Deletions, merges, stale scaffolding**

- Delete `boarding.test.ts:280` "mail failure answers 502 and expires" (covered by `:54-65`).
- Delete `password.test.ts:59` "a put-off seat cannot sign in with its password" (covered by `access.test.ts:73-89`).
- In `boarding.test.ts:178` "global caps hold", keep only the 10-unverified half; delete lines 181–183 (the 20-waiting half is covered by `:194-200`).
- Merge `decisions.test.ts:51` "let aboard installs the chosen password" into `:79` (one waiting request: assert user fields, status `aboard`, password sign-in and the mail text). Merge `:71` "turning away clears its hash" into `:108` (add `expect(<row>.password_hash).toBe('')` after its turn-away).
- In `access.test.ts:73-89`, remove the `passwordAuth` read/PATCH/`try/finally` (migration `1759000000_password_sign_in.js` always enables it); keep the sign-in assertions and the log row check.

- [ ] **Step 7: Run the SIM pass concurrently**

In `scripts/test-hooks.mjs`, replace the sequential `for (const sim of [false, true])` loop with a function `pass(sim, port)` that does what one loop iteration does today (probe the port is free, spawn `pb-test-server.mjs <port>`, wait healthy, spawn vitest with `PB_URL=http://127.0.0.1:<port>`, return the exit code), and run both at once:

```js
async function pass(sim, port) {
  const env = { ...process.env, SIM: sim ? '1' : '0', SIM_RUN_ID: sim ? 'hook-fixture' : '',
    // The SIM pass's recompute hook must not reach recompute.test's listener on 18095: port 9 refuses at once.
    WEB_INTERNAL_URL: sim ? 'http://127.0.0.1:9' : 'http://127.0.0.1:18095', INTERNAL_SECRET: 'hooks-test-secret' };
  // ... the body of today's loop iteration, using `env` for both spawns and `port` instead of 18090 ...
  return code;
}
const [normal, simulated] = await Promise.all([pass(false, 18090), pass(true, 18091)]);
process.exitCode = normal || simulated;
fakes.kill('SIGTERM');
```

Pass `env` explicitly to both `spawn` calls instead of mutating `process.env` (two passes now run at once). Keep the SIGINT/SIGTERM handling per pass. `pb-test-server.mjs` reads `SIM` from its environment: confirm with `grep -n "SIM" scripts/pb-test-server.mjs`.

- [ ] **Step 8: Run hooks and the full gate**

Run: `bash scripts/test-hooks.sh`
Expected: normal pass 21 files passed / 2 skipped, 166 passed + 7 skipped (177 minus 2 deletions and 2 merges); SIM pass 2 files, 7 tests; wall time about 30 s (`/usr/bin/time -f %es bash scripts/test-hooks.sh`).
Then the full gate. Expected: green.

- [ ] **Step 9: Commit**

```bash
git add web/tests/hooks web/tests/unit/hooksSetupGuard.test.ts scripts/test-hooks.mjs
git status --short
git commit -m "test(hooks): one superuser login per file, shorter waits, concurrent SIM pass, no fallback to the live stack"
```

---

### Task 7: Unit deletions, docs, and the timing report

**Files:**
- Modify: `web/tests/unit/metra-endpoints.test.ts`, `web/tests/unit/liveDay.test.ts`, `web/tests/unit/serverPlan.test.ts`
- Modify: `CLAUDE.md`, and `README.md` / `docs/OPERATIONS.md` where they quote test counts or describe `login()`

- [ ] **Step 1: Delete the three redundant unit tests**

- `metra-endpoints.test.ts:100` "applies a live prediction" (asserts only inside `if (hit)`; `:122` covers the path and always asserts).
- `liveDay.test.ts:106` "paused anchors in server action order" (same assertions as `:85-96`).
- `serverPlan.test.ts:72` (`activeAnchor` null without an anchor; covered by `anchor.test.ts:17`).

Run: `cd web && npm test`
Expected: PASS, 774 + Task 6's guard test = 775 tests (adjust if earlier tasks added unit tests).

- [ ] **Step 2: CLAUDE.md**

In "One test run at a time, across all worktrees", add after the e2e line:

```markdown
- Hooks (`bash scripts/test-hooks.sh`): **18090** for the normal pass's PocketBase, **18091** for the
  simulation pass's (the two run at once), **18095** for `recompute.test.ts`'s listener.
```

In "Conventions", add:

```markdown
- A new page or page state gets one line in `web/tests/e2e/layoutSweep.spec.ts`, which checks generic
  layout rules (`layoutRules.ts`) at phone width. `login()` in the e2e helpers only signs in: open the
  page you want next.
```

- [ ] **Step 3: README / OPERATIONS**

Run: `grep -n "114\|777\|177\|login(" README.md docs/OPERATIONS.md`
Update any test counts or descriptions of `login()` that are now wrong. Leave commands unchanged.

- [ ] **Step 4: Measure and report**

Run, sequentially, and record wall times:

```bash
cd web && /usr/bin/time -f "unit %es" npm test >/dev/null
/usr/bin/time -f "check %es" npm run check >/dev/null
cd .. && /usr/bin/time -f "hooks %es" bash scripts/test-hooks.sh >/dev/null
cd web && /usr/bin/time -f "e2e %es" npm run test:e2e >/dev/null
npm run test:sim && npm run test:sim:offline
```

Expected: e2e about 130–140 s, hooks about 30 s, everything green. Put the before/after table (spec §1's numbers vs these) in the commit message.

- [ ] **Step 5: Commit**

```bash
git add web/tests/unit/metra-endpoints.test.ts web/tests/unit/liveDay.test.ts web/tests/unit/serverPlan.test.ts CLAUDE.md README.md docs/OPERATIONS.md
git status --short
git commit -m "docs: hooks ports, the layout sweep and login(); drop three redundant unit tests"
```
