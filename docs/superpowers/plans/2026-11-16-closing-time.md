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
2. A feed read that started before Closing Time must never certify the reel; nothing unplayed is marked shown —
   Tasks 2, 3 and 4.
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

### Task 2: Ready to build — a read after Closing Time, and the auto-open decision

**Files:**
- Modify: `web/src/lib/live/day.svelte.ts`
- Create: `web/src/lib/live/closing.ts`
- Test: `web/tests/unit/closing.test.ts`, `web/tests/unit/liveDay.test.ts`

**Readiness without comparing clocks** (Codex plan review: `feedLoadedAt >= closedAt` mixes clocks, and four
concurrent requests can straddle the boundary). In `liveDay`:
- a public read-only `closingScope: ClosingScope | null` (`{ itinerary, date, runId }` with `runId` from
  `clientClock.runId`; null without an itinerary or a known clock);
- `closingRead: number | null` — when `closedAt` turns non-null for the current closing scope, liveDay starts a fresh
  `loadFeed()` and records that request's number (`feedRead`) as `closingRead`;
- `feedOkRead: number` — the request number of the last `loadFeed` whose result was accepted (inside the existing
  publication guard, never from optimistic upserts or stale responses);
- `get reelReady(): boolean` — `closedAt !== null && closingRead !== null && feedOkRead >= closingRead`;
- a scope change, a clock revision (seek) or `closedAt` going back to null resets `closingRead` (and the next
  non-null `closedAt` starts a new qualifying read).

**Interfaces:**
- Produces in `closing.ts`:
  ```ts
  export type ClosingScope = { itinerary: string; date: string; runId: string | null };
  export const closingKey: (s: ClosingScope) => string;           // `${itinerary}:${date}:${runId ?? ''}`
  export function shouldAutoOpen(o: { ready: boolean; shown: boolean; leftThisSession: boolean; overlayOpen: boolean; quiet: boolean }): boolean;
  export function closingStore(): { has(key: string): boolean; add(key: string): void }; // localStorage + memory
  export const closingSession: { left: Set<string> };              // in-memory only: reels entered and left unplayed
  ```

- [ ] **Step 1: Failing tests:** liveDay — `reelReady` false before Closing Time; a load in flight when Closing Time
  is reached does not make it ready (only the read started after it does); a failed qualifying read keeps it false
  and a later success makes it true; a stale response for an old scope or run never certifies; a seek resets it; a
  run change resets it; `closingScope` includes the run id. `shouldAutoOpen` truth table (including
  `leftThisSession`); `closingStore` persists and falls back to memory when storage throws.
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
- Consumes: `buildReel`, `stopWindows`, `REEL_DURATIONS` (Task 1); `liveDay.reelReady`, `closingScope`,
  `closingStore`, `closingSession` (Task 2); `liveDay.closedAt`,
  `liveDay.spikeEvents`, `liveDay.feed`, `liveDay.loadFeed`, `liveDay.feedError`.
- Behaviour exactly as the spec's "The player" section: dialog role and focus; snapshot once ready; loading line
  (`reel-loading`) and No signal + Try again (`reel-retry`); not-yet line when closedAt is null; tap thirds, hold,
  keys; ✕/Done go back once if the previous entry is Live in this session, else `goto('/live', { replaceState: true
  })`; Watch again; image-failure skip; reduced motion.

- Leaving the player before playback started (✕, Done, Back during loading or retry) adds its key to
  `closingSession.left`; playback starting writes `closingStore`.
- Unit-test what can be pure: slide timing/advance/back/pause state as a small controller (`reelPlayer.ts`) with a
  fake clock, and image-failure skip.

- [ ] **Step 1: Failing tests:** the controller unit tests; ordinary e2e: direct entry before Closing Time shows
  `copy.closingNotYet` and a link to Live; the layout shows no tab bar, banner or pinned Bulletin on
  `/live/closing`. layoutSweep line: the reel page in its not-yet state. (Playing-state e2e is Task 4.)
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** full gate.
- [ ] **Step 5: Commit** `feat(live): play the night as a reel`.

### Task 4: Opening at Closing Time, the night end to end, docs

**Files:**
- Modify: `web/src/routes/(app)/live/+page.svelte` (the `closing-card` with `closing-play`; the automatic open via
  `shouldAutoOpen(ready: liveDay.reelReady, shown: closingStore().has(key), leftThisSession, overlayOpen: a sheet,
  the Lightbox, the Tab or the composer is open, quiet)`), `README.md`, `docs/FEATURES.md`, `docs/ROADMAP.md`
- Create: `web/tests/sim/closing.spec.ts` (simulation suite, `npm run test:sim`, `playwright.sim.config.ts`)
- Test: also `web/tests/e2e/layoutSweep.spec.ts` only if the playing reel can be reached there cheaply; otherwise a
  layout check inside the sim spec using `layoutRules.ts`

**Why the simulation suite:** the server stamps drinks and media with its own event clock (`live.pb.js`; only chat
accepts a superuser `at`), and Live reads the server's day (`/api/day`). Only the simulation harness moves the server
clock, so it is the one place a whole night — activity, then the train home — can happen in order.

**Seed (proven by the plan review against the fixture GTFS):** a locked route on the simulation's event date, Board
at Aurora, start 11:00 local, two stops at CUS (Union Station), each dwell 5 min and walk 4 min, no hand-written
legs — create the stops and wait for the recompute until the closing leg exists (`to_stop = ''`, kind train); its
`arrive_at` (BN3, ~20:42Z on the fixture day) is `homeArrival`.

- [ ] **Step 1: Failing sim spec:** set the simulation clock inside the first stop's window; as crew (through the
  API or UI, so the server stamps event time): two drinks (Tab with photos via `tapDrink` or proof uploads), one more
  photo, one message; as a second crew member, Cheers the photo and the message; assert the stamped `at` values are
  before `homeArrival`. Advance the simulation clock past `homeArrival`; open Live → `closing-card`; the reel opens by
  itself once (`closing-reel`); tap right third advances; hold pauses; ←/→/Space/Escape work; the Cheered photo slide
  and `reel-slide-finale` appear; ✕ returns to Live and it does not reopen; Play then browser Back returns to Live; a
  double ✕ pops once; leaving during loading (route the feed GET to hang, then ✕) does not auto-open again this
  session and does not mark it shown; with the feed failing, Try again recovers; `emulateMedia({ reducedMotion:
  'reduce' })` still plays; while the reel plays, a fresh Golden Spike for this phone does not show its celebration
  over it; the automatic open waits while the Tab sheet is open.
- [ ] **Step 2:** FAIL. **Step 3:** implement + docs (README Closing Time row; FEATURES bullet; ROADMAP M5 note).
- [ ] **Step 4:** full gate. Rerun a failing spec once; report both outcomes.
- [ ] **Step 5: Commit** `feat(live): Closing Time opens when the train home arrives`.
