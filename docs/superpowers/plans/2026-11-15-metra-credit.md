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
- Date shown only when `source === 'live'`, `staticSource` is `'download'` or `'cache'`, and `staticPublishedAt` matches `MM/DD/YY hh:mm:ss AM|PM <zone>`; formatted `Nov 14, 2026`, taken as written (no time-zone conversion).
- Refresh interval: 10 minutes (`600_000` ms).
- Tests before code; each task ends green: `cd web && npm test && npm run check && npm run test:e2e`, plus `bash scripts/test-hooks.sh` once at the end (no hook changes). Never run e2e/hooks while another worktree runs them (fixed ports).
- Stage explicit paths only; read `git status --short` before each commit.

## Review Focus

1. An answer arriving after logout (or after a user switch) must not show a date — unit test in Task 1.
2. Token renewal or a rename republishes `$auth.user`; it must not restart the watcher — the effect keys on `$auth.user?.id` (Task 2, code review; mirrors `(app)/+layout.svelte`).
3. On Live with the tab bar, the footer must sit fully above the bar after scrolling down — e2e in Task 2.
4. `12/31/26 11:59:59 PM America/Chicago` must read `Dec 31, 2026`, not roll into the next day — unit test in Task 1.
5. A failing status call (503 in a misconfigured simulation, offline) shows the credit without a date and no error — unit test in Task 1.

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
  - `watchCreditDate(fetchStatus: () => Promise<CreditStatus>, onDate: (date: string) => void, intervalMs = 600_000): () => void` — calls `fetchStatus` at once and every `intervalMs`; passes `creditDate(answer)` to `onDate`, or `''` when the call rejects; the returned dispose stops the timer, calls `onDate('')`, and ignores any answer still in flight.
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
});
```

Also in `web/tests/unit/labels.test.ts`, add: `expect(copy.notAffiliated).toBe('Schedule from Metra’s public feed. Not affiliated with Metra.')` and `expect(copy.timetablePublished).toBe('Timetable published')`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run tests/unit/metraCredit.test.ts tests/unit/labels.test.ts`
Expected: FAIL (module `metraCredit` not found; label mismatch).

- [ ] **Step 3: Implement** `creditDate` and `watchCreditDate` in `web/src/lib/metraCredit.ts`, extend `fetchStatus`'s type, and change the labels (keep the comment above `notAffiliated`, reworded to say the footer renders it).

`creditDate`: match `/^(\d{2})\/(\d{2})\/(\d{2}) \d{2}:\d{2}:\d{2} [AP]M\b/`, reject month outside 1–12 or day outside 1–31, year = 2000 + YY; format with a fixed English month table (`Jan`…`Dec`) as `${mon} ${day} ${year}` with the comma — no `Date` or `Intl`, so no time zone can shift it.

- [ ] **Step 4: Run to verify they pass**

Run: `cd web && npx vitest run tests/unit/metraCredit.test.ts tests/unit/labels.test.ts && npm run check`
Expected: PASS, 0 errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/metraCredit.ts web/src/lib/live/feed.ts web/src/lib/labels.ts web/tests/unit/metraCredit.test.ts web/tests/unit/labels.test.ts
git commit -m "feat(web): Metra credit date — only Metra's real publish date, polled per session"
```

### Task 2: Footer on every page

**Files:**
- Modify: `web/src/routes/+layout.svelte` (effect, footer markup after `<main>`, style)
- Modify: `README.md` (UI glossary row)
- Test: `web/tests/e2e/practice.spec.ts`, `web/tests/e2e/login.spec.ts`

**Interfaces:**
- Consumes: `watchCreditDate`, `fetchStatus` (Task 1), `copy.notAffiliated`, `copy.timetablePublished`.
- Produces: `<footer class="col credit" data-testid="metra-credit">` whose text is `copy.notAffiliated`, followed by ` ${copy.timetablePublished} ${date}.` when the date is known.

- [ ] **Step 1: Write the failing e2e tests**

In `login.spec.ts`:

```ts
test('the Metra credit shows signed out, without a date', async ({ page }) => {
  await page.goto('/login');
  const credit = page.getByTestId('metra-credit');
  await expect(credit).toHaveText(copy.notAffiliated);
  await expect(credit).not.toContainText(copy.timetablePublished);
});
```

In `practice.spec.ts`, using the existing `practise()` helper:

```ts
test('the Metra credit sits above the tab bar at the bottom of Live', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await practise(page, 'E2E Practice Credit');
  await page.goto('/live');
  await expect(page.getByTestId('tab-bar')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const credit = await page.getByTestId('metra-credit').boundingBox();
  const bar = await page.getByTestId('tab-bar').boundingBox();
  expect(credit!.y + credit!.height).toBeLessThanOrEqual(bar!.y);
  await expect(page.getByTestId('metra-credit')).toBeInViewport({ ratio: 1 });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx playwright test tests/e2e/login.spec.ts tests/e2e/practice.spec.ts -g "Metra credit"`
Expected: FAIL (no `metra-credit` element).

- [ ] **Step 3: Implement** in `web/src/routes/+layout.svelte`:
  - `let creditDate = $state('')`; `const creditUser = $derived($auth.user?.id ?? '')`.
  - `$effect(() => { if (!creditUser) return; return watchCreditDate(fetchStatus, (d) => { creditDate = d; }); })` — reading only `creditUser` so renewals do not restart it; dispose clears the date on logout.
  - After `<main class="col">…</main>`: `<footer class="col credit" data-testid="metra-credit">{copy.notAffiliated}{#if creditDate} {copy.timetablePublished} {creditDate}.{/if}</footer>`.
  - Style: `.credit { font-size: 12px; line-height: 1.5; color: #888; padding-block: 32px 16px; }`.
  - README glossary, after the "Practice day" row: `| Metra credit | **Schedule from Metra’s public feed. Not affiliated with Metra. Timetable published …** | Plain | Footer on every page; Metra's license. The date shows only when signed in |`.

- [ ] **Step 4: Run to verify they pass, then the full gate**

Run: `cd web && npx playwright test tests/e2e/login.spec.ts tests/e2e/practice.spec.ts -g "Metra credit"`
Expected: PASS.
Run: `cd web && npm test && npm run check && npm run test:e2e && cd .. && bash scripts/test-hooks.sh`
Expected: all green. A one-off e2e failure in an unrelated spec is known noise: re-run that spec alone before blaming this change. Also confirm `layoutSweep.spec.ts` passes with the footer present.

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/+layout.svelte web/tests/e2e/login.spec.ts web/tests/e2e/practice.spec.ts README.md
git commit -m "feat(web): Metra credit footer on every page"
```
