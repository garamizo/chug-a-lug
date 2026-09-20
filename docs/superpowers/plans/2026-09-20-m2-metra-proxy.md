# M2 Metra Proxy and Departure Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Poll Metra's realtime feeds for the BNSF line, merge live times onto the static timetable, and put a ticket-shaped Departure Board with Last Call and All Aboard alerts on a new `/live` screen.

**Architecture:** A single in-process poller holds the latest decoded `FeedMessage` of each of Metra's three realtime feeds. Pure functions turn those into predictions and alerts; the existing `/api/metra/next` gains live times; a new `/api/metra/alerts` serves service alerts. The client derives which stop the crawl is at from the clock over the locked itinerary's legs, with a Conductor correction stored as a `checkins` record, and renders the board from two pure functions.

**Tech Stack:** SvelteKit 2 (Svelte 5 runes), TypeScript, PocketBase 0.28, `gtfs-realtime-bindings`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-20-m2-metra-proxy-design.md`

## Global Constraints

- **BNSF only** for trip-update and alert selection. All three feeds are still polled and recorded whole. The route id is the string `BNSF`; `PLANNER_ROUTE` in `web/src/lib/lineMap.ts` already holds it.
- **Realtime endpoints:** `https://gtfspublic.metrarr.com/gtfs/public/{positions,tripupdates,alerts}`, protobuf only, `Authorization: Bearer <token>`. Updated every 30 s; **do not poll faster than 30 s**. The old `gtfsapi.metrarail.com` host and its Basic auth were shut off 2025-11-01.
- **The token never leaves the server.** It is read only through `serverEnv.metraToken` and must never appear in a response body, a log line, or the client bundle.
- **Staleness threshold is 120 s** (`STALE_AFTER_SEC`), in one exported constant so the field test can tune it.
- **Departure buffer is 3 minutes** (`BUFFER_MIN`); the first warning is **10 minutes** (`WARNING_MIN`).
- **UI copy lives only in `web/src/lib/labels.ts`.** No user-visible string is written inline in a component. The `labels` map holds glossary terms (Departure Board, Last Call, All Aboard, Conductor, Crew, Run, Layover); the `copy` map holds sentences.
- **Times are UTC in the database and in every API payload** (ISO 8601 strings). Rendering to America/Chicago happens only through `$lib/time.ts` helpers.
- **Colours** (already the app's): background `#111`, text `#eee`, amber `#ffb400`, muted `#9a9a9a`, border `#2a2a2a`. Board card ivory `#f2efe6` with ink `#141413`; Last Call amber `#ffb400` with ink `#111`; All Aboard red `#c0261c` with white text. Touch targets are at least 44px.
- **Test fixtures:** tasks 1–11 use protobuf fixtures built with `GtfsRealtimeBindings.transit_realtime.FeedMessage.encode`, so unit tests are deterministic and need no token. Spec §9 asks for bytes captured from the live feed; Task 13 captures a real recording and adds a decode test over it, which is where that requirement is met.

---

### Task 1: Realtime fetch and decode

**Files:**
- Modify: `web/package.json` (add `gtfs-realtime-bindings`)
- Modify: `web/src/lib/server/env.ts`
- Modify: `.env.example`
- Create: `web/src/lib/server/metra/realtime.ts`
- Create: `web/tests/fixtures/rt.ts`
- Test: `web/tests/unit/realtime.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createRealtimeLoader(cfg: RealtimeConfig)` returning `{ refresh(opts?); start(); feeds(): Feeds; status(): RealtimeStatus; statusOf(name: FeedName): FeedStatus; setFetch(fn); stop(): void }`, where
  `type FeedName = 'positions' | 'tripupdates' | 'alerts'`,
  `type Feeds = Record<FeedName, { message: FeedMessage; fetchedAt: string } | null>`,
  `type FeedStatus = { fetchedAt: string | null; ageSec: number | null; enabled: boolean }`,
  `type RealtimeStatus = FeedStatus & { feeds: Record<FeedName, FeedStatus> }`.
  Also `web/tests/fixtures/rt.ts` exporting `encodeFeed(entities, timestampSec)`, `tripUpdate(...)`, `alertEntity(...)`.

**Why per-feed freshness.** One shared "last fetched" timestamp advanced by whichever feed happened to
succeed lets a healthy `positions` or `alerts` vouch for trip predictions that stopped arriving an hour
ago, and the board keeps counting down to times nobody publishes any more. Each feed carries its own
`fetchedAt`, and callers ask about the feed they actually depend on (spec §2.3).

- [ ] **Step 1: Add the dependency**

```bash
cd web && npm install gtfs-realtime-bindings@^1.1.1
```

- [ ] **Step 2: Add the config to `web/src/lib/server/env.ts`**

Add these two getters to the `serverEnv` object, after `gtfsPublishedUrl`:

```ts
  get metraToken() { return env.METRA_API_TOKEN || ''; },
  get metraRtBase() { return env.METRA_RT_BASE || 'https://gtfspublic.metrarr.com/gtfs/public'; },
```

- [ ] **Step 3: Document them in `.env.example`**

Replace the line `METRA_API_TOKEN=` (under "Later milestones; unused in M1.") with:

```
# Metra realtime (M2). Bearer token for gtfspublic.metrarr.com; the copy in .secrets/ is git-ignored.
# Leave empty to run on the static timetable alone: the app then says "Timetable only".
METRA_API_TOKEN=
# METRA_RT_BASE=https://gtfspublic.metrarr.com/gtfs/public
```

- [ ] **Step 4: Write the fixture builder `web/tests/fixtures/rt.ts`**

```ts
// Protobuf fixtures built with the same bindings the server decodes with, so unit tests need no
// token and no network. Task 13 adds a test over bytes captured from the real feed.
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;

/** Wraps entities in a FeedMessage and returns the encoded bytes. */
export function encodeFeed(entity: unknown[], timestampSec: number): Uint8Array {
  return FeedMessage.encode(FeedMessage.fromObject({
    header: { gtfsRealtimeVersion: '2.0', incrementality: 0, timestamp: timestampSec },
    entity
  })).finish();
}

/** One TripUpdate entity. `stops` maps stopId to seconds-since-epoch departure and arrival. */
export function tripUpdate(opts: {
  id: string; tripId: string; routeId?: string; canceled?: boolean;
  stops?: { stopId: string; departure?: number; arrival?: number }[];
}) {
  return {
    id: opts.id,
    tripUpdate: {
      trip: { tripId: opts.tripId, routeId: opts.routeId ?? 'BNSF', scheduleRelationship: opts.canceled ? 3 : 0 },
      stopTimeUpdate: (opts.stops ?? []).map((s) => ({
        stopId: s.stopId,
        ...(s.arrival === undefined ? {} : { arrival: { time: s.arrival } }),
        ...(s.departure === undefined ? {} : { departure: { time: s.departure } })
      }))
    }
  };
}

/** One Alert entity. `informed` is a list of informed_entity objects. */
export function alertEntity(opts: {
  id: string; header: string; body?: string; effect?: number;
  activeStart?: number; activeEnd?: number; informed?: Record<string, unknown>[];
}) {
  return {
    id: opts.id,
    alert: {
      activePeriod: opts.activeStart === undefined && opts.activeEnd === undefined ? [] : [{
        ...(opts.activeStart === undefined ? {} : { start: opts.activeStart }),
        ...(opts.activeEnd === undefined ? {} : { end: opts.activeEnd })
      }],
      informedEntity: opts.informed ?? [{ routeId: 'BNSF' }],
      effect: opts.effect ?? 2,
      headerText: { translation: [{ text: opts.header, language: 'en' }] },
      descriptionText: opts.body ? { translation: [{ text: opts.body, language: 'en' }] } : { translation: [] }
    }
  };
}
```

- [ ] **Step 5: Write the failing test `web/tests/unit/realtime.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createRealtimeLoader } from '../../src/lib/server/metra/realtime';
import { encodeFeed, tripUpdate } from '../fixtures/rt';

const bytes = (ts: number) => encodeFeed([tripUpdate({ id: 'e1', tripId: 'T1' })], ts);

/**
 * A tight ArrayBuffer copy. protobufjs's `finish()` returns a Node Buffer backed by an 8 KB pool,
 * and `Buffer.prototype.slice` is subarray semantics, so `.buffer` would hand back the whole pool
 * and the decoder would read past the message.
 */
const toArrayBuffer = (u8: Uint8Array): ArrayBuffer => new Uint8Array(u8).buffer;

/** A fetch that answers every feed with the same bytes and counts calls. */
function stubFetch(body: Uint8Array, ok = true) {
  const calls: { url: string; auth: string | null }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
    return ok
      ? { ok: true, status: 200, arrayBuffer: async () => toArrayBuffer(body) }
      : { ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

/** A fetch that fails only the named feeds, so one feed can rot while the others stay healthy. */
function stubFailing(body: Uint8Array, failing: string[]) {
  return (async (url: string) => {
    if (failing.some((f) => String(url).endsWith(`/${f}`))) {
      return { ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return { ok: true, status: 200, arrayBuffer: async () => toArrayBuffer(body) };
  }) as unknown as typeof fetch;
}

describe('createRealtimeLoader', () => {
  it('is disabled without a token and never fetches', async () => {
    const { impl, calls } = stubFetch(bytes(1));
    const rt = createRealtimeLoader({ base: 'https://x.test', token: '', fetchImpl: impl });
    await rt.refresh();
    expect(calls).toHaveLength(0);
    expect(rt.status()).toMatchObject({ fetchedAt: null, ageSec: null, enabled: false });
    expect(rt.statusOf('tripupdates')).toEqual({ fetchedAt: null, ageSec: null, enabled: false });
    expect(rt.feeds().tripupdates).toBeNull();
    rt.stop();
  });

  it('fetches all three feeds with a bearer token and decodes them', async () => {
    const { impl, calls } = stubFetch(bytes(1700000000));
    const rt = createRealtimeLoader({ base: 'https://x.test', token: 'SECRET', fetchImpl: impl });
    await rt.refresh();
    expect(calls.map((c) => c.url).sort()).toEqual([
      'https://x.test/alerts', 'https://x.test/positions', 'https://x.test/tripupdates'
    ]);
    expect(calls.every((c) => c.auth === 'Bearer SECRET')).toBe(true);
    expect(rt.feeds().tripupdates?.message.entity[0].id).toBe('e1');
    expect(rt.status().enabled).toBe(true);
    rt.stop();
  });

  it('keeps the last good feed when a fetch fails', async () => {
    const good = stubFetch(bytes(1700000000));
    const rt = createRealtimeLoader({ base: 'https://x.test', token: 'S', fetchImpl: good.impl });
    await rt.refresh();
    const first = rt.feeds().tripupdates;
    const bad = stubFetch(new Uint8Array(0), false);
    rt.setFetch(bad.impl);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await rt.refresh();
    expect(rt.feeds().tripupdates).toBe(first);
    rt.stop();
  });

  it('reports the age of the newest successful fetch', async () => {
    const { impl } = stubFetch(bytes(1700000000));
    const rt = createRealtimeLoader({ base: 'https://x.test', token: 'S', fetchImpl: impl, now: () => new Date('2026-12-26T20:02:00Z') });
    await rt.refresh({ at: new Date('2026-12-26T20:00:00Z') });
    expect(rt.status().ageSec).toBe(120);
    rt.stop();
  });

  it('ages each feed on its own, so a healthy feed cannot vouch for a broken one', async () => {
    let clock = new Date('2026-12-26T20:00:00Z');
    const body = bytes(1700000000);
    const { impl } = stubFetch(body);
    const rt = createRealtimeLoader({ base: 'https://x.test', token: 'S', fetchImpl: impl, now: () => clock });
    // Everything healthy at 20:00.
    await rt.refresh({ at: new Date('2026-12-26T20:00:00Z') });
    expect(rt.statusOf('tripupdates').ageSec).toBe(0);

    // tripupdates starts failing; alerts and positions keep succeeding for another ten minutes.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    rt.setFetch(stubFailing(body, ['tripupdates']));
    clock = new Date('2026-12-26T20:10:00Z');
    await rt.refresh({ at: clock });

    expect(rt.statusOf('alerts').ageSec).toBe(0);
    expect(rt.statusOf('tripupdates').ageSec).toBe(600);
    // The retained message is still there — it is the freshness that must give it away.
    expect(rt.feeds().tripupdates).not.toBeNull();
    // The overall figure follows the newest feed, which is why callers must not use it for predictions.
    expect(rt.status().ageSec).toBe(0);
    rt.stop();
  });
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `cd web && npx vitest run tests/unit/realtime.test.ts`
Expected: FAIL — `Failed to resolve import ".../server/metra/realtime"`.

- [ ] **Step 7: Write `web/src/lib/server/metra/realtime.ts`**

```ts
// Polls Metra's three GTFS-realtime feeds and keeps the newest decoded message of each in memory.
// A fetch failure keeps the previous feed; it never clears one. The token is read here and nowhere
// else, and never leaves the server.
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
export type FeedMessage = InstanceType<typeof FeedMessage>;

export type FeedName = 'positions' | 'tripupdates' | 'alerts';
export const FEED_NAMES: FeedName[] = ['positions', 'tripupdates', 'alerts'];

export type Feed = { message: FeedMessage; fetchedAt: string };
export type Feeds = Record<FeedName, Feed | null>;
export type FeedStatus = { fetchedAt: string | null; ageSec: number | null; enabled: boolean };
/** The newest fetch across all feeds, plus each feed on its own. */
export type RealtimeStatus = FeedStatus & { feeds: Record<FeedName, FeedStatus> };

export type RealtimeConfig = {
  base: string;
  token: string;
  fetchImpl?: typeof fetch;
  /** Metra publishes every 30 s and asks that nobody poll faster. */
  pollMs?: number;
  now?: () => Date;
};

export function createRealtimeLoader(cfg: RealtimeConfig) {
  let fetchImpl = cfg.fetchImpl ?? fetch;
  const now = cfg.now ?? (() => new Date());
  const pollMs = cfg.pollMs ?? 30_000;
  const feeds: Feeds = { positions: null, tripupdates: null, alerts: null };
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<void> | null = null;

  async function fetchOne(name: FeedName, at: Date): Promise<void> {
    const res = await fetchImpl(`${cfg.base}/${name}`, { headers: { Authorization: `Bearer ${cfg.token}` } });
    if (!res.ok) throw new Error(`${name} HTTP ${res.status}`);
    const message = FeedMessage.decode(new Uint8Array(await res.arrayBuffer()));
    feeds[name] = { message, fetchedAt: at.toISOString() };
  }

  async function refresh(opts?: { at?: Date }): Promise<void> {
    if (!cfg.token) return;
    if (inFlight) return inFlight;
    const at = opts?.at ?? now();
    inFlight = (async () => {
      const results = await Promise.allSettled(FEED_NAMES.map((n) => fetchOne(n, at)));
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') return;
        // Never log the reason object wholesale: it can carry the request headers.
        console.warn(`[metra-rt] ${FEED_NAMES[i]} fetch failed:`, (r.reason as Error)?.message ?? 'unknown');
      });
      // Nothing to record here: each feed's own `fetchedAt` was stamped by its successful fetchOne,
      // and a failed feed keeps the older one. Freshness is per feed on purpose.
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  function start(): void {
    if (timer || !cfg.token) return;
    void refresh();
    timer = setInterval(() => void refresh(), pollMs);
    // Do not hold the Node event loop open just for polling.
    (timer as unknown as { unref?: () => void }).unref?.();
  }

  const ageOf = (at: string | null): number | null =>
    at === null ? null : Math.max(0, Math.round((now().getTime() - new Date(at).getTime()) / 1000));

  function statusOf(name: FeedName): FeedStatus {
    if (!cfg.token) return { fetchedAt: null, ageSec: null, enabled: false };
    const fetchedAt = feeds[name]?.fetchedAt ?? null;
    return { fetchedAt, ageSec: ageOf(fetchedAt), enabled: true };
  }

  return {
    refresh,
    start,
    feeds: () => feeds,
    statusOf,
    status(): RealtimeStatus {
      const perFeed = Object.fromEntries(FEED_NAMES.map((n) => [n, statusOf(n)])) as Record<FeedName, FeedStatus>;
      if (!cfg.token) return { fetchedAt: null, ageSec: null, enabled: false, feeds: perFeed };
      // The headline figure is the newest fetch of any feed: useful to an operator, useless for
      // deciding whether one feed's contents can be trusted. Callers that care use statusOf().
      const newest = FEED_NAMES
        .map((n) => perFeed[n].fetchedAt)
        .filter((at): at is string => at !== null)
        .sort()
        .at(-1) ?? null;
      return { fetchedAt: newest, ageSec: ageOf(newest), enabled: true, feeds: perFeed };
    },
    /** Tests swap the fetch to simulate an outage after a good poll. */
    setFetch(next: typeof fetch) { fetchImpl = next; },
    stop() { if (timer) { clearInterval(timer); timer = null; } }
  };
}
```

- [ ] **Step 8: Run the tests**

Run: `cd web && npx vitest run tests/unit/realtime.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 9: Commit**

```bash
git add web/package.json web/package-lock.json web/src/lib/server/env.ts .env.example web/src/lib/server/metra/realtime.ts web/tests/fixtures/rt.ts web/tests/unit/realtime.test.ts
git commit -m "feat(metra): poll and decode the three realtime feeds

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Predictions and the live merge

**Files:**
- Create: `web/src/lib/server/metra/decode.ts`
- Create: `web/src/lib/metra/live.ts`
- Modify: `web/src/lib/types.ts`
- Test: `web/tests/unit/live.test.ts`

**Interfaces:**
- Consumes: `FeedMessage` from Task 1; `encodeFeed`, `tripUpdate` from `web/tests/fixtures/rt.ts`.
- Produces:
  `readPredictions(feed: FeedMessage | null, routeId: string): Predictions` in `decode.ts`;
  `mergeLive(trips: NextTrip[], preds: Predictions, fromStopId: string, toStopId: string): NextTrip[]`,
  `selectDepartures(candidates: NextTrip[], preds: Predictions, fromStopId: string, toStopId: string, after: Date, limit: number): NextTrip[]`,
  `modeFor(status: { ageSec: number | null; enabled: boolean }): FeedMode` and the constants
  `STALE_AFTER_SEC`, `DELAY_LOOKBACK_MIN` in `live.ts`;
  widened `NextTrip` and new `FeedMode` in `types.ts`.

**Why selection is a separate function.** Merging has to happen before any filtering or limiting. A train
scheduled for 20:31 and running ten minutes late has not left at 20:35, but a filter on the *scheduled*
time drops it while it is still at the platform — and cutting to `limit` before cancellations are removed
lets three cancelled trains empty a board that has good service behind them (spec §2.2).

- [ ] **Step 1: Widen the types in `web/src/lib/types.ts`**

Replace the `NextTrip` type (currently at line 60) with:

```ts
/** `live*` equal the scheduled times when no TripUpdate covers the trip: Metra means on time. */
export type NextTrip = {
  tripId: string; routeId: string; headsign: string; schedDepart: string; schedArrive: string;
  liveDepart: string | null; liveArrive: string | null; delayMin: number | null;
  status: 'scheduled' | 'live';
};

/** How much the server trusts its train times right now. */
export type FeedMode = 'live' | 'stale' | 'schedule_only';
```

- [ ] **Step 2: Write the failing test `web/tests/unit/live.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { readPredictions } from '../../src/lib/server/metra/decode';
import { mergeLive, modeFor, selectDepartures, STALE_AFTER_SEC } from '../../src/lib/metra/live';
import { encodeFeed, tripUpdate } from '../fixtures/rt';
import type { NextTrip } from '../../src/lib/types';

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
const decode = (b: Uint8Array) => FeedMessage.decode(b);
const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

const trip = (tripId: string, dep: string, arr: string): NextTrip => ({
  tripId, routeId: 'BNSF', headsign: 'Chicago', schedDepart: dep, schedArrive: arr,
  liveDepart: null, liveArrive: null, delayMin: null, status: 'scheduled'
});

describe('readPredictions', () => {
  it('reads departures and arrivals per trip and stop, for our route only', () => {
    const feed = decode(encodeFeed([
      tripUpdate({ id: 'a', tripId: 'T1', stops: [{ stopId: 'LAGRANGE', departure: sec('2026-12-26T20:34:00Z'), arrival: sec('2026-12-26T20:33:00Z') }] }),
      tripUpdate({ id: 'b', tripId: 'T9', routeId: 'UP-W', stops: [{ stopId: 'LAGRANGE', departure: sec('2026-12-26T20:40:00Z') }] })
    ], 1));
    const preds = readPredictions(feed, 'BNSF');
    expect(preds.T1.stops.LAGRANGE.departAt).toBe('2026-12-26T20:34:00.000Z');
    expect(preds.T1.stops.LAGRANGE.arriveAt).toBe('2026-12-26T20:33:00.000Z');
    expect(preds.T9).toBeUndefined();
  });

  it('marks a cancelled trip and survives a missing feed', () => {
    const feed = decode(encodeFeed([tripUpdate({ id: 'c', tripId: 'T2', canceled: true })], 1));
    expect(readPredictions(feed, 'BNSF').T2.canceled).toBe(true);
    expect(readPredictions(null, 'BNSF')).toEqual({});
  });
});

describe('mergeLive', () => {
  const trips = [trip('T1', '2026-12-26T20:31:00.000Z', '2026-12-26T20:46:00.000Z')];

  it('treats a trip with no update as on time', () => {
    const [t] = mergeLive(trips, {}, 'LAGRANGE', 'BERWYN');
    expect(t.liveDepart).toBe('2026-12-26T20:31:00.000Z');
    expect(t.liveArrive).toBe('2026-12-26T20:46:00.000Z');
    expect(t.delayMin).toBe(0);
    expect(t.status).toBe('scheduled');
  });

  it('applies a predicted departure and arrival and reports the delay in minutes', () => {
    const preds = { T1: { canceled: false, stops: {
      LAGRANGE: { departAt: '2026-12-26T20:34:00.000Z' },
      BERWYN: { arriveAt: '2026-12-26T20:49:00.000Z' }
    } } };
    const [t] = mergeLive(trips, preds, 'LAGRANGE', 'BERWYN');
    expect(t.liveDepart).toBe('2026-12-26T20:34:00.000Z');
    expect(t.liveArrive).toBe('2026-12-26T20:49:00.000Z');
    expect(t.delayMin).toBe(3);
    expect(t.status).toBe('live');
  });

  it('falls back to the scheduled time for a stop the update does not mention', () => {
    const preds = { T1: { canceled: false, stops: { LAGRANGE: { departAt: '2026-12-26T20:34:00.000Z' } } } };
    const [t] = mergeLive(trips, preds, 'LAGRANGE', 'BERWYN');
    expect(t.liveArrive).toBe('2026-12-26T20:46:00.000Z');
  });

  it('reports a train running early as a negative delay', () => {
    const preds = { T1: { canceled: false, stops: { LAGRANGE: { departAt: '2026-12-26T20:29:00.000Z' } } } };
    expect(mergeLive(trips, preds, 'LAGRANGE', 'BERWYN')[0].delayMin).toBe(-2);
  });

  it('drops a cancelled trip entirely', () => {
    const preds = { T1: { canceled: true, stops: {} } };
    expect(mergeLive(trips, preds, 'LAGRANGE', 'BERWYN')).toEqual([]);
  });
});

describe('selectDepartures', () => {
  const after = new Date('2026-12-26T20:35:00.000Z');
  const candidates = [
    trip('T1', '2026-12-26T20:31:00.000Z', '2026-12-26T20:46:00.000Z'), // late, still catchable
    trip('T2', '2026-12-26T21:00:00.000Z', '2026-12-26T21:15:00.000Z'),
    trip('T3', '2026-12-26T22:00:00.000Z', '2026-12-26T22:15:00.000Z'),
    trip('T4', '2026-12-26T23:00:00.000Z', '2026-12-26T23:15:00.000Z')
  ];

  it('keeps a train delayed past its scheduled departure', () => {
    // Scheduled 20:31, predicted 20:41. At 20:35 it has not left.
    const preds = { T1: { canceled: false, stops: { LAGRANGE: { departAt: '2026-12-26T20:41:00.000Z' } } } };
    const out = selectDepartures(candidates, preds, 'LAGRANGE', 'BERWYN', after, 3);
    expect(out[0].tripId).toBe('T1');
    expect(out[0].liveDepart).toBe('2026-12-26T20:41:00.000Z');
  });

  it('drops a train that has really gone', () => {
    const out = selectDepartures(candidates, {}, 'LAGRANGE', 'BERWYN', after, 3);
    expect(out.map((t) => t.tripId)).toEqual(['T2', 'T3', 'T4']);
  });

  it('does not let cancellations empty the board', () => {
    const cancel = { canceled: true, stops: {} };
    const preds = { T1: cancel, T2: cancel, T3: cancel };
    const out = selectDepartures(candidates, preds, 'LAGRANGE', 'BERWYN', after, 3);
    expect(out.map((t) => t.tripId)).toEqual(['T4']);
  });

  it('sorts by effective departure, not scheduled', () => {
    // T2 is held 90 minutes, so T3 overtakes it.
    const preds = { T2: { canceled: false, stops: { LAGRANGE: { departAt: '2026-12-26T22:30:00.000Z' } } } };
    const out = selectDepartures(candidates, preds, 'LAGRANGE', 'BERWYN', after, 3);
    expect(out.map((t) => t.tripId)).toEqual(['T3', 'T2', 'T4']);
  });

  it('applies the limit last', () => {
    const out = selectDepartures(candidates, {}, 'LAGRANGE', 'BERWYN', after, 2);
    expect(out).toHaveLength(2);
    expect(out.map((t) => t.tripId)).toEqual(['T2', 'T3']);
  });

  it('returns nothing when the service day is over', () => {
    expect(selectDepartures(candidates, {}, 'LAGRANGE', 'BERWYN', new Date('2026-12-27T02:00:00.000Z'), 3)).toEqual([]);
  });
});

describe('modeFor', () => {
  it('is schedule_only without a token or before the first successful fetch', () => {
    expect(modeFor({ ageSec: null, enabled: false })).toBe('schedule_only');
    expect(modeFor({ ageSec: null, enabled: true })).toBe('schedule_only');
  });
  it('is live up to the threshold and stale past it', () => {
    expect(modeFor({ ageSec: 0, enabled: true })).toBe('live');
    expect(modeFor({ ageSec: STALE_AFTER_SEC, enabled: true })).toBe('live');
    expect(modeFor({ ageSec: STALE_AFTER_SEC + 1, enabled: true })).toBe('stale');
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd web && npx vitest run tests/unit/live.test.ts`
Expected: FAIL — cannot resolve `decode` or `live`.

- [ ] **Step 4: Write `web/src/lib/server/metra/decode.ts`**

```ts
// Turns decoded GTFS-realtime feeds into the plain data the pure merge works on. Everything that
// knows about protobuf shapes lives here.
import type { FeedMessage } from './realtime';
import type { Predictions } from '$lib/metra/live';

/** GTFS-realtime ScheduleRelationship.CANCELED on a TripDescriptor. */
const CANCELED = 3;

const iso = (t: unknown): string | undefined => {
  // protobufjs gives Long for 64-bit fields; Number() handles both it and a plain number.
  const n = t === null || t === undefined ? NaN : Number(t);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : undefined;
};

/** Predicted times per trip and stop, for `routeId` only. A missing feed yields no predictions. */
export function readPredictions(feed: FeedMessage | null, routeId: string): Predictions {
  const out: Predictions = {};
  for (const entity of feed?.entity ?? []) {
    const tu = entity.tripUpdate;
    const tripId = tu?.trip?.tripId;
    if (!tu || !tripId) continue;
    if (tu.trip?.routeId && tu.trip.routeId !== routeId) continue;
    const pred = out[tripId] ?? (out[tripId] = { canceled: false, stops: {} });
    if (tu.trip?.scheduleRelationship === CANCELED) pred.canceled = true;
    for (const stu of tu.stopTimeUpdate ?? []) {
      if (!stu.stopId) continue;
      const at = pred.stops[stu.stopId] ?? (pred.stops[stu.stopId] = {});
      const departAt = iso(stu.departure?.time);
      const arriveAt = iso(stu.arrival?.time);
      if (departAt) at.departAt = departAt;
      if (arriveAt) at.arriveAt = arriveAt;
    }
  }
  return out;
}
```

- [ ] **Step 5: Write `web/src/lib/metra/live.ts`**

```ts
// Pure: merging predicted times onto scheduled ones, and deciding how much to trust them.
import type { FeedMode, NextTrip } from '$lib/types';

/** Four missed polls. One constant so the field test can tune it. */
export const STALE_AFTER_SEC = 120;

/**
 * How far before the caller's `after` to look for candidate trips. A train can be running late, and a
 * late train has not departed: drawing candidates only from `after` onwards would hide one still standing
 * at the platform. Metra delays past an hour are rare, and the scan costs about a millisecond.
 */
export const DELAY_LOOKBACK_MIN = 60;

export type StopPrediction = { departAt?: string; arriveAt?: string };
export type TripPrediction = { canceled: boolean; stops: Record<string, StopPrediction> };
export type Predictions = Record<string, TripPrediction>;

const minutesBetween = (a: string, b: string) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 60_000);

/**
 * Overlays predictions on scheduled trips for one leg. A trip with no prediction is on time, which
 * is what Metra's absence of a TripUpdate means. A cancelled trip is dropped so the caller rolls on.
 */
export function mergeLive(trips: NextTrip[], preds: Predictions, fromStopId: string, toStopId: string): NextTrip[] {
  const out: NextTrip[] = [];
  for (const t of trips) {
    const pred = preds[t.tripId];
    if (pred?.canceled) continue;
    const liveDepart = pred?.stops[fromStopId]?.departAt ?? t.schedDepart;
    const liveArrive = pred?.stops[toStopId]?.arriveAt ?? t.schedArrive;
    out.push({
      ...t, liveDepart, liveArrive,
      delayMin: minutesBetween(liveDepart, t.schedDepart),
      status: pred ? 'live' : 'scheduled'
    });
  }
  return out;
}

const effective = (t: NextTrip) => new Date(t.liveDepart ?? t.schedDepart).getTime();

/**
 * Merge first, then filter, then sort, then cut. Every step after the merge depends on the effective
 * departure, so doing any of them earlier throws away trips that are still catchable: a delayed train
 * filtered out by its scheduled time, or good service cut off behind three cancellations.
 */
export function selectDepartures(
  candidates: NextTrip[],
  preds: Predictions,
  fromStopId: string,
  toStopId: string,
  after: Date,
  limit: number
): NextTrip[] {
  return mergeLive(candidates, preds, fromStopId, toStopId)
    .filter((t) => effective(t) >= after.getTime())
    .sort((a, b) => effective(a) - effective(b))
    .slice(0, limit);
}

/** `live` while that feed's last successful fetch is recent, `stale` once it is not, else `schedule_only`. */
export function modeFor(status: { ageSec: number | null; enabled: boolean }): FeedMode {
  if (!status.enabled || status.ageSec === null) return 'schedule_only';
  return status.ageSec <= STALE_AFTER_SEC ? 'live' : 'stale';
}
```

- [ ] **Step 6: Run the tests**

Run: `cd web && npx vitest run tests/unit/live.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/server/metra/decode.ts web/src/lib/metra/live.ts web/src/lib/types.ts web/tests/unit/live.test.ts
git commit -m "feat(metra): predictions from trip updates, merged onto the timetable

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Wire the poller into the server and report the mode

**Files:**
- Modify: `web/src/lib/server/metra/index.ts`
- Modify: `web/src/routes/api/metra/status/+server.ts`
- Modify: `web/src/routes/api/metra/next/+server.ts`
- Modify: `web/src/lib/types.ts`
- Test: `web/tests/unit/metra-endpoints.test.ts`

**Interfaces:**
- Consumes: `createRealtimeLoader` (Task 1), `readPredictions`, `mergeLive`, `modeFor` (Task 2).
- Produces: `metraRt` exported from `web/src/lib/server/metra/index.ts`; `MetraStatus` type; `/api/metra/status` and `/api/metra/next` returning real modes and live times.

- [ ] **Step 1: Add the `MetraStatus` type to `web/src/lib/types.ts`**

After the `FeedMode` type added in Task 2:

```ts
/**
 * `mode` is the tripupdates mode — the one the Departure Board actually runs on — so the status page
 * agrees with the board. `rtFetchedAt` / `rtAgeSec` are the newest fetch of any feed, and `feeds` breaks
 * it down so an operator can see which one is failing.
 */
export type MetraStatus = {
  staticPublishedAt: string; staticSource: string;
  rtFetchedAt: string | null; rtAgeSec: number | null; mode: FeedMode;
  feeds: Record<'positions' | 'tripupdates' | 'alerts', { fetchedAt: string | null; ageSec: number | null; mode: FeedMode }>;
};
```

- [ ] **Step 2: Export the loader from `web/src/lib/server/metra/index.ts`**

Append to the file (keep the existing `metra` export exactly as it is):

```ts
import { createRealtimeLoader } from './realtime';

// One poller per server process. It starts on the first request that needs realtime, not at import
// time, so tests and the build never open a socket. Without a token it stays disabled and every
// endpoint reports schedule_only.
export const metraRt = createRealtimeLoader({ base: serverEnv.metraRtBase, token: serverEnv.metraToken });
```

- [ ] **Step 3: Write the failing test `web/tests/unit/metra-endpoints.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeFeed, tripUpdate } from '../fixtures/rt';
import { fixtureSchedule } from '../fixtures/loadFixture';

type S = { fetchedAt: string | null; ageSec: number | null; enabled: boolean };
const off: S = { fetchedAt: null, ageSec: null, enabled: false };
const state = vi.hoisted(() => ({
  perFeed: {
    positions: { fetchedAt: null, ageSec: null, enabled: false },
    tripupdates: { fetchedAt: null, ageSec: null, enabled: false },
    alerts: { fetchedAt: null, ageSec: null, enabled: false }
  } as Record<'positions' | 'tripupdates' | 'alerts', S>,
  overall: { fetchedAt: null, ageSec: null, enabled: false } as S,
  feed: null as unknown
}));

vi.mock('$lib/server/pb', () => ({ requireUser: vi.fn(async () => ({ id: 'u1', is_admin: false })) }));
vi.mock('$lib/server/metra', () => ({
  metra: { getSchedule: vi.fn(async () => fixtureSchedule()), status: () => ({ publishedAt: 'P', loadedAt: 'L', source: 'file' }) },
  metraRt: {
    start: vi.fn(),
    status: () => ({ ...state.overall, feeds: state.perFeed }),
    statusOf: (name: 'positions' | 'tripupdates' | 'alerts') => state.perFeed[name],
    feeds: () => ({ positions: null, tripupdates: state.feed, alerts: null })
  }
}));

/** Marks every feed fresh at the same moment. */
const allFresh = (ageSec = 10) => {
  const s: S = { fetchedAt: '2026-12-26T20:00:00.000Z', ageSec, enabled: true };
  state.perFeed = { positions: { ...s }, tripupdates: { ...s }, alerts: { ...s } };
  state.overall = { ...s };
};

const get = async (mod: string, url: string) => {
  const { GET } = await import(mod);
  const res = await GET({ request: new Request(url), url: new URL(url) } as never);
  return res.json();
};

const reset = () => {
  vi.resetModules();
  state.perFeed = { positions: { ...off }, tripupdates: { ...off }, alerts: { ...off } };
  state.overall = { ...off };
  state.feed = null;
};

describe('/api/metra/status', () => {
  beforeEach(reset);

  it('reports schedule_only with no realtime', async () => {
    const body = await get('../../src/routes/api/metra/status/+server', 'http://x/api/metra/status');
    expect(body.mode).toBe('schedule_only');
    expect(body.rtAgeSec).toBeNull();
  });

  it('reports live with a fresh fetch, and breaks it down per feed', async () => {
    allFresh(12);
    const body = await get('../../src/routes/api/metra/status/+server', 'http://x/api/metra/status');
    expect(body).toMatchObject({ mode: 'live', rtAgeSec: 12, rtFetchedAt: '2026-12-26T20:00:00.000Z' });
    expect(body.feeds.tripupdates.mode).toBe('live');
    expect(body.feeds.alerts.mode).toBe('live');
  });

  it('reports stale past the threshold', async () => {
    allFresh(300);
    expect((await get('../../src/routes/api/metra/status/+server', 'http://x/api/metra/status')).mode).toBe('stale');
  });

  it('follows the tripupdates feed even when the others are fresh', async () => {
    allFresh(10);
    state.perFeed.tripupdates = { fetchedAt: '2026-12-26T19:50:00.000Z', ageSec: 600, enabled: true };
    const body = await get('../../src/routes/api/metra/status/+server', 'http://x/api/metra/status');
    expect(body.mode).toBe('stale');
    expect(body.feeds.alerts.mode).toBe('live');
    // The headline age still shows the newest fetch, which is why it must not drive the mode.
    expect(body.rtAgeSec).toBe(10);
  });
});

describe('/api/metra/next', () => {
  beforeEach(reset);

  const decodeFeed = async (tripId: string, departure: number) => ({
    fetchedAt: '2026-12-26T20:00:00.000Z',
    message: (await import('gtfs-realtime-bindings')).default.transit_realtime.FeedMessage.decode(
      encodeFeed([tripUpdate({ id: 'e', tripId, stops: [{ stopId: 'LAGRANGE', departure }] })], 1))
  });

  it('returns scheduled trips with live fields filled from the timetable', async () => {
    const body = await get('../../src/routes/api/metra/next/+server', 'http://x/api/metra/next?from=LAGRANGE&to=CUS&date=2026-12-26');
    expect(body.mode).toBe('schedule_only');
    expect(body.trips.length).toBeGreaterThan(0);
    expect(body.trips[0].liveDepart).toBe(body.trips[0].schedDepart);
    expect(body.trips[0].delayMin).toBe(0);
    expect(body.trips[0].status).toBe('scheduled');
  });

  it('applies a live prediction to the matching trip', async () => {
    const first = fixtureSchedule().trips.find((t) => t.routeId === 'BNSF')!;
    allFresh(10);
    state.feed = await decodeFeed(first.id, 4102444800);
    const body = await get('../../src/routes/api/metra/next/+server', 'http://x/api/metra/next?from=LAGRANGE&to=CUS&date=2026-12-26');
    expect(body.mode).toBe('live');
    const hit = body.trips.find((t: { tripId: string }) => t.tripId === first.id);
    if (hit) expect(hit.status).toBe('live');
  });

  it('ignores predictions when the tripupdates feed is stale, however fresh the others are', async () => {
    const first = fixtureSchedule().trips.find((t) => t.routeId === 'BNSF')!;
    allFresh(10);
    // Only tripupdates has rotted. The retained message is still in memory and must not be used.
    state.perFeed.tripupdates = { fetchedAt: '2026-12-26T19:50:00.000Z', ageSec: 600, enabled: true };
    state.feed = await decodeFeed(first.id, 4102444800);
    const body = await get('../../src/routes/api/metra/next/+server', 'http://x/api/metra/next?from=LAGRANGE&to=CUS&date=2026-12-26');
    expect(body.mode).toBe('stale');
    expect(body.trips.every((t: { status: string }) => t.status === 'scheduled')).toBe(true);
    expect(body.trips.every((t: { liveDepart: string; schedDepart: string }) => t.liveDepart === t.schedDepart)).toBe(true);
  });
});
```

- [ ] **Step 4: Run it and watch it fail**

Run: `cd web && npx vitest run tests/unit/metra-endpoints.test.ts`
Expected: FAIL — `metraRt` is not exported, and `/status` still hard-codes `schedule_only`.

- [ ] **Step 5: Rewrite `web/src/routes/api/metra/status/+server.ts`**

```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/pb';
import { metra, metraRt } from '$lib/server/metra';
import { modeFor } from '$lib/metra/live';
import type { MetraStatus } from '$lib/types';

export const GET: RequestHandler = async ({ request }) => {
  await requireUser(request);
  try {
    await metra.getSchedule();
  } catch {
    throw error(503, 'Metra schedule is not available yet. Try again in a minute.');
  }
  metraRt.start();
  const st = metra.status();
  const rt = metraRt.status();
  const feeds = Object.fromEntries(
    (['positions', 'tripupdates', 'alerts'] as const).map((n) => [n, {
      fetchedAt: rt.feeds[n].fetchedAt, ageSec: rt.feeds[n].ageSec, mode: modeFor(rt.feeds[n])
    }])
  ) as MetraStatus['feeds'];
  const body: MetraStatus = {
    staticPublishedAt: st.publishedAt, staticSource: st.source,
    rtFetchedAt: rt.fetchedAt, rtAgeSec: rt.ageSec,
    // The board runs on trip updates, so that is the mode this page reports.
    mode: modeFor(metraRt.statusOf('tripupdates')),
    feeds
  };
  return json(body);
};
```

- [ ] **Step 6: Update `web/src/routes/api/metra/next/+server.ts`**

Add the imports:

```ts
import { metra, metraRt } from '$lib/server/metra';
import { readPredictions } from '$lib/server/metra/decode';
import { DELAY_LOOKBACK_MIN, modeFor, selectDepartures } from '$lib/metra/live';
import { PLANNER_ROUTE } from '$lib/lineMap';
```

Replace the final two statements (the `const trips: NextTrip[] = ...` mapping and the `return json(...)`) with:

```ts
  metraRt.start();
  // Trip predictions are only as trustworthy as the tripupdates feed itself. A healthy positions or
  // alerts feed says nothing about whether departures are still being published.
  const mode = modeFor(metraRt.statusOf('tripupdates'));

  // Look back before `after` so a delayed train is still a candidate, and take more than the caller
  // asked for so cancellations cannot empty the result. Both are trimmed by selectDepartures.
  const fromMin = Math.max(0, afterMin - DELAY_LOOKBACK_MIN);
  const candidates: NextTrip[] = nextTrips(s, from, to, fromMin, date, limit + 8).map((c) => ({
    tripId: c.tripId, routeId: c.routeId, headsign: c.headsign,
    schedDepart: localToUtc(date, c.dep).toISOString(), schedArrive: localToUtc(date, c.arr).toISOString(),
    liveDepart: null, liveArrive: null, delayMin: null, status: 'scheduled'
  }));
  // Stale times are worse than none: fall back to the timetable rather than show old predictions.
  const preds = mode === 'live' ? readPredictions(metraRt.feeds().tripupdates?.message ?? null, PLANNER_ROUTE) : {};
  return json({ mode, trips: selectDepartures(candidates, preds, from, to, afterDate, limit) });
```

- [ ] **Step 7: Run the tests**

Run: `cd web && npx vitest run tests/unit/metra-endpoints.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 8: Run the whole unit suite and the type check**

Run: `cd web && npm test && npm run check`
Expected: all unit tests pass; svelte-check reports 0 errors.

- [ ] **Step 9: Commit**

```bash
git add web/src/lib/server/metra/index.ts web/src/routes/api/metra/status/+server.ts web/src/routes/api/metra/next/+server.ts web/src/lib/types.ts web/tests/unit/metra-endpoints.test.ts
git commit -m "feat(metra): live times and a real mode on next and status

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Service alerts

**Files:**
- Modify: `web/src/lib/server/metra/decode.ts`
- Modify: `web/src/lib/types.ts`
- Create: `web/src/routes/api/metra/alerts/+server.ts`
- Test: `web/tests/unit/alerts.test.ts`

**Interfaces:**
- Consumes: `FeedMessage` (Task 1), `modeFor` (Task 2).
- Produces: `selectAlerts(feed, opts): Alert[]` in `decode.ts`; the `Alert` type; `GET /api/metra/alerts` returning `{ mode, fetchedAt, alerts }`.

- [ ] **Step 1: Add the `Alert` type to `web/src/lib/types.ts`**

```ts
/** A Metra service alert, trimmed to what the UI shows. `id` is the feed's entity id and is stable. */
export type Alert = {
  id: string; effect: string; header: string; body: string;
  startsAt: string | null; endsAt: string | null; stationIds: string[];
};
```

- [ ] **Step 2: Write the failing test `web/tests/unit/alerts.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { selectAlerts } from '../../src/lib/server/metra/decode';
import { alertEntity, encodeFeed } from '../fixtures/rt';

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
const decode = (b: Uint8Array) => FeedMessage.decode(b);
const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const NOW = new Date('2026-12-26T20:00:00Z');
const STATIONS = new Set(['LAGRANGE', 'BERWYN', 'CUS']);
const opts = { routeId: 'BNSF', stationIds: STATIONS, now: NOW };

describe('selectAlerts', () => {
  it('keeps an alert informing our route and reads its text', () => {
    const feed = decode(encodeFeed([alertEntity({ id: 'a1', header: 'Delays', body: 'Signal problem', effect: 2 })], 1));
    expect(selectAlerts(feed, opts)).toEqual([
      { id: 'a1', effect: 'SIGNIFICANT_DELAYS', header: 'Delays', body: 'Signal problem', startsAt: null, endsAt: null, stationIds: [] }
    ]);
  });

  it('keeps an alert informing one of our stations and lists it', () => {
    const feed = decode(encodeFeed([alertEntity({ id: 'a2', header: 'Elevator', informed: [{ stopId: 'CUS' }] })], 1));
    const [a] = selectAlerts(feed, opts);
    expect(a.stationIds).toEqual(['CUS']);
  });

  it('drops an alert for another route', () => {
    const feed = decode(encodeFeed([alertEntity({ id: 'a3', header: 'Other', informed: [{ routeId: 'UP-W' }] })], 1));
    expect(selectAlerts(feed, opts)).toEqual([]);
  });

  it('keeps an agency-wide alert', () => {
    const feed = decode(encodeFeed([alertEntity({ id: 'a4', header: 'Holiday schedule', informed: [{ agencyId: 'metra' }] })], 1));
    expect(selectAlerts(feed, opts)).toHaveLength(1);
  });

  it('drops an alert whose active period has not started or has ended', () => {
    const feed = decode(encodeFeed([
      alertEntity({ id: 'future', header: 'Later', activeStart: sec('2026-12-26T22:00:00Z') }),
      alertEntity({ id: 'past', header: 'Earlier', activeEnd: sec('2026-12-26T19:00:00Z') }),
      alertEntity({ id: 'now', header: 'Current', activeStart: sec('2026-12-26T19:30:00Z'), activeEnd: sec('2026-12-26T21:00:00Z') })
    ], 1));
    expect(selectAlerts(feed, opts).map((a) => a.id)).toEqual(['now']);
  });

  it('returns nothing for a missing feed', () => {
    expect(selectAlerts(null, opts)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd web && npx vitest run tests/unit/alerts.test.ts`
Expected: FAIL — `selectAlerts` is not exported.

- [ ] **Step 4: Add `selectAlerts` to `web/src/lib/server/metra/decode.ts`**

```ts
import type { Alert } from '$lib/types';

/** GTFS-realtime Alert.Effect, by enum value. */
const EFFECTS = [
  'NO_SERVICE', 'REDUCED_SERVICE', 'SIGNIFICANT_DELAYS', 'DETOUR', 'ADDITIONAL_SERVICE',
  'MODIFIED_SERVICE', 'OTHER_EFFECT', 'UNKNOWN_EFFECT', 'STOP_MOVED', 'NO_EFFECT', 'ACCESSIBILITY_ISSUE'
];

/** First English translation, else the first of any language, else ''. */
const text = (t: { translation?: { text?: string | null; language?: string | null }[] } | null | undefined): string => {
  const all = t?.translation ?? [];
  return (all.find((x) => x.language === 'en') ?? all[0])?.text ?? '';
};

/**
 * Active alerts that inform our route, one of our stations, or the whole agency. An alert with no
 * active_period is always active, which is what the spec says an absent period means.
 */
export function selectAlerts(
  feed: FeedMessage | null,
  opts: { routeId: string; stationIds: Set<string>; now: Date }
): Alert[] {
  const nowSec = Math.floor(opts.now.getTime() / 1000);
  const out: Alert[] = [];
  for (const entity of feed?.entity ?? []) {
    const al = entity.alert;
    if (!al) continue;

    const periods = al.activePeriod ?? [];
    const active = periods.length === 0 || periods.some((p) => {
      const start = p.start === null || p.start === undefined ? -Infinity : Number(p.start);
      const end = p.end === null || p.end === undefined ? Infinity : Number(p.end);
      return nowSec >= start && nowSec <= end;
    });
    if (!active) continue;

    const informed = al.informedEntity ?? [];
    const stationIds = informed.map((e) => e.stopId).filter((id): id is string => !!id && opts.stationIds.has(id));
    const relevant = informed.some((e) =>
      e.routeId === opts.routeId ||
      (!!e.stopId && opts.stationIds.has(e.stopId)) ||
      (!e.routeId && !e.stopId && !e.trip));
    if (!relevant) continue;

    const first = periods[0];
    const at = (v: unknown) => (v === null || v === undefined ? null : new Date(Number(v) * 1000).toISOString());
    out.push({
      id: entity.id ?? '',
      effect: EFFECTS[al.effect ?? 7] ?? 'UNKNOWN_EFFECT',
      header: text(al.headerText),
      body: text(al.descriptionText),
      startsAt: at(first?.start),
      endsAt: at(first?.end),
      stationIds: [...new Set(stationIds)]
    });
  }
  return out;
}
```

- [ ] **Step 5: Run the alert tests**

Run: `cd web && npx vitest run tests/unit/alerts.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Create `web/src/routes/api/metra/alerts/+server.ts`**

```ts
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/pb';
import { metra, metraRt } from '$lib/server/metra';
import { selectAlerts } from '$lib/server/metra/decode';
import { modeFor } from '$lib/metra/live';
import { PLANNER_ROUTE, plannerStations } from '$lib/lineMap';

export const GET: RequestHandler = async ({ request }) => {
  await requireUser(request);
  let s;
  try {
    s = await metra.getSchedule();
  } catch {
    throw error(503, 'Metra schedule is not available yet. Try again in a minute.');
  }
  metraRt.start();
  // Alerts carry their own active periods, so a stale feed is still worth showing; the mode simply
  // says how fresh it is. It is gated on the alerts feed, never on a shared timestamp.
  const mode = modeFor(metraRt.statusOf('alerts'));
  const feed = metraRt.feeds().alerts;
  // Alerts have their own active periods, so a stale feed is still worth showing; only an absent
  // one yields nothing.
  const alerts = selectAlerts(feed?.message ?? null, {
    routeId: PLANNER_ROUTE,
    stationIds: new Set(plannerStations(s.lines).map((st) => st.id)),
    now: new Date()
  });
  return json({ mode, fetchedAt: feed?.fetchedAt ?? null, alerts });
};
```

- [ ] **Step 7: Run the unit suite and the type check**

Run: `cd web && npm test && npm run check`
Expected: all pass, 0 type errors.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/server/metra/decode.ts web/src/lib/types.ts web/src/routes/api/metra/alerts/+server.ts web/tests/unit/alerts.test.ts
git commit -m "feat(metra): BNSF service alerts endpoint

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The recorder

**Files:**
- Create: `scripts/record.mjs`
- Modify: `justfile`
- Modify: `.gitignore`
- Modify: `compose.yml`
- Test: `web/tests/unit/recorder.test.ts`
- Create: `web/src/lib/server/metra/recorder.ts`

**Interfaces:**
- Consumes: `FEED_NAMES`, `createRealtimeLoader` (Task 1).
- Produces: `snapshotName(feed, timestampSec)` and `shouldWrite(feed, timestampSec, seen)` in `recorder.ts`; `just record <name>`.

- [ ] **Step 1: Write the failing test `web/tests/unit/recorder.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { shouldWrite, snapshotName } from '../../src/lib/server/metra/recorder';

describe('snapshotName', () => {
  it('names a snapshot by feed timestamp so files sort by time', () => {
    expect(snapshotName('tripupdates', 1766779200)).toBe('1766779200.tripupdates.pb');
  });
});

describe('shouldWrite', () => {
  it('writes the first snapshot of a feed', () => {
    const seen = new Map<string, number>();
    expect(shouldWrite('alerts', 100, seen)).toBe(true);
    expect(seen.get('alerts')).toBe(100);
  });

  it('skips a feed whose timestamp has not moved', () => {
    const seen = new Map([['alerts', 100]]);
    expect(shouldWrite('alerts', 100, seen)).toBe(false);
  });

  it('writes again once the feed timestamp advances', () => {
    const seen = new Map([['alerts', 100]]);
    expect(shouldWrite('alerts', 130, seen)).toBe(true);
    expect(seen.get('alerts')).toBe(130);
  });

  it('tracks each feed separately', () => {
    const seen = new Map([['alerts', 100]]);
    expect(shouldWrite('positions', 100, seen)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run tests/unit/recorder.test.ts`
Expected: FAIL — cannot resolve `recorder`.

- [ ] **Step 3: Write `web/src/lib/server/metra/recorder.ts`**

```ts
// Naming and de-duplication for recorded feed snapshots. Kept separate from the script so it can be
// unit-tested without touching the disk.
import type { FeedName } from './realtime';

export const snapshotName = (feed: FeedName, timestampSec: number) => `${timestampSec}.${feed}.pb`;

/**
 * True when this feed has not been written at this timestamp yet. Metra republishes every 30 s but
 * only changes `header.timestamp` when something moved, so an all-day recording stays small.
 * Mutates `seen`, which the caller keeps for the life of the recording.
 */
export function shouldWrite(feed: FeedName, timestampSec: number, seen: Map<string, number>): boolean {
  if (seen.get(feed) === timestampSec) return false;
  seen.set(feed, timestampSec);
  return true;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run tests/unit/recorder.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write `scripts/record.mjs`**

```js
#!/usr/bin/env node
// Records Metra's realtime feeds to data/recordings/<name>/ until interrupted. M4's replayer reads
// these back. Run it on a Saturday: `just record saturday`.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
const FEEDS = ['positions', 'tripupdates', 'alerts'];

const name = process.argv[2];
if (!name || !/^[A-Za-z0-9_-]+$/.test(name)) {
  console.error('Usage: just record <name>   (letters, digits, dash, underscore)');
  process.exit(1);
}

// Read .env without a dependency: KEY=value lines, ignoring comments.
const envFile = resolve(process.cwd(), '.env');
const env = { ...process.env };
try {
  for (const line of (await readFile(envFile, 'utf8')).split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env: rely on the environment */ }

const token = env.METRA_API_TOKEN;
const base = env.METRA_RT_BASE || 'https://gtfspublic.metrarr.com/gtfs/public';
if (!token) { console.error('METRA_API_TOKEN is not set; nothing to record.'); process.exit(1); }

const dir = resolve(process.cwd(), 'data', 'recordings', name);
await mkdir(dir, { recursive: true });
const seen = new Map();
let written = 0;

async function tick() {
  for (const feed of FEEDS) {
    try {
      const res = await fetch(`${base}/${feed}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const ts = Number(FeedMessage.decode(bytes).header?.timestamp ?? 0);
      if (seen.get(feed) === ts) continue;
      seen.set(feed, ts);
      await writeFile(join(dir, `${ts}.${feed}.pb`), bytes);
      written++;
    } catch (err) {
      console.warn(`[record] ${feed}: ${err.message}`);
    }
  }
  process.stdout.write(`\r${written} snapshots in data/recordings/${name}  `);
}

console.log(`Recording ${FEEDS.join(', ')} to data/recordings/${name}. Ctrl-C to stop.`);
await tick();
const timer = setInterval(tick, 30_000);
process.on('SIGINT', () => { clearInterval(timer); console.log(`\nStopped. ${written} snapshots.`); process.exit(0); });
```

- [ ] **Step 6: Add the `just` target**

In `justfile`, after the `backup:` target:

```
record NAME:
    node scripts/record.mjs "{{NAME}}"
```

- [ ] **Step 7: Ignore the recordings and mount them**

Append to `.gitignore`:

```
data/recordings/
```

In `compose.yml`, add to the `web` service's `volumes` list, after `./data/places:/data/places`:

```yaml
      - ./data/recordings:/data/recordings
```

And in `justfile`, extend the `up` target's `mkdir` so the bind mount is never created root-owned:

```
up:
    mkdir -p data/gtfs data/places data/recordings
    docker compose up -d --build
```

- [ ] **Step 8: Verify the script's argument guard without a token**

Run: `node scripts/record.mjs "bad name"`
Expected: exits 1 with the usage message.

- [ ] **Step 9: Commit**

```bash
git add scripts/record.mjs justfile .gitignore compose.yml web/src/lib/server/metra/recorder.ts web/tests/unit/recorder.test.ts
git commit -m "feat(metra): record the realtime feeds for replay

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The `checkins` collection

**Files:**
- Create: `pocketbase/pb_migrations/1758600000_checkins.js`
- Modify: `web/src/lib/types.ts`
- Test: `web/tests/hooks/checkins.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the `checkins` collection; the `Checkin` type.

- [ ] **Step 1: Add the `Checkin` type to `web/src/lib/types.ts`**

```ts
/**
 * Where someone is. M2 writes only the Conductor's `at_stop` correction from the Departure Board;
 * M3 opens the same collection to the Crew for Punch and the roster.
 */
export type Checkin = RecordModel & {
  user: string; stop: string; kind: 'at_stop' | 'on_train'; at: string;
  expand?: { user?: UserRecord };
};
```

- [ ] **Step 2: Write the migration `pocketbase/pb_migrations/1758600000_checkins.js`**

Model it on the existing `1758500001_stop_direction.js` and the collections in `1758400000_planning.js`.

```js
// Where the crawl is. M2 writes only the Conductor's correction from the Departure Board; the rules
// already allow any user to create their own, so M3's Punch needs no migration.
migrate((app) => {
  const users = app.findCollectionByNameOrId('users')
  const stops = app.findCollectionByNameOrId('stops')

  const checkins = new Collection({
    type: 'base',
    name: 'checkins',
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != "" && user = @request.auth.id',
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: 'user', type: 'relation', collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
      { name: 'stop', type: 'relation', collectionId: stops.id, maxSelect: 1, required: false, cascadeDelete: true },
      { name: 'kind', type: 'select', values: ['at_stop', 'on_train'], maxSelect: 1, required: true },
      { name: 'at', type: 'date', required: true },
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true }
    ],
    indexes: ['CREATE INDEX idx_checkins_at ON checkins (at)']
  })
  app.save(checkins)
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId('checkins'))
  } catch (_) {}
})
```

- [ ] **Step 3: Write the failing test `web/tests/hooks/checkins.test.ts`**

Uses the real helpers from `web/tests/hooks/setup.ts`: `loginToken(name, password)` returns `{ token, id }`, and the admin password is `ADMIN_LOGIN_PASSWORD`.

```ts
// The checkins rules against a live PocketBase: anyone signed in may read, you may only create
// your own. M2 writes only the Conductor's correction, but the rules already allow M3's Punch.
import { beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_LOGIN_PASSWORD, get, loginToken, post, truncate } from './setup';

let conductor = '';
let crew = '';
let conductorId = '';
let stopId = '';

beforeAll(async () => {
  await truncate('checkins');
  ({ token: conductor, id: conductorId } = await loginToken('Checkin Conductor', ADMIN_LOGIN_PASSWORD));
  ({ token: crew } = await loginToken('Checkin Crew'));

  const itinRes = await post('/api/collections/itineraries/records', {
    title: 'Checkin test', status: 'locked', event_date: '2026-12-26', start_time: '12:00', created_by: conductorId
  }, conductor);
  expect(itinRes.ok).toBe(true);
  const itinerary = await itinRes.json();

  const stopRes = await post('/api/collections/stops/records', {
    itinerary: itinerary.id, order: 1, name: 'The Whistle Stop', station_id: 'LAGRANGE', dwell_min: 60, walk_min: 5
  }, conductor);
  expect(stopRes.ok).toBe(true);
  stopId = (await stopRes.json()).id;
});

describe('checkins', () => {
  it('lets a user create their own check-in', async () => {
    const res = await post('/api/collections/checkins/records', {
      user: conductorId, stop: stopId, kind: 'at_stop', at: '2026-12-26 20:00:00.000Z'
    }, conductor);
    expect(res.status).toBe(200);
    expect((await res.json()).kind).toBe('at_stop');
  });

  it('refuses a check-in created on behalf of someone else', async () => {
    const res = await post('/api/collections/checkins/records', {
      user: conductorId, stop: stopId, kind: 'at_stop', at: '2026-12-26 20:05:00.000Z'
    }, crew);
    expect(res.status).toBe(400);
  });

  it('lets any authenticated user read check-ins', async () => {
    const res = await get('/api/collections/checkins/records?sort=-at', crew);
    expect(res.status).toBe(200);
    expect((await res.json()).items.length).toBeGreaterThan(0);
  });

  it('shows an anonymous reader nothing', async () => {
    // PocketBase list rules filter rather than reject, so the giveaway is an empty page, not a 403.
    const res = await get('/api/collections/checkins/records');
    expect(res.status).toBe(200);
    expect((await res.json()).totalItems).toBe(0);
  });

  it('refuses an anonymous create', async () => {
    const res = await post('/api/collections/checkins/records', {
      user: conductorId, stop: stopId, kind: 'at_stop', at: '2026-12-26 20:10:00.000Z'
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 4: Confirm the test fails without the migration**

Temporarily rename the migration so the collection is absent, then run the suite:

```bash
mv pocketbase/pb_migrations/1758600000_checkins.js /tmp/1758600000_checkins.js
bash scripts/test-hooks.sh
```

Expected: FAIL — the `checkins` collection does not exist, so the create returns 404.

- [ ] **Step 5: Restore the migration and run the hooks suite**

```bash
mv /tmp/1758600000_checkins.js pocketbase/pb_migrations/1758600000_checkins.js
bash scripts/test-hooks.sh
```

Expected: PASS, including the four new tests.

- [ ] **Step 6: Commit**

```bash
git add pocketbase/pb_migrations/1758600000_checkins.js web/src/lib/types.ts web/tests/hooks/checkins.test.ts
git commit -m "feat(pb): checkins collection for the Conductor's position correction

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Where the crawl is

**Files:**
- Create: `web/src/lib/live/current.ts`
- Test: `web/tests/unit/current.test.ts`

**Interfaces:**
- Consumes: `Stop`, `Leg` from `$lib/types`.
- Produces: `currentStop(stops, legs, now, opts): Current`, `type Current = { stop: Stop | null; nextStop: Stop | null; departAt: string | null; source: CurrentSource }`, `type CurrentSource = 'override' | 'clock' | 'before' | 'after'`.

- [ ] **Step 1: Write the failing test `web/tests/unit/current.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { currentStop } from '../../src/lib/live/current';
import type { Leg, Stop } from '../../src/lib/types';

const stop = (id: string, station: string, order: number): Stop => ({
  id, itinerary: 'i1', order, name: id, kind: 'bar', station_id: station, station_name: station,
  place: '', place_id: '', osm_id: '', address: '', lat: 0, lon: 0, hours: null, phone: '', website: '',
  confirmed_open: false, dwell_min: 60, walk_min: 5, notes: '', meet_point: '', photos_status: 'none',
  direction: 'out', collectionId: 'c', collectionName: 'stops', created: '', updated: ''
} as Stop);

const leg = (from: string, to: string, depart: string, arrive: string): Leg => ({
  id: `${from}-${to}`, itinerary: 'i1', from_stop: from, to_stop: to, kind: 'train',
  ready_at: depart, depart_at: depart, arrive_at: arrive, segments: [], computed_at: '',
  collectionId: 'c', collectionName: 'legs', created: '', updated: ''
} as Leg);

// A crawl: A (from 12:00), train to B at 13:00 arriving 13:20, train to C at 15:00 arriving 15:20.
const stops = [stop('A', 'AURORA', 1), stop('B', 'LAGRANGE', 2), stop('C', 'CUS', 3)];
const legs = [
  leg('A', 'B', '2026-12-26T19:00:00.000Z', '2026-12-26T19:20:00.000Z'),
  leg('B', 'C', '2026-12-26T21:00:00.000Z', '2026-12-26T21:20:00.000Z')
];
const startAt = new Date('2026-12-26T18:00:00.000Z');
const at = (iso: string) => currentStop(stops, legs, new Date(iso), { startAt });

describe('currentStop', () => {
  it('is the first stop, marked before, ahead of the start', () => {
    const r = at('2026-12-26T17:00:00.000Z');
    expect(r.stop?.id).toBe('A');
    expect(r.source).toBe('before');
  });

  it('is the stop whose arrival has passed and whose departure has not', () => {
    const r = at('2026-12-26T18:30:00.000Z');
    expect(r.stop?.id).toBe('A');
    expect(r.source).toBe('clock');
    expect(r.nextStop?.id).toBe('B');
    expect(r.departAt).toBe('2026-12-26T19:00:00.000Z');
  });

  it('moves on once the next arrival has passed', () => {
    expect(at('2026-12-26T20:00:00.000Z').stop?.id).toBe('B');
  });

  it('stays at the stop it left while the train is still running', () => {
    // Departed A at 19:00, arrives B at 19:20: at 19:10 the crawl is between the two.
    const r = at('2026-12-26T19:10:00.000Z');
    expect(r.stop?.id).toBe('A');
    expect(r.source).toBe('clock');
  });

  it('is the last stop, marked after, once the final departure has passed', () => {
    const r = at('2026-12-26T23:00:00.000Z');
    expect(r.stop?.id).toBe('C');
    expect(r.source).toBe('after');
    expect(r.nextStop).toBeNull();
    expect(r.departAt).toBeNull();
  });

  it('honours a correction newer than the arrival the clock would pick', () => {
    const r = currentStop(stops, legs, new Date('2026-12-26T18:30:00.000Z'), {
      startAt, override: { stopId: 'B', at: '2026-12-26T18:25:00.000Z' }
    });
    expect(r.stop?.id).toBe('B');
    expect(r.source).toBe('override');
    expect(r.nextStop?.id).toBe('C');
  });

  it('ignores a correction older than that arrival, so it cannot drag the crawl backwards', () => {
    // The clock says C (arrived 21:20); a correction made at 19:30 is stale.
    const r = currentStop(stops, legs, new Date('2026-12-26T22:00:00.000Z'), {
      startAt, override: { stopId: 'A', at: '2026-12-26T19:30:00.000Z' }
    });
    expect(r.stop?.id).toBe('C');
    expect(r.source).toBe('clock');
  });

  it('ignores a correction naming a stop that is not on the itinerary', () => {
    const r = currentStop(stops, legs, new Date('2026-12-26T18:30:00.000Z'), {
      startAt, override: { stopId: 'ZZZ', at: '2026-12-26T18:29:00.000Z' }
    });
    expect(r.stop?.id).toBe('A');
    expect(r.source).toBe('clock');
  });

  it('returns nothing for an empty itinerary', () => {
    const r = currentStop([], [], new Date('2026-12-26T18:30:00.000Z'), { startAt });
    expect(r.stop).toBeNull();
    expect(r.source).toBe('before');
  });

  it('counts down to the train from an earlier stop at the same station', () => {
    // Two bars at La Grange: only the last one has a train leg, per the M1 layover model.
    const twoAtStation = [stop('A', 'AURORA', 1), stop('B1', 'LAGRANGE', 2), stop('B2', 'LAGRANGE', 3)];
    const walkLeg = { ...leg('B1', 'B2', '2026-12-26T20:00:00.000Z', '2026-12-26T20:05:00.000Z'), kind: 'walk' } as Leg;
    const ls = [leg('A', 'B1', '2026-12-26T19:00:00.000Z', '2026-12-26T19:20:00.000Z'), walkLeg];
    const r = currentStop(twoAtStation, ls, new Date('2026-12-26T19:30:00.000Z'), { startAt });
    expect(r.stop?.id).toBe('B1');
    expect(r.departAt).toBe('2026-12-26T20:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run tests/unit/current.test.ts`
Expected: FAIL — cannot resolve `live/current`.

- [ ] **Step 3: Write `web/src/lib/live/current.ts`**

```ts
// Which stop the crawl is at. Derived from the clock over the locked itinerary's legs, with the
// Conductor's correction winning while it is newer than the arrival the clock would pick. No GPS:
// browsers cannot track location with the screen off, and a clock is something everyone can check.
import type { Leg, Stop } from '$lib/types';

export type CurrentSource = 'override' | 'clock' | 'before' | 'after';
export type Current = {
  stop: Stop | null;
  /** The stop after this one, or null at the end of the crawl. */
  nextStop: Stop | null;
  /** When the crawl leaves `stop`, or null when nothing follows. */
  departAt: string | null;
  source: CurrentSource;
};

type Timing = { stop: Stop; arriveAt: number; departAt: number | null; next: Stop | null; departIso: string | null };

/** Arrival and departure per stop: the incoming leg's arrival (or the start) and the outgoing leg's departure. */
function timings(stops: Stop[], legs: Leg[], startAt: Date): Timing[] {
  const ordered = [...stops].sort((a, b) => a.order - b.order);
  const incoming = new Map(legs.map((l) => [l.to_stop, l]));
  const outgoing = new Map(legs.map((l) => [l.from_stop, l]));
  return ordered.map((stop, i) => {
    const inLeg = incoming.get(stop.id);
    const outLeg = outgoing.get(stop.id);
    const arriveIso = i === 0 ? startAt.toISOString() : inLeg?.arrive_at;
    return {
      stop,
      arriveAt: arriveIso ? new Date(arriveIso).getTime() : startAt.getTime(),
      departAt: outLeg?.depart_at ? new Date(outLeg.depart_at).getTime() : null,
      departIso: outLeg?.depart_at ?? null,
      next: ordered[i + 1] ?? null
    };
  });
}

const result = (t: Timing, source: CurrentSource): Current =>
  ({ stop: t.stop, nextStop: t.next, departAt: t.departIso, source });

export function currentStop(
  stops: Stop[],
  legs: Leg[],
  now: Date,
  opts: { startAt: Date; override?: { stopId: string; at: string } | null }
): Current {
  const ts = timings(stops, legs, opts.startAt);
  if (ts.length === 0) return { stop: null, nextStop: null, departAt: null, source: 'before' };

  const at = now.getTime();
  let picked: Timing = ts[0];
  let source: CurrentSource = 'before';
  if (at >= ts[ts.length - 1].arriveAt && ts[ts.length - 1].departAt === null) {
    picked = ts[ts.length - 1];
    source = at >= picked.arriveAt ? 'clock' : 'before';
  }
  for (const t of ts) {
    if (at < t.arriveAt) break;
    picked = t;
    source = 'clock';
  }
  // Past the final departure there is nothing left to catch.
  const last = ts[ts.length - 1];
  if (last.departAt !== null && at >= last.departAt) { picked = last; source = 'after'; }
  if (picked === last && last.departAt === null && at >= last.arriveAt) source = 'after';

  const override = opts.override;
  if (override) {
    const hit = ts.find((t) => t.stop.id === override.stopId);
    // A correction holds until the schedule catches up with it; an older one is a leftover.
    if (hit && new Date(override.at).getTime() > picked.arriveAt) return result(hit, 'override');
  }
  return result(picked, source);
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run tests/unit/current.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/live/current.ts web/tests/unit/current.test.ts
git commit -m "feat(live): derive the current stop from the clock and a correction

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: The board state machine

**Files:**
- Create: `web/src/lib/live/board.ts`
- Test: `web/tests/unit/board.test.ts`

**Interfaces:**
- Consumes: `NextTrip` from `$lib/types`.
- Produces: `boardState(opts): Board`, `pickTrip(trips, now): NextTrip | null`, constants `BUFFER_MIN`, `WARNING_MIN`; `type BoardState = 'normal' | 'warning' | 'leave_now' | 'missed'`.

- [ ] **Step 1: Write the failing test `web/tests/unit/board.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { BUFFER_MIN, WARNING_MIN, boardState, pickTrip } from '../../src/lib/live/board';
import type { NextTrip } from '../../src/lib/types';

const trip = (tripId: string, depart: string): NextTrip => ({
  tripId, routeId: 'BNSF', headsign: 'Chicago', schedDepart: depart, schedArrive: depart,
  liveDepart: depart, liveArrive: depart, delayMin: 0, status: 'live'
});

const state = (nowIso: string, departIso = '2026-12-26T20:31:00.000Z', walkMin = 5) =>
  boardState({ departAt: new Date(departIso), walkMin, now: new Date(nowIso) });

describe('boardState', () => {
  it('subtracts the walk and the buffer to get the leave time', () => {
    const r = state('2026-12-26T19:00:00.000Z');
    // 20:31 minus 5 min walk minus 3 min buffer.
    expect(r.leaveAt.toISOString()).toBe('2026-12-26T20:23:00.000Z');
    expect(r.departsInMin).toBe(83);
    expect(r.state).toBe('normal');
  });

  it('is normal just outside the warning window', () => {
    // leaveAt 20:23; 10 min before is 20:13.
    expect(state('2026-12-26T20:12:00.000Z').state).toBe('normal');
  });

  it('warns from the threshold inwards', () => {
    expect(state('2026-12-26T20:13:00.000Z').state).toBe('warning');
    expect(state('2026-12-26T20:22:00.000Z').state).toBe('warning');
  });

  it('says leave now at the leave time and after it', () => {
    expect(state('2026-12-26T20:23:00.000Z').state).toBe('leave_now');
    expect(state('2026-12-26T20:30:00.000Z').state).toBe('leave_now');
  });

  it('reports the train missed once it has departed', () => {
    expect(state('2026-12-26T20:32:00.000Z').state).toBe('missed');
  });

  it('uses the documented constants', () => {
    expect(BUFFER_MIN).toBe(3);
    expect(WARNING_MIN).toBe(10);
  });

  it('clamps a zero walk without going negative on the countdown', () => {
    const r = state('2026-12-26T20:31:00.000Z', '2026-12-26T20:31:00.000Z', 0);
    expect(r.state).toBe('leave_now');
    expect(r.departsInMin).toBeLessThanOrEqual(0);
  });
});

describe('pickTrip', () => {
  it('picks the first trip that has not departed', () => {
    const trips = [trip('T1', '2026-12-26T20:00:00.000Z'), trip('T2', '2026-12-26T21:00:00.000Z')];
    expect(pickTrip(trips, new Date('2026-12-26T20:30:00.000Z'))?.tripId).toBe('T2');
  });

  it('keeps the current trip while it is still catchable', () => {
    const trips = [trip('T1', '2026-12-26T20:00:00.000Z'), trip('T2', '2026-12-26T21:00:00.000Z')];
    expect(pickTrip(trips, new Date('2026-12-26T19:00:00.000Z'))?.tripId).toBe('T1');
  });

  it('falls back to the scheduled time when there is no live one', () => {
    const t = { ...trip('T1', '2026-12-26T20:00:00.000Z'), liveDepart: null };
    expect(pickTrip([t], new Date('2026-12-26T19:00:00.000Z'))?.tripId).toBe('T1');
  });

  it('returns null when every trip has gone', () => {
    expect(pickTrip([trip('T1', '2026-12-26T20:00:00.000Z')], new Date('2026-12-26T21:00:00.000Z'))).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(pickTrip([], new Date())).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run tests/unit/board.test.ts`
Expected: FAIL — cannot resolve `live/board`.

- [ ] **Step 3: Write `web/src/lib/live/board.ts`**

```ts
// The Departure Board's state machine. Pure, with `now` injected, so M4's sim clock drives it
// without changing a line here.
import type { NextTrip } from '$lib/types';

/** Minutes of slack between arriving on the platform and the train leaving. */
export const BUFFER_MIN = 3;
/** How far out the first warning (Last Call) appears. */
export const WARNING_MIN = 10;

export type BoardState = 'normal' | 'warning' | 'leave_now' | 'missed';
export type Board = { state: BoardState; leaveAt: Date; departsInMin: number };

export function boardState(opts: { departAt: Date; walkMin: number; now: Date }): Board {
  const leaveAt = new Date(opts.departAt.getTime() - (opts.walkMin + BUFFER_MIN) * 60_000);
  const departsInMin = Math.round((leaveAt.getTime() - opts.now.getTime()) / 60_000);
  const state: BoardState =
    opts.now.getTime() > opts.departAt.getTime() ? 'missed'
    : departsInMin > WARNING_MIN ? 'normal'
    : departsInMin > 0 ? 'warning'
    : 'leave_now';
  return { state, leaveAt, departsInMin };
}

/** The first trip that has not left yet: the one the board counts down to. */
export function pickTrip(trips: NextTrip[], now: Date): NextTrip | null {
  return trips.find((t) => new Date(t.liveDepart ?? t.schedDepart).getTime() > now.getTime()) ?? null;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run tests/unit/board.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/live/board.ts web/tests/unit/board.test.ts
git commit -m "feat(live): Departure Board state machine with both thresholds

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Seen-alert state and the labels

**Files:**
- Create: `web/src/lib/live/seen.ts`
- Modify: `web/src/lib/labels.ts`
- Test: `web/tests/unit/seen.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `readSeen(): Set<string>`, `markSeen(ids: string[]): void`, `unseenCount(alerts, seen): number`; new entries in `copy`.

- [ ] **Step 1: Write the failing test `web/tests/unit/seen.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { markSeen, readSeen, unseenCount } from '../../src/lib/live/seen';

/** A localStorage stand-in; `fail` makes every call throw, as a private window can. */
function stubStorage(fail = false) {
  const map = new Map<string, string>();
  const store = {
    getItem: (k: string) => { if (fail) throw new Error('denied'); return map.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (fail) throw new Error('denied'); map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); }
  };
  vi.stubGlobal('localStorage', store);
  return map;
}

describe('seen alerts', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  it('starts empty', () => {
    stubStorage();
    expect(readSeen().size).toBe(0);
  });

  it('remembers ids across reads', () => {
    stubStorage();
    markSeen(['a1', 'a2']);
    expect([...readSeen()].sort()).toEqual(['a1', 'a2']);
  });

  it('adds to what is already there rather than replacing it', () => {
    stubStorage();
    markSeen(['a1']);
    markSeen(['a2']);
    expect([...readSeen()].sort()).toEqual(['a1', 'a2']);
  });

  it('treats everything as unseen when storage throws', () => {
    stubStorage(true);
    markSeen(['a1']);
    expect(readSeen().size).toBe(0);
  });

  it('survives corrupt stored data', () => {
    const map = stubStorage();
    map.set('chugalug.seenAlerts', 'not json');
    expect(readSeen().size).toBe(0);
  });

  it('counts only the alerts that have not been seen', () => {
    const alerts = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }];
    expect(unseenCount(alerts, new Set(['a2']))).toBe(2);
    expect(unseenCount([], new Set())).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run tests/unit/seen.test.ts`
Expected: FAIL — cannot resolve `live/seen`.

- [ ] **Step 3: Write `web/src/lib/live/seen.ts`**

```ts
// Which service alerts this browser has already shown. Per-device on purpose: it is a read marker,
// not shared state, and nothing breaks if it is lost. Every access is guarded because a private
// window, cleared site data or a blocked store all make localStorage throw.
const KEY = 'chugalug.seenAlerts';

export function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((x): x is string => typeof x === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

export function markSeen(ids: string[]): void {
  try {
    const next = readSeen();
    for (const id of ids) next.add(id);
    localStorage.setItem(KEY, JSON.stringify([...next]));
  } catch {
    // An unreadable store just means the dot keeps showing; nothing else depends on it.
  }
}

export const unseenCount = (alerts: { id: string }[], seen: Set<string>): number =>
  alerts.reduce((n, a) => (seen.has(a.id) ? n : n + 1), 0);
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run tests/unit/seen.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the copy to `web/src/lib/labels.ts`**

Add these entries to the `copy` object, before the closing `} as const;`:

```ts
  // Live day
  live: 'Live',
  noActiveRoute: 'No route is locked for today yet.',
  backToLive: 'Back to Live',
  stillToCome: 'Still to come',
  departLabel: 'Depart',
  arriveLabel: 'Arrive',
  run: 'Run',
  metraBnsf: 'Metra BNSF',
  leaveIn: 'Leave in',
  leaveNowSub: 'Leave now',
  walkFrom: 'min walk from',
  missedTrain: 'That train has gone. Counting down to the next one.',
  noTrainLeft: 'No train left today. Ask the Conductor.',
  timetableOnly: 'Timetable only — no live times since',
  timetableOnlyNoTime: 'Timetable only — no live times yet.',
  setOurStop: 'Not here? Set our stop',
  setOurStopTitle: 'Where is the crawl?',
  // Menu and notifications
  menu: 'Menu',
  notifications: 'Notifications',
  serviceAlerts: 'Service alerts',
  bulletins: 'Bulletins',
  noNotifications: 'Nothing to report.',
  bulletinsLater: 'Bulletins from the Conductor will appear here.',
  drinkScoreboard: 'Drink scoreboard',
  comingInM3: 'M3',
  theRoute: 'The Route',
  moreAlerts: 'more alerts',
  oneMoreAlert: 'more alert',
```

- [ ] **Step 6: Run the unit suite and the type check**

Run: `cd web && npm test && npm run check`
Expected: all pass, 0 errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/live/seen.ts web/src/lib/labels.ts web/tests/unit/seen.test.ts
git commit -m "feat(live): per-device seen-alert state and the live-day copy

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: The Departure Board component

**Files:**
- Create: `web/src/lib/live/present.ts`
- Create: `web/src/lib/components/DepartureBoard.svelte`
- Test: `web/tests/unit/boardView.test.ts`

**Interfaces:**
- Consumes: `boardState`, `BoardState` (Task 8); `copy`, `labels` (Task 9); `fmtTime` from `$lib/time.ts`.
- Produces: `boardTone(state: BoardState): Tone` and `leadLine(state: BoardState, departsInMin: number): string` in `web/src/lib/live/present.ts`, where `type Tone = 'calm' | 'last' | 'aboard'`; and `DepartureBoard.svelte` with props `{ station: string; stopName: string; nextStation: string; trip: NextTrip | null; walkMin: number; now: Date; mode: FeedMode; rtFetchedAt: string | null; canCorrect: boolean; oncorrect: () => void }`.

- [ ] **Step 1: Write the failing test `web/tests/unit/boardView.test.ts`**

This test covers the presentational mapping only; the component's rendering is exercised end to end in Task 13.

```ts
import { describe, expect, it } from 'vitest';
import { boardTone, leadLine } from '../../src/lib/live/present';
import { copy } from '../../src/lib/labels';

describe('boardTone', () => {
  it('maps each state to a card tone', () => {
    expect(boardTone('normal')).toBe('calm');
    expect(boardTone('missed')).toBe('calm');
    expect(boardTone('warning')).toBe('last');
    expect(boardTone('leave_now')).toBe('aboard');
  });
});

describe('leadLine', () => {
  it('counts down in the normal state', () => {
    expect(leadLine('normal', 42)).toBe(`${copy.leaveIn} 42 min`);
  });
  it('names the two alert states from the glossary', () => {
    expect(leadLine('warning', 8)).toBe('Last Call');
    expect(leadLine('leave_now', 0)).toBe('All Aboard');
  });
  it('says the train is gone when it has been missed', () => {
    expect(leadLine('missed', -3)).toBe(copy.missedTrain);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && npx vitest run tests/unit/boardView.test.ts`
Expected: FAIL — cannot resolve `live/present`.

- [ ] **Step 3: Write `web/src/lib/live/present.ts`**

```ts
// Presentation mapping for the board, kept out of the component so it can be unit-tested.
import { labels, copy } from '$lib/labels';
import type { BoardState } from './board';

export type Tone = 'calm' | 'last' | 'aboard';

export const boardTone = (state: BoardState): Tone =>
  state === 'warning' ? 'last' : state === 'leave_now' ? 'aboard' : 'calm';

/** The big line on the card. */
export function leadLine(state: BoardState, departsInMin: number): string {
  if (state === 'missed') return copy.missedTrain;
  if (state === 'warning') return labels.firstWarning;
  if (state === 'leave_now') return labels.leaveNow;
  return `${copy.leaveIn} ${Math.max(0, departsInMin)} ${copy.minutes}`;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run tests/unit/boardView.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write `web/src/lib/components/DepartureBoard.svelte`**

The ticket from the approved mockups. Match the existing components' style conventions: `$props()`, scoped `<style>`, no inline user-visible strings.

```svelte
<script lang="ts">
  // The Departure Board: a ticket for the run the crawl has to catch. The whole card changes colour
  // at Last Call and All Aboard so it registers without being read.
  import { copy } from '$lib/labels';
  import { fmtTime } from '$lib/time';
  import { boardState } from '$lib/live/board';
  import { boardTone, leadLine } from '$lib/live/present';
  import type { FeedMode, NextTrip } from '$lib/types';

  let { station, stopName, nextStation, trip, walkMin, now, mode, rtFetchedAt, canCorrect, oncorrect }: {
    station: string; stopName: string; nextStation: string;
    trip: NextTrip | null; walkMin: number; now: Date;
    mode: FeedMode; rtFetchedAt: string | null;
    canCorrect: boolean; oncorrect: () => void;
  } = $props();

  const stale = $derived(mode !== 'live');
  // Stale means the predictions are not trustworthy, so show the timetable and say so.
  const departIso = $derived(trip && (stale ? trip.schedDepart : trip.liveDepart ?? trip.schedDepart));
  const arriveIso = $derived(trip && (stale ? trip.schedArrive : trip.liveArrive ?? trip.schedArrive));
  const board = $derived(departIso ? boardState({ departAt: new Date(departIso), walkMin, now }) : null);
  const tone = $derived(board ? boardTone(board.state) : 'calm');
</script>

<div class="wrap">
  <div class="card {tone}">
    {#if trip && board}
      <div class="head">
        <span class="agency">{copy.metraBnsf}</span>
        <span class="run">{copy.run} {trip.tripId}</span>
      </div>
      <h2 class="station">{station}</h2>
      <div class="times">
        <div>
          <div class="cap">{copy.departLabel}</div>
          <div class="clock">{fmtTime(departIso!)}</div>
          <div class="where">{station}</div>
        </div>
        <div>
          <div class="cap">{copy.arriveLabel}</div>
          <div class="clock">{fmtTime(arriveIso!)}</div>
          <div class="where">{nextStation}</div>
        </div>
      </div>
      {#if stale}
        <p class="stale">
          {#if rtFetchedAt}{copy.timetableOnly} {fmtTime(rtFetchedAt)}{:else}{copy.timetableOnlyNoTime}{/if}
        </p>
      {/if}
      <div class="lead">
        <div class="big">{leadLine(board.state, board.departsInMin)}</div>
        <div class="sub">
          {#if board.state === 'leave_now'}{copy.leaveNowSub} ·
          {:else if board.state === 'warning'}{copy.leaveIn} {Math.max(0, board.departsInMin)} {copy.minutes} ·
          {/if}
          {walkMin} {copy.walkFrom} {stopName}
        </div>
      </div>
    {:else}
      <h2 class="station">{station}</h2>
      <p class="lead"><span class="big">{copy.noTrainLeft}</span></p>
    {/if}
    {#if canCorrect}
      <button type="button" class="correct" onclick={oncorrect} data-testid="set-our-stop">{copy.setOurStop}</button>
    {/if}
  </div>
</div>

<style>
  .wrap { padding: 12px 16px 16px; }
  .card { border-radius: 12px; padding: 16px 18px; display: flex; flex-direction: column; gap: 13px; }
  .calm { background: #f2efe6; color: #141413; --faint: #6b6862; --rule: #c9c4b5; --edge: #c0bbac; }
  .last { background: #ffb400; color: #111; --faint: rgba(17,17,17,.72); --rule: rgba(0,0,0,.28); --edge: rgba(0,0,0,.3); }
  .aboard { background: #c0261c; color: #fff; --faint: rgba(255,255,255,.82); --rule: rgba(0,0,0,.28); --edge: rgba(0,0,0,.3); }
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; }
  .head .agency { font-weight: 700; }
  .head .run { color: var(--faint); }
  .station { margin: 0; font-size: 25px; font-weight: 750; line-height: 1.15; }
  .times { display: flex; gap: 18px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .times > div { flex-grow: 1; }
  .cap { font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--faint); }
  .clock { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .where { font-size: 12px; color: var(--faint); }
  .stale { margin: 0; padding: 9px 11px; border-radius: 8px; border: 1px solid var(--rule);
    background: rgba(20,20,19,.07); font-size: 12px; line-height: 1.35; color: inherit; }
  .lead { border-top: 1px dashed var(--rule); padding-top: 13px; margin: 0; }
  .big { font-size: 24px; font-weight: 800; line-height: 1.1; }
  .aboard .big { font-size: 27px; }
  .sub { font-size: 13px; margin-top: 4px; color: var(--faint); }
  .correct { font-size: 14px; font-weight: 600; padding: 10px 14px; min-height: 44px; width: 100%;
    border-radius: 9px; border: 1px solid var(--edge); background: transparent; color: inherit; margin: 0; }
</style>
```

- [ ] **Step 6: Type-check**

Run: `cd web && npm run check`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/live/present.ts web/src/lib/components/DepartureBoard.svelte web/tests/unit/boardView.test.ts
git commit -m "feat(live): the Departure Board ticket component

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: The /live screen

**Files:**
- Create: `web/src/routes/(app)/live/+page.svelte`
- Create: `web/src/routes/(app)/live/+page.ts`
- Create: `web/src/lib/components/AlertBubbles.svelte`
- Create: `web/src/lib/live/feed.ts`

**Interfaces:**
- Consumes: `currentStop` (Task 7), `pickTrip` (Task 8), `readSeen`/`unseenCount` (Task 9), `DepartureBoard` (Task 10), `loadDraft`/`watchDraft` from `$lib/draft.ts`, `pb`/`auth`/`subscribe` from `$lib/pb.ts`.
- Produces: the `/live` route; `AlertBubbles.svelte` with props `{ alerts, onopen }`; `fetchAlerts()`, `fetchNext(...)`, `fetchStatus()` in `feed.ts`.

- [ ] **Step 1: Write `web/src/lib/live/feed.ts`**

```ts
// Reads of the Metra proxy from the browser. The proxy needs the PocketBase token, the same way
// $lib/server/places callers do, so every request carries it.
import { pb } from '$lib/pb';
import type { Alert, FeedMode, NextTrip } from '$lib/types';

const authed = async (path: string) => {
  const res = await fetch(path, { headers: { Authorization: pb.authStore.token } });
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return res.json();
};

export const fetchAlerts = (): Promise<{ mode: FeedMode; fetchedAt: string | null; alerts: Alert[] }> =>
  authed('/api/metra/alerts');

export const fetchNext = (from: string, to: string, date: string, after: Date): Promise<{ mode: FeedMode; trips: NextTrip[] }> =>
  authed(`/api/metra/next?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&date=${date}&after=${after.toISOString()}&limit=3`);

export const fetchStatus = (): Promise<{ rtFetchedAt: string | null; mode: FeedMode }> =>
  authed('/api/metra/status');
```

- [ ] **Step 2: Write `web/src/lib/components/AlertBubbles.svelte`**

```svelte
<script lang="ts">
  // Service alerts above the board: at most two, the rest rolled up. They stay visible in every
  // board state — hiding a delay notice while someone runs for a train is the wrong trade.
  import { copy } from '$lib/labels';
  import type { Alert } from '$lib/types';

  let { alerts, onopen }: { alerts: Alert[]; onopen: () => void } = $props();
  const shown = $derived(alerts.slice(0, 2));
  const extra = $derived(Math.max(0, alerts.length - 2));
</script>

{#if alerts.length}
  <div class="bubbles">
    {#each shown as alert (alert.id)}
      <button type="button" class="bubble" onclick={onopen}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M12 9v4M12 17h.01M10.3 3.9 2.4 17.5A1.9 1.9 0 0 0 4 20.4h16a1.9 1.9 0 0 0 1.6-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z"></path>
        </svg>
        <span>{alert.header}</span>
      </button>
    {/each}
    {#if extra}
      <button type="button" class="bubble more" onclick={onopen}>
        <span>{extra} {extra === 1 ? copy.oneMoreAlert : copy.moreAlerts}</span>
      </button>
    {/if}
  </div>
{/if}

<style>
  .bubbles { padding: 12px 16px 0; display: flex; flex-direction: column; gap: 8px; }
  .bubble { display: flex; align-items: flex-start; gap: 9px; text-align: left; width: 100%;
    min-height: 44px; padding: 10px 13px; border-radius: 999px; margin: 0; font-size: 13.5px; font-weight: 400;
    border: 1px solid rgba(255,180,0,.42); background: rgba(255,180,0,.12); color: #ffd98a; }
  .bubble svg { flex: none; margin-top: 1px; }
  .more { border-color: #3a3a3a; background: transparent; color: #9a9a9a; }
</style>
```

- [ ] **Step 3: Write `web/src/routes/(app)/live/+page.ts`**

```ts
// The live screen needs no server data of its own; everything loads in the browser.
export const ssr = false;
```

- [ ] **Step 4: Add a "today in Chicago" helper to `web/src/lib/time.ts`**

The board must only take over the screen on the day of the crawl, and "today" means Chicago's today, not the phone's.

```ts
/** Today's date in the crawl's timezone as YYYY-MM-DD, whatever timezone the phone is in. */
export function todayInTz(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parts;
}
```

Add the matching test to `web/tests/unit/time.test.ts` (create the file if it does not exist, following `web/tests/unit/rank.test.ts` for style):

```ts
import { describe, expect, it } from 'vitest';
import { todayInTz } from '../../src/lib/time';

describe('todayInTz', () => {
  it('gives the Chicago date, not the runner\'s', () => {
    // 05:30 UTC on the 27th is still the 26th in Chicago.
    expect(todayInTz(new Date('2026-12-27T05:30:00Z'))).toBe('2026-12-26');
  });
  it('rolls over at Chicago midnight', () => {
    expect(todayInTz(new Date('2026-12-27T06:30:00Z'))).toBe('2026-12-27');
  });
});
```

Run: `cd web && npx vitest run tests/unit/time.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write `web/src/routes/(app)/live/+page.svelte`**

```svelte
<script lang="ts">
  // The live day: where the crawl is, the run it has to catch, and what Metra is saying about it.
  import { goto } from '$app/navigation';
  import { copy } from '$lib/labels';
  import { pb, auth, subscribe } from '$lib/pb';
  import { fmtTime, localToUtc, parseHm, todayInTz } from '$lib/time';
  import { currentStop } from '$lib/live/current';
  import { pickTrip } from '$lib/live/board';
  import { fetchAlerts, fetchNext, fetchStatus } from '$lib/live/feed';
  import DepartureBoard from '$lib/components/DepartureBoard.svelte';
  import AlertBubbles from '$lib/components/AlertBubbles.svelte';
  import type { Alert, Checkin, FeedMode, Itinerary, Leg, NextTrip, Stop } from '$lib/types';

  let itinerary = $state<Itinerary | null>(null);
  let stops = $state<Stop[]>([]);
  let legs = $state<Leg[]>([]);
  let override = $state<{ stopId: string; at: string } | null>(null);
  let trips = $state<NextTrip[]>([]);
  let alerts = $state<Alert[]>([]);
  let mode = $state<FeedMode>('schedule_only');
  let rtFetchedAt = $state<string | null>(null);
  let now = $state(new Date());
  let error = $state('');
  let picking = $state(false);

  const isAdmin = $derived(!!$auth.user?.is_admin);
  // The crawl's start in real time: event_date plus start_time, read in Chicago's timezone.
  const startAt = $derived(itinerary ? localToUtc(itinerary.event_date, parseHm(itinerary.start_time)) : new Date());
  // The board only takes over on the day itself; before then /live points back at the plan.
  const isToday = $derived(!!itinerary && itinerary.event_date === todayInTz(now));
  const here = $derived(itinerary && isToday ? currentStop(stops, legs, now, { startAt, override }) : null);
  const trip = $derived(pickTrip(trips, now));

  async function loadRoute() {
    try {
      const list = await pb.collection('itineraries').getFullList<Itinerary>({ filter: pb.filter('status = "locked"'), sort: '-locked_at' });
      itinerary = list[0] ?? null;
      if (!itinerary) return;
      const filter = pb.filter('itinerary = {:id}', { id: itinerary.id });
      [stops, legs] = await Promise.all([
        pb.collection('stops').getFullList<Stop>({ filter, sort: 'order,created' }),
        pb.collection('legs').getFullList<Leg>({ filter })
      ]);
      await loadOverride();
    } catch {
      error = copy.loadError;
    }
  }

  /** The newest correction made by a Conductor. */
  async function loadOverride() {
    try {
      const rows = await pb.collection('checkins').getList<Checkin>(1, 1, {
        filter: pb.filter('kind = "at_stop"'), sort: '-at', expand: 'user'
      });
      const hit = rows.items.find((c) => c.expand?.user?.is_admin);
      override = hit?.stop ? { stopId: hit.stop, at: hit.at } : null;
    } catch {
      override = null;
    }
  }

  async function loadTrains() {
    if (!here?.stop || !here.nextStop || !itinerary) { trips = []; return; }
    try {
      const res = await fetchNext(here.stop.station_id, here.nextStop.station_id, itinerary.event_date, now);
      trips = res.trips;
      mode = res.mode;
    } catch {
      trips = [];
    }
  }

  async function loadAlerts() {
    try {
      const res = await fetchAlerts();
      alerts = res.alerts;
      rtFetchedAt = res.fetchedAt;
    } catch {
      alerts = [];
    }
  }

  async function setStop(stop: Stop) {
    if (!$auth.user) return;
    try {
      await pb.collection('checkins').create({ user: $auth.user.id, stop: stop.id, kind: 'at_stop', at: new Date().toISOString() });
      picking = false;
      await loadOverride();
    } catch (err) {
      error = (err as Error).message;
    }
  }

  $effect(() => {
    void loadRoute();
    void loadAlerts();
    void fetchStatus().then((s) => { rtFetchedAt = s.rtFetchedAt; mode = s.mode; }).catch(() => {});
    // The board re-reads the clock every 15 s and the feeds every 30 s.
    const tick = setInterval(() => { now = new Date(); }, 15_000);
    const poll = setInterval(() => { void loadTrains(); void loadAlerts(); }, 30_000);
    const unsubs = [
      subscribe('stops', '', loadRoute),
      subscribe('legs', '', loadRoute),
      subscribe('checkins', '', loadOverride)
    ];
    return () => { clearInterval(tick); clearInterval(poll); unsubs.forEach((u) => u()); };
  });

  // Re-ask for trains whenever the leg we are counting down changes.
  $effect(() => { void here?.stop?.id; void here?.nextStop?.id; void loadTrains(); });
</script>

<svelte:head><title>{copy.live}</title></svelte:head>

{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if !itinerary || !isToday}
  <p>{copy.noActiveRoute} <a href="/plan">{copy.backToPlanner}</a></p>
{:else if here?.stop}
  <AlertBubbles {alerts} onopen={() => goto('/notifications')} />
  <DepartureBoard
    station={here.stop.station_name || here.stop.station_id}
    stopName={here.stop.name}
    nextStation={here.nextStop?.station_name || here.nextStop?.station_id || ''}
    {trip}
    walkMin={here.stop.walk_min}
    {now}
    {mode}
    {rtFetchedAt}
    canCorrect={isAdmin}
    oncorrect={() => (picking = true)} />

  {#if picking}
    <section class="picker">
      <h2>{copy.setOurStopTitle}</h2>
      {#each stops as stop (stop.id)}
        <button type="button" class="secondary" onclick={() => setStop(stop)}>{stop.name} · {stop.station_name}</button>
      {/each}
    </section>
  {/if}

  <section class="rest">
    <h2>{copy.stillToCome}</h2>
    {#each stops.filter((s) => s.order > (here.stop?.order ?? 0)) as stop (stop.id)}
      {@const leg = legs.find((l) => l.to_stop === stop.id)}
      <div class="row">
        <span class="when">{leg?.arrive_at ? fmtTime(leg.arrive_at) : ''}</span>
        <span class="name">{stop.name}</span>
        <span class="where">{stop.station_name}</span>
      </div>
    {/each}
  </section>
{/if}

<style>
  .rest, .picker { padding: 18px 20px; }
  h2 { margin: 0 0 10px; font-size: 13px; letter-spacing: .09em; text-transform: uppercase; color: #9a9a9a; font-weight: 700; }
  .row { display: flex; align-items: baseline; gap: 12px; padding: 11px 0; border-bottom: 1px solid #2a2a2a; }
  .when { font-variant-numeric: tabular-nums; font-size: 15px; color: #9a9a9a; width: 68px; flex: none; }
  .name { flex-grow: 1; font-size: 16px; }
  .where { font-size: 13px; color: #9a9a9a; }
</style>
```

- [ ] **Step 6: Type-check and run the unit suite**

Run: `cd web && npm run check && npm test`
Expected: 0 type errors, all unit tests pass. (`subscribe(collection, '', fn)` with an empty filter is supported — `web/src/lib/pb.ts:64` passes `{}` when the filter is falsy.)

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/live/feed.ts web/src/lib/time.ts web/tests/unit/time.test.ts web/src/lib/components/AlertBubbles.svelte "web/src/routes/(app)/live"
git commit -m "feat(live): the /live screen with the board and alert bubbles

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: The header menu and notifications

**Files:**
- Modify: `web/src/routes/+layout.svelte`
- Create: `web/src/lib/components/AppMenu.svelte`
- Create: `web/src/routes/(app)/notifications/+page.svelte`

**Interfaces:**
- Consumes: `fetchAlerts` (Task 11), `readSeen`/`markSeen`/`unseenCount` (Task 9), `copy` (Task 9).
- Produces: the menu in the app header; the `/notifications` route.

- [ ] **Step 1: Write `web/src/lib/components/AppMenu.svelte`**

```svelte
<script lang="ts">
  // The header menu. Items that belong to later milestones are rendered disabled rather than hidden,
  // so the shape of the finished app is visible and M3 only has to enable them.
  import { goto } from '$app/navigation';
  import { copy, labels } from '$lib/labels';
  import { logout } from '$lib/pb';

  let { open, unread, onclose }: { open: boolean; unread: number; onclose: () => void } = $props();

  const go = (href: string) => { onclose(); void goto(href); };
</script>

{#if open}
  <button type="button" class="scrim" aria-label={copy.close} onclick={onclose}></button>
  <nav class="panel">
    <button type="button" class="item" onclick={() => go('/notifications')}>
      <span class="label">{copy.notifications}</span>
      {#if unread}<span class="badge">{unread}</span>{/if}
    </button>
    <button type="button" class="item" disabled>
      <span class="label">{copy.drinkScoreboard}</span><span class="soon">{copy.comingInM3}</span>
    </button>
    <button type="button" class="item" onclick={() => go('/route')}>
      <span class="label">{copy.theRoute}</span>
    </button>
    <button type="button" class="item" disabled>
      <span class="label">{labels.userRoster}</span><span class="soon">{copy.comingInM3}</span>
    </button>
    <button type="button" class="item" onclick={() => { onclose(); logout(); }} data-testid="logout">
      <span class="label">{copy.logout}</span>
    </button>
  </nav>
{/if}

<style>
  .scrim { position: fixed; inset: 0; z-index: 20; border: 0; border-radius: 0; margin: 0; padding: 0;
    background: rgba(0,0,0,.55); width: 100%; min-height: 0; }
  .panel { position: fixed; top: 0; right: 0; bottom: 0; z-index: 21; width: min(310px, 86vw);
    background: #1a1a1a; border-left: 1px solid #2a2a2a; display: flex; flex-direction: column; padding-top: 57px; }
  .item { display: flex; align-items: center; gap: 14px; width: 100%; min-height: 56px; padding: 14px 20px;
    margin: 0; border: 0; border-bottom: 1px solid #2a2a2a; border-radius: 0; background: transparent;
    color: #eee; font-size: 16.5px; font-weight: 600; text-align: left; }
  .item:disabled { color: #6f6f6f; opacity: 1; cursor: default; }
  .label { flex-grow: 1; }
  .badge { font-size: 13px; font-weight: 700; color: #ffb400; }
  .soon { font-size: 13px; font-weight: 700; color: #6f6f6f; }
</style>
```

- [ ] **Step 2: Add the one label the menu needs**

The Crew Board name already exists as `labels.userRoster`; only the scrim needs new copy. In `web/src/lib/labels.ts`, add to `copy`:

```ts
  close: 'Close the menu',
```

- [ ] **Step 3: Rework the header in `web/src/routes/+layout.svelte`**

Replace the `<header class="top">` block with the version below, and add the imports and state to the instance script. The date is gone; the logout button moves into the menu.

```svelte
<header class="top">
  <div class="col bar">
    <a href="/" class="brand"><img src="/icon.svg" alt="" width="40" height="40" /><span>{copy.appTitle}</span></a>
    {#if $auth.user}
      <button type="button" class="secondary menu" aria-label={copy.menu} onclick={() => (menuOpen = true)} data-testid="menu">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16"></path>
        </svg>
        {#if unread}<span class="dot"></span>{/if}
      </button>
    {/if}
  </div>
</header>
<AppMenu open={menuOpen} {unread} onclose={() => (menuOpen = false)} />
```

Add to the instance script:

```ts
  import AppMenu from '$lib/components/AppMenu.svelte';
  import { fetchAlerts } from '$lib/live/feed';
  import { readSeen, unseenCount } from '$lib/live/seen';

  let menuOpen = $state(false);
  let unread = $state(0);

  // The dot is best-effort: a failed alerts read simply leaves it off.
  $effect(() => {
    if (!$auth.user) { unread = 0; return; }
    const check = () => void fetchAlerts()
      .then((r) => { unread = unseenCount(r.alerts, readSeen()); })
      .catch(() => { unread = 0; });
    check();
    const timer = setInterval(check, 60_000);
    return () => clearInterval(timer);
  });
```

Add to the `<style>` block:

```css
  .menu { flex: none; width: 44px; height: 44px; padding: 0; margin: 0; position: relative;
    display: flex; align-items: center; justify-content: center; }
  .dot { position: absolute; top: 5px; right: 5px; width: 9px; height: 9px; border-radius: 50%;
    background: #ffb400; border: 2px solid #111; }
```

- [ ] **Step 4: Write `web/src/routes/(app)/notifications/+page.svelte`**

```svelte
<script lang="ts">
  // Service alerts from Metra, and (from M3) Bulletins from the Conductor. Opening the screen marks
  // every alert on it as seen, which clears the header dot.
  import { copy } from '$lib/labels';
  import { fmtTime } from '$lib/time';
  import { fetchAlerts } from '$lib/live/feed';
  import { markSeen, readSeen } from '$lib/live/seen';
  import type { Alert } from '$lib/types';

  let alerts = $state<Alert[]>([]);
  let seen = $state<Set<string>>(new Set());
  let loaded = $state(false);

  $effect(() => {
    seen = readSeen();
    void fetchAlerts()
      .then((r) => { alerts = r.alerts; markSeen(r.alerts.map((a) => a.id)); })
      .catch(() => { alerts = []; })
      .finally(() => { loaded = true; });
  });
</script>

<svelte:head><title>{copy.notifications}</title></svelte:head>

<p><a href="/live">← {copy.backToLive}</a></p>
<h1>{copy.notifications}</h1>

<h2>{copy.serviceAlerts}</h2>
{#if loaded && alerts.length === 0}
  <p>{copy.noNotifications}</p>
{/if}
{#each alerts as alert (alert.id)}
  <article class="notice" class:unread={!seen.has(alert.id)}>
    <div class="row">
      <span class="title">{alert.header}</span>
      {#if alert.startsAt}<span class="when">{fmtTime(alert.startsAt)}</span>{/if}
    </div>
    {#if alert.body}<p class="body">{alert.body}</p>{/if}
  </article>
{/each}

<h2>{copy.bulletins}</h2>
<p>{copy.bulletinsLater}</p>

<style>
  h2 { margin: 24px 0 8px; font-size: 12px; letter-spacing: .09em; text-transform: uppercase; color: #9a9a9a; font-weight: 700; }
  .notice { padding: 15px 0; border-bottom: 1px solid #2a2a2a; }
  .notice.unread { background: rgba(255,180,0,.05); }
  .row { display: flex; align-items: baseline; gap: 10px; }
  .title { flex-grow: 1; font-size: 15.5px; font-weight: 700; }
  .when { flex: none; font-size: 12px; color: #9a9a9a; }
  .body { margin: 4px 0 0; font-size: 14px; line-height: 1.45; color: #b4b4b4; }
</style>
```

- [ ] **Step 5: Type-check and run the unit suite**

Run: `cd web && npm run check && npm test`
Expected: 0 type errors, all unit tests pass.

- [ ] **Step 6: Check the logout test id still resolves**

`web/tests/e2e/planning.spec.ts` clicks `[data-testid="logout"]`, which has moved into the menu. Run: `grep -n 'data-testid="logout"' -r web/src web/tests`
Expected: the id exists only in `AppMenu.svelte`. Task 13 updates the e2e flow to open the menu first.

- [ ] **Step 7: Commit**

```bash
git add web/src/routes/+layout.svelte web/src/lib/components/AppMenu.svelte "web/src/routes/(app)/notifications" web/src/lib/labels.ts
git commit -m "feat(web): header menu, notifications screen, no date in the header

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: End to end, the real feed, and the docs

**Files:**
- Modify: `web/tests/e2e/planning.spec.ts`
- Create: `web/tests/e2e/live.spec.ts`
- Create: `web/tests/fixtures/rt-real/.gitkeep` and the captured `.pb` files
- Create: `web/tests/unit/realFeed.test.ts`
- Modify: `README.md`
- Modify: `docs/OPERATIONS.md`

**Interfaces:**
- Consumes: everything above.
- Produces: green e2e, a decode test over real Metra bytes, updated docs.

- [ ] **Step 1: Fix the logout step in `web/tests/e2e/planning.spec.ts`**

Find every `page.click('[data-testid="logout"]')` (or locator equivalent) and put a menu open in front of it:

```ts
await page.getByTestId('menu').click();
await page.getByTestId('logout').click();
```

- [ ] **Step 2: Run the e2e suite and confirm it is green again**

Run: `cd web && npm run test:e2e`
Expected: PASS. If the planning spec fails for an unrelated reason, fix that before moving on.

- [ ] **Step 3: Extract the shared e2e helpers into `web/tests/e2e/helpers.ts`**

`planning.spec.ts` keeps `login` to itself; the live spec needs it too, plus a way to put a locked crawl in the database without driving the whole planner UI.

```ts
import { expect, type Page } from '@playwright/test';

const PB = process.env.PB_URL ?? 'http://127.0.0.1:18093';
const SU_EMAIL = process.env.PB_ADMIN_EMAIL ?? 'tests@chugalug.invalid';
const SU_PASSWORD = process.env.PB_ADMIN_PASSWORD ?? 'local-test-password-only';

export async function login(page: Page, name: string, password: string) {
  await page.goto('/login');
  await page.getByTestId('name-input').fill(name);
  await page.getByTestId('password').fill(password);
  await page.getByTestId('login').click();
  await expect(page.getByTestId('name')).toHaveText(name);
}

async function superuserToken(): Promise<string> {
  const res = await fetch(`${PB}/api/collections/_superusers/auth-with-password`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identity: SU_EMAIL, password: SU_PASSWORD })
  });
  if (!res.ok) throw new Error(`Superuser login failed: ${res.status}`);
  return (await res.json()).token;
}

const create = async (collection: string, body: unknown, token: string) => {
  const res = await fetch(`${PB}/api/collections/${collection}/records`, {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: token },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Create ${collection} failed: ${res.status} ${await res.text()}`);
  return res.json();
};

/**
 * Two stops on the BNSF with one train leg between them, locked and dated `eventDate`. Written as
 * superuser because `legs` is server-only. Returns the ids so a test can assert against them.
 */
export async function seedLockedCrawl(opts: {
  ownerName: string; eventDate: string; startTime: string; departAt: string; arriveAt: string;
}) {
  const token = await superuserToken();
  const users = await fetch(`${PB}/api/collections/users/records?filter=${encodeURIComponent(`name_key="${opts.ownerName.toLowerCase()}"`)}`, {
    headers: { Authorization: token }
  });
  const owner = (await users.json()).items[0];
  if (!owner) throw new Error(`No user named ${opts.ownerName}; log in first so the identity exists.`);

  const itinerary = await create('itineraries', {
    title: 'E2E Live Crawl', status: 'locked', event_date: opts.eventDate,
    start_time: opts.startTime, vote_open: false, created_by: owner.id, locked_at: `${opts.eventDate} 00:00:00.000Z`
  }, token);

  const first = await create('stops', {
    itinerary: itinerary.id, order: 1, name: 'The Whistle Stop', kind: 'bar',
    station_id: 'LAGRANGE', station_name: 'La Grange Road', dwell_min: 90, walk_min: 5, direction: 'out'
  }, token);
  const second = await create('stops', {
    itinerary: itinerary.id, order: 2, name: 'Berwyn Beer Hall', kind: 'bar',
    station_id: 'CUS', station_name: 'Union Station', dwell_min: 60, walk_min: 4, direction: 'out'
  }, token);
  await create('legs', {
    itinerary: itinerary.id, from_stop: first.id, to_stop: second.id, kind: 'train',
    ready_at: opts.departAt, depart_at: opts.departAt, arrive_at: opts.arriveAt,
    segments: [], computed_at: opts.departAt
  }, token);

  return { itineraryId: itinerary.id, firstStopId: first.id, secondStopId: second.id };
}
```

- [ ] **Step 4: Point `planning.spec.ts` at the shared helper**

Delete its local `login` function and import the shared one instead:

```ts
import { login } from './helpers';
```

Run: `cd web && npm run test:e2e`
Expected: PASS, unchanged behaviour.

- [ ] **Step 5: Write `web/tests/e2e/live.spec.ts`**

```ts
import { expect, test, type Page } from '@playwright/test';
import { login, seedLockedCrawl } from './helpers';

const ADMIN = process.env.ADMIN_PASSWORD ?? 'admin-test-password';
const CREW = process.env.CREW_PASSWORD ?? 'crew-test-password';

// A fixed crawl day, so every board state is deterministic. Chicago is UTC-6 in December, so
// 12:00 local is 18:00Z and the train leaves at 14:34 local.
const DATE = '2026-12-26';
const DEPART = '2026-12-26T20:34:00.000Z';
const ARRIVE = '2026-12-26T20:49:00.000Z';
// walk 5 + buffer 3 means the crawl has to leave at 20:26Z.
const TRIP = {
  tripId: '1244', routeId: 'BNSF', headsign: 'Chicago',
  schedDepart: '2026-12-26T20:31:00.000Z', schedArrive: '2026-12-26T20:46:00.000Z',
  liveDepart: DEPART, liveArrive: ARRIVE, delayMin: 3, status: 'live'
};

async function stubProxy(page: Page, alerts: unknown[] = []) {
  await page.route('**/api/metra/next**', (r) => r.fulfill({ json: { mode: 'live', trips: [TRIP] } }));
  await page.route('**/api/metra/status', (r) => r.fulfill({ json: {
    staticPublishedAt: 'P', staticSource: 'file', rtFetchedAt: '2026-12-26T20:00:00.000Z', rtAgeSec: 10, mode: 'live'
  } }));
  await page.route('**/api/metra/alerts', (r) => r.fulfill({ json: {
    mode: 'live', fetchedAt: '2026-12-26T20:00:00.000Z', alerts
  } }));
}

/** Logs in, seeds a locked crawl owned by that identity, and freezes the clock at `at`. */
async function arrive(page: Page, name: string, password: string, at: string, alerts: unknown[] = []) {
  await stubProxy(page, alerts);
  await login(page, name, password);
  await seedLockedCrawl({ ownerName: name, eventDate: DATE, startTime: '12:00', departAt: DEPART, arriveAt: ARRIVE });
  await page.clock.install({ time: new Date(at) });
  await page.goto('/live');
}

test('the board counts down, warns at Last Call, then says All Aboard', async ({ page }) => {
  await arrive(page, 'E2E Live Skipper', ADMIN, '2026-12-26T19:00:00.000Z');
  await expect(page.getByText('Leave in')).toBeVisible();

  await page.clock.setFixedTime(new Date('2026-12-26T20:20:00.000Z'));
  await expect(page.getByText('Last Call')).toBeVisible();

  await page.clock.setFixedTime(new Date('2026-12-26T20:27:00.000Z'));
  await expect(page.getByText('All Aboard')).toBeVisible();
});

test('an alert shows as a bubble and opens the notifications screen', async ({ page }) => {
  await arrive(page, 'E2E Alert Skipper', ADMIN, '2026-12-26T19:00:00.000Z', [{
    id: 'a1', effect: 'SIGNIFICANT_DELAYS', header: 'BNSF inbound delays',
    body: 'Signal problem at Cicero.', startsAt: null, endsAt: null, stationIds: []
  }]);
  await page.getByText('BNSF inbound delays').click();
  await expect(page).toHaveURL(/\/notifications/);
  await expect(page.getByText('Signal problem at Cicero.')).toBeVisible();
});

test('only the Conductor sees the correction control', async ({ page }) => {
  await arrive(page, 'E2E Live Crew', CREW, '2026-12-26T19:00:00.000Z');
  await expect(page.getByTestId('set-our-stop')).toHaveCount(0);
});

test('the Conductor can move the crawl to another stop', async ({ page }) => {
  await arrive(page, 'E2E Correcting Skipper', ADMIN, '2026-12-26T19:00:00.000Z');
  await expect(page.getByText('La Grange Road')).toBeVisible();
  await page.getByTestId('set-our-stop').click();
  await page.getByRole('button', { name: /Berwyn Beer Hall/ }).click();
  await expect(page.getByText('Union Station')).toBeVisible();
});

test('the menu opens and logs out', async ({ page }) => {
  await arrive(page, 'E2E Menu Skipper', ADMIN, '2026-12-26T19:00:00.000Z');
  await page.getByTestId('menu').click();
  await page.getByTestId('logout').click();
  await expect(page).toHaveURL(/\/login/);
});
```

- [ ] **Step 6: Run the new e2e spec**

Run: `cd web && npx playwright test tests/e2e/live.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Capture a real recording**

This is the one step that needs the live token. With `METRA_API_TOKEN` set in `.env`:

```bash
just record smoke
# wait about 90 seconds, then Ctrl-C
ls data/recordings/smoke/
```

Expected: at least one `.pb` per feed. Copy the newest of each into the repo as a fixture:

```bash
mkdir -p web/tests/fixtures/rt-real
for f in positions tripupdates alerts; do
  cp "$(ls -t data/recordings/smoke/*.$f.pb | head -1)" "web/tests/fixtures/rt-real/$f.pb"
done
ls -la web/tests/fixtures/rt-real/
```

- [ ] **Step 8: Write `web/tests/unit/realFeed.test.ts`**

This is where spec §9's "decode real Metra bytes" requirement is met.

```ts
// Decodes bytes captured from the live feed with `just record`, so the parsing above is proved
// against Metra's actual output and not only against fixtures we encoded ourselves.
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { readPredictions, selectAlerts } from '../../src/lib/server/metra/decode';

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
const dir = join(import.meta.dirname, '../fixtures/rt-real');
const load = (name: string) => FeedMessage.decode(new Uint8Array(readFileSync(join(dir, `${name}.pb`))));

describe('real Metra feeds', () => {
  it('decodes a captured tripupdates feed into predictions', () => {
    expect(existsSync(join(dir, 'tripupdates.pb'))).toBe(true);
    const preds = readPredictions(load('tripupdates'), 'BNSF');
    // Every prediction key is a trip id, and every stop time parses to an ISO string.
    for (const [tripId, pred] of Object.entries(preds)) {
      expect(tripId).toBeTruthy();
      for (const at of Object.values(pred.stops)) {
        if (at.departAt) expect(Number.isNaN(Date.parse(at.departAt))).toBe(false);
        if (at.arriveAt) expect(Number.isNaN(Date.parse(at.arriveAt))).toBe(false);
      }
    }
  });

  it('decodes a captured alerts feed without throwing', () => {
    const alerts = selectAlerts(load('alerts'), { routeId: 'BNSF', stationIds: new Set(['CUS', 'LAGRANGE']), now: new Date() });
    for (const a of alerts) {
      expect(typeof a.id).toBe('string');
      expect(typeof a.header).toBe('string');
    }
  });

  it('decodes a captured positions feed', () => {
    expect(load('positions').entity).toBeDefined();
  });
});
```

- [ ] **Step 9: Run the full suite**

Run: `cd web && npm test && npm run check && cd .. && bash scripts/test-hooks.sh`
Expected: every unit test passes (including the real-feed ones), 0 type errors, hooks green.

- [ ] **Step 10: Update `README.md`**

In the Roadmap table, change the M2 row's "Done when" to record completion, matching how the M1 row reads. Put the date you actually finish in place of `<today>` — run `date +%F` to get it:

```
| M2 Metra proxy | mid Nov | BNSF realtime proxy with recording, Departure Board with Last Call and All Aboard, service alerts and the header menu, schedule fallback — done <today> (see docs/superpowers/plans/2026-09-20-m2-metra-proxy.md) |
```

In the Phase 2 "Must have (MVP)" list, replace the location-sharing bullet with what M2 actually built, and note GPS is not used:

```
- **Where the crawl is** comes from the clock over the locked itinerary, with a one-tap Conductor
  correction. No GPS: browsers cannot track location with the screen off, and a clock is something
  anyone can check. See the M2 design doc, section 3.
```

- [ ] **Step 11: Update `docs/OPERATIONS.md`**

Add a Realtime section after the Planning data section:

```markdown
## Realtime (M2)
- `METRA_API_TOKEN` in `.env` is the bearer token for
  `https://gtfspublic.metrarr.com/gtfs/public/{positions,tripupdates,alerts}`. Empty means the app runs on
  the static timetable and every screen says "Timetable only". The old `gtfsapi.metrarail.com` host was
  shut off 2025-11-01; anything using it is dead.
- The poller starts on the first request that needs it and refetches every 30 s. Metra asks that nobody
  poll faster. `GET /api/metra/status` reports `mode` (`live`, `stale`, `schedule_only`) and `rtAgeSec`;
  anything over 120 s counts as stale and the app falls back to the timetable.
- A fetch failure keeps the last good feed and logs one line per feed. It never clears one.
- `just record <name>` writes raw feed snapshots to `data/recordings/<name>/` until Ctrl-C, one file per
  feed per change in `header.timestamp`. Run it on a Saturday for M4's replay. The folder is git-ignored
  and bind-mounted, so it survives `docker compose up`.
- Where the crawl is on the live day comes from the clock, not GPS. The Conductor can correct it from the
  Departure Board; that writes a `checkins` record and everyone's board follows within seconds.
```

- [ ] **Step 12: Commit**

```bash
git add web/tests/e2e/helpers.ts web/tests/e2e/planning.spec.ts web/tests/e2e/live.spec.ts web/tests/fixtures/rt-real web/tests/unit/realFeed.test.ts README.md docs/OPERATIONS.md
git commit -m "test(live): e2e for the board, real captured feeds; docs: M2 write-back

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Verification

Before calling M2 done, confirm each line of the spec's section 10 by running it, not by reading the code:

- [ ] `GET /api/metra/status` against the real feed reports `mode: "live"` with `rtAgeSec` under 30.
- [ ] `GET /api/metra/next` shows a delay that matches Metra's own app for the same train.
- [ ] A train whose predicted departure is past its scheduled one is still listed by `/api/metra/next` when asked with `after` between the two.
- [ ] Blocking only the tripupdates URL (point `METRA_RT_BASE` at a host that 503s for it) drives `mode` to `stale` within 120 s while `feeds.alerts.mode` stays `live`, and the board falls back to timetable times.
- [ ] Emptying `METRA_API_TOKEN` and restarting degrades to `schedule_only`, the board shows the "Timetable only" notice, and nothing else breaks.
- [ ] `just record saturday` produces a folder whose file count grows only when the feed changes.
- [ ] `/live` shows all three board states against the frozen clock, and the Conductor's correction moves the crawl.
- [ ] Alerts from the live feed appear as bubbles and in `/notifications`, and reading them clears the header dot.
- [ ] `cd web && npm test && npm run check && npm run test:e2e` and `bash scripts/test-hooks.sh` are all green.
