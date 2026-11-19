# Sheet Close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the footer "Close" buttons on the stop and venue sheets with one round X that straddles the sheet's top edge, shared with the Tab sheet.

**Architecture:** A `SheetClose` component wraps `IconButton` in an absolutely positioned holder raised across the top border. The two `<dialog>` sheets stop scrolling themselves: the dialog becomes `overflow: visible` and an inner `.body` scrolls, so the raised X is not clipped.

**Tech Stack:** Svelte 5, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-19-sheet-close-design.md`

## Global Constraints

- X: 40px round, `IconButton` icon `close`, solid fill in the sheet colour and the sheet border; centre on the top border, its right edge 12px in from the sheet's right edge.
- Stop/venue sheets: Back and Escape still close them; no tap-outside close is added.
- Accessible names unchanged: `copy.closeSheet` (stop, venue) and `copy.closeTab` (Tab). No new strings.
- Test IDs move to the X: `sheet-close`, `venue-sheet-close`, `tab-close`.
- Lightbox, ClosingReel, RoleWindow and the TabHost inline ✕ are untouched.

## Review Focus

- A long stop sheet scrolled to the bottom: the X stays pinned at the top edge (it lives outside the scroller) and stays tappable.
- Swipe left/right on the stop sheet still pages stops (touch handlers stay on the dialog).
- The Lightbox opened over the stop sheet still covers the raised X: both are in the top layer, the Lightbox later.
- The X must not overlap StopSheet's `›` (`sheet-next`) button, so `sheet-next` stays clickable (liveUx already clicks it).
- The layout sweep must not report the X as `covered`/`text-spill`.

---

### Task 1: SheetClose on all three sheets

**Files:**
- Create: `web/src/lib/components/SheetClose.svelte`
- Modify: `web/src/lib/components/TabSheet.svelte`, `StopSheet.svelte`, `VenueSheet.svelte`
- Test: `web/tests/e2e/helpers.ts`, `liveUx.spec.ts` (~L44-49), `planning.spec.ts` (~L50), `chat.spec.ts`, `layoutSweep.spec.ts`

**Interfaces:**
- Produces: `SheetClose` props `{ label: string; onclick: () => void; testid: string }`. The parent must be a positioned box (`position: relative` on the dialog, or the Tab's `position: fixed`).

- [ ] **Step 1: Write the failing tests**

In `web/tests/e2e/helpers.ts` add `expectRaisedClose(page: Page, sheetId: string, closeId: string, bodyId?: string): Promise<void>`. It asserts that:
- the X's top is above the sheet's top and its bottom is below it;
- the gap from the X's right edge to the sheet's right edge is `>= 0` and `< 40`;
- `document.elementFromPoint(xCentre, sheetTop - 8)` resolves inside `[data-testid=closeId]`;
- when `bodyId` is given, it repeats that hit test after setting the body's `scrollTop = scrollHeight`.

Call it in:
- `liveUx.spec.ts` stop-sheet test with `('stop-sheet', 'sheet-close', 'stop-sheet-body')`. It replaces the old right-edge lines, and the `overscroll-behavior-y` assertion moves to `stop-sheet-body`.
- `planning.spec.ts` ~L50 with `('venue-sheet', 'venue-sheet-close', 'venue-sheet-body')`.
- Any one test that opens the Tab (e.g. `chat.spec.ts` before its `tab-close` click) with `('tab-sheet', 'tab-close')`.

In `layoutSweep.spec.ts` "Conductor pages", add `{ name: 'station picker, venue sheet', … }`. It opens `/plan/${ids.itineraryId}/add`, picks a station whose venues exist in the fixture (as `planning.spec.ts` does), clicks `venue-node-0`, and is ready on `venue-sheet`. If that fixture has no venues, use the draft from `planning.spec.ts`'s setup pattern instead.

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx playwright test liveUx planning chat layoutSweep`
Expected: the new assertions FAIL (the X is inside the sheet and `stop-sheet-body` does not exist). The venue sweep state may already pass.

- [ ] **Step 3: Implement**

- `SheetClose.svelte`: a `div.x` holder (`position: absolute; top: -20px; right: 12px; z-index: 2`) holding `<IconButton icon="close" size={40} …>`. Use `.x :global(button)` to set `background: #181818; border-color: #3a3a3a; box-shadow: 0 2px 8px #0008`. Keep one style for all three sheets (the Tab's `#1b1b1b`/`#444` differ by too little to matter).
- `TabSheet`: replace the `.close` div with `<SheetClose label={copy.closeTab} onclick={onclose} testid="tab-close" />` and drop the `.close` rule.
- `StopSheet`/`VenueSheet`: inside `{#if stop}`/`{#if venue}`, put `<SheetClose …>` first, then wrap the rest in `<div class="body" data-testid="stop-sheet-body">` (`venue-sheet-body`).
  - `.sheet` becomes `overflow: visible; position: relative; padding: 0; max-height: none`. It keeps its width, margins, border, radius, background, animation and backdrop.
  - `.body` gets the old padding (`8px 20px calc(20px + env(safe-area-inset-bottom))`), `max-height: 88dvh`, `overflow-y: auto`, `overscroll-behavior: contain` and `border-radius: 22px 22px 0 0`.
  - Delete the footer Close buttons. Update StopSheet's footer comment: Website sits on the right, Edit on the left. VenueSheet's footer keeps Add stop.

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx playwright test liveUx planning liveEdit spikes crew chat layoutSweep`
Expected: PASS, including `planning.spec.ts`'s failed-add case (error inside the modal, Add re-enabled).

- [ ] **Step 5: Full gate**

Run: `cd web && npm test && npm run check && npm run test:e2e`, then `bash scripts/test-hooks.sh` from the repo root.
Expected: green, apart from failures already known to be red before this change (`offline.spec`, `sim:offline:6`). Confirm those by running them on `main`.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/components/SheetClose.svelte web/src/lib/components/TabSheet.svelte web/src/lib/components/StopSheet.svelte web/src/lib/components/VenueSheet.svelte web/tests/e2e/helpers.ts web/tests/e2e/liveUx.spec.ts web/tests/e2e/planning.spec.ts web/tests/e2e/chat.spec.ts web/tests/e2e/layoutSweep.spec.ts
git commit -m "feat(sheets): one X across the top edge replaces Close"
```
