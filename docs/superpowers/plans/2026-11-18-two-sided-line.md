# Two-Sided Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw the route planner as one BNSF line with going stops left and return stops right (drag between the sides on a phone, both in full on a wide screen), replacing the unfolded out-and-back line.

**Architecture:** View-layer only. `LineMap.svelte` gains a second layout (`left` + `right` snippets, `panes` mode) beside today's `cell` layout, which the station picker keeps. `ItineraryView.svelte` renders one two-sided `LineMap` from `placement.rows[i].left/right` and owns the focused side. `StopRow.svelte` adapts to narrow cards with a container query. `placeStops`/`insertionIndex` and all data stay as they are.

**Tech Stack:** SvelteKit + Svelte 5 runes, TypeScript, Vitest (unit), Playwright (e2e, iPhone 13 profile, chromium).

**Spec:** `docs/superpowers/specs/2026-11-18-two-sided-line-design.md`

## Global Constraints

- User-visible strings live only in `web/src/lib/labels.ts` (`copy.inbound` = "Aurora → Chicago", `copy.outbound` = "Chicago → Aurora").
- Phone pane width: `(column − track) / 1.2`; track is `36px`. Minimum supported viewport 320 px.
- Cards narrower than about **260 px** put their corner buttons in their own row above the head.
- Wide mode: both panes in full, no horizontal scroll, when the `LineMap` itself is at least **640 px** wide (container query; the app column is max 760 px).
- Test ids: one `map-row-<stationId>` and one `station-dot-<stationId>` per station (no `-back-` variants, no `section-*`); tabs `side-left` / `side-right`; the panes viewport `line-viewport`.
- `ItineraryView` writes nothing itself; adding a stop still goes through `actions.add(stationId, side)`.
- Stage explicit paths; read `git status --short` before each commit. Never `git add -A`.
- Every task ends green: `cd web && npm test && npm run check && npm run test:e2e`, plus `bash scripts/test-hooks.sh`. One test run at a time across worktrees (ports 15173/18093/18090/18091/18095).

## Review Focus

1. **A tab tap on a wide screen** must still change which side a station tap adds to, although nothing scrolls (so `onscroll` never fires). Pinned in Task 3.
2. **Vertical scrolling with a finger/wheel over the line** must scroll the page, not get swallowed by the horizontal viewport. Pinned in Task 1.
3. **Coming back from the add screen after adding a return stop** must land on the right pane, not snap back to the left. Pinned in Task 4.
4. **A station with stops on both sides**: its dot sits between its two cards in one row, on every screen. Pinned in Task 1.
5. **The read-only views (`/route`, a crew member's `/plan/[id]`)** have no station dot buttons but still need tabs and dragging. Pinned in Task 1 (`station-dot-*` count 0 in `planning.spec.ts` stays) and Task 3.

---

### Task 1: One two-sided line with panes

**Files:**
- Modify: `web/src/lib/components/LineMap.svelte` (add the `left`/`right` layout and `panes` mode, keep `cell`)
- Modify: `web/src/lib/components/ItineraryView.svelte` (one `LineMap`, tabs, focused side; drop `halves`/`unfold`/turn divider)
- Modify: `web/src/lib/lineMap.ts` (remove `unfold`, `Section`, `SectionRow`, `sideOfSection`)
- Modify: `web/src/lib/labels.ts` (remove `turnAround`)
- Modify: `web/tests/unit/lineMap.test.ts` (remove the `unfold` describe block and its import)
- Modify: `web/tests/unit/labels.test.ts:48` (drop `'turnAround'` from the list)
- Modify: `web/tests/e2e/planning.spec.ts` (lines 74–93, 145, 177, 300–303)
- Modify: `web/tests/sim/rehearsal.spec.ts:108` (comment only: "The line's one dot per station; the focused side is the going side.")
- Modify: `web/tests/e2e/helpers.ts` (add `seedDraftRoute`)
- Create: `web/tests/e2e/twoSidedLine.spec.ts`

**Interfaces:**
- Produces (`LineMap.svelte` props): `stations: Station[]; color?: string; selected?: string; panes?: boolean; onpick?: (s: Station) => void; pickLabel?: (s: Station) => string; onside?: (side: Side) => void; cell?: Snippet<[Station, number]>; left?: Snippet<[Station, number]>; right?: Snippet<[Station, number]>`. `section` is removed. Layout is three-column when `left` or `right` is passed, else today's track + `cell`.
- Produces (`LineMap` export): `focusSide(next: Side, behavior: ScrollBehavior = 'smooth'): void` — calls `onside(next)` **immediately** (so it works when nothing scrolls), then scrolls the viewport to that pane if it overflows.
- Produces (markup): panes viewport `data-testid="line-viewport"` with `data-focused="left"|"right"`; cells carry classes `cell left` / `cell right`.
- Produces (`helpers.ts`): `seedDraftRoute(opts: { ownerName: string; eventDate: string; startTime: string; stops: { name: string; station_id: string; station_name: string; direction: 'out' | 'back'; photo?: boolean }[] }): Promise<{ itineraryId: string; stopIds: string[] }>` — creates a draft owned by `ownerName` (superuser, like `seedLockedCrawl`), stops with `order` 1..n in the given order, `dwell_min: 30`, `walk_min: 5`, `kind: 'bar'`; for `photo: true` it first creates a `places` record by multipart (`ref: 'google:e2e-<random>'`, `source: 'google'`, `name`, `photos`: a 1×1 PNG) and sets the stop's `place`.

- [ ] **Step 1: Write `seedDraftRoute` and the failing spec `twoSidedLine.spec.ts`**

The spec runs at `test.use({ viewport: { width: 320, height: 640 } })`, logs in as `'E2E Two Sides'` (admin password, as `planning.spec.ts` does), `clearRoutes()`, and seeds this draft on `2026-12-26`, `12:00` — crawl order:

| # | name | station | direction | photo |
|---|---|---|---|---|
| 0 | Going Naperville | NAPERVILLE | out | |
| 1 | Going La Grange | LAGRANGE | out | |
| 2 | Back One | NAPERVILLE | back | |
| 3 | Back Two | NAPERVILLE | back | yes |
| 4 | Back Three | NAPERVILLE | back | |

The seed runs in a `beforeEach` that stores its result in a module-level `let ids: { itineraryId: string; stopIds: string[] }`, then opens `/plan/${ids.itineraryId}/edit`. Tests (names exact):

```ts
test('going stops sit left of the line and return stops right, in one row per station', async ({ page }) => {
  const row = page.getByTestId('map-row-NAPERVILLE');
  await expect(page.getByTestId('map-row-back-NAPERVILLE')).toHaveCount(0);
  await expect(row.locator('.cell.left').getByTestId('stop-row-0')).toHaveAttribute('data-side', 'left');
  for (const i of [2, 3, 4]) await expect(row.locator('.cell.right').getByTestId(`stop-row-${i}`)).toHaveAttribute('data-side', 'right');
  const dot = await page.getByTestId('station-dot-NAPERVILLE').boundingBox();
  const going = await page.getByTestId('stop-row-0').boundingBox();
  const back = await page.getByTestId('stop-row-2').boundingBox();
  expect(going!.x + going!.width).toBeLessThanOrEqual(dot!.x + 1);
  expect(back!.x).toBeGreaterThanOrEqual(dot!.x + dot!.width - 1);
});

test('on a phone the focused side fills the line and the other peeks in', async ({ page }) => {
  const vp = page.getByTestId('line-viewport');
  const box = (await vp.boundingBox())!;
  const going = (await page.getByTestId('stop-row-0').boundingBox())!;
  expect(going.x).toBeGreaterThanOrEqual(box.x - 1);
  expect(going.x + going.width).toBeLessThanOrEqual(box.x + box.width + 1);
  const back = (await page.getByTestId('stop-row-2').boundingBox())!;
  expect(back.x).toBeLessThan(box.x + box.width);              // peeks in
  expect(back.x + back.width).toBeGreaterThan(box.x + box.width); // but is clipped
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});

test('a tab, a drag or a card on the other side switches sides', async ({ page }) => {
  const vp = page.getByTestId('line-viewport');
  await expect(page.getByTestId('side-left')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('side-right').click();
  await expect(vp).toHaveAttribute('data-focused', 'right');
  await expect.poll(() => vp.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  await vp.evaluate((el) => el.scrollTo({ left: 0 }));                       // a drag back
  await expect(page.getByTestId('side-left')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('stop-link-2').focus();                             // a card on the right
  await expect(page.getByTestId('side-right')).toHaveAttribute('aria-selected', 'true');
});

test('scrolling up and down over the line moves the page', async ({ page }) => {
  const box = (await page.getByTestId('line-viewport').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 40);
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd web && npx playwright test tests/e2e/twoSidedLine.spec.ts`
Expected: FAIL — `map-row-NAPERVILLE` has no `.cell.left`; `line-viewport` not found.

- [ ] **Step 3: Update `planning.spec.ts` to the single-row ids**

- Lines 78–80: replace the `section-back` visibility check and `station-dot-back-NAPERVILLE` click with `await page.getByTestId('side-right').click(); await page.getByTestId('station-dot-NAPERVILLE').click();`. Keep the `side=right` URL and `dir-back` assertions.
- Lines 85, 93: `map-row-back-NAPERVILLE` → `map-row-NAPERVILLE` (the `data-side='right'` assertion carries the side). Line 86 (`map-row-NAPERVILLE … stop-row-2` count 0) becomes `await expect(page.getByTestId('map-row-NAPERVILLE').locator('.cell.left').getByTestId('stop-row-2')).toHaveCount(0);`.
- Line 87's flow (going stop added via URL afterwards) is unchanged.
- Lines 145, 177: delete the `station-dot-back-LAGRANGE` lines (the `station-dot-LAGRANGE` count-0 lines stay).
- Lines 300–303: `section-out` → `line-viewport`.

- [ ] **Step 4: Implement the two-sided `LineMap`**

Restore the three-column row, `panes` viewport CSS, `onscroll` side detection and `onfocusin` from `git show 703ca91^:web/src/lib/components/LineMap.svelte`, with these changes: keep today's `cell` layout as the branch when neither `left` nor `right` is given (Schematic depends on it); `focusSide(next, behavior)` per Interfaces; `data-focused` on the viewport; `data-testid="line-viewport"`. The viewport must not become a vertical scroller: no fixed height, `overscroll-behavior-x: contain` only (never `overscroll-behavior: contain`), so wheel and vertical touch reach the page. Remove the `section` prop and `tid()`.

- [ ] **Step 5: Rewire `ItineraryView`**

Bring back `focused = $state<Side>('left')` and `map` (bound `LineMap`) from `703ca91^`. Above the map, a `role="tablist"` with two `role="tab"` buttons (`side-left` → `copy.inbound`, `side-right` → `copy.outbound`), `aria-selected` from `focused`, `onclick={() => map?.focusSide(side)}`. Render one `<LineMap panes … onside={(s) => (focused = s)} onpick={editable ? (s) => { rememberScroll(); actions.add(s.id, focused); } : undefined}>` with `left`/`right` snippets: a 36 px `.rowhead` holding the station label only on the focused side, then `{#each placement.rows[i].left|right as k}{@render card(k)}{/each}`. Delete `sections`, `halves`, the `.dir`/`.turn` markup and CSS. Off-line list unchanged. Remove the now-unused exports from `lineMap.ts`, `copy.turnAround`, and the matching unit-test lines.

- [ ] **Step 6: Run the new spec and the touched suites**

Run: `cd web && npm test && npm run check && npx playwright test tests/e2e/twoSidedLine.spec.ts tests/e2e/planning.spec.ts`
Expected: PASS.

- [ ] **Step 7: Full gate, then commit**

Run: `cd web && npm run test:e2e && npm run test:sim && cd .. && bash scripts/test-hooks.sh`
Expected: PASS. A failure that also fails on `main` (memory notes `offline.spec` red there) is recorded in the commit message, not fixed here.

```bash
git add web/src/lib/components/LineMap.svelte web/src/lib/components/ItineraryView.svelte web/src/lib/lineMap.ts web/src/lib/labels.ts web/tests/unit/lineMap.test.ts web/tests/unit/labels.test.ts web/tests/e2e/planning.spec.ts web/tests/sim/rehearsal.spec.ts web/tests/e2e/helpers.ts web/tests/e2e/twoSidedLine.spec.ts
git commit -m "feat(route): one line, going stops left and return stops right; drag between them on a phone"
```

### Task 2: Cards that fit a narrow pane

**Files:**
- Modify: `web/src/lib/components/StopRow.svelte` (styles only)
- Test: `web/tests/e2e/twoSidedLine.spec.ts`

**Interfaces:**
- Consumes: Task 1's seeded draft (stop 3, "Back Two", is a photographed middle stop with `up-3`, `down-3`, `remove-3`).

- [ ] **Step 1: Write the failing test**

```ts
test('a photographed middle stop fits its pane with room for its name', async ({ page }) => {
  await page.getByTestId('side-right').click();
  await expect(page.getByTestId('line-viewport')).toHaveAttribute('data-focused', 'right');
  await expect(page.getByTestId('stop-photo-3')).toBeVisible();
  const vp = (await page.getByTestId('line-viewport').boundingBox())!;
  const card = (await page.getByTestId('stop-row-3').boundingBox())!;
  expect(card.x).toBeGreaterThanOrEqual(vp.x - 1);
  expect(card.x + card.width).toBeLessThanOrEqual(vp.x + vp.width + 1);
  const name = (await page.getByTestId('stop-link-3').locator('strong').boundingBox())!;
  expect(name.width).toBeGreaterThanOrEqual(80);
  for (const id of ['up-3', 'down-3', 'remove-3']) {
    const b = (await page.getByTestId(id).boundingBox())!;
    const overlaps = b.x < name.x + name.width && name.x < b.x + b.width && b.y < name.y + name.height && name.y < b.y + b.height;
    expect(overlaps, id).toBe(false);
    expect(b.x + b.width).toBeLessThanOrEqual(card.x + card.width + 1);
  }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd web && npx playwright test tests/e2e/twoSidedLine.spec.ts -g 'photographed middle stop'`
Expected: FAIL on the name width (the head reserves 104 px).

- [ ] **Step 3: Make `.stop` a size container**

`container-type: inline-size` on `.stop`; inside `@container (max-width: 259px)`: `.corner` becomes `position: static` with `justify-content: flex-end` and a small bottom margin, and the head's right padding is `0` — written with selectors at least as specific as the existing `.stop:has(.corner > …) .head` rules. Nothing changes above 260 px.

- [ ] **Step 4: Run it to see it pass, plus the e2e suites that render cards**

Run: `cd web && npx playwright test tests/e2e/twoSidedLine.spec.ts tests/e2e/planning.spec.ts tests/e2e/liveEdit.spec.ts tests/e2e/layoutSweep.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full gate (as Task 1 Step 7), then commit**

```bash
git add web/src/lib/components/StopRow.svelte web/tests/e2e/twoSidedLine.spec.ts
git commit -m "feat(route): stop cards stack their buttons when a pane is narrow"
```

### Task 3: Both sides in full on a wide screen

**Files:**
- Modify: `web/src/lib/components/LineMap.svelte` (container query), `web/src/lib/components/ItineraryView.svelte` (label placement in wide mode)
- Test: `web/tests/e2e/twoSidedLine.spec.ts`

**Interfaces:**
- Consumes: `focusSide` calling `onside` immediately (Task 1).

- [ ] **Step 1: Write the failing tests**

In a `test.describe` with `test.use({ viewport: { width: 1024, height: 800 } })`, same seed and `/plan/<id>/edit`:

```ts
test('a wide screen shows both sides in full and nothing scrolls sideways', async ({ page }) => {
  const vp = page.getByTestId('line-viewport');
  expect(await vp.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
  const box = (await vp.boundingBox())!;
  for (const i of [0, 2]) {
    const c = (await page.getByTestId(`stop-row-${i}`).boundingBox())!;
    expect(c.x).toBeGreaterThanOrEqual(box.x - 1);
    expect(c.x + c.width).toBeLessThanOrEqual(box.x + box.width + 1);
  }
});

test('on a wide screen the tab still picks the side a station tap adds to', async ({ page }) => {
  await page.getByTestId('side-right').click();
  await expect(page.getByTestId('side-right')).toHaveAttribute('aria-selected', 'true');
  await page.getByTestId('station-dot-LAGRANGE').click();
  await expect(page).toHaveURL(/side=right/);
});

test('a read-only route still has both tabs and no station buttons', async ({ page }) => {
  await page.goto(`/plan/${ids.itineraryId}`);  // view screen, not editor
  await expect(page.getByTestId('side-right')).toBeVisible();
  await expect(page.locator('[data-testid^="station-dot-"]')).toHaveCount(0);
});
```

(The last test uses the 320 px viewport: put it in the phone describe block.)

- [ ] **Step 2: Run them to see them fail**

Run: `cd web && npx playwright test tests/e2e/twoSidedLine.spec.ts -g 'wide screen'`
Expected: FAIL — the viewport overflows at 1024 px.

- [ ] **Step 3: Add wide mode**

`container-type: inline-size` on the `LineMap` wrapper (a parent of the viewport, so the query sees the available width); in `@container (min-width: 640px)` the `.panes .map` width is `100%`, the row is `1fr track 1fr`, scroll snapping off. In `ItineraryView`, in wide mode the station label shows in the left cell only (right-aligned beside the line) regardless of `focused`; use a CSS rule under the same container query rather than JS width checks.

- [ ] **Step 4: Run to see them pass**

Run: `cd web && npx playwright test tests/e2e/twoSidedLine.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full gate, then commit**

```bash
git add web/src/lib/components/LineMap.svelte web/src/lib/components/ItineraryView.svelte web/tests/e2e/twoSidedLine.spec.ts
git commit -m "feat(route): both sides of the line in full on a wide screen"
```

### Task 4: Come back to the side you added on

**Files:**
- Modify: `web/src/lib/components/ItineraryView.svelte` (`rememberScroll` and its restore effect)
- Test: `web/tests/e2e/twoSidedLine.spec.ts`

**Interfaces:**
- Consumes: `focusSide(next, 'instant')` (Task 1).

- [ ] **Step 1: Write the failing test** (phone describe block)

```ts
test('after adding a return stop the right side is still in focus', async ({ page }) => {
  await page.route('**/api/places/nearby*', (r) => r.fulfill({ json: { venues: [] } }));
  await page.getByTestId('side-right').click();
  await page.getByTestId('station-dot-LAGRANGE').click();
  await expect(page).toHaveURL(/side=right/);
  await page.getByTestId('manual-name').fill('Back At La Grange');
  await page.getByTestId('manual-add').click();
  await expect(page).toHaveURL(/\/edit$/);
  await expect(page.getByTestId('line-viewport')).toHaveAttribute('data-focused', 'right');
  await expect(page.getByTestId('side-right')).toHaveAttribute('aria-selected', 'true');
});
```


- [ ] **Step 2: Run it to see it fail**

Expected: FAIL — `data-focused` is `left` after returning.

- [ ] **Step 3: Store the side with the scroll position**

`rememberScroll()` also stores `focused` under `` `side:/plan/${itinerary.id}` `` in `sessionStorage` (try/catch, as today). The restore effect reads and removes it, and after `tick()` calls `map?.focusSide(side, 'instant')` before `window.scrollTo`.

- [ ] **Step 4: Run to see it pass**, then the full gate.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/ItineraryView.svelte web/tests/e2e/twoSidedLine.spec.ts
git commit -m "feat(route): coming back from adding a stop keeps its side in focus"
```

### Task 5: Layout sweep and docs

**Files:**
- Modify: `web/tests/e2e/layoutSweep.spec.ts` (new test)
- Modify: `README.md` (glossary row "Midpoint of the unfolded line | Turn around" → remove it; add a row for the direction tabs if the glossary lists tabs), `docs/FEATURES.md:15-18`

- [ ] **Step 1: Add a sweep test with a populated return side**

```ts
test('a draft with stops on both sides', async ({ page }) => {
  await stubDepartures(page);
  await login(page, 'E2E Sweep Sides', ADMIN);
  await clearRoutes();
  const { itineraryId } = await seedDraftRoute({ ownerName: 'E2E Sweep Sides', eventDate: '2026-12-26', startTime: '12:00', stops: [
    { name: 'Going Naperville', station_id: 'NAPERVILLE', station_name: 'Naperville', direction: 'out' },
    { name: 'Back One', station_id: 'NAPERVILLE', station_name: 'Naperville', direction: 'back' },
    { name: 'Back Two', station_id: 'NAPERVILLE', station_name: 'Naperville', direction: 'back', photo: true },
    { name: 'Back Three', station_id: 'NAPERVILLE', station_name: 'Naperville', direction: 'back' }
  ] });
  await sweep(page, [
    { name: 'draft editor, going side', open: (p) => p.goto(`/plan/${itineraryId}/edit`), ready: (p) => p.getByTestId('stop-row-0') },
    { name: 'draft editor, return side', open: (p) => p.getByTestId('side-right').click(), ready: (p) => p.getByTestId('stop-row-2') }
  ]);
});
```

- [ ] **Step 2: Run it**

Run: `cd web && npx playwright test tests/e2e/layoutSweep.spec.ts`
Expected: PASS. A violation here is a real layout bug to fix in the component, not a rule to `skip`.

- [ ] **Step 3: Update the docs**

`docs/FEATURES.md`: the draft is laid out on one line; going stops (**Aurora → Chicago**) left of it and return stops (**Chicago → Aurora**) right of it, in their station's row; on a phone one side is in focus and the other peeks in (drag, tap a tab, or tap a card to switch), on a wide screen both show; tapping a station's circle adds a stop on the side in focus. Keep the rest of that bullet (crawl order, unserved stations, departures) as it is. README glossary: remove the **Turn around** row.

- [ ] **Step 4: Full gate, then commit**

```bash
git add web/tests/e2e/layoutSweep.spec.ts README.md docs/FEATURES.md
git commit -m "test(route): sweep a draft with both sides; docs describe the two-sided line"
```
