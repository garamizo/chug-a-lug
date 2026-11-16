import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closingKey, closingSession, closingStore, eventfulReel, leaveUnplayed, leftThisSession, liveIsBehind, shouldAutoOpen, type ClosingSession
} from '../../src/lib/live/closing';
import type { Slide } from '../../src/lib/live/reel';

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

describe('closingKey', () => {
  it('is route, day and simulation run', () => {
    expect(closingKey({ itinerary: 'r1', date: '2026-12-26', runId: 'run-a' })).toBe('r1:2026-12-26:run-a');
  });
  it('leaves the run empty outside a simulation', () => {
    expect(closingKey({ itinerary: 'r1', date: '2026-12-26', runId: null })).toBe('r1:2026-12-26:');
  });
});

describe('shouldAutoOpen', () => {
  const go = { ready: true, eventful: true, shown: false, leftThisSession: false, busy: false, quiet: false };
  it('opens once the reel is ready, has something in it, is unwatched and nothing is in the way', () => {
    expect(shouldAutoOpen(go)).toBe(true);
  });
  it.each([
    ['not ready yet', { ready: false }],
    ['the night has no drinks, photos or messages', { eventful: false }],
    ['already shown on this phone', { shown: true }],
    ['entered and left unplayed this session', { leftThisSession: true }],
    ['something on Live is open or holds unsent work', { busy: true }],
    ['practice quiet applies', { quiet: true }]
  ])('waits when %s', (_name, change) => {
    expect(shouldAutoOpen({ ...go, ...change })).toBe(false);
  });
  it('is false for every other combination too', () => {
    const flags = ['ready', 'eventful', 'shown', 'leftThisSession', 'busy', 'quiet'] as const;
    for (let mask = 0; mask < 64; mask++) {
      const o = Object.fromEntries(flags.map((f, i) => [f, !!(mask & (1 << i))])) as typeof go;
      expect(shouldAutoOpen(o)).toBe(o.ready && o.eventful && !o.shown && !o.leftThisSession && !o.busy && !o.quiet);
    }
  });
});

describe('eventfulReel: is there a night to show?', () => {
  const title: Slide = { kind: 'title', title: 'Night', date: '2026-12-26' };
  const stop: Slide = { kind: 'stop', stopId: 's1', name: 'Bar', station: 'CUS', at: '', photo: null };
  const finale: Slide = { kind: 'finale', holders: [], caboose: [], total: 0 };
  it('not when the reel is only its title, stops and finale', () => {
    expect(eventfulReel([title, stop, stop, finale])).toBe(false);
    expect(eventfulReel([])).toBe(false);
  });
  it.each<[string, Slide]>([
    ['a photo', { kind: 'photo', mediaId: 'm1', cheers: 0, author: 'Ana', caption: 'Ana' }],
    ['a message', { kind: 'message', messageId: 'c1', body: 'hi', author: 'Ana', cheers: 1 }],
    ['a Golden Spike', { kind: 'spikes', events: [] }],
    ['drinks', { kind: 'drinks', stopId: 's1', counts: { beer: 1 } as never }]
  ])('when it has %s', (_name, slide) => {
    expect(eventfulReel([title, stop, slide, finale])).toBe(true);
  });
});

describe('closingStore', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  it('persists a shown reel in localStorage under chugalug.closingShown', () => {
    const map = stubStorage();
    closingStore().add('r1:2026-12-26:');
    expect(JSON.parse(map.get('chugalug.closingShown')!)).toEqual(['r1:2026-12-26:']);
    expect(closingStore().has('r1:2026-12-26:')).toBe(true);
    expect(closingStore().has('r1:2026-12-27:')).toBe(false);
  });

  it('reads a key another tab or an earlier session wrote', () => {
    const map = stubStorage();
    map.set('chugalug.closingShown', JSON.stringify(['earlier:2026-12-26:run']));
    expect(closingStore().has('earlier:2026-12-26:run')).toBe(true);
  });

  it('adds to what is there rather than replacing it', () => {
    const map = stubStorage();
    map.set('chugalug.closingShown', JSON.stringify(['a:2026-12-26:']));
    closingStore().add('b:2026-12-26:');
    expect(JSON.parse(map.get('chugalug.closingShown')!).sort()).toEqual(['a:2026-12-26:', 'b:2026-12-26:']);
  });

  it('ignores a corrupt entry', () => {
    const map = stubStorage();
    map.set('chugalug.closingShown', '{not json');
    expect(closingStore().has('x')).toBe(false);
    closingStore().add('c:2026-12-26:');
    expect(closingStore().has('c:2026-12-26:')).toBe(true);
  });

  it('falls back to memory for this session when storage throws', () => {
    stubStorage(true);
    const store = closingStore();
    expect(store.has('m:2026-12-26:run')).toBe(false);
    expect(() => store.add('m:2026-12-26:run')).not.toThrow();
    expect(store.has('m:2026-12-26:run')).toBe(true);
    // The layout and the reel each make their own store: the memory is shared, so neither re-opens it.
    expect(closingStore().has('m:2026-12-26:run')).toBe(true);
  });

  it('falls back to memory when there is no localStorage at all', () => {
    vi.stubGlobal('localStorage', undefined);
    closingStore().add('n:2026-12-26:');
    expect(closingStore().has('n:2026-12-26:')).toBe(true);
  });
});

describe('closingSession', () => {
  it('keeps reels left unplayed in memory only', () => {
    expect(closingSession.left).toBeInstanceOf(Set);
    closingSession.left.add('r1:2026-12-26:');
    expect(closingSession.left.has('r1:2026-12-26:')).toBe(true);
    closingSession.left.clear();
  });
});

describe('leaving the reel before it played', () => {
  const fresh = (): ClosingSession => ({ left: new Set(), beforeKnown: false });
  it('with the night known and Closing Time come: that night stays closed this session', () => {
    const s = fresh();
    leaveUnplayed(s, { key: 'r1:d:', closed: true });
    expect(leftThisSession(s, 'r1:d:', true)).toBe(true);
    expect(leftThisSession(s, 'r2:d:', true)).toBe(false);
  });
  it('before Closing Time, or with no route: nothing is held against a later night', () => {
    const s = fresh();
    leaveUnplayed(s, { key: 'r1:d:', closed: false });
    leaveUnplayed(s, { key: null, closed: false });
    expect(leftThisSession(s, 'r1:d:', true)).toBe(false);
  });
  it('while the route or clock was still loading: the first night to resolve takes the leave, if it had closed', () => {
    const s = fresh();
    leaveUnplayed(s, null);
    expect(leftThisSession(s, 'r1:d:', true)).toBe(true);
    // Settled once: it does not carry over to another night.
    expect(leftThisSession(s, 'r1:d:', true)).toBe(true);
    expect(leftThisSession(s, 'r2:d:', true)).toBe(false);
  });
  it('while loading, then the night resolves before Closing Time: the leave is dropped', () => {
    const s = fresh();
    leaveUnplayed(s, null);
    expect(leftThisSession(s, 'r1:d:', false)).toBe(false);
    expect(leftThisSession(s, 'r1:d:', true)).toBe(false);
  });
});

describe('liveIsBehind: may the reel close by going back?', () => {
  const live = { url: new URL('http://x/live') };
  it('when Live opened it with a link or goto', () => {
    expect(liveIsBehind({ type: 'link', from: live })).toBe(true);
    expect(liveIsBehind({ type: 'goto', from: { url: new URL('http://x/live?stop=s1') } })).toBe(true);
  });
  it('when Forward went from Live to the reel, one step', () => {
    expect(liveIsBehind({ type: 'popstate', delta: 1, from: live })).toBe(true);
    expect(liveIsBehind({ type: 'popstate', delta: 2, from: live })).toBe(false);
  });
  it('not when Back came to the reel from Live: Live is ahead of it, not behind', () => {
    expect(liveIsBehind({ type: 'popstate', delta: -1, from: live })).toBe(false);
  });
  it('not on a direct entry, a reload or an arrival from another screen', () => {
    expect(liveIsBehind({ type: 'enter', from: null })).toBe(false);
    expect(liveIsBehind({ type: 'enter', from: { url: null } })).toBe(false);
    expect(liveIsBehind({ type: 'goto', from: { url: new URL('http://x/plan') } })).toBe(false);
    expect(liveIsBehind({ type: 'link', from: null })).toBe(false);
  });
});
