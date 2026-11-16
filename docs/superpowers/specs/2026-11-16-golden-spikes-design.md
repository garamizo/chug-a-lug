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
| **Triple Header** | Three drinks at one Metra station ("hat trick (same station)") | won once per station |
| **Full Consist** | One of each of the five Tab kinds | won once |
| **Whistle Stop** | Most crew chat messages | held |
| **Railfan** | Most photos (images in Freight that are not a Tab drink's photo) | held |

Spikes are finalised at Closing Time (the train home arriving, from the ride-home branch).

**Calls made without the user (unattended run), recorded so they can be reversed:**
- Held spikes need a minimum before anyone holds them — Big Boy 3 drinks, Whistle Stop 5 messages, Railfan 3 photos —
  so the first beer of the night isn't an award. Ties stay with the holder.
- Railfan counts images only, and not Tab drink photos: since photo-tab every drink is a photo, and counting them
  would make Railfan a copy of Big Boy. Videos don't count ("photos").
- Caboose measures alcoholic drinks (the same "drinks" as Big Boy), among people with at least one Tab entry today
  (NA or food counts as taking part); someone who logged nothing wasn't on the crawl as far as the app knows. Ties
  share it. It waits for Closing Time because "fewest" is only meaningful once the night is over.
- Triple Header groups by Metra station (`stop.station_id`), following the user's words "same station"; two bars at
  one station count together.

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
  stops: Pick<Stop, 'id' | 'station_id'>[]; // Triple Header groups drinks by station
  date: string;          // the server's today, as milestones use
  closedAt: string | null; // Closing Time on the activity clock (ISO), once reached, else null
};
export function spikes(input: SpikeInput): SpikeEvent[];
/** Spikes each person holds now: won-once spikes, plus held spikes they currently hold. */
export function spikeTally(events: SpikeEvent[]): Map<string, SpikeKind[]>;
```

Rules, evaluated over today's rows (`todayInTz(at) === date`), and only rows with `at < closedAt` when `closedAt` is
set. Closing Time means "nothing posted after it counts"; it is not a stored snapshot, so a correction to an earlier row
(a Conductor deleting a photo) still changes the result. Every rule replays the full, canonically sorted rows on each
call — never state carried between calls — so every phone agrees:

Event ids are built from the row that triggered the award, so deleting an earlier row never renumbers a later award:

- **Pathfinder** — for each Tab kind, the first drink of that kind in `drinkOrder`. Id
  `spike:pathfinder:{kind}:{drinkId}`.
- **Big Boy** — walk drinks in `drinkOrder` keeping each person's alcohol count. The first person to reach **3** takes
  it; afterwards it passes only on a strict overtake of the holder's count (ties stay with the holder). Each hand-over
  is an event; id `spike:bigboy:{drinkId}`.
- **Whistle Stop** — same held rule over chat messages ordered by `at`, `created`, id; threshold **5**. Id
  `spike:whistlestop:{messageId}`.
- **Railfan** — same held rule over media with `kind = image` and no `drink_kind`, ordered by `at || created`,
  `created`, id; threshold **3**. Id `spike:railfan:{mediaId}`.
- **Triple Header** — a person's third alcoholic drink at one station (via `stops`; a drink whose stop is unknown is
  skipped). Once per person per station. Id `spike:triple:{user}:{stationId}:{drinkId}`.
- **Full Consist** — the drink that completes all five Tab kinds for a person. Id `spike:fullconsist:{user}:{drinkId}`.
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
- `CrewChat.svelte` merges `spikeEntries(spikes({...liveDay.feed, stops: liveDay.stops, date: liveDay.today,
  closedAt: liveDay.closedAt}))`.

### Closing Time — one derivation (`liveDay.closedAt`)

A single getter on `liveDay` used by chat, the Crew Board and the celebration:
- Null unless `liveDay.here?.source === 'after'` **and** the route has a resolved (not impossible) closing leg
  (`closingLeg`); `crawlEnd`'s fallbacks (last stop's departure, legacy routes without a run home) never make a
  Closing Time. So legacy routes and impossible runs home get no Caboose.
- On the event day: `crawlEnd(...).at` as an ISO string.
- On a practice day `crawlEnd` is on the plan date (`planClock.ts`), but the feed holds today's real rows: map the plan
  time back onto the activity day — the same America/Chicago wall-clock time on `liveDay.today` (through
  `$lib/time.ts`, DST-safe) — the inverse of `projectToPlanDate`. A helper `planToActivityDay(plan: Date, eventDate,
  today): string` in `planClock.ts`, unit-tested across a DST change.

### The animation — winner's phone only

- `web/src/lib/components/SpikeCelebration.svelte`, mounted once in `(app)/+layout.svelte` (the layout owns the live
  day), shows a full-screen golden-spike overlay (spike name, its one-line meaning, ~2.5 s, tap to dismiss), one at a
  time, oldest first. The decisions live in a pure, unit-tested queue (`web/src/lib/live/celebrate.ts`) with an
  injected clock; the component only renders its head.
- **Identity.** A celebration key is `{itineraryId}:{date}:{runId ?? ''}:{userId}:{eventId}`, so the same award on
  another day, route, simulation run or account is a different celebration.
- **Eligible.** Events whose `user` is me, whose key is not celebrated, and whose `at` is within the last **10
  minutes** of the live clock — checked on every pass, not just the first run, so a phone that was closed for hours
  never replays the night.
- **Present at show time.** Before an item is shown, the queue checks it is still in the current timeline; if not
  (undone, or the feed is mid-reload), it is dropped without being marked. If it reappears and is still fresh, it
  queues again; an empty or reloading feed is never treated as a revocation of anything already shown.
- **Marking.** A key is marked celebrated when its overlay starts.
- **Storage.** Keys persist in `localStorage` (`chugalug.celebratedSpikes`, guarded like `seen.ts`), and are always
  also kept in an in-memory set for the session, so blocked storage at worst replays a still-fresh award after a full
  reload. Keys older than two days are pruned on write.
- **Teardown.** Logout, a route/day/run change, or the practice `quiet` rule switching on clears the queue and hides
  the overlay; nothing is shown while `quiet`.
- `prefers-reduced-motion`: no motion; the overlay fades in and out.

### Crew Board

- Loads today's media and chat messages for the route alongside drinks (same filters as `liveDay.loadFeed`); stops and
  Closing Time come from `liveDay` (`liveDay.stops`, `liveDay.closedAt`).
- Next to each name: a laurel (inline SVG, `data-testid="spike-laurel"`) and the count from `spikeTally`, shown only
  when the count is > 0; its accessible label lists the spike names (e.g. "Golden Spikes: Pathfinder, Big Boy").
- Ranking is unchanged.

### Labels (web/src/lib/labels.ts)

- `spikeAuthor: 'Golden Spike'`
- Names: `spikePathfinder: 'Pathfinder'`, `spikeBigBoy: 'Big Boy'`, `spikeCaboose: 'Caboose'`,
  `spikeTriple: 'Triple Header'`, `spikeFullConsist: 'Full Consist'`, `spikeWhistleStop: 'Whistle Stop'`,
  `spikeRailfan: 'Railfan'`
- Meanings (overlay and laurel tooltip): `spikePathfinderWhy: 'First to log it today'`,
  `spikeBigBoyWhy: 'Most drinks'`, `spikeCabooseWhy: 'Fewest drinks'`, `spikeTripleWhy: 'Three drinks at one station'`,
  `spikeFullConsistWhy: 'One of each'`, `spikeWhistleStopWhy: 'Most messages'`, `spikeRailfanWhy: 'Most photos'`
- Chat glue: `spikeFirst: 'first'`, `spikeTakesFrom: 'takes it from'`, `spikeLaurel: 'Golden Spikes'`
- Remove `milestoneFirst` and `milestoneLead` if nothing else uses them.

README glossary: the **Golden Spikes** row gains the seven names; FEATURES.md gets a Golden Spikes bullet and the
Crew chat bullet loses "firsts, lead changes" in favour of spikes.

## Edge cases

- Undo or a Conductor photo delete removes the row; the timeline recomputes and the spike may move or vanish; a winner
  who already saw the animation keeps the memory — accepted. A queued, not-yet-shown celebration is dropped.
- Ties for held spikes stay with the holder; a tie for Caboose shares it.
- No run home (impossible) or the crawl not finished: no Closing Time, no Caboose, held spikes stay live.
- Anything posted after Closing Time does not count. The Tab is closed after the crawl (`source: 'after'`), so Undo
  is not offered then; a Conductor's later photo delete can still change the result (computed, not stored).
- A route edit that moves the run home moves Closing Time with it.
- Practice days: computed from the server's today like milestones; Closing Time comes from the practice timetable.
- Someone with only NA/food: eligible for Caboose (0 drinks), Pathfinder, Full Consist; not Big Boy.

## Tests

- Unit `web/tests/unit/spikes.test.ts`: each rule, thresholds, held hand-over on strict overtake only, tie stays,
  Caboose only with `closedAt` and shared on ties, rows after `closedAt` ignored, other days ignored, proof photos and
  videos excluded from Railfan, Triple Header across two stops at one station, ids unchanged when an earlier row is
  deleted, same output for shuffled input, undo removes a spike; `spikeTally`.
- Unit `planClock.test.ts`: `planToActivityDay` on the event day, before and after it, and across a DST change;
  `liveDay.closedAt` null for a legacy route, an impossible run home, and before `after`.
- Unit `milestones.test.ts` updated (first-of-day and lead removed; first photo ignores proofs), `chat.test.ts` for
  spike entries.
- Unit `celebrate.test.ts` with a fake clock: only mine; key scoping (another day/route/run/user is new); the
  10-minute window on every pass; a queued award that vanishes before showing is dropped and not marked; a reloading
  (empty) feed drops nothing already shown and queues nothing; blocked storage falls back to memory; teardown on
  scope change and `quiet`.
- e2e: a drink that wins Pathfinder posts the spike line in chat for two phones, the overlay shows only on the
  winner's phone and not again after reload; the Crew Board shows the laurel with the count. One `layoutSweep` line
  for the overlay.

## Left to the builder

The overlay's visual (golden spike art, CSS animation), the laurel SVG, exact chat line punctuation within the labels
above.
