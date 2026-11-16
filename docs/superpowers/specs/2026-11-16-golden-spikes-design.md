# Golden Spikes — awards worked out from the night

Status: design, 2026-11-16. Branch `feat/golden-spikes`. Third of the four M5 branches (ride-home → photo-tab →
**golden-spikes** → closing-time).

## Intent

The user asked for awards that "appear during the trip, showing an animation when achieved". Their list: "the first
of each drink/food. More consumption, less consumption, hat trick (same station), one of each, more chatty, more
photos. We need to rename those." Then: "When someone achieve it, it should be posted on the chat. Animation is only on
the winner. And the crew board should show a laurel with the number next to the name."

The agreed set (railway names, README glossary **Golden Spikes**):

| Spike | Earned by | Kind |
|---|---|---|
| **Pathfinder** | First of each Tab kind today (one per kind: shot, cocktail, beer, NA, food) | won once |
| **Big Boy** | Most drinks (shots + cocktails + beers) | held — changes hands |
| **Caboose** | Fewest drinks, among the crew who logged anything | given only at Closing Time |
| **Triple Header** | Three drinks at one stop | won once per stop |
| **Full Consist** | One of each of the five Tab kinds | won once |
| **Whistle Stop** | Most crew chat messages | held |
| **Railfan** | Most photos (Freight that is not a Tab drink's photo) | held |

Spikes are finalised at Closing Time (the train home arriving, from the ride-home branch).

**Goals**
- Computed, never stored, exactly like milestones (`web/src/lib/live/milestones.ts:1-2`): every phone reads the same
  rows and tells the same story; an undone drink takes its spike with it.
- Each award posts one line in Crew Chat, replacing the "First of the day" and "took the lead" milestones.
- The winner's phone, and only the winner's, plays a short animation once per award.
- The Crew Board shows a laurel and a count next to each name that holds or has won spikes.

**Non-goals**
- Conductor-assigned awards (ROADMAP mentions them; later).
- The Hall of Fame scoreboard.
- The Closing Time reel (next branch) — it will reuse this branch's spike list.
- Push notifications.

**Anti-goals**
- A spike that differs between phones, or flickers between two people on a tie.
- An animation on everyone's phone, or the same animation replaying on every app open.

## How it works today (verified)

- `milestones(drinks, media, stops, date)` (`web/src/lib/live/milestones.ts:22-62`) walks today's drinks in
  `drinkOrder` (time, `action_order`, `created`, id) and emits `ChatEntry` rows (`kind: 'milestone'`) for: first of
  each kind (`copy.milestoneFirst`), crew totals 10/25/50/100, a strict-overtake lead change (`copy.milestoneLead`,
  using `compareScores` from `crew.ts`), and the first photo at each stop (`copy.milestonePhoto`).
- `CrewChat.svelte:27` merges them: `milestones(liveDay.feed.drinks, liveDay.feed.media, liveDay.stops,
  liveDay.today)`. `liveDay.feed` holds today's drinks, media, chat messages and reactions for the current route.
- The Crew Board (`web/src/routes/(app)/crew/+page.svelte`) loads users, today's drinks and acks itself, ranks with
  `crewScore`/`compareScores` (alcohol first, then NA, then food).
- Photo Tab (just merged): a Tab drink's photo is `media` with `drink_kind` set and the same id as the drink.
- Ride home (merged): `crawlEnd(stops, legs, startAt)` in `web/src/lib/live/current.ts` gives the home arrival, or
  `{ at: null, reason: 'no_run_home' }`; `currentStop` reports `source: 'after'` once home with fresh legs.
- Per-device markers live in `localStorage` behind try/catch (`web/src/lib/live/seen.ts`).

## Approaches considered

1. **A pure `spikes()` timeline, computed on every phone (chosen).** Same inputs as milestones plus chat messages and
   the closing time; emits ordered award events; chat, the Crew Board and the animation all read it.
2. Store awards in a collection written by a hook. Needs server logic mirroring the rules, breaks "undo takes it
   back", and adds migration and realtime work. Rejected — the user asked for them to be computed.
3. Fold spikes into `milestones()`. One function doing two jobs; the Crew Board would have to parse chat entries.
   Rejected.

## Design

### The timeline — `web/src/lib/live/spikes.ts`

```ts
export type SpikeKind = 'pathfinder' | 'bigboy' | 'caboose' | 'triple' | 'fullconsist' | 'whistlestop' | 'railfan';
export type SpikeEvent = {
  id: string;            // stable: see below
  kind: SpikeKind;
  user: string;          // winner
  name: string;          // winner's display name
  at: string; created: string; order: number;  // placement in chat, like milestones
  detail?: string;       // Pathfinder's Tab kind, Triple Header's stop id
  from?: string;         // held spikes: the previous holder's user id, if any
};
export type SpikeInput = {
  drinks: DrinkEntry[]; media: Media[]; messages: ChatMessage[];
  date: string;          // the server's today, as milestones use
  closedAt: string | null; // Closing Time (crawlEnd.at) once reached, else null
};
export function spikes(input: SpikeInput): SpikeEvent[];
/** Spikes each person holds now: won-once spikes, plus held spikes they currently hold. */
export function spikeTally(events: SpikeEvent[]): Map<string, SpikeKind[]>;
```

Rules, evaluated over today's rows (`todayInTz(at) === date`), and only rows with `at < closedAt` when `closedAt` is
set (Closing Time freezes the night):

- **Pathfinder** — for each Tab kind, the first drink of that kind in `drinkOrder`. Id `spike:pathfinder:{kind}`.
- **Big Boy** — walk drinks in order keeping each person's alcohol count. The first person to reach **3** takes it;
  afterwards it passes only on a strict overtake of the holder's count (ties stay with the holder). Each hand-over is
  an event; id `spike:bigboy:{n}:{user}` (n = 1, 2, …).
- **Whistle Stop** — same held rule over chat messages (`at`, then `created`, then id), threshold **5**. Id
  `spike:whistlestop:{n}:{user}`.
- **Railfan** — same held rule over media that has no `drink_kind`, threshold **3**. Id `spike:railfan:{n}:{user}`.
- **Triple Header** — a person's third alcoholic drink at one stop. Once per person per stop. Id
  `spike:triple:{user}:{stop}`.
- **Full Consist** — the drink that completes all five Tab kinds for a person. Id `spike:fullconsist:{user}`.
- **Caboose** — only when `closedAt` is set: among people with at least one Tab entry today, the fewest alcoholic
  drinks; every tied person wins. Placed at `closedAt`. Id `spike:caboose:{user}`.

Thresholds are named constants in `spikes.ts`. Legacy drinks (no photo) count like any other.

### Crew Chat

- A new `spikeEntries(events, labels)` maps each event to a `ChatEntry` with `kind: 'spike'`, author
  `copy.spikeAuthor` ("Golden Spike"), and a body like `🏅 Pathfinder · Ana — first 🍺 Beer`,
  `🏅 Big Boy · Ben takes it from Ana`, `🏅 Caboose · Cy`. Rendered like milestones (`CrewChat.svelte`), with a gold
  accent.
- `milestones()` drops the "First of the day" and lead-change notes (Pathfinder and Big Boy replace them). Crew totals
  stay. The first-photo-at-a-stop note ignores Tab drink photos (`drink_kind` set), so a drink's photo no longer
  doubles as a stop's first photo.
- `CrewChat.svelte` merges `spikeEntries(spikes({...liveDay.feed, date: liveDay.today, closedAt}))`, where
  `closedAt` is `crawlEnd(...).at` when `liveDay.here?.source === 'after'`, else null.

### The animation — winner's phone only

- `web/src/lib/components/SpikeCelebration.svelte`, mounted once in `(app)/+layout.svelte` (the layout owns the live
  day). It watches the same `spikes()` timeline and, for events whose `user` is the signed-in user and whose id this
  browser has not celebrated, shows a full-screen golden-spike overlay (spike name, its one-line meaning, ~2.5 s, tap
  to dismiss), one at a time, oldest first.
- Celebrated ids are kept per device in `localStorage` (`chugalug.celebratedSpikes`, guarded like `seen.ts`). An
  unreadable store means at worst one replay; nothing else depends on it.
- On the first run in a browser (no stored set yet), events older than 10 minutes are marked celebrated without
  playing, so opening the app late doesn't replay the whole night.
- `prefers-reduced-motion`: no motion; the overlay fades in and out.
- Not on practice-day screens other than Live (follows the layout's `quiet` rule); on the event day everywhere.

### Crew Board

- Loads today's media and chat messages for the route alongside drinks (same filters as `liveDay.loadFeed`), and the
  closing time from `liveDay`.
- Next to each name: a laurel (inline SVG, `data-testid="spike-laurel"`) and the count from `spikeTally`, shown only
  when the count is > 0; its accessible label lists the spike names (e.g. "Golden Spikes: Pathfinder, Big Boy").
- Ranking is unchanged.

### Labels (web/src/lib/labels.ts)

- `spikeAuthor: 'Golden Spike'`
- Names: `spikePathfinder: 'Pathfinder'`, `spikeBigBoy: 'Big Boy'`, `spikeCaboose: 'Caboose'`,
  `spikeTriple: 'Triple Header'`, `spikeFullConsist: 'Full Consist'`, `spikeWhistleStop: 'Whistle Stop'`,
  `spikeRailfan: 'Railfan'`
- Meanings (overlay and laurel tooltip): `spikePathfinderWhy: 'First to log it today'`,
  `spikeBigBoyWhy: 'Most drinks'`, `spikeCabooseWhy: 'Fewest drinks'`, `spikeTripleWhy: 'Three drinks at one stop'`,
  `spikeFullConsistWhy: 'One of each'`, `spikeWhistleStopWhy: 'Most messages'`, `spikeRailfanWhy: 'Most photos'`
- Chat glue: `spikeFirst: 'first'`, `spikeTakesFrom: 'takes it from'`, `spikeLaurel: 'Golden Spikes'`
- Remove `milestoneFirst` and `milestoneLead` if nothing else uses them.

README glossary: the **Golden Spikes** row gains the seven names; FEATURES.md gets a Golden Spikes bullet and the
Crew chat bullet loses "firsts, lead changes" in favour of spikes.

## Edge cases

- Undo or a Conductor photo delete removes the row; the timeline recomputes and the spike may move or vanish; the
  winner already saw the animation — accepted.
- Ties for held spikes stay with the holder; a tie for Caboose shares it.
- No run home (impossible) or the crawl not finished: no Closing Time, no Caboose, held spikes stay live.
- A drink after Closing Time (late Undo or a straggler) does not change the frozen result.
- Practice days: computed from the server's today like milestones; Closing Time comes from the practice timetable.
- Someone with only NA/food: eligible for Caboose (0 drinks), Pathfinder, Full Consist; not Big Boy.

## Tests

- Unit `web/tests/unit/spikes.test.ts`: each rule, thresholds, held hand-over on strict overtake only, tie stays,
  Caboose only with `closedAt` and shared on ties, freeze after `closedAt`, other days ignored, proof photos excluded
  from Railfan, stable ids, same output for shuffled input, undo removes a spike; `spikeTally`.
- Unit `milestones.test.ts` updated (first-of-day and lead removed; first photo ignores proofs), `chat.test.ts` for
  spike entries.
- Unit for the celebration picker (`pendingCelebrations(events, me, celebrated, now)` in `spikes.ts` or a small module):
  only mine, not celebrated, first-run 10-minute cutoff.
- e2e: a drink that wins Pathfinder posts the spike line in chat for two phones, the overlay shows only on the
  winner's phone and not again after reload; the Crew Board shows the laurel with the count. One `layoutSweep` line
  for the overlay.

## Left to the builder

The overlay's visual (golden spike art, CSS animation), the laurel SVG, exact chat line punctuation within the labels
above, where `pendingCelebrations` lives.
