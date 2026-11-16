# Metra Credit Footer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show "Schedule from Metra’s public feed. Not affiliated with Metra. Timetable published Nov 14, 2026." at the bottom of every page, with the date only when it is Metra's real publish date.

**Architecture:** A pure module `web/src/lib/metraCredit.ts` decides the date (`creditDate`) and owns the polling (`watchCreditDate`). The root layout `web/src/routes/+layout.svelte` runs the watcher in one `$effect` keyed on the user id and renders `<footer class="col credit">` after `<main>`.

**Tech Stack:** SvelteKit SPA (Svelte 5 runes, `ssr = false`), Vitest (`npm test` = `tests/unit`), Playwright (`npm run test:e2e`).

**Spec:** `docs/superpowers/specs/2026-11-15-metra-credit-design.md`

## Global Constraints

- User-visible strings live only in `web/src/lib/labels.ts`; README's UI glossary names them.
- `copy.notAffiliated` = `'Schedule from Metra’s public feed. Not affiliated with Metra.'` (typographic ’).
- `copy.timetablePublished` = `'Timetable published'`.
- Date shown only when `source === 'live'`, `staticSource` is `'download'` or `'cache'`, and the whole of `staticPublishedAt` matches `MM/DD/YY hh:mm:ss AM|PM <zone>` with a real calendar date and a valid 12-hour time; formatted `Nov 14, 2026`, taken as written (no time-zone conversion).
- Refresh interval: 10 minutes (`600_000` ms), single-flight: a tick while a request is outstanding is skipped.
- Simulation clock revisions do not restart or refresh the watcher (simulation never shows a date anyway); only a change of signed-in user id does.
- Tests before code; each task ends green: `cd web && npm test && npm run check && npm run test:e2e && cd .. && bash scripts/test-hooks.sh`. Never run e2e/hooks while another worktree runs them (fixed ports).
- Stage explicit paths only; read `git status --short` before each commit.

## Review Focus

1. An answer arriving after logout (or after a user switch) must not show a date — unit test in Task 1; logout clearing a visible date — e2e in Task 2.
2. Token renewal, a rename or a simulation clock revision must not restart the watcher: the effect reads only `$auth.user?.id`, and starts the watcher inside `untrack` because `authed()` reads `clientClock.revision` synchronously (Task 2; code review, the effect has no other reactive reads).
3. On Live with the tab bar, the footer must sit fully above the bar after scrolling down — e2e in Task 2.
4. `12/31/26 11:59:59 PM America/Chicago` must read `Dec 31, 2026`, not roll into the next day — unit test in Task 1.
5. A failing status call (503 in a misconfigured simulation, offline) shows the credit without a date and no error — unit test in Task 1.
6. A slow request must not overlap or overwrite a newer one — single-flight, unit test in Task 1.

---

### Task 1: Credit date and watcher

**Files:**
- Create: `web/src/lib/metraCredit.ts`
- Modify: `web/src/lib/live/feed.ts:25-28` (`fetchStatus` return type)
- Modify: `web/src/lib/labels.ts:210-211`
- Test: `web/tests/unit/metraCredit.test.ts`

**Interfaces:**
- Produces:
  - `type CreditStatus = Pick<MetraStatus, 'source' | 'staticPublishedAt' | 'staticSource'>`
  - `creditDate(status: CreditStatus): string` — `'Nov 14, 2026'` or `''`.
  - `watchCreditDate(fetchStatus: () => Promise<CreditStatus>, onDate: (date: string) => void, intervalMs = 600_000): () => void` — calls `fetchStatus` at once and every `intervalMs`, skipping a tick while a call is outstanding; passes `creditDate(answer)` to `onDate`, or `''` when the call rejects; the returned dispose stops the timer, calls `onDate('')`, and ignores any answer still in flight.
  - `fetchStatus()` in `feed.ts` additionally returns `source?: MetraSource; staticPublishedAt: string; staticSource: string` (use `MetraStatus`'s field types).
  - `copy.notAffiliated`, `copy.timetablePublished` as in Global Constraints.

- [ ] **Step 1: Write the failing tests** in `web/tests/unit/metraCredit.test.ts`

```ts
const live = (staticPublishedAt: string, extra: Partial<CreditStatus> = {}): CreditStatus =>
  ({ source: 'live', staticSource: 'download', staticPublishedAt, ...extra });

describe('creditDate', () => {
  it('reads Metra’s published.txt as written', () => {
    expect(creditDate(live('11/14/26 02:20:03 AM America/Chicago'))).toBe('Nov 14, 2026');
    expect(creditDate(live('12/31/26 11:59:59 PM America/Chicago'))).toBe('Dec 31, 2026');
    expect(creditDate(live('01/02/27 12:00:00 PM America/Chicago', { staticSource: 'cache' }))).toBe('Jan 2, 2027');
  });
  it('shows no date unless it is Metra’s real publish date', () => {
    expect(creditDate(live('2026-10-26T18:00:00.000Z', { staticSource: 'file' }))).toBe('');
    expect(creditDate(live('11/14/26 02:20:03 AM America/Chicago', { staticSource: 'file' }))).toBe('');
    expect(creditDate(live('11/14/26 02:20:03 AM America/Chicago', { source: 'timetable' }))).toBe('');
    expect(creditDate(live('11/14/26 02:20:03 AM America/Chicago', { source: 'recording' }))).toBe('');
    expect(creditDate(live(''))).toBe('');
    expect(creditDate(live('garbage'))).toBe('');
    expect(creditDate(live('13/40/26 02:20:03 AM America/Chicago'))).toBe('');
    expect(creditDate(live('02/31/26 02:20:03 AM America/Chicago'))).toBe('');   // no Feb 31
    expect(creditDate(live('02/29/27 02:20:03 AM America/Chicago'))).toBe('');   // 2027 is not leap
    expect(creditDate(live('11/14/26 13:20:03 PM America/Chicago'))).toBe('');   // 12-hour clock
    expect(creditDate(live('11/14/26 02:61:03 AM America/Chicago'))).toBe('');
    expect(creditDate(live('11/14/26 02:20:03 AM'))).toBe('');                   // zone required
    expect(creditDate(live('11/14/26 02:20:03 AM America/Chicago junk'))).toBe('');
  });
  it('accepts Feb 29 in a leap year', () => {
    expect(creditDate(live('02/29/28 09:00:00 AM America/Chicago'))).toBe('Feb 29, 2028');
  });
});

describe('watchCreditDate', () => {
  // vi.useFakeTimers() in beforeEach, vi.useRealTimers() in afterEach.
  it('fetches at once and every interval', async () => {
    // fetch resolves live('11/14/26 …'); after flushing: onDate called with 'Nov 14, 2026', fetch called once;
    // vi.advanceTimersByTime(600_000) + flush → fetch called twice.
  });
  it('reports no date when the call fails', async () => {
    // fetch rejects → onDate('') and no throw.
  });
  it('ignores an answer that lands after dispose, and clears on dispose', async () => {
    // fetch returns a promise resolved by hand; dispose() before resolving → onDate calls === [''];
    // resolve it, flush → still [''];
    // vi.advanceTimersByTime(600_000) → fetch still called once.
  });
  it('never overlaps calls', async () => {
    // first fetch is a hand-resolved promise; advanceTimersByTime(600_000) twice → fetch called once;
    // resolve it with live('11/14/26 …'), flush → onDate('Nov 14, 2026');
    // advanceTimersByTime(600_000) → fetch called twice.
  });
});
```

Also in `web/tests/unit/labels.test.ts`, add: `expect(copy.notAffiliated).toBe('Schedule from Metra’s public feed. Not affiliated with Metra.')` and `expect(copy.timetablePublished).toBe('Timetable published')`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run tests/unit/metraCredit.test.ts tests/unit/labels.test.ts`
Expected: FAIL (module `metraCredit` not found; label mismatch).

- [ ] **Step 3: Implement** `creditDate` and `watchCreditDate` in `web/src/lib/metraCredit.ts`, extend `fetchStatus`'s type, and change the labels (keep the comment above `notAffiliated`, reworded to say the footer renders it).

`creditDate`: match the whole string with `/^(\d{2})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2}) (AM|PM) (\S+)$/`; require hour 01–12, minute and second 00–59, month 01–12 and a day that exists in that month (leap years by the Gregorian rule), year = 2000 + YY; format with a fixed English month table (`Jan`…`Dec`) as `${mon} ${day}, ${year}` — no `Date` or `Intl`, so no time zone can shift it.

`watchCreditDate`: a `disposed` flag and an `inFlight` flag; the tick returns early when either is set.

- [ ] **Step 4: Run to verify they pass, then the full gate**

Run: `cd web && npx vitest run tests/unit/metraCredit.test.ts tests/unit/labels.test.ts`
Expected: PASS.
Run: `cd web && npm test && npm run check && npm run test:e2e && cd .. && bash scripts/test-hooks.sh`
Expected: all green (nothing renders the new code yet, so e2e and hooks prove the label change broke nothing). A one-off e2e failure in an unrelated spec is known noise: re-run that spec alone before blaming this change.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/metraCredit.ts web/src/lib/live/feed.ts web/src/lib/labels.ts web/tests/unit/metraCredit.test.ts web/tests/unit/labels.test.ts
git commit -m "feat(web): Metra credit date — only Metra's real publish date, polled per session"
```

### Task 2: Footer on every page

**Files:**
- Modify: `web/src/routes/+layout.svelte` (effect, footer markup after `<main>`, style)
- Modify: `README.md` (UI glossary row)
- Test: `web/tests/e2e/practice.spec.ts`, `web/tests/e2e/login.spec.ts`, `web/tests/e2e/helpers.ts` (`stubLiveStatus`)

**Interfaces:**
- Consumes: `watchCreditDate`, `fetchStatus` (Task 1), `copy.notAffiliated`, `copy.timetablePublished`.
- Produces: `<footer class="col credit" data-testid="metra-credit">` whose text is `copy.notAffiliated`, followed by ` ${copy.timetablePublished} ${date}.` when the date is known.

- [ ] **Step 1: Write the failing e2e tests**

The test stack's `file:` timetable never yields a date, so tests that need one stub the status call with a
live answer. Put this helper in `helpers.ts`. `liveDay` (`day.svelte.ts:364`) also reads this endpoint for
the board's mode; the stub answers `schedule_only` with no fetch time, which is what the test stack and a
practice day report anyway, so the board is unchanged:

```ts
export const CREDIT_PUBLISHED = '11/14/26 02:20:03 AM America/Chicago';
/** Answers /api/metra/status as the live stack would, optionally after `delayMs`. */
export async function stubLiveStatus(page: Page, delayMs = 0) {
  const feed = { fetchedAt: null, ageSec: null, mode: 'schedule_only' };
  await page.route('**/api/metra/status', async (r) => {
    if (delayMs) await new Promise((res) => setTimeout(res, delayMs));
    await r.fulfill({ json: { source: 'live', revision: null, staticPublishedAt: CREDIT_PUBLISHED, staticSource: 'download',
      rtFetchedAt: null, rtAgeSec: null, mode: 'schedule_only', feeds: { positions: feed, tripupdates: feed, alerts: feed } } })
      .catch(() => {});   // the page may have moved on
  });
}
```

In `login.spec.ts` (add `import { copy } from '../../src/lib/labels';` and the helpers to the imports):

```ts
test('the Metra credit shows signed out without a date, signed in with it, and loses it at logout', async ({ page }) => {
  await page.goto('/login');
  const credit = page.getByTestId('metra-credit');
  await expect(credit).toHaveText(copy.notAffiliated);
  await stubLiveStatus(page);
  await login(page, 'E2E Credit', 'crew-test-password');
  await openHome(page, 'E2E Credit');
  await expect(credit).toHaveText(`${copy.notAffiliated} ${copy.timetablePublished} Nov 14, 2026.`);
  await page.getByTestId('menu').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(credit).toHaveText(copy.notAffiliated);
});

test('a status answer that lands after logout never shows its date', async ({ page }) => {
  await stubLiveStatus(page, 3000);
  await login(page, 'E2E Credit Late', 'crew-test-password');
  await openHome(page, 'E2E Credit Late');
  await page.getByTestId('menu').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/login$/);
  await page.waitForTimeout(3500);   // past the stubbed delay; a sleep is the point of this test
  await expect(page.getByTestId('metra-credit')).toHaveText(copy.notAffiliated);
});
```

In `practice.spec.ts`, using the existing `practise()` helper and the dated (longer, wrapping) text:

```ts
test('the Metra credit sits above the tab bar at the bottom of Live', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stubLiveStatus(page);
  await practise(page, 'E2E Practice Credit');
  await page.goto('/live');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  const credit = page.getByTestId('metra-credit');
  await expect(credit).toContainText('Nov 14, 2026');
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(async () => {
    const c = await credit.boundingBox(); const bar = await page.getByTestId('tab-bar').boundingBox();
    return c && bar ? bar.y - (c.y + c.height) : -1;
  }).toBeGreaterThanOrEqual(0);
  await expect(credit).toBeInViewport({ ratio: 1 });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx playwright test tests/e2e/login.spec.ts tests/e2e/practice.spec.ts -g "Metra credit|after logout"`
Expected: FAIL on a missing `metra-credit` element (not on an import or reference error).

- [ ] **Step 3: Implement** in `web/src/routes/+layout.svelte`:
  - `let creditDate = $state('')`; `const creditUser = $derived($auth.user?.id ?? '')`.
  - `$effect(() => { if (!creditUser) return; return untrack(() => watchCreditDate(fetchStatus, (d) => { creditDate = d; })); })` (`untrack` from `svelte`) — the effect's only reactive read is `creditUser`, so renewals, renames and clock revisions (which `authed()` reads synchronously) do not restart it; dispose clears the date on logout or a user change.
  - After `<main class="col">…</main>`: `<footer class="col credit" data-testid="metra-credit">{copy.notAffiliated}{#if creditDate} {copy.timetablePublished} {creditDate}.{/if}</footer>`.
  - Style: `.credit { font-size: 12px; line-height: 1.5; color: #888; padding-block: 32px 16px; }`.
  - README glossary, after the "Practice day" row: `| Metra credit | **Schedule from Metra’s public feed. Not affiliated with Metra. Timetable published …** | Plain | Footer on every page; Metra's license. The date shows only when signed in |`.

- [ ] **Step 4: Run to verify they pass, then the full gate**

Run: `cd web && npx playwright test tests/e2e/login.spec.ts tests/e2e/practice.spec.ts -g "Metra credit|after logout"`
Expected: PASS.
Run: `cd web && npm test && npm run check && npm run test:e2e && cd .. && bash scripts/test-hooks.sh`
Expected: all green. A one-off e2e failure in an unrelated spec is known noise: re-run that spec alone before blaming this change. Also confirm `layoutSweep.spec.ts` passes with the footer present.

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/+layout.svelte web/tests/e2e/login.spec.ts web/tests/e2e/practice.spec.ts web/tests/e2e/helpers.ts README.md
git commit -m "feat(web): Metra credit footer on every page"
```
