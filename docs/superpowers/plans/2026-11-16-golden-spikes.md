# Golden Spikes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seven computed awards (Pathfinder, Big Boy, Caboose, Triple Header, Full Consist, Whistle Stop, Railfan)
that post to Crew Chat, celebrate on the winner's phone only, and show as a laurel + count on the Crew Board.

**Architecture:** A pure `spikes()` timeline over today's drinks, photos and messages, cut at Closing Time
(`liveDay.closedAt`). Chat maps events to entries; a pure celebration queue decides what the winner sees; the Crew
Board tallies held/won spikes. Nothing is stored server-side.

**Tech Stack:** SvelteKit 5, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-16-golden-spikes-design.md`

## Global Constraints

- User-visible strings only in `web/src/lib/labels.ts`; README glossary is the source of truth for names.
- Labels verbatim: `spikeAuthor: 'Golden Spike'`; names `spikePathfinder: 'Pathfinder'`, `spikeBigBoy: 'Big Boy'`,
  `spikeCaboose: 'Caboose'`, `spikeTriple: 'Triple Header'`, `spikeFullConsist: 'Full Consist'`,
  `spikeWhistleStop: 'Whistle Stop'`, `spikeRailfan: 'Railfan'`; meanings `spikePathfinderWhy: 'First to log it
  today'`, `spikeBigBoyWhy: 'Most drinks'`, `spikeCabooseWhy: 'Fewest drinks'`, `spikeTripleWhy: 'Three drinks at one
  station'`, `spikeFullConsistWhy: 'One of each'`,
  `spikeWhistleStopWhy: 'Most messages'`, `spikeRailfanWhy: 'Most photos'`; glue `spikeFirst: 'first'`,
  `spikeTakesFrom: 'takes it from'`, `spikeLaurel: 'Golden Spikes'`.
- Thresholds (named constants): Big Boy 3 alcoholic drinks, Whistle Stop 5 messages, Railfan 3 photos. Alcohol =
  shot, cocktail, beer. Tab kinds = shot, cocktail, beer, water, food.
- Celebration window 10 minutes of the live clock; key `{itineraryId}:{date}:{runId ?? ''}:{userId}:{eventId}`;
  storage key `chugalug.celebratedSpikes`, guarded like `web/src/lib/live/seen.ts`; prune keys older than two days.
- Times are UTC; Chicago rendering/dates only via `$lib/time.ts`.
- One test harness at a time (`ss -ltn | grep -E ':(15173|1809[0-5]|1252[56])\b'` empty first); never ports
  8090/3000; explicit `git add`; never `--no-verify`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01DAa9224AnBt4iBP2FnF83m`.

## Review Focus

1. Two phones with the same rows in different arrival order must show the same spikes — shuffled-input test, Task 1.
2. Practice day: Closing Time must land on today's activity clock, not the plan date — Task 2 (DST case too).
3. A celebration queued behind another that is undone before showing must never play — Task 4.
4. A phone opened hours later must not replay old awards — Task 4 (10-minute window every pass).
5. Removing "First of the day"/"took the lead" milestones must not break existing chat e2e (`liveUx.spec.ts:163`) —
   Task 3 rewrites them to spikes.

---

### Task 1: The spikes timeline

**Files:**
- Create: `web/src/lib/live/spikes.ts`
- Modify: `web/src/lib/labels.ts` (all spike labels)
- Test: `web/tests/unit/spikes.test.ts`, `web/tests/unit/labels.test.ts`

**Interfaces:**
- Produces (exact, from spec): `SpikeKind`, `SpikeEvent {id, kind, user, name, at, created, order, detail?, from?}`,
  `SpikeInput {drinks, media, messages, stops: Pick<Stop,'id'|'station_id'>[], date, closedAt: string | null}`,
  `spikes(input): SpikeEvent[]` (sorted like chat: at, created, order, id), `spikeTally(events): Map<string,
  SpikeKind[]>` (won-once spikes plus held spikes whose latest hand-over is to that user; Caboose per winner),
  `SPIKE_LABELS: Record<SpikeKind, { name: string; why: string }>` built from `copy`.
- Ids exactly as in the spec ("Event ids are built from the row that triggered the award").

- [ ] **Step 1: Failing tests** (`spikes.test.ts`), named: `pathfinder goes to the first of each kind`;
  `big boy needs three drinks and passes only on a strict overtake`; `a tie stays with the holder`;
  `whistle stop and railfan use the same held rule`; `railfan counts images that are not drink photos`;
  `triple header counts three drinks at one station across two stops`; `full consist completes all five kinds`;
  `caboose waits for closing time, counts takers-part only, and ties share it`; `rows after closing time do not
  count`; `other days are ignored`; `ids survive deleting an earlier row`; `shuffled input gives the same spikes`;
  `undoing the deciding drink removes its spike`; `spikeTally counts won and currently held spikes`.
  Labels test: every label verbatim.
- [ ] **Step 2:** `cd web && npx vitest run tests/unit/spikes.test.ts tests/unit/labels.test.ts` → FAIL.
- [ ] **Step 3:** implement (reuse `drinkOrder` semantics from `milestones.ts`; export it from one place if both need
  it).
- [ ] **Step 4:** PASS; `npm test && npm run check`.
- [ ] **Step 5: Commit** `feat(live): Golden Spikes are worked out from the night`.

### Task 2: Closing Time on the activity clock

**Files:**
- Modify: `web/src/lib/live/planClock.ts` (`planToActivityDay(plan: Date, eventDate: string, today: string): string`),
  `web/src/lib/live/day.svelte.ts` (`get closedAt(): string | null`)
- Test: `web/tests/unit/planClock.test.ts`, `web/tests/unit/liveDay.test.ts`

**Interfaces:**
- Consumes: `closingLeg`, `crawlEnd` (`web/src/lib/live/current.ts`), `projectToPlanDate`.
- Produces: `liveDay.closedAt` — null unless `here.source === 'after'` and the closing leg exists and is not
  impossible; event day → `crawlEnd.at` ISO; practice day → same Chicago wall-clock time on `liveDay.today`.

- [ ] **Step 1: Failing tests:** `planToActivityDay` identity on the event day; a practice day before and after the
  event date; across a DST change (e.g. event date in winter, practice in early November). `liveDay.closedAt`: null
  before `after`; null with no closing leg (legacy); null with an impossible closing leg; ISO once home on the event
  day; mapped on a practice day.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** PASS; `npm test && npm run check`.
- [ ] **Step 5: Commit** `feat(live): Closing Time on the day's own clock`.

### Task 3: Spikes in Crew Chat; milestones slimmed

**Files:**
- Modify: `web/src/lib/live/milestones.ts` (drop first-of-day and lead notes; first photo at a stop ignores media
  with `drink_kind`), `web/src/lib/live/chat.ts` (`spikeEntries(events): ChatEntry[]`, `kind: 'spike'`, author
  `copy.spikeAuthor`), `web/src/lib/components/CrewChat.svelte` (merge `spikeEntries(spikes({...}))` with
  `liveDay.closedAt`; gold accent for `kind === 'spike'`), `web/src/lib/labels.ts` (remove `milestoneFirst`,
  `milestoneLead` if unused)
- Test: `web/tests/unit/milestones.test.ts`, `web/tests/unit/chat.test.ts`, `web/tests/e2e/liveUx.spec.ts`
  (`:163` "the first beer is celebrated in chat…" → expects the Pathfinder spike line), any other e2e asserting
  `copy.milestoneFirst` / `copy.milestoneLead` (grep).

**Interfaces:**
- Consumes: `spikes`, `SPIKE_LABELS` (Task 1), `liveDay.closedAt` (Task 2).
- Produces: `spikeEntries(events: SpikeEvent[]): ChatEntry[]` — body formats: Pathfinder `🏅 {name} · {winner} —
  {spikeFirst} {icon} {kind label}`; held hand-over `🏅 {name} · {winner} {spikeTakesFrom} {previous}` (first holder:
  `🏅 {name} · {winner}`); others `🏅 {name} · {winner}`.

- [ ] **Step 1: Failing tests:** milestones no longer emit first/lead, still emit totals and first photo, first photo
  skips a drink photo; `spikeEntries` bodies for each shape; liveUx e2e expects the Pathfinder line.
- [ ] **Step 2:** FAIL. **Step 3:** implement. **Step 4:** `npm test && npm run check`, then the touched e2e specs.
- [ ] **Step 5: Commit** `feat(live): Golden Spikes post to Crew chat`.

### Task 4: The winner's celebration

**Files:**
- Create: `web/src/lib/live/celebrate.ts`, `web/src/lib/components/SpikeCelebration.svelte`
- Modify: `web/src/routes/(app)/+layout.svelte` (mount once; pass scope and `quiet`), `web/tests/e2e/layoutSweep.spec.ts`
  (one line: the overlay)
- Test: `web/tests/unit/celebrate.test.ts`, `web/tests/e2e/spikes.spec.ts` (new)

**Interfaces:**
- Produces:
  ```ts
  export type CelebrationScope = { itinerary: string; date: string; runId: string | null; user: string };
  export class CelebrationQueue {
    constructor(deps: { now: () => Date; store: { read(): Set<string>; add(key: string): void } });
    /** Recompute from the current timeline; returns the event to show now, or null. */
    next(events: SpikeEvent[], scope: CelebrationScope | null, quiet: boolean): SpikeEvent | null;
    /** The overlay started showing this event: mark it. */
    shown(event: SpikeEvent, scope: CelebrationScope): void;
    reset(): void;
  }
  export function celebrationStore(): { read(): Set<string>; add(key: string): void }; // localStorage + memory
  ```
  Rules exactly as in the spec's "The animation" section (identity, 10-minute window each pass, present at show time,
  marking at start, storage fallback and pruning, teardown on scope change and `quiet`).

- [ ] **Step 1: Failing tests:** `celebrate.test.ts` with a fake clock and a memory store: only mine; another
  day/route/run/user is a new key; older than 10 minutes never shows (also on a later pass); a queued event that
  vanishes before its turn is dropped and not marked; an empty timeline marks nothing and shows nothing; storage that
  throws falls back to memory; `quiet` and a scope change clear the queue. e2e `spikes.spec.ts`: two phones; one
  taps the first beer (with a photo, `tapDrink`) → the Pathfinder line shows in chat on both, the overlay
  (`spike-celebration`) only on the tapper's, and not again after reload. layoutSweep line for the overlay.
- [ ] **Step 2:** FAIL. **Step 3:** implement (overlay: spike name, meaning, ~2.5 s, tap to dismiss,
  `prefers-reduced-motion` fades only). **Step 4:** `npm test && npm run check`, then the new e2e and layoutSweep.
- [ ] **Step 5: Commit** `feat(live): the winner sees their Golden Spike`.

### Task 5: Crew Board laurels, docs, full gate

**Files:**
- Modify: `web/src/routes/(app)/crew/+page.svelte` (load today's media and chat messages for the route like
  `liveDay.loadFeed`; `spikeTally(spikes({... stops: liveDay.stops, closedAt: liveDay.closedAt}))`; laurel SVG
  `data-testid="spike-laurel"` + count when > 0; accessible label `{spikeLaurel}: {names}`; subscribe to `media` and
  `chat_messages` too), `README.md` (Golden Spikes glossary row lists the seven names), `docs/FEATURES.md` (Golden
  Spikes bullet; Crew chat bullet mentions spikes instead of firsts/lead), `docs/ROADMAP.md` (Golden Spikes item)
- Test: `web/tests/e2e/crew.spec.ts` (a person with a Pathfinder shows a laurel with 1)

- [ ] **Step 1:** failing e2e. **Step 2:** implement + docs.
- [ ] **Step 3: Full gate:** `cd web && npm test && npm run check && npm run test:e2e`, `npm run test:sim`,
  `bash scripts/test-hooks.sh`. Rerun a failing spec once; report both outcomes.
- [ ] **Step 4: Commit** `feat(crew): a laurel and a count for each Golden Spike`.
