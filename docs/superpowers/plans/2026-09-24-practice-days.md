# Practice Days Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One deployment and one database, where the Conductor selects the current route and Live runs it every day: as the real event on its date, and as practice on any other day. Activity is shown one day at a time and is never deleted.

**Architecture:**
- A `crawl_settings` singleton names the current route. One resolver (`$lib/live/route.ts`) reads it on the client, and the media hook reads the same setting on the server.
- `liveDay` keeps three clocks:
  - `realNow`: the client clock, used for event-day detection.
  - `now`: plan time, which is real time projected onto the route's date on practice days.
  - `today`: the **server's** Chicago date from `GET /api/day`.
- Every activity row is stamped by the server, including drinks (new hook). Every live-day read is limited to `today`'s UTC bounds.
- Shared rehearsal (`compose.rehearsal.yml`, `REHEARSAL` in `up.sh`) is removed. The isolated sim harness stays.

**Tech Stack:** SvelteKit 2 / Svelte 5 runes, PocketBase 0.3x JS hooks and migrations, Vitest, Playwright, Google Places API (script only).

**Spec:** `docs/superpowers/specs/2026-09-24-practice-days-design.md`

## Global Constraints

- User-visible strings live only in `web/src/lib/labels.ts`. The README's UI glossary is the source of truth for names.
- Tests are written before the code they cover. Each task ends green on: `cd web && npm test && npm run check && npm run test:e2e`, plus `bash scripts/test-hooks.sh`.
- Times are UTC in the database and in every payload. Rendering to America/Chicago goes only through `$lib/time.ts`.
- `pb_hooks/planning.pb.js` forces new itineraries to `draft`. Locking is an update, including in seeds and the canned-route script.
- PocketBase list rules filter, they do not reject. Assert on the empty page, not the status code.
- Never point a dev or test server at 8090 or 3000. Run one test run at a time (e2e uses 15173/18093).
- Nothing plans legs except `computeLegs`. A practice day must never re-plan legs from an off-day anchor.
- `ItineraryView` writes nothing itself. "Make current" is a page-level control, not part of a shared view.
- **Spec refinement (Task 1):** drinks are stamped by the server like chat, photos and Bulletins, and "today" comes from the server. The spec said "the drink `at` comes from the client's wall time". This refinement keeps a phone with a wrong clock from putting activity on the wrong day, and keeps e2e tests (which fake the browser clock to 2026-12-26) consistent with rows the server stamps in real time. Task 1 updates the spec text.

## Review Focus

- **A phone whose clock is wrong or faked** (e2e installs 2026-12-26) must still see the server's rows for today. Pinned by Task 1 (server stamps) and Task 4 (`today` from `/api/day`), and asserted in the Task 6 e2e tests.
- **A client open across Chicago midnight** empties its chat, Tab and Freight without a reload, and never shows yesterday's Bulletin pinned, **even when the reloads fail or the day endpoint is unreachable**. Task 4 unit tests "empties yesterday's activity at midnight even when every reload fails", "drops a read that started yesterday…" and "keeps counting the server's day…".
- **A route switch** (Make current) never leaves the old route's trains, chat or Bulletins on screen, even for a moment while the reloads are slow or failing. Task 4 "switching the current route" tests and the Task 6 two-browser e2e.
- **A Save in the locked-route editor on a practice day** must not treat the day as the event day. The editor's `cohesionBlockers` receives `realNow`, not plan time. Task 6 unit test in `cohesion.test.ts`.
- **A stale `crawl_settings.current_itinerary`** that points at an archived or deleted route falls back to the newest locked route, both in the client resolver and in the media hook. Task 3 unit and hook tests.
- **Pending (unsaved) drink taps** still count on the Tab immediately, even though their client `at` may be on another date than the server's `today`. Task 6 e2e: the existing `tab.spec.ts` tests must stay green unchanged.

---

## File Structure

| File | Responsibility |
|---|---|
| `web/src/lib/time.ts` (modify) | add `nextDate(date)` and `dayBounds(date)` |
| `web/src/routes/api/day/+server.ts` (create) | `GET` returns `{ today }`, the server's Chicago date (sim-aware) |
| `pocketbase/pb_hooks/live.pb.js` (modify) | stamp drink `at` server-side; media tags only current-route stops |
| `pocketbase/pb_hooks/current.js` (create) | `currentItineraryId(app)`, shared by hooks |
| `pocketbase/pb_migrations/1758850000_crawl_settings.js` (create) | `crawl_settings` collection and its singleton row |
| `web/src/lib/live/planClock.ts` (create) | `isEventDay`, `projectToPlanDate`, `planNow` |
| `web/src/lib/live/route.ts` (create) | `resolveCurrentRoute()`, `setCurrentRoute(id)` |
| `web/src/lib/live/day.svelte.ts` (modify) | clocks, resolver, day-scoped reads, practice trains, rollover |
| `web/src/lib/live/feed.ts` (modify) | `fetchNext(..., practice)`, `fetchDay()` |
| `web/src/routes/api/metra/next/+server.ts` (modify) | `practice=1` returns timetable only |
| `web/src/routes/(app)/**` and `routes/+layout.svelte` (modify) | practice gating, badge, "Make current" |
| `web/scripts/practice-route.mjs`, `web/scripts/practice-venues.mjs` (create) | the one-time canned route |
| deletions | shared rehearsal files (Task 7) |

---

### Task 1: The server stamps everything, and `/api/day` says what day it is

**Files:**
- Modify: `web/src/lib/time.ts` (append after `todayInTz`, line ~91)
- Create: `web/src/routes/api/day/+server.ts`
- Modify: `pocketbase/pb_hooks/live.pb.js` (append a drink hook)
- Modify: `docs/superpowers/specs/2026-09-24-practice-days-design.md` ("Activity by date" last bullet)
- Test: `web/tests/unit/time.test.ts`, `web/tests/unit/dayEndpoint.test.ts` (create), `web/tests/hooks/live.test.ts`

**Interfaces:**
- Produces:
  - `nextDate(date: string): string`
  - `dayBounds(date: string): { start: string; end: string }` (UTC ISO strings, Chicago day, DST-safe)
  - `GET /api/day` → `{ today: string; now: string }` (`now` is the server's clock as UTC ISO)
  - drink rows whose `at` is always server time

- [ ] **Step 1: Write the failing tests**

`web/tests/unit/time.test.ts` (append):
```ts
import { dayBounds, nextDate } from '../../src/lib/time';
describe('dayBounds', () => {
  it('spans one Chicago calendar day in UTC', () => {
    expect(dayBounds('2026-12-26')).toEqual({ start: '2026-12-26T06:00:00.000Z', end: '2026-12-27T06:00:00.000Z' });
  });
  it('is 25 hours on the fall-back day and 23 on spring-forward', () => {
    const len = (d: string) => (Date.parse(dayBounds(d).end) - Date.parse(dayBounds(d).start)) / 3_600_000;
    expect(len('2026-11-01')).toBe(25);
    expect(len('2026-03-08')).toBe(23);
  });
  it('rolls months and years', () => {
    expect(nextDate('2026-12-31')).toBe('2027-01-01');
    expect(nextDate('2028-02-28')).toBe('2028-02-29');
  });
});
```
(If `describe`/`it` imports are missing at the top of the file, add them from `vitest`.)

`web/tests/unit/dayEndpoint.test.ts`:
```ts
import { expect, it, vi } from 'vitest';
vi.mock('$lib/server/pb', () => ({ requireUser: vi.fn(async () => ({ id: 'u1' })) }));
vi.mock('$lib/server/sim/service', async (orig) => ({
  ...(await orig<object>()),
  simulationClock: { readContext: vi.fn(async () => ({ enabled: false, eventNow: '2026-09-25T04:30:00.000Z', serverWallNow: '2026-09-25T04:30:00.000Z' })) }
}));
it('answers with the Chicago date of the server clock, not UTC', async () => {
  const { GET } = await import('../../src/routes/api/day/+server');
  const res = await GET({ request: new Request('http://x/api/day') } as never);
  expect(await res.json()).toEqual({ today: '2026-09-24', now: '2026-09-25T04:30:00.000Z' });
  expect(res.headers.get('cache-control')).toBe('no-store');
});
```
Check first where `simulationClock` is exported (`grep -rn "export const simulationClock" web/src/lib/server`) and point the mock at that module.

`web/tests/hooks/live.test.ts` (append inside a new `describe('drink_entries')`):
```ts
it('stamps a drink with server time, whatever time the phone sent', async () => {
  const before = Date.now();
  const res = await post('/api/collections/drink_entries/records', {
    user: crewId, stop: stopId, kind: 'beer', at: '2020-01-01T00:00:00.000Z'
  }, crew);
  expect(res.status).toBe(200);
  const at = Date.parse((await res.json()).at);
  expect(at).toBeGreaterThanOrEqual(before - 5000);
  expect(at).toBeLessThanOrEqual(Date.now() + 5000);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run tests/unit/time.test.ts tests/unit/dayEndpoint.test.ts && cd .. && bash scripts/test-hooks.sh`
Expected: FAIL. `dayBounds`/`nextDate` are not exported, `api/day/+server` is missing, and the drink `at` is `2020-01-01…`.

- [ ] **Step 3: Implement**

`web/src/lib/time.ts` (append):
```ts
/** The calendar day after `date` (YYYY-MM-DD). */
export function nextDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** UTC bounds [start, end) of one Chicago calendar day; 23 or 25 hours across DST. */
export function dayBounds(date: string): { start: string; end: string } {
  return { start: localToUtc(date, 0).toISOString(), end: localToUtc(nextDate(date), 0).toISOString() };
}
```

`web/src/routes/api/day/+server.ts`:
```ts
// The server's calendar day. Every activity row is stamped by the server, so "today" on Live has to
// be the server's today too, not whatever the phone's clock claims.
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/pb';
import { simulationClock } from '$lib/server/sim/service';
import { todayInTz } from '$lib/time';

export const GET: RequestHandler = async ({ request }) => {
  await requireUser(request);
  const context = await simulationClock.readContext();
  // `now` lets the client keep counting the server's day between polls and while offline.
  return json({ today: todayInTz(new Date(context.eventNow)), now: context.eventNow }, { headers: { 'cache-control': 'no-store' } });
};
```
(Use the same import path for `simulationClock` as `routes/api/plan/commit/+server.ts`.)

`pocketbase/pb_hooks/live.pb.js` (append):
```js
// Drinks are stamped by the server like every other live row, so a phone's wrong clock cannot put a
// round on the wrong day. The client's `at` is only its optimistic guess.
onRecordCreateRequest((e) => {
  e.record.set('at', require(`${__hooks}/clock.js`).eventNow(e.app))
  e.next()
}, 'drink_entries')
```

In the spec, replace the sentence "the drink `at` comes from the client's wall time, and the drink rule does not change" with: "Drinks are stamped by a create hook with `clock.js` `eventNow`, like chat, photos and Bulletins. `today` comes from `GET /api/day`, the server's Chicago date."

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run tests/unit/time.test.ts tests/unit/dayEndpoint.test.ts && cd .. && bash scripts/test-hooks.sh`
Expected: PASS. Then run the full `npm test` and `npm run test:e2e`: `tab.spec.ts` sorts by `at`, and server stamps are monotonic, so it must stay green.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/time.ts web/src/routes/api/day pocketbase/pb_hooks/live.pb.js web/tests docs/superpowers/specs
git commit -m "feat(live): server-stamped drinks and a server day endpoint"
```

---

### Task 2: Plan time

**Files:**
- Create: `web/src/lib/live/planClock.ts`
- Test: `web/tests/unit/planClock.test.ts`

**Interfaces:**
- Produces:
  - `isEventDay(eventDate: string, realNow: Date): boolean`
  - `projectToPlanDate(realNow: Date, eventDate: string): Date`
  - `planNow(eventDate: string | null, realNow: Date): Date`, which returns `realNow` when there is no route or on the event day

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { isEventDay, planNow, projectToPlanDate } from '../../src/lib/live/planClock';

describe('plan clock', () => {
  it('is the event day only on the route date in Chicago', () => {
    expect(isEventDay('2026-12-26', new Date('2026-12-26T06:00:00Z'))).toBe(true);   // 00:00 CST
    expect(isEventDay('2026-12-26', new Date('2026-12-26T05:59:00Z'))).toBe(false);  // still the 25th
  });
  it('lays today’s time of day onto the route date', () => {
    // Tuesday 14:05 CDT → the event day's 14:05 CST
    expect(projectToPlanDate(new Date('2026-09-22T19:05:00Z'), '2026-12-26').toISOString()).toBe('2026-12-26T20:05:00.000Z');
  });
  it('keeps real time on the event day and when there is no route', () => {
    const now = new Date('2026-12-26T18:00:00Z');
    expect(planNow('2026-12-26', now)).toBe(now);
    expect(planNow(null, now)).toBe(now);
  });
  it('projects across midnight without wrapping to the next day', () => {
    // 23:59 Chicago practice → 23:59 on the event date, never 00:00 of the day after
    const p = projectToPlanDate(new Date('2026-09-23T04:59:00Z'), '2026-12-26');
    expect(p.toISOString()).toBe('2026-12-27T05:59:00.000Z');
  });
  it('keeps seconds, so 23:59:30 stays on the event date', () => {
    const p = projectToPlanDate(new Date('2026-09-23T04:59:30.250Z'), '2026-12-26');
    expect(p.toISOString()).toBe('2026-12-27T05:59:30.250Z');
  });
  it('uses the wall-clock time on DST transition days, not minutes since midnight', () => {
    // 2026-03-08 spring forward: 14:00 CDT is 13 elapsed hours after midnight, but it is still 14:00
    expect(projectToPlanDate(new Date('2026-03-08T19:00:00Z'), '2026-12-26').toISOString()).toBe('2026-12-26T20:00:00.000Z');
    // 2026-11-01 fall back: 14:00 CST is 15 elapsed hours after midnight
    expect(projectToPlanDate(new Date('2026-11-01T20:00:00Z'), '2026-12-26').toISOString()).toBe('2026-12-26T20:00:00.000Z');
  });
  it('resolves a time the route date skips or repeats the way localToUtc does', () => {
    // Practising at 02:30 for a route on 2027-03-14 (02:00-03:00 does not exist): the transition instant
    expect(projectToPlanDate(new Date('2026-09-22T07:30:00Z'), '2027-03-14').toISOString()).toBe('2027-03-14T08:00:00.000Z');
    // Practising at 01:30 for a route on 2026-11-01 (01:00-02:00 happens twice): the first one, CDT
    expect(projectToPlanDate(new Date('2026-09-22T06:30:00Z'), '2026-11-01').toISOString()).toBe('2026-11-01T06:30:00.000Z');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run tests/unit/planClock.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// Practice days: any day that is not the route's date runs the route at today's time of day on its
// own date, so the board shows the trains the crew would catch then. Only the timetable follows
// plan time; everything people post stays on real time.
import { localToUtc, TZ, todayInTz } from '$lib/time';

const clock = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function isEventDay(eventDate: string, realNow: Date): boolean {
  return todayInTz(realNow) === eventDate;
}

/** The Chicago wall-clock time of `realNow` on `eventDate`. Not `minutesOfDay`: that counts elapsed
 *  minutes, which is an hour off on DST transition days, and it rounds away the seconds. A time the
 *  event date skips or repeats resolves as `localToUtc` resolves it (transition instant, first occurrence). */
export function projectToPlanDate(realNow: Date, eventDate: string): Date {
  const part = (type: string) => Number(clock.formatToParts(realNow).find((p) => p.type === type)!.value);
  const base = localToUtc(eventDate, part('hour') * 60 + part('minute')).getTime();
  return new Date(base + part('second') * 1000 + realNow.getUTCMilliseconds());
}

export function planNow(eventDate: string | null, realNow: Date): Date {
  return !eventDate || isEventDay(eventDate, realNow) ? realNow : projectToPlanDate(realNow, eventDate);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx vitest run tests/unit/planClock.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/live/planClock.ts web/tests/unit/planClock.test.ts
git commit -m "feat(live): plan clock for practice days"
```

---

### Task 3: The current route (`crawl_settings`, resolver, media hook)

**Files:**
- Create: `pocketbase/pb_migrations/1758850000_crawl_settings.js`
- Create: `pocketbase/pb_hooks/current.js`
- Modify: `pocketbase/pb_hooks/live.pb.js:6-30` (media tagging)
- Create: `web/src/lib/live/route.ts`
- Modify: `web/src/lib/types.ts` (add `CrawlSettings`)
- Test: `web/tests/hooks/currentRoute.test.ts` (create), `web/tests/unit/route.test.ts` (create), `web/tests/hooks/migrations.test.ts` (add the collection if it enumerates collections)

**Interfaces:**
- Produces:
  - collection `crawl_settings`: id `crawlsettings`, field `current_itinerary` (relation, optional)
  - `resolveCurrentRoute(): Promise<Itinerary | null>`
  - `setCurrentRoute(id: string): Promise<void>`
  - hook helper `require(`${__hooks}/current.js`).currentItineraryId(app): string`

- [ ] **Step 1: Write the failing hook test**

`web/tests/hooks/currentRoute.test.ts`:
```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, get, loginToken, patch, post, superuserToken, PB } from './setup';

let conductor = '', crew = '', conductorId = '', crewId = '';
const route = async (title: string, date: string) => {
  const it = await (await post('/api/collections/itineraries/records', { title, event_date: date, start_time: '11:00', created_by: conductorId }, conductor)).json();
  await patch(`/api/collections/itineraries/records/${it.id}`, { status: 'locked' }, conductor);
  const stop = await (await post('/api/collections/stops/records', { itinerary: it.id, order: 1, name: `${title} bar`, station_id: 'LAGRANGE', dwell_min: 30, walk_min: 2 }, conductor)).json();
  return { id: it.id as string, stopId: stop.id as string };
};

beforeAll(async () => {
  ({ token: conductor, id: conductorId } = await loginToken('Current Conductor', ADMIN_LOGIN_PASSWORD));
  ({ token: crew, id: crewId } = await loginToken('Current Crew'));
});

describe('crawl_settings', () => {
  it('lets anyone signed in read it and only the Conductor change it', async () => {
    const a = await route('Settings A', '2026-10-03');
    expect((await get('/api/collections/crawl_settings/records/crawlsettings', crew)).status).toBe(200);
    expect((await patch('/api/collections/crawl_settings/records/crawlsettings', { current_itinerary: a.id }, crew)).status).toBe(404);
    expect((await patch('/api/collections/crawl_settings/records/crawlsettings', { current_itinerary: a.id }, conductor)).status).toBe(200);
  });
  it('hides it from strangers', async () => {
    const res = await get('/api/collections/crawl_settings/records');
    expect((await res.json()).items ?? []).toHaveLength(0);
  });
});

describe('media tagging follows the current route', () => {
  it('tags a photo to a current-route stop and blanks a stop from another locked route', async () => {
    const current = await route('Media current', '2026-10-10');
    const other = await route('Media other', '2026-10-17');
    await patch('/api/collections/crawl_settings/records/crawlsettings', { current_itinerary: current.id }, conductor);
    const upload = async (stop: string) => {
      const form = new FormData();
      form.set('user', crewId); form.set('stop', stop); form.set('kind', 'photo');
      form.set('file', new Blob([Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0))], { type: 'image/gif' }), 'x.gif');
      return (await fetch(`${PB}/api/collections/media/records`, { method: 'POST', headers: { Authorization: crew }, body: form })).json();
    };
    expect((await upload(current.stopId)).stop).toBe(current.stopId);
    expect((await upload(other.stopId)).stop).toBe('');
  });
  it('falls back to the newest locked route when the setting points at an archived one', async () => {
    const stale = await route('Stale', '2026-10-24');
    await patch('/api/collections/crawl_settings/records/crawlsettings', { current_itinerary: stale.id }, conductor);
    await patch(`/api/collections/itineraries/records/${stale.id}`, { status: 'archived' }, await superuserToken());
    const newest = await route('Newest', '2026-10-31');
    // A photo for the newest locked route is kept, because the stale setting no longer counts.
    const form = new FormData();
    form.set('user', crewId); form.set('stop', newest.stopId); form.set('kind', 'photo');
    form.set('file', new Blob([new Uint8Array([71, 73, 70])], { type: 'image/gif' }), 'x.gif');
    const row = await (await fetch(`${PB}/api/collections/media/records`, { method: 'POST', headers: { Authorization: crew }, body: form })).json();
    expect(row.stop).toBe(newest.stopId);
  });
});
```
Confirm the media `kind` values in `pocketbase/pb_migrations/1758700000_live.js` (`photo`/`video`) and whether `status: 'archived'` is a valid itinerary status (see `1758400000_planning.js`). Adjust the literals to match before running. If a 3-byte GIF is rejected, use the full base64 GIF from `tests/e2e/liveUx.spec.ts:7`.

`web/tests/unit/route.test.ts`:
```ts
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getOne: vi.fn(), getFullList: vi.fn(), update: vi.fn() }));
vi.mock('$lib/pb', () => ({ pb: { collection: () => mocks, filter: (s: string) => s } }));
const { resolveCurrentRoute } = await import('../../src/lib/live/route');
beforeEach(() => vi.clearAllMocks());

it('uses the selected route when it is locked', async () => {
  mocks.getOne.mockImplementation(async (id: string) => id === 'crawlsettings'
    ? { current_itinerary: 'r1', expand: { current_itinerary: { id: 'r1', status: 'locked' } } } : null);
  expect((await resolveCurrentRoute())?.id).toBe('r1');
  expect(mocks.getFullList).not.toHaveBeenCalled();
});
it('falls back to the newest locked route when nothing is selected or the selection is stale', async () => {
  mocks.getFullList.mockResolvedValue([{ id: 'r9', status: 'locked' }]);
  mocks.getOne.mockResolvedValue({ current_itinerary: 'r1', expand: { current_itinerary: { id: 'r1', status: 'archived' } } });
  expect((await resolveCurrentRoute())?.id).toBe('r9');
  mocks.getOne.mockResolvedValue({ current_itinerary: '' });
  expect((await resolveCurrentRoute())?.id).toBe('r9');
});
it('has no route when nothing is locked', async () => {
  mocks.getOne.mockRejectedValue(new Error('404'));
  mocks.getFullList.mockResolvedValue([]);
  expect(await resolveCurrentRoute()).toBeNull();
});
it('lets a network failure propagate so liveDay can fall back to its mirror', async () => {
  mocks.getOne.mockRejectedValue(Object.assign(new Error('offline'), { status: 0 }));
  mocks.getFullList.mockRejectedValue(Object.assign(new Error('offline'), { status: 0 }));
  await expect(resolveCurrentRoute()).rejects.toThrow('offline');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `bash scripts/test-hooks.sh` and `cd web && npx vitest run tests/unit/route.test.ts`
Expected: FAIL. The collection does not exist (404s) and the module is missing.

- [ ] **Step 3: Implement**

`pocketbase/pb_migrations/1758850000_crawl_settings.js`:
```js
// The Conductor's choice of which locked route is "the" route: Live, the home page, The Route and
// photo tagging all follow it. One row; reading needs a login, writing needs a Conductor.
migrate((app) => {
  const itineraries = app.findCollectionByNameOrId('itineraries')
  const collection = new Collection({
    type: 'base',
    name: 'crawl_settings',
    listRule: "@request.auth.id != ''",
    viewRule: "@request.auth.id != ''",
    createRule: null,
    updateRule: '@request.auth.is_admin = true',
    deleteRule: null,
    fields: [
      { name: 'current_itinerary', type: 'relation', collectionId: itineraries.id, maxSelect: 1, required: false, cascadeDelete: false },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
    ]
  })
  app.save(collection)
  const row = new Record(collection)
  row.set('id', 'crawlsettings')
  app.save(row)
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId('crawl_settings')) } catch (_) {}
})
```

`pocketbase/pb_hooks/current.js`:
```js
// The current route for server-side decisions, as the web client resolves it: the Conductor's
// selection if it is still locked, else the most recently locked route, else ''.
module.exports.currentItineraryId = function (app) {
  try {
    const id = app.findRecordById('crawl_settings', 'crawlsettings').getString('current_itinerary')
    if (id && app.findRecordById('itineraries', id).getString('status') === 'locked') return id
  } catch (_) {}
  try {
    const rows = app.findRecordsByFilter('itineraries', 'status = "locked"', '-locked_at', 1, 0)
    return rows.length ? rows[0].id : ''
  } catch (_) { return '' }
}
```

`pocketbase/pb_hooks/live.pb.js`: replace the `ok` calculation (lines 13-19) with:
```js
      const stop = $app.findRecordById('stops', stopId)
      ok = stop.getString('itinerary') === require(`${__hooks}/current.js`).currentItineraryId($app)
```
Also update the comment above the hook to: "Trust it only when that stop belongs to the current route."

`web/src/lib/types.ts` (append):
```ts
export type CrawlSettings = RecordModel & { current_itinerary: string; expand?: { current_itinerary?: Itinerary } };
```

`web/src/lib/live/route.ts`:
```ts
// Which route the app is about: the Conductor's selection while it is still locked, otherwise the
// most recently locked one. Everything that means "the route" goes through here.
import { pb } from '$lib/pb';
import type { CrawlSettings, Itinerary } from '$lib/types';

const isMissing = (e: unknown) => (e as { status?: number })?.status === 404;

export async function resolveCurrentRoute(): Promise<Itinerary | null> {
  try {
    const settings = await pb.collection('crawl_settings').getOne<CrawlSettings>('crawlsettings', { expand: 'current_itinerary', cache: 'no-store' });
    const chosen = settings.expand?.current_itinerary;
    if (chosen?.status === 'locked') return chosen;
  } catch (e) { if (!isMissing(e)) throw e; }
  const list = await pb.collection('itineraries').getFullList<Itinerary>({ filter: 'status = "locked"', sort: '-locked_at', cache: 'no-store' });
  return list[0] ?? null;
}

export async function setCurrentRoute(id: string): Promise<void> {
  await pb.collection('crawl_settings').update('crawlsettings', { current_itinerary: id });
}
```
Note that the unit test's "stale selection" case mocks `getOne` resolving with an archived expand. That path must fall through to `getFullList` without throwing. The last unit test needs `getOne` to fail with status 0 and propagate, which it does because only a 404 is swallowed.

- [ ] **Step 4: Run to verify they pass**

Run: `bash scripts/test-hooks.sh && cd web && npx vitest run tests/unit/route.test.ts` → PASS. The existing media tests in `web/tests/hooks/live.test.ts` must still pass. Their route is the newest locked one and no selection is set, so the fallback applies. If an earlier test file left a selection set, clear it in that file's `beforeAll` with a superuser `PATCH … { current_itinerary: '' }`.

- [ ] **Step 5: Commit**

```bash
git add pocketbase web/src/lib/live/route.ts web/src/lib/types.ts web/tests
git commit -m "feat: crawl_settings current route, shared by the client and the media hook"
```

---

### Task 4: `liveDay` follows the current route, plan time and the server's day

**Files:**
- Modify: `web/src/lib/live/day.svelte.ts` (fields near lines 13-45, `loadRoute` 67-108, `loadBulletins` 125-139, `loadFeed` 141-158, `loadTrains`/`loadAlerts` 190-212, `start` 214-252)
- Modify: `web/src/lib/live/feed.ts` (add `fetchDay`, add a `practice` arg to `fetchNext`)
- Test: `web/tests/unit/liveDay.test.ts` (append), `web/tests/unit/offlineDay.test.ts` (adjust if it asserts on the locked-list call)

**Interfaces:**
- Consumes:
  - `resolveCurrentRoute()` (Task 3)
  - `planNow`, `isEventDay` (Task 2)
  - `dayBounds` (Task 1)
  - `GET /api/day` (Task 1)
- Produces, on `LiveDay`:
  - `realNow: Date` ($state): the client clock (`clientClock.eventNow()`)
  - `now: Date` ($state): plan time
  - `serverOffset: number | null` ($state): server clock minus phone clock, in ms
  - `get today(): string`, which is `todayInTz(realNow + (serverOffset ?? 0))`
  - `enterScope(reload = true): void`, which clears activity and trains and, with `reload`, reloads them for the current route and day
  - `checkScope(): Promise<void>`, which calls `enterScope()` when the route or `today` changed
  - `get hasRoute(): boolean`
  - `get isEventDay(): boolean`
  - `get practice(): boolean`, which is `hasRoute && !isEventDay`
  - `get isToday()`, **removed**. Every caller moves to `hasRoute`/`isEventDay` (Task 6).
  - `syncPlan(): void`, which recomputes `now` from `realNow` (pure, used by tests)
  - `syncNow(): void`, which sets `realNow` from `clientClock.eventNow()`, then `syncPlan()`
  - `get effectiveAnchor()`, which is `isEventDay ? anchor : null` (the only anchor `here` uses)
  - `loadDay(): Promise<void>`, which refreshes `serverOffset`, then `checkScope()`
- `feed.ts`:
  - `fetchDay(): Promise<{ today: string; now: string }>`
  - `fetchNext(from, to, date, after, practice = false)`

- [ ] **Step 1: Write the failing tests** (append to `web/tests/unit/liveDay.test.ts`)

Extend the hoisted mocks with `getOne: vi.fn()` in the collection stub, mock `$lib/live/route` and extend the `$lib/live/feed` mock:
```ts
vi.mock('$lib/live/route', () => ({ resolveCurrentRoute: mocks.resolve }));
vi.mock('$lib/live/feed', () => ({ fetchStatus: async () => ({ mode: 'schedule_only' }), fetchDay: mocks.fetchDay, fetchNext: mocks.fetchNext, fetchAlerts: mocks.fetchAlerts }));
```
(Add `resolve`, `fetchDay`, `fetchNext`, `fetchAlerts` as `vi.fn()` to `mocks`. Replace the existing `$lib/live/feed` mock line rather than adding a second one.)

```ts
const route = { id: 'r1', event_date: '2026-12-26', start_time: '11:00', status: 'locked' } as Itinerary;

describe('practice days', () => {
  it('is a practice day on any other date, with plan time on the route date', () => {
    const day = new LiveDay();
    day.itinerary = route;
    day.realNow = new Date('2026-09-22T19:05:00Z');
    day.syncPlan();
    expect(day.hasRoute).toBe(true);
    expect(day.isEventDay).toBe(false);
    expect(day.practice).toBe(true);
    expect(day.now.toISOString()).toBe('2026-12-26T20:05:00.000Z');
  });
  it('ignores the Conductor’s position on a practice day', () => {
    const day = new LiveDay();
    day.itinerary = route; day.stops = [] as never;
    day.anchor = { stopId: 's2', at: '2026-09-22T18:00:00Z' };
    day.realNow = new Date('2026-09-22T19:05:00Z'); day.syncPlan();
    expect(day.effectiveAnchor).toBeNull();
    day.realNow = new Date('2026-12-26T19:05:00Z'); day.syncPlan();
    expect(day.effectiveAnchor).toEqual(day.anchor);
  });
  it('asks for timetable-only trains on a practice day and skips alerts', async () => {
    mocks.fetchNext.mockResolvedValue({ trips: [], mode: 'schedule_only', fetchedAt: null });
    const day = new LiveDay();
    day.itinerary = route;
    day.stops = [
      { id: 'a', order: 1, station_id: 'LAGRANGE', dwell_min: 30, walk_min: 2 },
      { id: 'b', order: 2, station_id: 'CUS', dwell_min: 30, walk_min: 2 }
    ] as never;
    day.legs = [{ from_stop: 'a', to_stop: 'b', kind: 'train', depart_at: '2026-12-26T20:34:00Z', arrive_at: '2026-12-26T20:49:00Z' }] as never;
    day.realNow = new Date('2026-09-22T17:30:00Z'); day.syncPlan();
    await day.loadTrains();
    expect(mocks.fetchNext).toHaveBeenCalledWith('LAGRANGE', 'CUS', '2026-12-26', day.now, true);
    await day.loadAlerts();
    expect(mocks.fetchAlerts).not.toHaveBeenCalled();
    expect(day.alerts).toEqual([]);
  });
});

describe('one day at a time', () => {
  it('reads activity only inside the server day', async () => {
    mocks.getFullList.mockResolvedValue([]);
    const day = new LiveDay();
    day.itinerary = route; day.serverOffset = 0; day.realNow = new Date('2026-09-24T18:00:00Z');
    await day.loadFeed();
    const filters = mocks.filter.mock.calls.map((c) => [c[0], c[1]]);
    expect(filters).toContainEqual([expect.stringContaining('at >= {:start} && at < {:end}'), expect.objectContaining({ start: '2026-09-24T05:00:00.000Z', end: '2026-09-25T05:00:00.000Z' })]);
    expect(filters).toContainEqual([expect.stringContaining('created >= {:start} && created < {:end}'), expect.anything()]);
  });
  it('limits Bulletins to the day, and acks to those Bulletins', async () => {
    mocks.getFullList.mockResolvedValueOnce([{ id: 'b1' }]).mockResolvedValueOnce([]);
    const day = new LiveDay();
    day.itinerary = route; day.serverOffset = 0; day.realNow = new Date('2026-09-24T18:00:00Z');
    await day.loadBulletins();
    const texts = mocks.filter.mock.calls.map((c) => c[0]);
    expect(texts).toContainEqual(expect.stringContaining('itinerary = {:id} && at >= {:start} && at < {:end}'));
    expect(texts).toContainEqual(expect.stringContaining('broadcast.itinerary = {:id} && broadcast.at >= {:start}'));
  });
  const yesterday = () => {
    const day = new LiveDay();
    day.itinerary = route; day.realNow = new Date('2026-09-25T04:58:00Z');   // 23:58 CDT on the 24th
    day.serverOffset = 0; day.enterScope(false);
    day.feed = { drinks: [{ id: 'd1' }], media: [{ id: 'm1' }], messages: [{ id: 'c1' }], reactions: [] } as never;
    day.bulletins = [{ id: 'b1' }] as never;
    return day;
  };
  it('empties yesterday’s activity at midnight even when every reload fails', async () => {
    mocks.getFullList.mockRejectedValue(new Error('offline'));
    const day = yesterday();
    expect(day.pinnedBulletin?.id).toBe('b1');
    day.realNow = new Date('2026-09-25T05:01:00Z');                          // 00:01 on the 25th
    await day.checkScope();
    expect(day.today).toBe('2026-09-25');
    expect(day.feed.messages).toEqual([]);
    expect(day.feed.drinks).toEqual([]);
    expect(day.bulletins).toEqual([]);
    expect(day.pinnedBulletin).toBeNull();
  });
  it('drops a read that started yesterday and answers after midnight', async () => {
    let answer!: (rows: unknown[]) => void;
    mocks.getFullList.mockImplementation(() => new Promise((r) => { answer = r; }));
    const day = yesterday();
    const late = day.loadBulletins();
    day.realNow = new Date('2026-09-25T05:01:00Z'); day.enterScope(false);
    answer([{ id: 'b-old' }]); await late;
    expect(day.bulletins).toEqual([]);
  });
  it('keeps counting the server’s day while the day endpoint is unreachable', async () => {
    // The phone is a day behind (e2e fakes it); the server said so once, then went quiet.
    mocks.fetchDay.mockResolvedValueOnce({ today: '2026-09-24', now: '2026-09-24T18:00:00.000Z' }).mockRejectedValue(new Error('offline'));
    const day = new LiveDay();
    day.realNow = new Date('2026-09-23T18:00:00Z');
    await day.loadDay();
    expect(day.today).toBe('2026-09-24');
    day.realNow = new Date('2026-09-24T12:00:00Z');                          // 18 h later on the phone
    await day.loadDay();
    expect(day.today).toBe('2026-09-25');
  });
  it('uses the phone’s own date before the server has ever answered', async () => {
    mocks.fetchDay.mockRejectedValue(new Error('offline'));
    const day = new LiveDay();
    day.realNow = new Date('2026-09-24T18:00:00Z');
    await day.loadDay();
    expect(day.today).toBe('2026-09-24');
  });
});

describe('switching the current route', () => {
  const two = { id: 'r2', event_date: '2026-12-12', start_time: '11:00', status: 'locked' } as Itinerary;
  it('clears the old route’s trains, feed and Bulletins before the new ones arrive', async () => {
    mocks.getFullList.mockImplementation(() => new Promise(() => {}));   // reloads never answer
    const day = new LiveDay();
    day.itinerary = route; day.serverOffset = 0; day.realNow = new Date('2026-09-24T18:00:00Z'); day.enterScope(false);
    day.trips = [{ tripId: 'old' }] as never; day.feed.messages = [{ id: 'c1' }] as never; day.bulletins = [{ id: 'b1' }] as never;
    day.itinerary = two; day.enterScope(false);
    expect(day.trips).toEqual([]);
    expect(day.feed.messages).toEqual([]);
    expect(day.bulletins).toEqual([]);
  });
  it('drops a train answer for the previous route', async () => {
    let answer!: (v: unknown) => void;
    mocks.fetchNext.mockImplementation(() => new Promise((r) => { answer = r; }));
    const day = new LiveDay();
    day.itinerary = route;
    day.stops = [
      { id: 'a', order: 1, station_id: 'LAGRANGE', dwell_min: 30, walk_min: 2 },
      { id: 'b', order: 2, station_id: 'CUS', dwell_min: 30, walk_min: 2 }
    ] as never;
    day.legs = [{ from_stop: 'a', to_stop: 'b', kind: 'train', depart_at: '2026-12-26T20:34:00Z', arrive_at: '2026-12-26T20:49:00Z' }] as never;
    day.realNow = new Date('2026-09-22T17:30:00Z'); day.syncPlan();
    const late = day.loadTrains();
    day.itinerary = two; day.enterScope(false);
    answer({ trips: [{ tripId: 'old-route' }], mode: 'schedule_only', fetchedAt: null }); await late;
    expect(day.trips).toEqual([]);
  });
});
```
Note: `syncPlan()` recomputes `now` from `realNow` without reading `clientClock`, and `syncNow()` calls it. `effectiveAnchor` is `isEventDay ? anchor : null`, and `here` uses it.

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run tests/unit/liveDay.test.ts`
Expected: FAIL. `syncPlan`, `practice`, `effectiveAnchor`, `loadDay` and the day filters do not exist yet.

- [ ] **Step 3: Implement** (`day.svelte.ts`)

Fields and getters (replace `now`, `isToday` and `here`):
```ts
  realNow = $state(new Date());
  now = $state(new Date());
  get hasRoute(): boolean { return this.clockKnown && !!this.itinerary; }
  get isEventDay(): boolean { return this.hasRoute && isEventDay(this.itinerary!.event_date, this.realNow); }
  get practice(): boolean { return this.hasRoute && !this.isEventDay; }
  /** A Conductor's correction steers the board only on the event day; practice runs the timetable. */
  get effectiveAnchor() { return this.isEventDay ? this.anchor : null; }
  syncPlan() { this.now = planNow(this.itinerary?.event_date ?? null, this.realNow); }
  syncNow() { this.realNow = clientClock.eventNow() ?? this.realNow; this.syncPlan(); }
  get here(): Current | null {
    if (!this.hasRoute) return null;
    return currentStop(this.stops, this.legs, this.now, { startAt: this.startAt, override: this.effectiveAnchor });
  }
```
(Import `isEventDay`, `planNow` from `./planClock` and `dayBounds` from `$lib/time`. The getter named `isEventDay` shadows the import inside the class, so import it as `import { isEventDay as onEventDate, planNow } from './planClock'` and call `onEventDate(...)`.)

`loadRoute`: replace the `getFullList(... status = "locked" ...)` line with `const itinerary = await resolveCurrentRoute();` and delete the `list[0]` line. After `this.itinerary = itinerary`, call `this.syncPlan()`. On the mirror path, also call `this.syncPlan()` after assigning `this.itinerary`.

Day window helper (private):
```ts
  private window() { return dayBounds(this.today); }
```

`loadBulletins`:
```ts
      const { start, end } = this.window(), id = this.itinerary.id;
      const [rows, acks] = await Promise.all([
        pb.collection('broadcasts').getFullList<Broadcast>({ filter: pb.filter('itinerary = {:id} && at >= {:start} && at < {:end}', { id, start, end }), sort: '-created', expand: 'created_by' }),
        pb.collection('broadcast_acks').getFullList<BroadcastAck>({ filter: pb.filter('user = {:u} && broadcast.itinerary = {:id} && broadcast.at >= {:start} && broadcast.at < {:end}', { u: pb.authStore.record?.id ?? '', id, start, end }) })
      ]);
```

`loadFeed`:
```ts
    const { start, end } = this.window();
    const byStop = pb.filter('stop.itinerary = {:id} && at >= {:start} && at < {:end}', { id, start, end });
    const byRoute = pb.filter('itinerary = {:id} && at >= {:start} && at < {:end}', { id, start, end });
    const reactionsToday = pb.filter('itinerary = {:id} && created >= {:start} && created < {:end}', { id, start, end });
```
Use `byStop` for drinks and media, `byRoute` for chat messages, and `reactionsToday` for reactions. Media `at` was backfilled from `created` by migration 1758840000, so filtering on `at` is safe for old rows.

`loadTrains`: pass `this.practice` as the new last argument to `fetchNext`.
`loadAlerts`: begin with `if (this.practice) { this.alerts = []; return; }`.

**Scope.** Everything Live shows about activity belongs to one *scope*: the route id plus the Chicago day. When the scope changes, the old rows are wrong at once, whether or not the reload succeeds. So a scope change **clears first and reloads second**, and every read drops an answer that belongs to an earlier scope.
```ts
  /** Server clock minus this phone's clock, from the last `/api/day`. Null until the server answers. */
  serverOffset = $state<number | null>(null);
  get today(): string {
    return todayInTz(this.serverOffset === null ? this.realNow : new Date(this.realNow.getTime() + this.serverOffset));
  }
  private scopeKey = $state('');
  private get currentScope() { return `${this.itinerary?.id ?? ''}|${this.today}`; }

  /** Route or day changed: nothing on screen belongs to the new scope, so empty it now. */
  enterScope(reload = true) {
    this.scopeKey = this.currentScope;
    this.feedRead++; this.bulletinRead++; this.trainRead++;
    this.feed = { drinks: [], media: [], messages: [], reactions: [] };
    this.bulletins = []; this.ackedIds = []; this.acking = []; this.trips = [];
    if (reload && this.itinerary) { void this.loadAnchor(); void this.loadFeed(); void this.loadBulletins(); void this.loadTrains(); }
  }
  async checkScope() { if (this.currentScope !== this.scopeKey) this.enterScope(); }

  async loadDay() {
    const sent = this.realNow.getTime();
    try {
      // The round trip is ignored: a second's error does not matter to which day it is.
      this.serverOffset = Date.parse((await fetchDay()).now) - sent;
    } catch { /* offline: keep the last offset; with none yet, `today` is this phone's own date */ }
    await this.checkScope();
  }
```
- `today` is computed, not stored. Once the server has answered, the day rolls over on this phone's clock plus the offset, so midnight is caught **offline too** and between polls. Before the first answer it is the phone's date, as in the spec.
- The offset is measured against `realNow` as it stood when the request was sent. `loadDay` does not call `syncNow()` itself; the tick keeps `realNow` current, and the unit tests set it explicitly.
- Each loader captures `const scope = this.scopeKey` when it starts, and before publishing it checks `scope === this.scopeKey` as well as its request counter. On failure it publishes nothing, so an empty scope stays empty (`loadBulletins`' "keep whatever we had" now keeps only rows of the same scope). `loadTrains` also checks `scope` together with `clientClock.revision`.
- `loadRoute` compares the resolved itinerary id (from the server or the mirror) with the one on screen. After assigning a **different** route, it calls `this.syncPlan()` and then `this.enterScope()`, which reloads the anchor, feed, Bulletins and trains. A same-route refresh does not clear.
- `start()` orders the first load as `void this.loadDay().then(() => this.loadRoute()).then(...)`. The first `loadRoute` then enters a scope with the right day, and the existing `.then(...)` loaders stay as they are. The scope was already entered by `loadRoute`, so this does not double-load in a way that matters: the second call of each loader supersedes the first by request counter.
- The run-ID reset at the top of `loadRoute` (sim harness) sets `this.scopeKey = ''`, so the next route load enters a fresh scope.

`start()`:
- Replace every `this.now = clientClock.eventNow() ?? this.now` with `this.syncNow()`, including the tick at line ~222.
- Add `void this.loadDay()` to the 30 s `poll`.
- In the tick, after `syncNow()`, call `void this.checkScope()`. `today` follows the phone's clock plus the server offset, so midnight is caught within one tick and needs no fetch.
- Subscribe `crawl_settings` to `refreshRoute`, **not** `queueRefresh`. A route switch should not wait 750 ms, and `loadRoute` enters the new scope, which clears and reloads the trains, feed and Bulletins: `subscribe('crawl_settings', '', refreshRoute)` in `unsubs`.
- In `revisionRefresh` (sim harness), also call `this.syncNow()`.

`feed.ts`:
```ts
export const fetchDay = (): Promise<{ today: string; now: string }> => authed('/api/day');
export const fetchNext = (from: string, to: string, date: string, after: Date, practice = false): Promise<{ mode: FeedMode; fetchedAt: string | null; trips: NextTrip[] }> =>
  authed(`/api/metra/next?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&date=${date}&after=${after.toISOString()}&limit=3${practice ? '&practice=1' : ''}`);
```
Check that `authed` sends `cache: 'no-store'` for `/api/day`. If it only does so in sim, pass it explicitly for this call: Workbox must never serve a cached day.

- [ ] **Step 4: Run to verify they pass**

Run: `cd web && npx vitest run tests/unit/liveDay.test.ts tests/unit/offlineDay.test.ts` → PASS. Then `npm run check` will list every `isToday` caller as an error. Those are Task 6's list, so leave them and do not commit until Step 5 compiles. Add a temporary `get isToday() { return this.isEventDay; }` with the comment `// removed in Task 6` so this task ends green.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/live web/tests/unit
git commit -m "feat(live): liveDay follows the current route, plan time and the server day"
```

---

### Task 5: `/api/metra/next?practice=1` serves the timetable only

**Files:**
- Modify: `web/src/routes/api/metra/next/+server.ts:26-58`
- Test: `web/tests/unit/metra-endpoints.test.ts` (inside `describe('/api/metra/next')`)

**Interfaces:**
- Produces: with `practice=1`, the response has `mode: 'schedule_only'`, `fetchedAt: null`, and every trip has `status: 'scheduled'`, `liveDepart: null`, `delayMin: null`, whatever the realtime feeds say. `after` is the plan-time instant the client sends.

- [ ] **Step 1: Write the failing test**

```ts
  it('ignores realtime for a practice-day request', async () => {
    allFresh();
    state.feed = encodeFeed([tripUpdate(/* copy the delayed-trip arguments from the existing "applies live predictions" test above */)]);
    const body = await get('../../src/routes/api/metra/next/+server',
      'http://x/api/metra/next?from=LAGRANGE&to=CUS&date=2026-12-26&after=2026-12-26T19:00:00Z&practice=1');
    expect(body.mode).toBe('schedule_only');
    expect(body.fetchedAt).toBeNull();
    expect(body.trips.length).toBeGreaterThan(0);
    expect(body.trips.every((t: { status: string; delayMin: number | null }) => t.status === 'scheduled' && t.delayMin === null)).toBe(true);
  });
```
Take the `tripUpdate(...)` arguments from the existing test in this file that proves predictions are applied (search for `tripUpdate(`), so the feed would have changed the answer without `practice=1`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run tests/unit/metra-endpoints.test.ts -t practice`
Expected: FAIL, because the mode is `live`.

- [ ] **Step 3: Implement**

After `const mode = modeFor(...)`:
```ts
  // Practice days run the plan date's published timetable; today's realtime belongs to another day.
  const practice = url.searchParams.get('practice') === '1';
  const effectiveMode = practice ? 'schedule_only' : mode;
```
Then use `effectiveMode` for `preds` (`effectiveMode === 'live' ? readPredictions(...) : {}`) and in the response (`mode: effectiveMode, fetchedAt: practice ? null : fetchedAt`). Also remove the `'2026-12-26'` fallback: make `date` required, since the client always sends it.
```ts
  const date = url.searchParams.get('date') ?? snapshot.serviceDate ?? '';
```
The existing 400 check already rejects an empty date. Check whether the existing test at line ~127 relies on the fallback. If it does, it runs against the sim snapshot's `serviceDate: '2026-12-26'` and still passes.

- [ ] **Step 4: Run to verify it passes**

Run: `cd web && npx vitest run tests/unit/metra-endpoints.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/routes/api/metra/next web/tests/unit/metra-endpoints.test.ts
git commit -m "feat(metra): practice requests get the timetable only"
```

---

### Task 6: Screens: practice gating, the Practice badge, "Make current", day-scoped Crew Board

**Files:**
- Modify: `web/src/lib/labels.ts` (new strings), `README.md` (UI glossary)
- Modify: `web/src/routes/(app)/+page.svelte` (home)
- Modify: `web/src/routes/(app)/live/+page.svelte`
- Modify: `web/src/routes/(app)/+layout.svelte` (pinned Bulletin, banner, TabBar)
- Modify: `web/src/routes/+layout.svelte` (unread badge)
- Modify: `web/src/routes/(app)/crew/+page.svelte`
- Modify: `web/src/routes/(app)/route/+page.svelte`
- Modify: `web/src/routes/(app)/notifications/+page.svelte`
- Modify: `web/src/routes/(app)/plan/[id]/+page.svelte` ("Make current")
- Modify: `web/src/routes/(app)/plan/[id]/edit/+page.svelte:140` (`now: liveDay.realNow`)
- Modify: `web/src/lib/components/CrewChat.svelte:18` (`liveDay.today`)
- Modify: `web/src/lib/live/day.svelte.ts` (delete the temporary `isToday`)
- Modify: `web/tests/e2e/helpers.ts` (`seedLockedCrawl` takes an optional `firstStopName`, default `'The Whistle Stop'`)
- Test: `web/tests/e2e/practice.spec.ts` (create), `web/tests/unit/cohesion.test.ts` (append)

**Interfaces:**
- Consumes:
  - `liveDay.hasRoute`, `isEventDay`, `practice`, `today`, `realNow`, `now` (Task 4)
  - `setCurrentRoute(id)` and `resolveCurrentRoute()` (Task 3)
- Produces:
  - labels `copy.practiceBadge = 'Practice'`
  - `copy.practiceHint = 'Timetable for the route’s date, at today’s time'`
  - `copy.makeCurrent = 'Make current'`
  - `copy.currentRoute = 'Current route'`
  - test ids `practice-badge`, `make-current`, `current-route`

Replace every `liveDay.isToday` as follows:

| Call site | Becomes |
|---|---|
| `(app)/+page.svelte:19` (auto-land) | `liveDay.isEventDay` |
| `(app)/+page.svelte:27` (Live link) | `liveDay.hasRoute`, dropping the `clientClock.enabled`/rehearsal copy branches (Task 7 deletes those labels) |
| `live/+page.svelte:144` | `!liveDay.hasRoute` |
| `(app)/+layout.svelte:90` (TabBar) | `liveDay.isEventDay` |
| `route/+page.svelte:23,26` | `liveDay.hasRoute` (the stop sheet works on practice days too) |
| `crew/+page.svelte:54`, `notifications/+page.svelte:28` | `!liveDay.isEventDay` (the back link is needed whenever there is no TabBar) |
| `live/+page.svelte:47-48` | `drinkCount(liveDay.feed.drinks, me, liveDay.today) + pending.filter((p) => p.user === me).length` and `topLine(..., liveDay.today)` |
| `live/+page.svelte:59,72,75,118` | `liveDay.syncNow()` in place of the `liveDay.now = …` lines. The optimistic `at` becomes `liveDay.realNow.toISOString()` (the server overwrites it) |
| `CrewChat.svelte:18` | `liveDay.today` |
| `crew/+page.svelte:18` | `liveDay.clockKnown ? liveDay.today : ''` |

- [ ] **Step 1: Write the failing tests**

`web/tests/unit/cohesion.test.ts` (append; reuse the fixtures of the existing "off-day" test):
```ts
it('treats a practice-day Save as off-day even though plan time falls on the route date', () => {
  // The editor must pass real time. Plan time would land on eventDate and wrongly apply history rules.
  const blockers = cohesionBlockers({ ...offDayInput, eventDate: '2026-12-26', now: new Date('2026-09-22T19:05:00Z') });
  expect(blockers.map((b) => b.code)).toEqual(offDayExpected);
});
```
Find the existing off-day case (`grep -n "off-day\|offDay" web/tests/unit/cohesion.test.ts`) and adapt its input object. The test pins that `now` is a real-time instant.

`web/tests/e2e/practice.spec.ts`:
```ts
import { expect, test, type Page } from '@playwright/test';
import { clearLockedCrawls, login, seedLockedCrawl } from './helpers';
import { copy } from '../../src/lib/labels';

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
// The fixture timetable covers 2026-10-26..12-31, so the route is dated in it and a practice day is
// any other day. 2026-12-19 13:00 CST practises the 26th's 13:00.
const PRACTICE = new Date('2026-12-19T19:00:00Z');

async function practise(page: Page, name: string) {
  await page.route('**/api/metra/alerts', (r) => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, alerts: [] } }));
  await login(page, name, ADMIN);
  await clearLockedCrawls();
  const ids = await seedLockedCrawl({ ownerName: name, eventDate: '2026-12-26', startTime: '12:00', departAt: '2026-12-26T20:34:00Z', arriveAt: '2026-12-26T20:49:00Z' });
  await page.clock.install({ time: PRACTICE });
  return ids;
}

test('on a practice day Live runs the route at today’s time with timetable trains', async ({ page }) => {
  const next: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/api/metra/next')) next.push(r.url()); });
  await practise(page, 'E2E Practice Board');
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);                       // no event-day auto-landing
  await page.getByTestId('nav-live').click();
  await expect(page.getByTestId('practice-badge')).toHaveText(copy.practiceBadge);
  await expect(page.getByTestId('departure-board')).toBeVisible();
  await expect(page.getByTestId('strip-stop-0')).toHaveAttribute('aria-current', 'step');
  await expect.poll(() => next.find((u) => u.includes('practice=1') && u.includes('date=2026-12-26'))).toBeTruthy();
  await expect(page.getByTestId('tab-route')).toHaveCount(0); // TabBar is event-day only
});

test('a practice Bulletin pins on Live but not on the planner', async ({ page }) => {
  await practise(page, 'E2E Practice Bulletin');
  await page.goto('/live');
  await page.getByTestId('menu').click();
  await page.getByTestId('menu-bulletin').click();
  await page.getByTestId('bulletin-body').fill('Practice: meet at the clock.');
  await page.getByTestId('bulletin-send').click();
  await expect(page.getByTestId('pinned-bulletin')).toBeVisible();
  await page.goto('/plan');
  await expect(page.getByTestId('pinned-bulletin')).toHaveCount(0);
  await expect(page.getByTestId('banner')).toHaveCount(0);
});

test('the Conductor makes a route current and another phone’s Live follows it', async ({ page, browser }) => {
  const first = await practise(page, 'E2E Make Current');
  // Locked later, so it is the newest-locked fallback until the Conductor chooses.
  await seedLockedCrawl({ ownerName: 'E2E Make Current', eventDate: '2026-12-12', startTime: '12:00', departAt: '2026-12-12T20:34:00Z', arriveAt: '2026-12-12T20:49:00Z', firstStopName: 'The Switchyard' });
  const crew = await (await browser.newContext()).newPage();
  await crew.route('**/api/metra/alerts', (r) => r.fulfill({ json: { mode: 'schedule_only', fetchedAt: null, alerts: [] } }));
  // Hold the crew phone's train reads for the first route, so a late answer would land after the switch.
  let held: (() => void) | undefined;
  await crew.route('**/api/metra/next**', async (r) => { if (!held) { await new Promise<void>((go) => { held = go; }); } await r.continue(); });
  await login(crew, 'E2E Make Current Crew');
  await crew.clock.install({ time: PRACTICE });
  await crew.goto('/live');
  await expect(crew.getByText('The Switchyard').first()).toBeVisible();

  await page.goto(`/plan/${first.itineraryId}`);
  await page.getByTestId('make-current').click();
  await expect(page.getByTestId('current-route')).toBeVisible();

  await expect(crew.getByText('The Whistle Stop').first()).toBeVisible();
  await expect(crew.getByText('The Switchyard')).toHaveCount(0);
  held?.();                                                  // the old route's trains answer now
  await expect(crew.getByTestId('departure-board')).toBeVisible();
  await expect(crew.getByText('The Switchyard')).toHaveCount(0);
  await crew.context().close();
});

test('yesterday’s activity is not on today’s Live', async ({ page }) => {
  const ids = await practise(page, 'E2E Yesterday');
  // A superuser backdates a chat line to yesterday. The server stamps real time, so write it directly.
  const { superuserToken, PB } = await import('../hooks/setup');
  const token = await superuserToken();
  const user = (await (await fetch(`${PB}/api/collections/users/records?filter=${encodeURIComponent('name_key="e2e yesterday"')}`, { headers: { Authorization: token } })).json()).items[0];
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  await fetch(`${PB}/api/collections/chat_messages/records`, { method: 'POST', headers: { Authorization: token, 'content-type': 'application/json' },
    body: JSON.stringify({ itinerary: ids.itineraryId, user: user.id, body: 'From yesterday', at: yesterday }) });
  await page.goto('/live');
  await expect(page.getByTestId('departure-board')).toBeVisible();
  await expect(page.getByText('From yesterday')).toHaveCount(0);
});
```
Note: e2e runs against PocketBase on **18093**. `tests/hooks/setup.ts` defaults `PB` to 8090 unless `PB_URL` is set, and `browser-config.ts` sets `process.env.PB_URL = 'http://127.0.0.1:18093'`, so the import resolves correctly under Playwright. The chat hook overwrites `at` on superuser creates too. If the backdated row reads as today, add `if (e.auth?.isSuperuser() && e.record.getString('at')) return e.next()` at the top of the `chat_messages` create hook. That keeps a superuser-supplied `at` for fixtures, and a test in `tests/hooks/chat.test.ts` should pin it. Do the same for `drink_entries` only if a test needs it (YAGNI otherwise).

Existing e2e tests that must now be checked (they install `2026-12-26` = event day, so the event-day paths are unchanged):
- `layout.spec.ts`: the TabBar and banner on the event day
- `bulletins.spec.ts`: pins everywhere on the event day
- `crew.spec.ts`, `chat.spec.ts`, `freight.spec.ts`, `tab.spec.ts`: rows are server-stamped today and `today` comes from `/api/day`, so they stay visible although the browser says Dec 26

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run tests/unit/cohesion.test.ts && npx playwright test tests/e2e/practice.spec.ts`
Expected: FAIL (no practice badge, no `make-current`, the Bulletin pins on `/plan`). The cohesion test may already pass, because the function takes whatever `now` it is given. It still pins the contract, and the edit to `edit/+page.svelte` is what makes the page honour it.

- [ ] **Step 3: Implement**

`labels.ts` (in `copy`):
```ts
  practiceBadge: 'Practice',
  practiceHint: 'Timetable for the route’s date, at today’s time',
  makeCurrent: 'Make current',
  currentRoute: 'Current route',
```
Add the same names to the README UI glossary table with one-line meanings: "Practice: any day that is not the current route's date; Live runs the route's timetable at today's time", and "Current route: the locked route the Conductor selected; Live, The Route and photos follow it".

`live/+page.svelte`: under the departure board header add:
```svelte
{#if liveDay.practice}<p class="practice" data-testid="practice-badge" title={copy.practiceHint}>{copy.practiceBadge}</p>{/if}
```
with the style `.practice { margin: 8px 16px 0; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #9ad; }`.

`(app)/+layout.svelte`:
```ts
  const onLive = $derived(page.url.pathname === '/live');
  // Practice interrupts only the screen that is practising; planning and voting stay quiet.
  const quiet = $derived(liveDay.practice && !onLive);
  const showBanner = $derived(!!here?.stop && !onLive && !quiet);
```
and wrap the pinned Bulletin: `{#if liveDay.pinnedBulletin && !quiet}`.

`routes/+layout.svelte`: import `page` from `$app/state` and make the Bulletin half of the badge follow the same rule:
```ts
  const bulletinUnread = $derived(liveDay.practice && page.url.pathname !== '/live' ? 0
    : liveDay.bulletins.filter((b) => !liveDay.isAcked(b.id)).length);
  const unread = $derived(alertsUnread + bulletinUnread);
```

`plan/[id]/+page.svelte`, after `<ApprovalPanel …/>`:
```svelte
  {#if isAdmin && draft.itinerary.status === 'locked'}
    {#if liveDay.itinerary?.id === draft.itinerary.id}
      <p data-testid="current-route"><strong>{copy.currentRoute}</strong></p>
    {:else}
      <button type="button" data-testid="make-current" onclick={() => void setCurrentRoute(draft!.itinerary.id).then(() => liveDay.loadRoute()).catch(() => (error = copy.noSignal))}>{copy.makeCurrent}</button>
    {/if}
  {/if}
```
(Import `liveDay` and `setCurrentRoute`.)

`(app)/+page.svelte`: replace the `onMount` `getList` with `locked = await resolveCurrentRoute()`, so the home card names the current route.

Crew Board (`crew/+page.svelte:30-33`): limit the reads to the current route and the day:
```ts
        const id = liveDay.itinerary?.id ?? '', { start, end } = dayBounds(liveDay.today);
        const rows = await Promise.all([
          pb.collection('users').getFullList<UserRecord>({ sort: 'name' }),
          pb.collection('drink_entries').getFullList<DrinkEntry>({ filter: pb.filter('stop.itinerary = {:id} && at >= {:start} && at < {:end}', { id, start, end }) }),
          pb.collection('broadcast_acks').getFullList<BroadcastAck>({ filter: pb.filter('broadcast.itinerary = {:id} && broadcast.at >= {:start} && broadcast.at < {:end}', { id, start, end }) })
        ]);
```
Make the `$effect` depend on `liveDay.itinerary?.id` and `liveDay.today` so it reloads on either change.

`edit/+page.svelte:140`: `now: liveDay.realNow`.

Delete the temporary `isToday` getter from `day.svelte.ts`.

- [ ] **Step 4: Run to verify they pass**

Run: `cd web && npm test && npm run check && npm run test:e2e && cd .. && bash scripts/test-hooks.sh` → all green, including the whole existing e2e suite.

- [ ] **Step 5: Commit**

```bash
git add web README.md pocketbase
git commit -m "feat(live): practice days on Live, quiet planner, Make current, day-scoped Crew Board"
```

---

### Task 7: Remove shared rehearsal

**Files:**
- Delete: `compose.rehearsal.yml`, `web/scripts/prepare-rehearsal.mjs`, `web/scripts/shared-rehearsal.mjs`, `web/scripts/download-rehearsal-venues.mjs`, `web/src/lib/server/sim/shared.ts`, `web/tests/unit/sharedRehearsal.test.ts`
- Rename: `web/scripts/rehearsal-venues.mjs` → `web/scripts/practice-venues.mjs` (Task 8 rewrites it)
- Modify: `scripts/up.sh`, `web/Dockerfile:17`, `.env.example`, `web/tests/unit/startup.test.ts`, `web/src/lib/labels.ts`, `web/src/routes/login/+page.svelte:31`, `web/src/routes/(app)/+page.svelte` (the rehearsal copy branches, if Task 6 left any)
- Keep: `compose.sim.yml`, `web/scripts/sim.mjs`, `web/scripts/sim-test-web.mjs`, `web/src/lib/server/sim/{clock,service,seed,setup,source}.ts`, `web/tests/sim/**`, every `PUBLIC_SIM` branch

- [ ] **Step 1: Rewrite the startup test to the new contract** (`web/tests/unit/startup.test.ts`)

Keep the file's fixture helper (the fake `docker` recorder and the temp root). Replace the rehearsal cases with:
```ts
it('up starts the real stack only', async () => {
  const f = await fixture();
  await f.run();
  expect(await f.calls()).toBe('compose -f compose.yml up -d --build\n');
});
it('up ignores a leftover REHEARSAL setting and never touches data/rehearsal', async () => {
  const f = await fixture('1');
  await mkdir(join(f.root, 'data/rehearsal/pb_data'), { recursive: true });
  await writeFile(join(f.root, 'data/rehearsal/pb_data/keep'), 'x');
  await f.run();
  expect(await f.calls()).toBe('compose -f compose.yml up -d --build\n');
  expect(await readFile(join(f.root, 'data/rehearsal/pb_data/keep'), 'utf8')).toBe('x');
});
```
Adapt `fixture()`/`run()`/`calls()` to the names the file already uses (read lines 1-21 first).

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run tests/unit/startup.test.ts` → FAIL (the calls include `compose.rehearsal.yml`).

- [ ] **Step 3: Implement the removal**

`scripts/up.sh`, the whole file:
```bash
#!/usr/bin/env bash
# just loads .env. One stack, one database: practice happens on Live on any day that is not the
# current route's date (see README "Practice days").
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/gtfs data/places data/recordings
docker compose -f compose.yml up -d --build
```
- `web/Dockerfile`: delete line 17 (`COPY scripts/shared-rehearsal.mjs …`).
- `.env.example`: delete `REHEARSAL*` lines.
- `git rm` the files listed under Delete, and `git mv web/scripts/rehearsal-venues.mjs web/scripts/practice-venues.mjs`.
- `labels.ts`: delete `rehearsalIntro`, `rehearsalReady`, `rehearsalSetupIncomplete`, `rehearsalLive`, `rehearsalLiveHint`, `rehearsalRouteTitle` and `rehearsalBulletins`, then run `grep -rn "<name>" web/src web/scripts web/tests` for each and remove any dead references. **Keep** `rehearsalTitle` and the `sim*` strings: `SimulationStatus.svelte` (the harness) uses them.
- `login/+page.svelte:31`: delete the `rehearsal-notice` paragraph.
- Check `web/tests/sim/**` for uses of deleted labels or `shared.ts` (`grep -rn "shared\|rehearsalBulletins" web/tests/sim`). The harness seeds through `seed.ts`/`setup.ts`, so nothing should remain. If something does, move the needed constant into `seed.ts`.

- [ ] **Step 4: Run everything**

Run: `cd web && npm test && npm run check && npm run test:e2e && cd .. && bash scripts/test-hooks.sh` → green.
Then run the harness suite once, because it is the only thing still using the sim branches: `cd web && npx playwright test -c playwright.sim.config.ts`. Find the harness config name with `ls web/playwright*.ts`.
Expected: the same pass or fail state as on `main` before this branch. Record the baseline first, with the same command on `main`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove shared rehearsal; just up runs the real stack only"
```

---

### Task 8: The canned route, built once

**Files:**
- Modify (renamed in Task 7): `web/scripts/practice-venues.mjs`, which exports pure selectors and a Places client
- Create: `web/scripts/practice-build.mjs`: `buildCannedRoute(api, stops, opts)`, the database half, with no Places and no `fetch` of its own
- Create: `web/scripts/practice-route.mjs`: the thin CLI that wires the real PocketBase, Places and GTFS into it
- Modify: `justfile` (recipe `practice-route`)
- Test: `web/tests/unit/practiceVenues.test.ts`, `web/tests/unit/practiceBuild.test.ts`

**Interfaces:**
- Produces:
  - `pickBar(places, station, used: Set<string>)`
  - `pickLunch(places, station, used)`
  - `pickDeepDish(candidatesByStation, used)`
  - `CANNED_TITLE = 'Out and back on the BNSF — practice crawl'`
  - `PLAN = [{ station, role: 'bar'|'lunch'|'dinner', direction: 'out'|'in', dwell }]`
  - `nextFreeSaturday(today: string, taken: string[]): string`
  - from `practice-build.mjs`: `buildCannedRoute(api, stops, { title, eventDate, startTime, ownerId, timeoutMs, pollMs }) → Promise<{ id, legs }>`, where `api` is `{ list(collection, predicate), create(collection, body), update(collection, id, body), remove(collection, id), getSettings(), setCurrent(id) }`. `list` takes a row predicate: the CLI's adapter reads the whole collection as superuser and filters in memory, since these collections are small. It throws `CannedRouteError` with a message for the person running it.

All selectors are pure over the Places `searchNearby`/`searchText` result shape: `{ id, displayName: { text }, location: { latitude, longitude }, primaryType, types, businessStatus, rating, userRatingCount, regularOpeningHours }`.

- [ ] **Step 1: Write the failing unit test**

```ts
import { describe, expect, it } from 'vitest';
import { PLAN, nextFreeSaturday, pickBar, pickDeepDish, pickLunch } from '../../scripts/practice-venues.mjs';

const station = { id: 'LISLE', lat: 41.7955, lon: -88.0751 };
const place = (id: string, over: object = {}) => ({ id, displayName: { text: id }, location: { latitude: 41.7956, longitude: -88.0752 },
  primaryType: 'bar', types: ['bar'], businessStatus: 'OPERATIONAL', rating: 4.5, userRatingCount: 300, ...over });

describe('practice route plan', () => {
  it('goes out to LaGrange and back, lunch out, deep-dish dinner back, bars at other stations', () => {
    expect(PLAN.map((p) => `${p.direction}:${p.station}:${p.role}`)).toEqual([
      'out:AURORA:bar', 'out:NAPERVILLE:bar', 'out:LISLE:lunch', 'out:MAINST-DG:bar', 'out:LAGRANGE:bar',
      'in:HINSDALE:bar', 'in:WESTMONT:bar', 'in:NAPERVILLE:dinner', 'in:ROUTE59:bar'
    ]);
    expect(PLAN.map((p) => p.dwell)).toEqual([30, 30, 60, 30, 30, 30, 30, 75, 30]);
  });
  it('picks the nearest operational bar with enough ratings, never twice', () => {
    const used = new Set(['taken']);
    const far = place('far', { location: { latitude: 41.80, longitude: -88.08 } });
    expect(pickBar([place('taken'), place('few', { userRatingCount: 5 }), place('closed', { businessStatus: 'CLOSED_PERMANENTLY' }), far], station, used)?.id).toBe('far');
  });
  it('picks a well-rated restaurant open at noon for lunch', () => {
    const open = { periods: [{ open: { day: 6, hour: 11, minute: 0 }, close: { day: 6, hour: 22, minute: 0 } }] };
    const late = { periods: [{ open: { day: 6, hour: 16, minute: 0 }, close: { day: 6, hour: 23, minute: 0 } }] };
    const r = (id: string, rating: number, hours: object) => place(id, { primaryType: 'mexican_restaurant', types: ['restaurant'], rating, userRatingCount: 400, regularOpeningHours: hours });
    expect(pickLunch([r('dinner-only', 4.9, late), r('lunch', 4.4, open), r('small', 4.8, { periods: open.periods })].map((p, i) => i === 2 ? { ...p, userRatingCount: 50 } : p), station, new Set())?.id).toBe('lunch');
  });
  it('chooses the best-rated deep-dish place across outbound stations', () => {
    const got = pickDeepDish({ NAPERVILLE: [place('lou', { primaryType: 'pizza_restaurant', rating: 4.5 })], LISLE: [place('gio', { primaryType: 'pizza_restaurant', rating: 4.3 })] }, new Set());
    expect(got).toEqual({ station: 'NAPERVILLE', place: expect.objectContaining({ id: 'lou' }) });
  });
  it('dates the route on the next Saturday that no locked route uses', () => {
    expect(nextFreeSaturday('2026-09-24', [])).toBe('2026-09-26');
    expect(nextFreeSaturday('2026-09-26', [])).toBe('2026-10-03');   // "next", never today
    expect(nextFreeSaturday('2026-09-24', ['2026-09-26'])).toBe('2026-10-03');
  });
});
```
The e2e and harness tests never call Google. This test is the only automated coverage of the script's decisions.

`web/tests/unit/practiceBuild.test.ts` covers the database half against an in-memory fake `api`. Legs appear only when the test says the recompute has answered:
```ts
import { describe, expect, it } from 'vitest';
import { buildCannedRoute } from '../../scripts/practice-build.mjs';

const TITLE = 'Out and back on the BNSF — practice crawl';
const stops = [{ name: 'A bar', kind: 'bar', station_id: 'AURORA' }, { name: 'B bar', kind: 'bar', station_id: 'NAPERVILLE' }];
const opts = { title: TITLE, eventDate: '2026-10-03', startTime: '11:00', ownerId: 'u1', timeoutMs: 50, pollMs: 5 };

function fakeApi(legKind: 'train' | 'impossible' | null) {
  const rows: Record<string, Record<string, unknown>[]> = { itineraries: [], stops: [], legs: [] };
  let n = 0, current = '';
  const api = {
    rows, get current() { return current; },
    async list(c: string, f: (r: Record<string, unknown>) => boolean) { return rows[c].filter(f); },
    async create(c: string, body: Record<string, unknown>) {
      const row = { id: `${c}${++n}`, ...body, ...(c === 'itineraries' ? { status: 'draft' } : {}) };
      rows[c].push(row);
      // The recompute hook runs on drafts: a stop write produces the legs between stops.
      if (c === 'stops' && legKind && rows.stops.length > 1) rows.legs.push({ itinerary: body.itinerary, kind: legKind });
      return row;
    },
    async update(c: string, id: string, body: Record<string, unknown>) { Object.assign(rows[c].find((r) => r.id === id)!, body); },
    async remove(c: string, id: string) { rows[c] = rows[c].filter((r) => r.id !== id && r.itinerary !== id); },
    async getSettings() { return { current_itinerary: current }; },
    async setCurrent(id: string) { current = id; }
  };
  return api;
}

describe('buildCannedRoute', () => {
  it('locks and selects the route only after every leg is a train or a walk', async () => {
    const api = fakeApi('train');
    const { id } = await buildCannedRoute(api, stops, opts);
    expect(api.rows.itineraries.find((r) => r.id === id)?.status).toBe('locked');
    expect(api.current).toBe(id);
  });
  it('leaves an impossible route as a draft that nobody sees', async () => {
    const api = fakeApi('impossible');
    await expect(buildCannedRoute(api, stops, opts)).rejects.toThrow(/impossible/i);
    expect(api.rows.itineraries[0].status).toBe('draft');
    expect(api.current).toBe('');
  });
  it('leaves a draft when the planner never answers', async () => {
    const api = fakeApi(null);
    await expect(buildCannedRoute(api, stops, opts)).rejects.toThrow(/timed out/i);
    expect(api.rows.itineraries[0].status).toBe('draft');
  });
  it('replaces its own abandoned draft on a second run', async () => {
    const api = fakeApi('impossible');
    await expect(buildCannedRoute(api, stops, opts)).rejects.toThrow();
    const failed = api.rows.itineraries[0].id;
    const again = fakeApi('train');
    again.rows.itineraries.push(...api.rows.itineraries);
    await buildCannedRoute(again, stops, opts);
    expect(again.rows.itineraries.map((r) => r.id)).not.toContain(failed);
    expect(again.rows.itineraries).toHaveLength(1);
  });
  it('refuses when a locked canned route already exists', async () => {
    const api = fakeApi('train');
    api.rows.itineraries.push({ id: 'old', title: TITLE, status: 'locked' });
    await expect(buildCannedRoute(api, stops, opts)).rejects.toThrow(/already exists/i);
  });
  it('does not take over from a route the Conductor already selected', async () => {
    const api = fakeApi('train');
    await api.setCurrent('real');
    await buildCannedRoute(api, stops, opts);
    expect(api.current).toBe('real');
  });
});
```

Before relying on these station ids, confirm them against the live GTFS (`stops.txt` in `data/gtfs/…`, or `unzip -p <zip> stops.txt | grep -i -E "hinsdale|westmont|route 59|naperville|aurora|lisle|main st|lagrange"`). Fix `PLAN` if an id differs, for example `ROUTE59` vs `ROUTE59-NAPERVILLE`. `LAGRANGE` and `MAINST-DG` are already used by `prepare-rehearsal.mjs`. Update the test's expected strings to the confirmed ids.

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run tests/unit/practiceVenues.test.ts` → FAIL (the exports do not exist yet).

- [ ] **Step 3: Implement**

`web/scripts/practice-venues.mjs`. Keep the Places HTTP helper and the photo-download code from the old `rehearsalVenues` (same field masks, 2 photos per venue, cache per station). Put the pure pieces above it:
```js
export const CANNED_TITLE = 'Out and back on the BNSF — practice crawl'
export const PLAN = [
  { station: 'AURORA', role: 'bar', direction: 'out', dwell: 30 },
  { station: 'NAPERVILLE', role: 'bar', direction: 'out', dwell: 30 },
  { station: 'LISLE', role: 'lunch', direction: 'out', dwell: 60 },
  { station: 'MAINST-DG', role: 'bar', direction: 'out', dwell: 30 },
  { station: 'LAGRANGE', role: 'bar', direction: 'out', dwell: 30 },
  { station: 'HINSDALE', role: 'bar', direction: 'in', dwell: 30 },
  { station: 'WESTMONT', role: 'bar', direction: 'in', dwell: 30 },
  { station: 'NAPERVILLE', role: 'dinner', direction: 'in', dwell: 75 },
  { station: 'ROUTE59', role: 'bar', direction: 'in', dwell: 30 }
]
const metres = (p, s) => Math.hypot((p.location.latitude - s.lat) * 111000, (p.location.longitude - s.lon) * 83000)
const usable = (p, used, minRatings) => p.location && p.businessStatus === 'OPERATIONAL' && (p.userRatingCount ?? 0) >= minRatings && !used.has(p.id)
const isBar = (p) => ['bar', 'pub', 'brewery'].includes(p.primaryType) || (p.types ?? []).some((t) => ['bar', 'pub', 'brewery'].includes(t))
const isRestaurant = (p) => (p.primaryType ?? '').endsWith('restaurant')
const openAtNoonSaturday = (p) => (p.regularOpeningHours?.periods ?? []).some((x) => x.open?.day === 6 &&
  x.open.hour * 60 + (x.open.minute ?? 0) <= 12 * 60 && (!x.close || x.close.hour * 60 + (x.close.minute ?? 0) >= 13 * 60 || x.close.day !== 6))

export function pickBar(places, station, used) {
  return places.filter((p) => usable(p, used, 20) && isBar(p)).sort((a, b) => metres(a, station) - metres(b, station))[0] ?? null
}
export function pickLunch(places, station, used) {
  return places.filter((p) => usable(p, used, 200) && isRestaurant(p) && openAtNoonSaturday(p) && metres(p, station) <= 1000)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0] ?? null
}
export function pickDeepDish(byStation, used) {
  const all = Object.entries(byStation).flatMap(([station, places]) => places.filter((p) => usable(p, used, 100)).map((place) => ({ station, place })))
  return all.sort((a, b) => (b.place.rating ?? 0) - (a.place.rating ?? 0))[0] ?? null
}
export function nextFreeSaturday(today, taken) {
  const d = new Date(`${today}T12:00:00Z`)
  do { d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7)) } while (taken.includes(d.toISOString().slice(0, 10)))
  return d.toISOString().slice(0, 10)
}
```
The deep-dish search is `places:searchText` with `textQuery: 'deep dish pizza'`, `locationBias` a 1500 m circle around each outbound station, then filtered to within 1000 m walking distance (`metres`). If the best result is not at the `PLAN` dinner station, the script uses the result's station and moves the dinner stop there, keeping its position in the order. Log that.

`web/scripts/practice-route.mjs` (run with `node --env-file=../.env`, from `web/`):
1. Refuse unless `PB_URL` (default `http://127.0.0.1:8090`), `PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD` and `GOOGLE_PLACES_KEY` are set. Refuse early, before spending Places budget, if a **locked** itinerary titled `CANNED_TITLE` exists. (A draft with that title is a failed earlier run; `buildCannedRoute` replaces it.)
2. Load the station list with `buildSchedule(unzipGtfs(await readFile(<latest data/gtfs zip>)))` (`ls data/gtfs` to see the cached file name; the same loader as `prepare-rehearsal.mjs`). Resolve each `PLAN` station's lat/lon/name, and fail on a missing id.
3. Pick venues in `PLAN` order through the selectors, with one `used` set, and cache the raw Places JSON and photos under `data/practice-route/`.
4. Pick `event_date = nextFreeSaturday(todayInTz(), <locked routes' event_dates>)`. Check `servicesOn(schedule, event_date)` has BNSF trips, and walk forward a Saturday at a time (at most 8) until one does. Otherwise fail with "The timetable does not cover the next Saturdays".
5. Build the stop list (`name`, `kind` `bar`/`restaurant`, `station_id`, `station_name`, `dwell_min`, `walk_min` = `Math.max(2, Math.round(metres / 80))`, `direction`, plus the place fields), and call `buildCannedRoute` with a superuser-backed `api` and `ownerId` = the first admin user (fail if none). Attaching places and photos exactly as `shared-rehearsal.mjs`'s `finish()` did (copy that block) happens per stop, right after its create, through `api.create('places', …)` / `api.update('stops', …)`. That keeps it inside the draft phase.

`practice-build.mjs` `buildCannedRoute`, in this order. **Nothing is visible to users until step 5.**
1. `list('itineraries', title === opts.title)`. If any row is `locked`, throw "already exists". Remove each draft/archived row with that title (`remove` cascades its stops and legs); these are the script's own failed runs.
2. Create the itinerary (the hook makes it a draft), then create the stops in order.
3. Poll `list('legs', itinerary === id)` every `pollMs` until there are `stops.length - 1` legs or `timeoutMs` passes (production: 60 s / 1 s). **The recompute hook runs on drafts** (`planning.pb.js:80-93`, the stop after-create hooks), so the legs arrive before locking. On timeout, throw "timed out waiting for the planner; the draft <id> is left for inspection".
4. If any leg's `kind` is not `train` or `walk`, throw "impossible legs: …", naming each leg's stops. The route stays a draft, which only the planner's draft list shows.
5. `update('itineraries', id, { status: 'locked' })`. Locking changes neither `start_time` nor `event_date`, so it does not trigger a recompute, and the checked legs stand.
6. If `getSettings().current_itinerary` is empty, `setCurrent(id)`. Return `{ id, legs }`, and the CLI prints the route id, date and stop list.

The fallback exposes the newest locked route whenever the setting is empty, so between steps 5 and 6 the canned route is already visible. That is the intended outcome, and it happens only after validation.

`justfile`:
```
practice-route:
    cd web && node --env-file=../.env scripts/practice-route.mjs
```

- [ ] **Step 4: Run to verify the unit test passes**

Run: `cd web && npx vitest run tests/unit/practiceVenues.test.ts tests/unit/practiceBuild.test.ts` → PASS. Also `npm run check` (the `.mjs` import types) → green.

- [ ] **Step 5: Commit**

```bash
git add web/scripts web/tests/unit/practiceVenues.test.ts web/tests/unit/practiceBuild.test.ts justfile
git commit -m "feat: one-time canned practice route, out and back with lunch and deep dish"
```

(The real run against production happens after the merge, in Task 9. It spends Places budget and writes to the real database.)

---

### Task 9: Documentation, full verification and the production cutover

**Files:**
- Modify: `CLAUDE.md` (Deploying; the "Keep practice and real-event data separate" trap)
- Modify: `README.md` (deployment, "Practice days" section)
- Modify: `docs/OPERATIONS.md` (rehearsal procedures)

- [ ] **Step 1: Update the docs**

`CLAUDE.md`:
- Replace the Deploying paragraph's first two sentences with: "`just up` runs the one real stack (`docker compose up -d --build`)."
- Replace the trap "Keep practice and real-event data separate…" with: "**Practice is a day, not a database.** On any date that is not the current route's `event_date`, Live runs the route's timetable at today's time (`planClock.ts`). Everything people post is stamped by the server; Live reads only the server's today (`/api/day`, `dayBounds`). Never plan legs from plan time, and never filter activity by plan time."
- Add a trap: "**The current route is `crawl_settings.current_itinerary`**, falling back to the newest locked route. Client (`$lib/live/route.ts`) and hooks (`pb_hooks/current.js`) must agree."

`README.md` and `docs/OPERATIONS.md`: remove the `REHEARSAL=0/1` instructions, and describe `just practice-route` and "Make current" in two short paragraphs.

- [ ] **Step 2: Full verification**

Run: `cd web && npm test && npm run check && npm run test:e2e && cd .. && bash scripts/test-hooks.sh`
Expected: everything passes. Paste the summary lines into the branch's final report.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md README.md docs/OPERATIONS.md
git commit -m "docs: practice days replace shared rehearsal"
```

- [ ] **Step 4: Cutover (after merge, with the user present)**

This changes production and spends Places budget, so confirm with the user before each numbered action. Production runs from the **main checkout's working tree** (`/home/garamizo/chug-a-lug`). Today it is Compose project `chug-a-lug`, built from `compose.yml` + `compose.rehearsal.yml` and mounting `data/rehearsal/pb_data`. Task 7 deletes `compose.rehearsal.yml`, so the old stack has to be stopped **before** main is fast-forwarded.

Before the merge, from the main checkout (still at `4b159cc`, where the file exists):
1. Record what is running: `docker compose ls`, and `docker compose -f compose.yml -f compose.rehearsal.yml config > ~/chug-a-lug-rehearsal-compose.$(date +%F).yml`, for reference and rollback.
2. Back up the real database the new stack will open: `tar czf data/backups/pb_data-before-practice-days.$(date +%F).tgz -C data pb_data`. `data/pb_data` holds rows from the real stack's last run (2026-09-22). Before the migration applies, list its locked itineraries (`sqlite3 data/pb_data/data.db "select id,title,event_date,status from itineraries"`), because the newest one becomes the fallback current route. If there are leftover test routes, ask the user whether to archive them before step 6.
3. `docker compose -f compose.yml -f compose.rehearsal.yml down` stops the rehearsal stack. `data/rehearsal/` stays on disk. If the checkout has moved on already, the file-free form works too: `docker compose -p chug-a-lug down`.

Then merge and bring up the real stack:
4. `git merge --ff-only feat/practice-days` in the main checkout.
5. `just up` starts the real stack on `data/pb_data`, and migration `1758850000` applies on start. `docker compose ls` must show only `compose.yml` for `chug-a-lug`, and `docker images | grep chug` must show a fresh image.
6. `just practice-route` builds the canned route and selects it as current, unless a route is already selected.
7. Open `https://chugalug.app/live` on a phone. You should see the Practice badge and timetable trains, and the planner should show no Bulletin.

**Rollback** (if step 5 or 7 fails and cannot be fixed forward):
- `docker compose -p chug-a-lug down`
- `git worktree add .worktrees/rollback 4b159cc`
- copy `.env` into that worktree
- run `just up` there, which is the old default: rehearsal on a freshly wiped `data/rehearsal`
- restore `data/pb_data` from the step-2 tarball if the migration must be undone
