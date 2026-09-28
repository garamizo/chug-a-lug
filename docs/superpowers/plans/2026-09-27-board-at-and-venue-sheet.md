# Board at, and venue sheets while planning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A route can name the station the crew boards at, so stop 1's arrival counts the ride in and
Live counts down to that boarding train; venues on Add Stop and stops in the editor open a photo sheet.

**Architecture:** The one planner (`recomputeLegs`) grows an optional opening leg from
`itineraries.start_station` to stop 1, stored in `legs` with an empty `from_stop`, so preview, commit
and recompute stay identical. Leg readers treat that leg as stop 1's incoming leg. Live gets a pure
`boardingJourney()` that replaces the stop-to-onward train request before the crawl. The venue sheet
reuses the attach code's fetch-once media step through a new endpoint.

**Tech Stack:** SvelteKit (Svelte 5 runes), PocketBase JS hooks and migrations, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-27-board-at-and-venue-sheet-design.md`

## Global Constraints

- User-visible strings live only in `web/src/lib/labels.ts`; the README UI glossary is the source of truth for names.
- Tests before code; each task ends green on what it touched. Final task runs everything:
  `cd web && npm test && npm run check && npm run test:e2e`, plus `bash scripts/test-hooks.sh`.
- One test run at a time across worktrees (e2e 15173/18093). Never point anything at 8090 or 3000.
- Nothing may plan legs except `computeLegs`. `ItineraryView` writes nothing itself; it calls `actions`.
- Times are UTC in the database and payloads; render only through `$lib/time.ts`.
- Stage explicit paths when committing (never `git add -A`); no `--no-verify`.
- Google budget caps stay: details 800, photos 800 a month (`consumeBudget`).

## Review Focus

1. A route with a start station and **one** stop: Live before the crawl must still show a train (Aurora → stop 1), not "no train". Pinned in Task 5.
2. Start station equal to stop 1's station: no boarding journey; Live behaves as today; stop 1 arrives at Start + walk. Pinned in Tasks 2 and 4.
3. Clearing Board at (empty option) returns the route to today's timing (no opening leg left behind). Pinned in Task 3 (recompute deletes all legs then writes only computed ones) and Task 6 e2e.
4. A staged change on the locked Route editor survives opening and closing a stop sheet. Pinned in Task 9 e2e.
5. Opening a venue whose Google photos were already fetched makes no Google call. Pinned in Task 7.

---

### Task 1: Schema — `start_station`, optional `from_stop`, hook guard

**Files:**
- Create: `pocketbase/pb_migrations/1758880000_start_station.js`
- Modify: `pocketbase/pb_hooks/planning.pb.js` (the `['title', 'event_date', 'start_time']` guard and `scheduleChanged`)
- Modify: `web/src/lib/types.ts:9` (`Itinerary`)
- Test: `web/tests/hooks/planning.test.ts`, `web/tests/hooks/recompute.test.ts`

**Interfaces:**
- Produces: `Itinerary.start_station: string`, `Itinerary.start_station_name: string`; legs rows may have `from_stop: ''`.

- [ ] **Step 1: Failing hook tests.** In `planning.test.ts`, inside `'freezes a locked itinerary for its creator…'` after the `event_date` 403 line, add:

```ts
    expect((await patch(`/api/collections/itineraries/records/${id}`, { start_station: 'AURORA', start_station_name: 'Aurora' }, crew.token)).status).toBe(403);
```

and a new test in the same `describe`:

```ts
  it('stores a start station and accepts an opening leg with no from_stop', async () => {
    const { id } = await (await createItinerary(crew.token, { title: 'Boarding' })).json();
    const set = await patch(`/api/collections/itineraries/records/${id}`, { start_station: 'AURORA', start_station_name: 'Aurora' }, crew.token);
    expect(set.status).toBe(200);
    expect(await set.json()).toMatchObject({ start_station: 'AURORA', start_station_name: 'Aurora' });
    const { id: stop } = await (await createStop(crew.token, id)).json();
    const su = await superuserToken();
    const leg = await post('/api/collections/legs/records', { itinerary: id, from_stop: '', to_stop: stop, kind: 'train' }, su);
    expect(leg.status).toBe(200);
  });
```

In `recompute.test.ts`, extend the trigger test after the `start_time` patch:

```ts
    await patch(`/api/collections/itineraries/records/${it.id}`, { start_station: 'AURORA', start_station_name: 'Aurora' }, crew.token);
    expect(forThis()).toHaveLength(2);
```

- [ ] **Step 2:** Run `bash scripts/test-hooks.sh` from the repo root. Expected: the three new assertions FAIL (unknown field / from_stop required / no recompute).

- [ ] **Step 3: Migration.**

```js
// Where the crew boards. Empty keeps the old meaning of Start (the arrival at stop 1). The ride from
// here to stop 1 is the route's opening leg: a legs row with no from_stop.
migrate((app) => {
  const itineraries = app.findCollectionByNameOrId('itineraries')
  itineraries.fields.add(new TextField({ name: 'start_station', max: 32 }))
  itineraries.fields.add(new TextField({ name: 'start_station_name', max: 80 }))
  app.save(itineraries)
  const legs = app.findCollectionByNameOrId('legs')
  legs.fields.getByName('from_stop').required = false
  app.save(legs)
}, (app) => {
  const legs = app.findCollectionByNameOrId('legs')
  app.db().newQuery("DELETE FROM legs WHERE from_stop = ''").execute()
  legs.fields.getByName('from_stop').required = true
  app.save(legs)
  const itineraries = app.findCollectionByNameOrId('itineraries')
  itineraries.fields.removeByName('start_station')
  itineraries.fields.removeByName('start_station_name')
  app.save(itineraries)
})
```

- [ ] **Step 4: Hook.** In `planning.pb.js` change the frozen-field list to
`['title', 'event_date', 'start_time', 'start_station', 'start_station_name']` and `scheduleChanged` to also compare `start_station`:

```js
  const scheduleChanged = e.record.getString('start_time') !== original.getString('start_time') ||
    e.record.getString('event_date') !== original.getString('event_date') ||
    e.record.getString('start_station') !== original.getString('start_station')
```

- [ ] **Step 5: Type.** `web/src/lib/types.ts` `Itinerary`: add `start_station: string; start_station_name: string;` after `start_time: string;`.

- [ ] **Step 6:** `bash scripts/test-hooks.sh` → PASS. `cd web && npm run check` → 0 errors (fix any test fixture literal typed as `Itinerary` by adding `start_station: '', start_station_name: ''`).

- [ ] **Step 7: Commit** `pocketbase/pb_migrations/1758880000_start_station.js pocketbase/pb_hooks/planning.pb.js web/src/lib/types.ts web/tests/hooks/planning.test.ts web/tests/hooks/recompute.test.ts` (+ any fixture files touched) — `feat(plan): start_station on routes; legs may open with no from_stop`.

---

### Task 2: Planner — the opening leg

**Files:**
- Modify: `web/src/lib/metra/plan.ts` (`recomputeLegs`)
- Modify: `web/src/lib/metra/compute.ts`
- Modify: `web/src/lib/server/plan.ts` (`computeLegs` opts)
- Test: `web/tests/unit/plan.test.ts`

**Interfaces:**
- Produces: `recomputeLegs(s, { date, startMin, anchor?, startStation? }, stops)`; `computeLegs(schedule, { …, startStation? })` and server `computeLegs({ …, startStation? })`. Opening leg: `fromStopId: ''`, `toStopId: <stop 1 id>`, first in the array.

- [ ] **Step 1: Failing tests** — append to `plan.test.ts`:

```ts
describe('recomputeLegs with a start station', () => {
  const stops = [
    { id: 's1', order: 1, station_id: 'LAGRANGE', dwell_min: 60, walk_min: 5 },
    { id: 's2', order: 2, station_id: 'CUS', dwell_min: 60, walk_min: 4 }
  ];

  it('rides from the start station to stop 1 before anything else', () => {
    const legs = recomputeLegs(s, { date: D, startMin: 660, startStation: 'NAPERVILLE' }, stops);
    // BN2 leaves Naperville 12:05, La Grange 12:30, plus the 5 min walk.
    expect(legs[0]).toMatchObject({ fromStopId: '', toStopId: 's1', kind: 'train', readyMin: 660, departMin: 725, arriveMin: 755 });
    expect(legs[0].segments[0]).toMatchObject({ kind: 'train', tripId: 'BN2', from: 'NAPERVILLE' });
    // Stop 1 then dwells 60 and walks 5: at the platform 13:40, BN4 at 14:30 reaches CUS 14:55 (+4).
    expect(legs[1]).toMatchObject({ fromStopId: 's1', toStopId: 's2', readyMin: 815, departMin: 870, arriveMin: 899 });
  });

  it('is a walk when stop 1 is at the start station', () => {
    const legs = recomputeLegs(s, { date: D, startMin: 660, startStation: 'LAGRANGE' }, stops);
    expect(legs[0]).toMatchObject({ fromStopId: '', toStopId: 's1', kind: 'walk', readyMin: 660, arriveMin: 665 });
  });

  it('is impossible with no train, and stop 1 is then reached at Start plus its walk', () => {
    const legs = recomputeLegs(s, { date: D, startMin: 1380, startStation: 'NAPERVILLE' }, stops);
    expect(legs[0]).toMatchObject({ fromStopId: '', kind: 'impossible', arriveMin: 1385 });
  });

  it('plans an opening leg even for a single stop', () => {
    const legs = recomputeLegs(s, { date: D, startMin: 660, startStation: 'NAPERVILLE' }, [stops[0]]);
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ fromStopId: '', toStopId: 's1', arriveMin: 755 });
  });

  it('adds nothing without a start station', () => {
    const legs = recomputeLegs(s, { date: D, startMin: 660 }, stops);
    expect(legs.map((l) => l.fromStopId)).toEqual(['s1']);
  });

  it('lets an anchor on stop 1 override the opening arrival', () => {
    const legs = recomputeLegs(s, { date: D, startMin: 660, startStation: 'NAPERVILLE', anchor: { stopId: 's1', atMin: 700 } }, stops);
    // Anchored at 11:40: ready 12:40, platform 12:45, BN4 at 14:30.
    expect(legs[1]).toMatchObject({ fromStopId: 's1', readyMin: 760, departMin: 870 });
  });
});
```

- [ ] **Step 2:** `cd web && npx vitest run tests/unit/plan.test.ts` → FAIL (no opening leg).

- [ ] **Step 3: Implement** in `plan.ts`: change the opts type to `{ date: string; startMin: number; anchor?: Anchor | null; startStation?: string | null }`, update the doc comment ("…at stop 1 at startMin — or, with a start station, after the ride from there…"), and before the loop:

```ts
  let arrival = opts.startMin;
  const first = sorted[0];
  if (opts.startStation && first) {
    const plan = planLeg(s, opts.startStation, first.station_id, opts.startMin, opts.date);
    const arriveMin = (plan.kind === 'impossible' ? opts.startMin : plan.arriveMin) + first.walk_min;
    legs.push({ fromStopId: '', toStopId: first.id, kind: plan.kind, readyMin: opts.startMin, departMin: plan.departMin, arriveMin, segments: plan.segments });
    arrival = arriveMin;
  }
```

(`legs` must be declared before this block.) In `compute.ts` add `startStation?: string | null` to opts and pass `startStation: opts.startStation` into `recomputeLegs`. In `server/plan.ts` add `startStation?: string | null` to `computeLegs` opts (it forwards `opts` unchanged).

- [ ] **Step 4:** `npx vitest run tests/unit/plan.test.ts` → PASS.
- [ ] **Step 5: Commit** `web/src/lib/metra/plan.ts web/src/lib/metra/compute.ts web/src/lib/server/plan.ts web/tests/unit/plan.test.ts` — `feat(plan): the opening leg from the start station to stop 1`.

---

### Task 3: Server wiring — recompute, preview, commit

**Files:**
- Modify: `web/src/lib/server/recompute.ts:47-60`, `web/src/routes/api/plan/preview/+server.ts:28`, `web/src/routes/api/plan/commit/+server.ts:128`
- Test: `web/tests/unit/recompute.test.ts`, `web/tests/unit/planEndpoints.test.ts`

**Interfaces:**
- Consumes: Task 2's `startStation` option.
- Produces: stored legs include `{ from_stop: '', to_stop: stop1 }`; preview response includes `{ fromStopId: '' }`.

- [ ] **Step 1: Failing tests.** In `recompute.test.ts`, add `startStation: '' as string` to `state`, reset it in `beforeEach`, make the itinerary mock return `start_station: state.startStation`, and make `metra.getSchedule` return `fixtureSchedule()` for this test:

```ts
  it('writes the opening leg with an empty from_stop when the route has a start station', async () => {
    vi.mocked(metra.getSchedule).mockResolvedValueOnce(fixtureSchedule());
    state.startStation = 'NAPERVILLE';
    state.stops = [{ id: 's1', order: 1, station_id: 'LAGRANGE', dwell_min: 60, walk_min: 5 }];
    await recomputeItinerary('aaaaaaaaaaaaaaa');
    const legs = state.created.filter((c) => c.collection === 'legs').map((c) => c.body);
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ from_stop: '', to_stop: 's1', kind: 'train' });
  });
```

In `planEndpoints.test.ts` (`describe('POST /api/plan/preview'`):

```ts
  it('includes the opening leg when the route boards elsewhere', async () => {
    state.itinerary = { ...state.itinerary, status: 'draft', start_station: 'NAPERVILLE' };
    const res = await call({ itinerary: 'itinerary000001', stops });
    const body = await res.json();
    expect(body.legs[0]).toMatchObject({ fromStopId: '', toStopId: 's2', kind: 'train' });
  });
```

- [ ] **Step 2:** `npx vitest run tests/unit/recompute.test.ts tests/unit/planEndpoints.test.ts` → FAIL.
- [ ] **Step 3:** Pass `startStation: it.start_station || null` in `recompute.ts` and `startStation: itinerary.start_station || null` in preview and commit `computeLegs` calls. In `commit/+server.ts` the `cohesionBlockers` call already receives `legs`; no other change.
- [ ] **Step 4:** Tests → PASS.
- [ ] **Step 5: Commit** those five files — `feat(plan): preview, commit and recompute plan the opening leg`.

---

### Task 4: Leg readers — timings, strip, planned train, cohesion, boarding journey

**Files:**
- Modify: `web/src/lib/live/current.ts` (`timings`), `web/src/lib/live/strip.ts:20`, `web/src/lib/live/board.ts` (`plannedTrain`, new `boardingJourney`), `web/src/lib/live/cohesion.ts` (blocker name), `web/src/lib/labels.ts`
- Test: `web/tests/unit/current.test.ts`, `web/tests/unit/strip.test.ts`, `web/tests/unit/board.test.ts`, `web/tests/unit/cohesion.test.ts`

**Interfaces:**
- Produces:
```ts
export type Boarding = { from: string; fromName: string; to: string; toName: string; walkMin: 0; planned: { tripId: string; dep: string } };
export function boardingJourney(itinerary: Pick<Itinerary, 'start_station' | 'start_station_name'> | null, stops: Stop[], legs: Leg[], here: Current | null): Boarding | null;
```
- Labels: `theStart: 'the start'` (cohesion blocker name for the opening leg).

- [ ] **Step 1: Failing tests.**

`current.test.ts`:
```ts
  it('arrives at stop 1 when the opening leg does, not at the start', () => {
    const opening = leg('', 'A', '2026-12-26T17:30:00.000Z', '2026-12-26T18:20:00.000Z');
    const r = currentStop(stops, [opening, ...legs], new Date('2026-12-26T18:10:00.000Z'), { startAt });
    expect(r.source).toBe('before');
    expect(currentStop(stops, [opening, ...legs], new Date('2026-12-26T18:25:00.000Z'), { startAt }).source).toBe('clock');
  });
```

`board.test.ts` (inside `describe('plannedTrain'`):
```ts
  it('prefers the opening leg, which sorts before every stop', () => {
    const legs = [
      leg('a', [seg('BN4', 'LAGRANGE', '2026-12-26T20:30:00.000Z')]),
      leg('', [seg('BN2', 'LAGRANGE', '2026-12-26T18:30:00.000Z')])
    ];
    expect(plannedTrain(stops, legs, 'LAGRANGE')).toEqual({ tripId: 'BN2', dep: '2026-12-26T18:30:00.000Z' });
  });
```
and a new describe:
```ts
describe('boardingJourney', () => {
  const stop = (id: string, order: number, station_id: string, station_name: string) => ({ id, order, station_id, station_name, walk_min: 5 }) as Stop;
  const seg = { kind: 'train' as const, tripId: 'BN2', routeId: 'BNSF', headsign: 'Chicago', from: 'AURORA', to: 'NAPERVILLE', dep: '2026-12-26T17:12:00.000Z', arr: '2026-12-26T17:31:00.000Z' };
  const opening = { from_stop: '', to_stop: 'a', kind: 'train', segments: [seg] } as unknown as Leg;
  const stops = [stop('a', 1, 'NAPERVILLE', 'Naperville')];
  const it1 = { start_station: 'AURORA', start_station_name: 'Aurora' };
  const before = { stop: stops[0], nextStop: null, onwardStop: null, departAt: null, source: 'before' } as Current;

  it('is the ride from the start station to stop 1 before the crawl, even with one stop', () => {
    expect(boardingJourney(it1, stops, [opening], before)).toEqual({
      from: 'AURORA', fromName: 'Aurora', to: 'NAPERVILLE', toName: 'Naperville', walkMin: 0,
      planned: { tripId: 'BN2', dep: '2026-12-26T17:12:00.000Z' }
    });
  });
  it('is null once the crawl has started', () => {
    expect(boardingJourney(it1, stops, [opening], { ...before, source: 'clock' })).toBeNull();
  });
  it('is null with no start station, or when stop 1 is at it, or with no train', () => {
    expect(boardingJourney({ start_station: '', start_station_name: '' }, stops, [opening], before)).toBeNull();
    expect(boardingJourney({ start_station: 'NAPERVILLE', start_station_name: 'Naperville' }, stops, [opening], before)).toBeNull();
    expect(boardingJourney(it1, stops, [{ ...opening, kind: 'impossible', segments: [] } as Leg], before)).toBeNull();
  });
});
```
(import `boardingJourney` and `type Current` from `../../src/lib/live/current`.)

`strip.test.ts`: add a case where legs include `{ from_stop: '', to_stop: <first>, arrive_at: X }` and assert the first item's `arriveAt` is `X` (follow the file's existing builders).

`cohesion.test.ts`:
```ts
  it('names the start for an impossible opening leg', () => {
    const blockers = cohesionBlockers({ eventDate: '2026-12-26', now: new Date('2026-09-27T12:00:00Z'), anchorStopId: 'a',
      stops: [{ id: 'a', order: 1, name: 'Alpha' }], legs: [{ fromStopId: '', toStopId: 'a', kind: 'impossible' }] });
    expect(blockers[0].message).toContain(`${copy.theStart} ${copy.blockTo} Alpha`);
  });
```

- [ ] **Step 2:** `npx vitest run tests/unit/current.test.ts tests/unit/board.test.ts tests/unit/strip.test.ts tests/unit/cohesion.test.ts` → FAIL.

- [ ] **Step 3: Implement.**
  - `current.ts` `timings`: `const arriveIso = inLeg?.arrive_at ?? (i === 0 ? startAt.toISOString() : undefined);`
  - `strip.ts:20`: `arriveAt: arrive.get(stop.id) ?? (i === 0 ? startAt.toISOString() : null),`
  - `board.ts` `plannedTrain`: `const rank = (id: string) => (id ? order.get(id) ?? 0 : -Infinity);` and sort by `rank(a.from_stop) - rank(b.from_stop)`.
  - `board.ts` new function:
```ts
/**
 * Before the crawl, the ride the crew actually starts with: from the route's start station to stop 1.
 * Null when the route has no start station, stop 1 is at it, the opening leg has no train, or the
 * crawl has begun — then the board follows the stops as it always has.
 */
export function boardingJourney(itinerary: Pick<Itinerary, 'start_station' | 'start_station_name'> | null, stops: Stop[], legs: Leg[], here: Current | null): Boarding | null {
  if (!itinerary?.start_station || here?.source !== 'before') return null;
  const first = [...stops].sort((a, b) => a.order - b.order)[0];
  if (!first || first.station_id === itinerary.start_station) return null;
  const opening = legs.find((l) => !l.from_stop && l.to_stop === first.id);
  const train = opening?.segments?.find((seg) => seg.kind === 'train');
  if (!opening || opening.kind !== 'train' || !train || train.kind !== 'train') return null;
  return {
    from: itinerary.start_station, fromName: itinerary.start_station_name || itinerary.start_station,
    to: first.station_id, toName: first.station_name || first.station_id, walkMin: 0,
    planned: { tripId: train.tripId, dep: train.dep }
  };
}
```
  - `cohesion.ts` blocker name: `const name = (id: string) => (id ? ordered.find((s) => s.id === id)?.name ?? id : copy.theStart);`
  - `labels.ts`: `theStart: 'the start',`

- [ ] **Step 4:** tests → PASS; `npm run check` → 0 errors.
- [ ] **Step 5: Commit** the four source files, `labels.ts` and the four test files — `feat(live): legs readers understand the opening leg; boardingJourney`.

---

### Task 5: Live — count down to the boarding train

**Files:**
- Modify: `web/src/lib/live/day.svelte.ts` (`boarding` getter, `plannedTrip`, `loadTrains`)
- Modify: `web/src/routes/(app)/live/+page.svelte:154-162`, `web/src/routes/(app)/+layout.svelte:45-46,84-88`
- Test: `web/tests/unit/liveDay.test.ts`, `web/tests/e2e/live.spec.ts`

**Interfaces:**
- Consumes: `boardingJourney`, `Boarding` (Task 4).
- Produces: `liveDay.boarding: Boarding | null`.

- [ ] **Step 1: Failing unit test** in `liveDay.test.ts`, following its existing LiveDay construction/mocking of `fetchNext` (read the file's first 80 lines for the harness): give the day a locked itinerary with `start_station: 'AURORA', start_station_name: 'Aurora'`, **one** stop at NAPERVILLE, an opening leg whose train segment departs AURORA, `now` before that departure; call `loadTrains()` and assert `fetchNext` was called with `('AURORA', 'NAPERVILLE', eventDate, <planned dep − 60 s>, practice)` and that `day.plannedTrip` equals the segment's `{ tripId, dep }`. Second case: same route with a second stop at CUS — `fetchNext` is still called `('AURORA', 'NAPERVILLE', …)`.

- [ ] **Step 2:** run it → FAIL (today it returns early / asks NAPERVILLE→CUS).

- [ ] **Step 3: Implement** in `day.svelte.ts`:
```ts
  /** Before the crawl on a route that boards elsewhere: the ride to stop 1 (see `boardingJourney`). */
  get boarding(): Boarding | null {
    return this.hasRoute ? boardingJourney(this.itinerary, this.stops, this.legs, this.here) : null;
  }
  get plannedTrip(): { tripId: string; dep: string } | null {
    const boarding = this.boarding;
    if (boarding) return boarding.planned;
    const here = this.here;
    return here?.source === 'before' && here.stop ? plannedTrain(this.stops, this.legs, here.stop.station_id) : null;
  }
```
and in `loadTrains` replace the early return and the `fetchNext` arguments:
```ts
    const boarding = this.boarding;
    const from = boarding?.from ?? here?.stop?.station_id;
    const to = boarding?.to ?? here?.onwardStop?.station_id;
    if (!from || !to || !this.itinerary) { this.trips = []; return; }
    …
      const res = await fetchNext(from, to, this.itinerary.event_date, after, this.practice);
```
Import `boardingJourney, type Boarding` from `./board`.

- [ ] **Step 4: Screens.** Live page `DepartureBoard`:
```svelte
  {@const b = liveDay.boarding}
  <DepartureBoard
    station={b ? b.fromName : here.stop.station_name || here.stop.station_id}
    stopName={here.stop.name}
    nextStation={b ? b.toName : here.onwardStop?.station_name || here.onwardStop?.station_id || ''}
    trip={liveDay.trip}
    walkMin={b ? b.walkMin : here.stop.walk_min}
    … />
```
Same three substitutions in the `(app)/+layout.svelte` banner. In the layout's reload key (line 46) append `:${liveDay.boarding?.from ?? ''}` so switching into/out of the boarding journey refetches trains.

- [ ] **Step 5: e2e** in `live.spec.ts`, using `seedLockedCrawl` (read its options in `helpers.ts`; add `start_station`/`start_station_name` passthrough to the itinerary it creates if it lacks a generic field bag) with stops at LAGRANGE then CUS, `start_station: 'NAPERVILLE'`, start 11:00 on the fixture date and the clock before 12:05: expect the board to name Naperville and show the 12:05 train.

- [ ] **Step 6:** unit + e2e for these files → PASS; `npm run check`.
- [ ] **Step 7: Commit** `day.svelte.ts`, both Svelte files, `liveDay.test.ts`, `live.spec.ts`, `helpers.ts` — `feat(live): before the crawl, count down to the boarding train`.

---

### Task 6: Draft editor — the Board at picker and the opening ride

**Files:**
- Modify: `web/src/lib/planActions.ts` (`setStartStation`), `web/src/lib/components/ItineraryView.svelte`, `web/src/lib/labels.ts`, `README.md` (UI glossary)
- Test: `web/tests/unit/planActions.test.ts`, `web/tests/e2e/planning.spec.ts`

**Interfaces:**
- Produces: `PlanActions.setStartStation?: (station: { id: string; name: string } | null) => void | Promise<void>` (present exactly where `setStartTime` is).
- Labels: `boardAt: 'Board at'`, `boardAtPick: 'Pick where the crew boards'`.

- [ ] **Step 1: Failing tests.** `planActions.test.ts` (follow its pb mock): `recordActions('it1', fail).setStartStation({ id: 'AURORA', name: 'Aurora' })` updates `itineraries/it1` with `{ start_station: 'AURORA', start_station_name: 'Aurora' }`; `setStartStation(null)` writes `{ start_station: '', start_station_name: '' }`.

e2e, new test in `planning.spec.ts`:
```ts
test('Board at counts the ride in to the first stop', async ({ page }) => {
  await login(page, 'E2E Skipper', ADMIN);
  await page.getByTestId('nav-plan').click();
  await page.getByTestId('draft-title').fill('Board At');
  await page.getByTestId('create-draft').click();
  await expect(page).toHaveURL(/\/edit$/);
  await page.getByTestId('station-dot-LAGRANGE').click();
  await page.getByTestId('venue-p1').click();
  await page.getByTestId('sheet-add').click();
  await expect(page.getByTestId('stop-row-0')).toContainText('Arrive 11:00 AM');
  await page.getByTestId('board-at').selectOption('NAPERVILLE');
  // BN2 leaves Naperville 12:05, reaches La Grange 12:30, plus the 2 min walk.
  await expect(page.getByTestId('opening-leg')).toContainText('12:05 PM');
  await expect(page.getByTestId('stop-row-0')).toContainText('Arrive 12:32 PM');
  await page.getByTestId('board-at').selectOption('');
  await expect(page.getByTestId('opening-leg')).toHaveCount(0);
  await expect(page.getByTestId('stop-row-0')).toContainText('Arrive 11:00 AM');
});
```
(`sheet-add` comes from Task 8; if Task 8 is not done yet, use the venue row as today and switch it in Task 8.)

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: Implement.**
  - `planActions.ts`: add the type member (doc: "Absent on the live editor, like `setStartTime`.") and in `recordActions`:
```ts
    async setStartStation(station) {
      try { await pb.collection('itineraries').update(itineraryId, { start_station: station?.id ?? '', start_station_name: station?.name ?? '' }); } catch (err) { fail(err); }
    },
```
  - `ItineraryView.svelte`:
    - `const opening = $derived(legs.find((l) => !l.from_stop && l.to_stop === sorted[0]?.id));`
    - `arriveAt(0)`: `return opening ? new Date(opening.arrive_at) : localToUtc(itinerary.event_date, parseHm(itinerary.start_time));`
    - `names`: add `...(itinerary.start_station ? [{ [itinerary.start_station]: itinerary.start_station_name || itinerary.start_station }] : [])` before the OTC/CUS entry.
    - Under the `.stats` grid in the header:
```svelte
  {#if canManage && actions.setStartStation}
    <label class="board">{copy.boardAt}
      <select value={itinerary.start_station ?? ''} data-testid="board-at"
        onchange={(e) => { const id = (e.target as HTMLSelectElement).value; const st = (stations ?? []).find((s) => s.id === id); void actions.setStartStation?.(st ? { id: st.id, name: st.name } : null); }}>
        <option value="">{copy.boardAtPick}</option>
        {#each stations ?? [] as st (st.id)}<option value={st.id} disabled={st.served === false}>{stationLabel(st)}</option>{/each}
      </select>
    </label>
  {:else if itinerary.start_station}
    <p class="board">{copy.boardAt} <strong>{itinerary.start_station_name || itinerary.start_station}</strong></p>
  {/if}
```
    - In the `card` snippet, before `<StopRow …>` when `i === 0 && opening`:
```svelte
  {#if i === 0 && opening}
    <div class="opening" data-testid="opening-leg">
      <p class="meta">{copy.boardAt} {itinerary.start_station_name || itinerary.start_station} · {itinerary.start_time}</p>
      <LegRow leg={opening} index={-1} {names} />
    </div>
  {/if}
```
      (import `LegRow`; style `.board` like the stats text and `.opening { margin: 0 0 6px; }`).
  - `labels.ts`: the two labels.
  - `README.md` glossary table: a row for **Board at** — "Draft header select; the station the crew boards at, at Start. Stop 1's arrival counts the ride in."

- [ ] **Step 4:** unit + the new e2e → PASS; `npm run check`.
- [ ] **Step 5: Commit** those files — `feat(plan): Board at picker and the opening ride on the draft`.

---

### Task 7: Venue media endpoint (fetch once, shared with attach)

**Files:**
- Modify: `web/src/lib/server/places/attach.ts` (extract `ensurePlaceMedia`; add `venueMedia`)
- Create: `web/src/routes/api/places/photos/+server.ts`
- Test: `web/tests/unit/attach.test.ts`

**Interfaces:**
- Produces:
```ts
export function venueMedia(placeRecordId: string): Promise<{ status: 'done' | 'none' | 'failed'; place: Place | null; message?: string }>;
// POST /api/places/photos { placeRef } → 200 { status, place }  (place carries id, collectionId, photos, rating, hours, address…)
```

- [ ] **Step 1: Failing tests** in `attach.test.ts` (the file's mocks already fake places and google):
```ts
describe('venueMedia', () => {
  it('fetches a stored Google venue\'s details and photos once, then serves them without Google', async () => {
    pbState.places.set('placeg1', { id: 'placeg1', ref: 'google:G1', source: 'google', place_id: 'G1', name: 'Bar', photos: [], photo_refs: [] });
    vi.mocked(placeDetails).mockResolvedValue({ name: 'Bar', address: 'A', lat: 1, lon: 2, hours: [], rating: 4.5, phone: '', website: '', mapsUrl: '', photos: [{ name: 'p/1', attribution: 'x' }], fetchedAt: '' } as never);
    vi.mocked(photoBytes).mockResolvedValue(new Uint8Array([1]) as never);
    const first = await venueMedia('placeg1');
    expect(first.status).toBe('done');
    expect(first.place?.photos).toEqual(['1.jpg']);
    vi.mocked(placeDetails).mockClear(); vi.mocked(photoBytes).mockClear();
    await venueMedia('placeg1');
    expect(placeDetails).not.toHaveBeenCalled();
    expect(photoBytes).not.toHaveBeenCalled();
  });
  it('returns no photos for an OpenStreetMap venue and never calls Google', async () => {
    pbState.places.set('placeo1', { id: 'placeo1', ref: 'osm:node/1', source: 'osm', place_id: '', name: 'Pub', photos: [] });
    expect(await venueMedia('placeo1')).toMatchObject({ status: 'none' });
    expect(placeDetails).not.toHaveBeenCalled();
  });
});
```
Check the file's `beforeEach` resets `pbState`, `envState.dataDir` (tmp dir) and the google mocks; reuse it.

- [ ] **Step 2:** run → FAIL (`venueMedia` not exported).

- [ ] **Step 3: Implement.** Move the body of the `serialize(placeQueues, ref, async () => { … })` callback into
```ts
/** Details and up to five photos for one Google venue, once. Returns the place, or why not. */
async function ensurePlaceMedia(pb: PocketBase, cfg: { key: string }, placeId: string, seed: { existing: Place | null; name: string; kind: string; lat: number; lon: number; address: string; station_id: string }): Promise<Place | string> {
  const ref = `google:${placeId}`;
  return serialize(placeQueues, ref, async () => { /* the existing body, using seed.* where it used stop.* and seed.existing where it used place */ });
}
```
and call it from `doAttachPlace` with `{ existing: place, name: stop.name, kind: stop.kind || 'other', lat: stop.lat, lon: stop.lon, address: stop.address, station_id: stop.station_id }`. Add:
```ts
export async function venueMedia(placeRecordId: string) {
  const pb = await adminPb();
  const place = await pb.collection('places').getOne<Place>(placeRecordId).catch(() => null);
  if (!place) return { status: 'none' as const, place: null };
  if (place.source !== 'google' || !place.place_id || !/^[A-Za-z0-9_-]+$/.test(place.place_id)) return { status: 'none' as const, place };
  if (place.details_at && (place.photos.length || !(place.photo_refs ?? []).length)) return { status: 'done' as const, place };
  if (!serverEnv.googleKey) return { status: 'none' as const, place };
  try {
    const out = await ensurePlaceMedia(pb, { key: serverEnv.googleKey }, place.place_id, { existing: place, name: place.name, kind: place.kind, lat: place.lat, lon: place.lon, address: place.address, station_id: place.station_id });
    return typeof out === 'string' ? { status: 'failed' as const, place, message: out } : { status: 'done' as const, place: out };
  } catch (err) {
    console.error('[places] venue media', placeRecordId, err);
    return { status: 'failed' as const, place, message: (err as Error).message };
  }
}
```
Endpoint:
```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/pb';
import { venueMedia } from '$lib/server/places/attach';

// A venue's photos before it is added: fetched from Google once, then shared by every later stop.
export const POST: RequestHandler = async ({ request }) => {
  await requireUser(request);
  const body = await request.json().catch(() => ({}));
  const placeRef = typeof body.placeRef === 'string' ? body.placeRef : '';
  if (!/^[a-z0-9]{15}$/.test(placeRef)) throw error(400, 'placeRef is required.');
  return json(await venueMedia(placeRef));
};
```
- [ ] **Step 4:** `npx vitest run tests/unit/attach.test.ts` → PASS (old attach tests included).
- [ ] **Step 5: Commit** `attach.ts`, the new endpoint, `attach.test.ts` — `feat(places): fetch a venue's photos once from Add Stop, shared with attach`.

---

### Task 8: VenueSheet on Add Stop

**Files:**
- Create: `web/src/lib/components/VenueSheet.svelte`
- Modify: `web/src/lib/nav.ts` (`openVenue`, `closeVenue`, `sheetVenueId`), `web/src/routes/(app)/plan/[id]/add/+page.svelte`, `web/src/lib/labels.ts`
- Test: `web/tests/e2e/planning.spec.ts`

**Interfaces:**
- Consumes: `POST /api/places/photos` (Task 7).
- Produces: test ids `venue-sheet`, `sheet-add`, `venue-sheet-close`, `venue-photo-<i>`. Labels: `addThisStop: 'Add stop'`, `venueDetails: 'Venue details'`.

- [ ] **Step 1: Failing e2e.** In `planning.spec.ts` `beforeEach`, add a route for `**/api/places/photos` returning `{ status: 'none', place: null }`. Update the big planning test: every `await page.getByTestId('venue-…').click();` that adds a venue is followed by `await page.getByTestId('sheet-add').click();`. Add at the first venue tap:
```ts
  await page.getByTestId('venue-node-2').click();
  await expect(page.getByTestId('venue-sheet')).toBeVisible();
  await expect(page.getByTestId('venue-sheet')).toContainText('Naperville Wine Bar');
  await page.getByTestId('venue-sheet-close').click();
  await expect(page.getByTestId('venue-sheet')).toBeHidden();
  await expect(page).toHaveURL(/\/add\?station=NAPERVILLE&side=left$/);
  await page.getByTestId('venue-node-2').click();
  await page.getByTestId('sheet-add').click();
  await expect(page).toHaveURL(editUrl);
```
and a photo case for `venue-p1` with `placeRef: 'place000000001'` in `venuesFor.LAGRANGE[0]` and the photos route answering `{ status: 'done', place: { id: 'place000000001', collectionId: 'places', collectionName: 'places', photos: ['1.jpg'] } }`: expect `venue-photo-0` visible.

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: Implement.**
  - `nav.ts`: mirror the stop helpers with key `venue`:
```ts
export const sheetVenueId = (): string | null =>
  'venue' in page.state ? (page.state.venue ?? null) : page.url.searchParams.get('venue');
export function openVenue(id: string) { pushState(withParam('venue', id), { ...page.state, venue: id, sheet: true }); }
export function closeVenue() {
  if (page.state.sheet) guardedBack();
  else replaceState(withParam('venue', null), { ...page.state, venue: null, sheet: undefined });
}
```
    Generalise `withStop` into `withParam(key, id)` and keep `withStop = (id) => withParam('stop', id)`. Add `venue?: string | null` to `App.PageState` in `src/app.d.ts`.
  - `VenueSheet.svelte` (props `{ venue: Venue | null; weekday: string; walkMin: number; busy: boolean; onadd: () => void; onclose: () => void }`): a `<dialog class="sheet">` with the same open/close `$effect` and `oncancel` as `StopSheet`, content: name, `copy.kind_*`, `rated` text, address, `walkMin` + `copy.walkMinutes`, `hoursFor(venue.hours ?? null, weekday).line ?? copy.hoursUnknown`, a gallery of `pb.files.getURL(place, f, { thumb: '800x0' })` with `data-testid="venue-photo-{i}"`, and a footer with the primary `<button data-testid="sheet-add" disabled={busy} onclick={onadd}>{copy.addThisStop}</button>` and `<button class="secondary" data-testid="venue-sheet-close" onclick={onclose}>{copy.closeSheet}</button>`. On `venue` change with a `placeRef`, `api<{ place: Place | null }>('/api/places/photos', { method: 'POST', json: { placeRef } })` into local `place` state (errors → no photos). Copy the `.sheet` styles from `StopSheet.svelte`.
  - Add page: keep `nearby`/`results`; `const openVenueObj = $derived([...(nearby ?? []), ...(results ?? [])].find((v) => tid(v) === sheetVenueId()) ?? null);` Venue rows call `openVenue(tid(v))` instead of `add(v)`. Render
```svelte
<VenueSheet venue={openVenueObj} weekday={itinerary ? fmtWeekday(itinerary.event_date) : ''}
  walkMin={openVenueObj && station ? walkMinutes(haversineM(station.lat, station.lon, openVenueObj.lat, openVenueObj.lon)) : 0}
  busy={!!busy} onadd={() => openVenueObj && void add(openVenueObj)} onclose={closeVenue} />
```
    `add()` navigates away with `goto`, which replaces the sheet state; no extra close needed. The manual form still calls `add` directly.
  - Labels.

- [ ] **Step 4:** e2e planning spec → PASS; `npm run check`.
- [ ] **Step 5: Commit** — `feat(plan): tap a venue on Add Stop for its photos, then add it`.

---

### Task 9: Stop sheet in the editor

**Files:**
- Modify: `web/src/lib/components/StopSheet.svelte` (optional `photos`, `detailsLink`), `web/src/routes/(app)/plan/[id]/edit/+page.svelte`, `web/src/routes/(app)/plan/[id]/stops/[stopId]/+page.svelte:97`
- Test: `web/tests/e2e/planning.spec.ts`, `web/tests/e2e/liveEdit.spec.ts`

**Interfaces:**
- Consumes: `openStop`/`closeStop` from `$lib/nav`; `ItineraryView`'s existing `onopenstop` prop.
- Produces: `StopSheet` props `photos?: Record<string, string>` (fallback thumb when the stop has no `expand.place`), `detailsLink?: boolean` (default `true`; the link also still needs `isAdmin`).

- [ ] **Step 1: Failing e2e.**
  - `planning.spec.ts` (big test): replace `await page.getByTestId('stop-link-1').click();` with
```ts
  await page.getByTestId('stop-link-1').click();
  await expect(page.getByTestId('stop-sheet')).toBeVisible();
  await expect(page.getByTestId('sheet-add')).toHaveCount(0);
  await page.getByTestId('sheet-close').click();
  await expect(page).toHaveURL(editUrl);
  await expect(page.getByTestId('dwell-0')).toBeVisible();
  await page.getByTestId('stop-link-1').click();
  await page.getByTestId('sheet-edit').click();
```
    and after the detail-page `reload` assertions, `await page.getByTestId('back').click(); await expect(page).toHaveURL(editUrl);` — use the detail page back link's test id (add `testid="stop-back"` to that `IconLink` and use it).
  - `liveEdit.spec.ts`: after a staged dwell change in an existing test, tap `stop-link-0`, expect `stop-sheet` visible and `sheet-edit` count 0, close, and expect the staged dwell option still selected and Save still enabled.

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: Implement.**
  - `StopSheet.svelte`: add props `photos = undefined as Record<string, string> | undefined, detailsLink = true`; gallery falls back to `photos?.[stop.id]` as a single image item when `place` is absent; the edit link condition becomes `isAdmin && detailsLink`.
  - Edit page: `import StopSheet` and `openStop` from `$lib/nav`; pass `onopenstop={openStop}` to `ItineraryView`; render
```svelte
    <StopSheet stops={sheetStops} media={[]} eventDate={draft.itinerary.event_date} itineraryId={draft.itinerary.id}
      isAdmin={editable} detailsLink={!live} photos={stopPhotos(draft.stops)} />
```
    with
```ts
  // The sheet reads Stop records; a staged stop that is not saved yet borrows what it has.
  const sheetStops = $derived(!draft ? [] : live && plan
    ? plan.stops.map((s) => ({ ...(draft!.stops.find((d) => d.id === s.id) ?? {}), ...s }) as unknown as Stop)
    : draft.stops);
```
  - Detail page back link: `<IconLink href="/plan/{data.id}" icon="back" label={copy.backToDraft} testid="stop-back" onclick={(e) => { if (history.length > 1 && document.referrer.startsWith(location.origin)) { e.preventDefault(); history.back(); } }} />` — if `IconLink` lacks `onclick`, add an optional `onclick` prop passed to its `<a>`.

- [ ] **Step 4:** both e2e specs → PASS; `npm run check`.
- [ ] **Step 5: Commit** — `feat(plan): the editor opens stops in the sheet and keeps you in the editor`.

---

### Task 10: Full verification and docs

- [ ] **Step 1:** `cd web && npm test && npm run check && npm run test:e2e`, then `bash scripts/test-hooks.sh` from the repo root. All green; paste the counts in the handoff.
- [ ] **Step 2:** README: confirm the glossary rows for **Board at** and the venue sheet ("Venue sheet: Add Stop; photos, hours, Add stop"). OPERATIONS.md: note that opening a venue on Add Stop may spend 1 details + up to 5 photo calls the first time.
- [ ] **Step 3: Commit** docs — `docs: Board at and the venue sheet`.
