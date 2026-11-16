import { beforeEach, describe, expect, it, vi } from 'vitest';
import { closingKey, closingSession, closingStore, liveIsBehind, shouldAutoOpen } from '../../src/lib/live/closing';

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
  const go = { ready: true, shown: false, leftThisSession: false, overlayOpen: false, quiet: false };
  it('opens once the reel is ready, unwatched and nothing is in the way', () => {
    expect(shouldAutoOpen(go)).toBe(true);
  });
  it.each([
    ['not ready yet', { ready: false }],
    ['already shown on this phone', { shown: true }],
    ['entered and left unplayed this session', { leftThisSession: true }],
    ['a sheet, the Lightbox, the Tab or the composer is open', { overlayOpen: true }],
    ['practice quiet applies', { quiet: true }]
  ])('waits when %s', (_name, change) => {
    expect(shouldAutoOpen({ ...go, ...change })).toBe(false);
  });
  it('is false for every other combination too', () => {
    const flags = ['ready', 'shown', 'leftThisSession', 'overlayOpen', 'quiet'] as const;
    for (let mask = 0; mask < 32; mask++) {
      const o = Object.fromEntries(flags.map((f, i) => [f, !!(mask & (1 << i))])) as typeof go;
      expect(shouldAutoOpen(o)).toBe(o.ready && !o.shown && !o.leftThisSession && !o.overlayOpen && !o.quiet);
    }
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
