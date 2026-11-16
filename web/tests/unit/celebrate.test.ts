import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CelebrationQueue, celebrationKey, celebrationStore, CELEBRATION_WINDOW_MS, type CelebrationScope } from '../../src/lib/live/celebrate';
import type { SpikeEvent } from '../../src/lib/live/spikes';

const T0 = Date.parse('2026-12-26T20:00:00Z');
const at = (minute: number) => new Date(T0 + minute * 60_000).toISOString();
const ev = (id: string, minute: number, user = 'me', kind: SpikeEvent['kind'] = 'pathfinder'): SpikeEvent =>
  ({ id, kind, user, name: user.toUpperCase(), at: at(minute), created: '', order: minute });
const SCOPE: CelebrationScope = { itinerary: 'r1', date: '2026-12-26', runId: null, user: 'me' };

function memoryStore() {
  const keys = new Set<string>();
  return { keys, read: () => new Set(keys), add: (k: string) => { keys.add(k); } };
}
function setup(minute = 0) {
  let now = T0 + minute * 60_000;
  const store = memoryStore();
  const q = new CelebrationQueue({ now: () => new Date(now), store });
  return { q, store, tick: (m: number) => { now = T0 + m * 60_000; } };
}
/** Show the head and let it finish: what the overlay does with each item. */
function play(q: CelebrationQueue, events: SpikeEvent[], scope: CelebrationScope | null = SCOPE, quiet = false) {
  const head = q.next(events, scope, quiet);
  if (head && scope) { q.shown(head, scope); q.done(); }
  return head;
}

describe('celebration key', () => {
  it('scopes by route, day, run and user', () => {
    expect(celebrationKey(SCOPE, ev('spike:x', 1))).toBe('r1:2026-12-26::me:spike:x');
    expect(celebrationKey({ ...SCOPE, runId: 'run7' }, ev('spike:x', 1))).toBe('r1:2026-12-26:run7:me:spike:x');
  });
});

describe('CelebrationQueue', () => {
  it('only celebrates my own spikes', () => {
    const { q } = setup(1);
    expect(q.next([ev('a', 1, 'other')], SCOPE, false)).toBeNull();
    expect(q.next([ev('a', 1, 'other'), ev('b', 1)], SCOPE, false)?.id).toBe('b');
  });

  it('shows oldest first, one at a time, and marks each when it starts', () => {
    const { q, store } = setup(3);
    const events = [ev('late', 2), ev('early', 1)];
    const head = q.next(events, SCOPE, false)!;
    expect(head.id).toBe('early');
    expect(store.keys.size).toBe(0);
    q.shown(head, SCOPE);
    expect([...store.keys]).toEqual([celebrationKey(SCOPE, head)]);
    // While it shows, the queue keeps answering with it.
    expect(q.next(events, SCOPE, false)).toBe(head);
    q.done();
    expect(q.next(events, SCOPE, false)?.id).toBe('late');
  });

  it('never shows a celebrated key again', () => {
    const { q } = setup(1);
    expect(play(q, [ev('a', 1)])?.id).toBe('a');
    expect(q.next([ev('a', 1)], SCOPE, false)).toBeNull();
  });

  it('treats another day, route, run or user as a new celebration', () => {
    const { q } = setup(1);
    play(q, [ev('a', 1)]);
    expect(q.next([ev('a', 1)], { ...SCOPE, date: '2026-12-27' }, false)?.id).toBe('a');
    expect(q.next([ev('a', 1)], { ...SCOPE, itinerary: 'r2' }, false)?.id).toBe('a');
    expect(q.next([ev('a', 1)], { ...SCOPE, runId: 'run2' }, false)?.id).toBe('a');
    expect(q.next([ev('a', 1, 'you')], { ...SCOPE, user: 'you' }, false)?.id).toBe('a');
  });

  it('never shows a spike older than the window, on the first pass or a later one', () => {
    const { q, store, tick } = setup(0);
    expect(CELEBRATION_WINDOW_MS).toBe(10 * 60_000);
    tick(11);
    expect(q.next([ev('old', 0)], SCOPE, false)).toBeNull();
    // Queued behind another, it ages out before its turn.
    tick(1);
    const first = q.next([ev('a', 0), ev('b', 1)], SCOPE, false)!;
    expect(first.id).toBe('a');
    q.shown(first, SCOPE);
    tick(12);
    q.done();
    expect(q.next([ev('a', 0), ev('b', 1)], SCOPE, false)).toBeNull();
    expect(store.keys.size).toBe(1);
  });

  it('drops a queued spike that vanishes before its turn, without marking it, and takes it back if it returns fresh', () => {
    const { q, store } = setup(2);
    const a = q.next([ev('a', 1), ev('b', 2)], SCOPE, false)!;
    q.shown(a, SCOPE);
    // b is undone while a is still showing.
    expect(q.next([ev('a', 1)], SCOPE, false)).toBe(a);
    q.done();
    expect(q.next([ev('a', 1)], SCOPE, false)).toBeNull();
    expect([...store.keys]).toEqual([celebrationKey(SCOPE, a)]);
    expect(q.next([ev('a', 1), ev('b', 2)], SCOPE, false)?.id).toBe('b');
  });

  it('an empty timeline marks nothing, shows nothing and does not hide what is showing', () => {
    const { q, store } = setup(1);
    expect(q.next([], SCOPE, false)).toBeNull();
    expect(store.keys.size).toBe(0);
    const a = q.next([ev('a', 1)], SCOPE, false)!;
    q.shown(a, SCOPE);
    // The feed reloading empty is not a revocation.
    expect(q.next([], SCOPE, false)).toBe(a);
  });

  it('quiet hides the current item and shows nothing', () => {
    const { q } = setup(1);
    const a = q.next([ev('a', 1), ev('b', 1)], SCOPE, false)!;
    q.shown(a, SCOPE);
    expect(q.next([ev('a', 1), ev('b', 1)], SCOPE, true)).toBeNull();
    // The hidden one was already marked; the next is still waiting once quiet ends.
    expect(q.next([ev('a', 1), ev('b', 1)], SCOPE, false)?.id).toBe('b');
  });

  it('a null scope (clock unknown, signed out) hides the current item', () => {
    const { q } = setup(1);
    const a = q.next([ev('a', 1)], SCOPE, false)!;
    q.shown(a, SCOPE);
    expect(q.next([ev('a', 1)], null, false)).toBeNull();
  });

  it('a scope change, even only the run, hides the current item and the same spike under the new run is new', () => {
    const { q } = setup(1);
    const a = q.next([ev('a', 1)], SCOPE, false)!;
    q.shown(a, SCOPE);
    const next = q.next([ev('a', 1)], { ...SCOPE, runId: 'run2' }, false);
    expect(next).not.toBe(a);
    expect(next?.id).toBe('a');
  });

  it('reset forgets what is showing', () => {
    const { q } = setup(1);
    const a = q.next([ev('a', 1), ev('b', 1)], SCOPE, false)!;
    q.shown(a, SCOPE);
    q.reset();
    expect(q.next([ev('a', 1), ev('b', 1)], SCOPE, false)?.id).toBe('b');
  });
});

/** A localStorage stand-in; `fail` makes every call throw, as a private window can. */
function stubStorage(fail = false) {
  const map = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => { if (fail) throw new Error('denied'); return map.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (fail) throw new Error('denied'); map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); }
  });
  return map;
}

describe('celebrationStore', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  it('persists keys in localStorage across stores', () => {
    const map = stubStorage();
    celebrationStore().add('k1');
    expect(map.has('chugalug.celebratedSpikes')).toBe(true);
    expect([...celebrationStore().read()]).toEqual(['k1']);
  });

  it('falls back to memory when storage throws', () => {
    stubStorage(true);
    const store = celebrationStore();
    expect(store.read().size).toBe(0);
    store.add('k1');
    expect([...store.read()]).toEqual(['k1']);
  });

  it('keeps a session memory even when storage loses the key', () => {
    const map = stubStorage();
    const store = celebrationStore();
    store.add('k1');
    map.clear();
    expect(store.read().has('k1')).toBe(true);
  });

  it('ignores garbage in storage', () => {
    const map = stubStorage();
    map.set('chugalug.celebratedSpikes', '{not json');
    expect(celebrationStore().read().size).toBe(0);
    map.set('chugalug.celebratedSpikes', '[1,2]');
    expect(celebrationStore().read().size).toBe(0);
  });

  it('prunes keys older than two days on write', () => {
    const map = stubStorage();
    let now = Date.parse('2026-12-20T12:00:00Z');
    celebrationStore(() => now).add('old');
    now += 2 * 86_400_000 + 1;
    celebrationStore(() => now).add('new');
    expect([...celebrationStore(() => now).read()]).toEqual(['new']);
    expect(JSON.parse(map.get('chugalug.celebratedSpikes')!)).toEqual({ new: now });
  });
});
