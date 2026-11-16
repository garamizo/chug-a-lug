# Closing Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the train home arrives, everyone gets an auto-playing highlight reel of the night: per stop in route
order — the stop, its most-Cheered photos, its most-Cheered message, the spikes won there, the drinks — then a finale.

**Architecture:** A pure `buildReel()` over today's feed, spikes and stop windows (`reel.ts`); a full-screen player
route `/live/closing` that the app layout treats as a presentation; a Live card plus a once-per-device automatic open
gated on a feed loaded after Closing Time.

**Tech Stack:** SvelteKit 5, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-closing-time-design.md`

## Global Constraints

- User-visible strings only in `web/src/lib/labels.ts`; README glossary is the source of truth for names.
- Labels verbatim: `closingCard: 'Closing Time — the night’s highlights'`, `closingPlay: 'Play'`,
  `closingNotYet: 'Closing Time starts when the train home arrives.'`, `closingLoading: 'Putting the night
  together…'`, `closingReplay: 'Watch again'`, `closingDone: 'Done'`, `closingFinale: 'That’s the night'`,
  `closingCrewTotal: 'drinks, all told'`, `closingCheers: 'Cheers'`.
- Limits: 2 photos (≥1 Cheers, else the single earliest photo) and 1 message (≥1 Cheers) per stop; won-once spikes
  grouped per stop; held hand-overs only on the finale.
- Durations (ms): title 3000, stop 3000, photo 4500, message 4000, spikes 3500, drinks 3000, finale 6000.
- Auto-open marker: `localStorage` `chugalug.closingShown`, key `{itineraryId}:{date}:{runId ?? ''}`, written when
  playback starts; guarded like `web/src/lib/live/seen.ts` with an in-memory fallback.
- Times are UTC; Chicago rendering only via `$lib/time.ts`.
- **Every task ends with the full gate** before commit: `cd web && npm test && npm run check && npm run test:e2e`,
  `npm run test:sim`, `bash scripts/test-hooks.sh`. One harness at a time (`ss -ltn | grep -E
  ':(15173|1809[0-5]|1252[56])\b'` empty first); never ports 8090/3000; explicit `git add`; never `--no-verify`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01DAa9224AnBt4iBP2FnF83m`.

## Review Focus

1. Caboose must reach the finale (stamped at `closedAt`, never re-cut) — Task 1.
2. A feed that hasn't loaded after Closing Time must never be snapshotted or marked shown — Tasks 2 and 4.
3. Closing the reel must never bring it back automatically, and Back/double-✕ must pop once — Tasks 3 and 4.
4. Nothing from the layout (banner, Bulletin, tab bar, spike celebration) may sit over or capture input from the
   reel — Task 3.
5. Practice day: windows use the same shift as `closedAt` — Task 1.

---

### Task 1: The reel builder

**Files:**
- Modify: `web/src/lib/live/current.ts` (export `stopTimings` = the existing private `timings`, unchanged; internal
  callers use it), `web/src/lib/labels.ts` (the closing labels)
- Create: `web/src/lib/live/reel.ts`
- Test: `web/tests/unit/reel.test.ts`, `web/tests/unit/current.test.ts`, `web/tests/unit/labels.test.ts`

**Interfaces (exact, from the spec):** `stopWindows(stops, legs, startAt: Date, shiftMs: number, closedAt: string)`,
`Slide`, `ReelInput`, `buildReel(input): Slide[]`, plus `REEL_DURATIONS: Record<Slide['kind'], number>`.

- [ ] **Step 1: Failing tests** named: `each stop plays stop, photos, message, spikes, drinks in route order`;
  `the top two Cheered photos, ties to the earliest`; `an uncheered stop shows its first photo`; `videos are skipped`;
  `the most Cheered message in the stop's window`; `no uncheered message`; `won-once spikes are grouped per stop and
  hand-overs are not replayed`; `caboose stamped at closing time reaches the finale`; `drinks slide counts and is
  skipped when empty`; `rows at or after closing time and other days are left out`; `a Cheers after closing time
  counts`; `shuffled input gives the same reel`; `stopWindows follows stopTimings and ends at closing time`;
  `stopWindows applies the practice shift`; current.test: `stopTimings matches the old timings` (existing timing
  tests now import it); labels verbatim.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** full gate.
- [ ] **Step 5: Commit** `feat(live): a highlight reel worked out from the night`.

### Task 2: Ready to build — feed scope and the auto-open decision

**Files:**
- Modify: `web/src/lib/live/day.svelte.ts` (record `feedScope` — the `scopeKey` of the last successful `loadFeed` —
  and `feedLoadedAt` — the activity-clock instant it finished; `feedError` stays)
- Create: `web/src/lib/live/closing.ts`
- Test: `web/tests/unit/closing.test.ts`, `web/tests/unit/liveDay.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ClosingScope = { itinerary: string; date: string; runId: string | null };
  export const closingKey: (s: ClosingScope) => string;           // `${itinerary}:${date}:${runId ?? ''}`
  export function reelReady(day: { closedAt: string | null; feedScope: string | null; scopeKey: string; feedLoadedAt: string | null }): boolean;
  export function shouldAutoOpen(o: { ready: boolean; shown: boolean; overlayOpen: boolean; quiet: boolean }): boolean;
  export function closingStore(): { has(key: string): boolean; add(key: string): void }; // localStorage + memory
  ```
  `reelReady`: closedAt set, `feedScope === scopeKey`, and `feedLoadedAt >= closedAt`.

- [ ] **Step 1: Failing tests:** liveDay records `feedScope`/`feedLoadedAt` only on success, keeps them on a failed
  read, and drops them on a scope change; `reelReady` false before Closing Time, false for a feed loaded before it,
  false for another scope, true after; `shouldAutoOpen` truth table; `closingStore` persists, survives throwing
  storage via memory.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** full gate.
- [ ] **Step 5: Commit** `feat(live): know when the night's reel can be built`.

### Task 3: The player and the presentation state

**Files:**
- Create: `web/src/routes/(app)/live/closing/+page.svelte`, `web/src/lib/components/ClosingReel.svelte`,
  `web/src/lib/components/SpikeArt.svelte` (extracted from `SpikeCelebration.svelte`, which then uses it)
- Modify: `web/src/routes/(app)/+layout.svelte` (on `/live/closing`: no banner, pinned Bulletin, tab bar, composer;
  the spike celebration paused), `web/src/lib/live/day.svelte.ts` only if a helper is needed for the shift
- Test: `web/tests/e2e/closing.spec.ts` (new; the player-only cases), `web/tests/e2e/layoutSweep.spec.ts`

**Interfaces:**
- Consumes: `buildReel`, `stopWindows`, `REEL_DURATIONS` (Task 1); `reelReady` (Task 2); `liveDay.closedAt`,
  `liveDay.spikeEvents`, `liveDay.feed`, `liveDay.loadFeed`, `liveDay.feedError`.
- Behaviour exactly as the spec's "The player" section: dialog role and focus; snapshot once ready; loading line
  (`reel-loading`) and No signal + Try again (`reel-retry`); not-yet line when closedAt is null; tap thirds, hold,
  keys; ✕/Done go back once if the previous entry is Live in this session, else `goto('/live', { replaceState: true
  })`; Watch again; image-failure skip; reduced motion.

- [ ] **Step 1: Failing e2e** (player only; reaching Closing Time is Task 4): direct entry before Closing Time shows
  `copy.closingNotYet` and a link to Live; with the feed failing (route the feed GETs) after Closing Time the player
  shows Try again, and it recovers when unrouted — if this needs Task 4's seed, write it in Task 4 instead and say so.
  layoutSweep line: the reel page (not-yet state is acceptable here; Task 4 adds the playing state if cheap).
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** full gate.
- [ ] **Step 5: Commit** `feat(live): play the night as a reel`.

### Task 4: Opening at Closing Time, the end-to-end night, docs

**Files:**
- Modify: `web/src/routes/(app)/live/+page.svelte` (the `closing-card` with `closing-play`; the automatic open via
  `shouldAutoOpen`, deferred while a sheet, the Lightbox, the Tab or the composer is open, marker written by the
  player when playback starts), `web/tests/e2e/helpers.ts` (`seedLockedCrawl({ withRunHome: true })` → stops whose
  recompute yields a resolved closing leg on the fixture GTFS; waits for the recompute; returns `homeArrival`),
  `README.md`, `docs/FEATURES.md`, `docs/ROADMAP.md`
- Test: `web/tests/e2e/closing.spec.ts`, `web/tests/e2e/layoutSweep.spec.ts` (playing reel)

- [ ] **Step 1: Failing e2e** (`closing.spec.ts`): seed with `withRunHome`, seed two drinks, a photo with a Cheers and
  a Cheered message before `homeArrival` (superuser, event date); `page.clock` past `homeArrival`; open Live →
  `closing-card` shows and the reel opens by itself once; tapping the right third advances; the Cheered photo slide
  and `reel-slide-finale` appear; ✕ returns to Live and the reel does not reopen; reopen with Play, browser Back
  returns to Live; a double ✕ pops only once. layoutSweep line for the playing reel.
- [ ] **Step 2:** FAIL. **Step 3:** implement + docs (README Closing Time row; FEATURES bullet; ROADMAP M5 note).
- [ ] **Step 4:** full gate. Rerun a failing spec once; report both outcomes.
- [ ] **Step 5: Commit** `feat(live): Closing Time opens when the train home arrives`.
