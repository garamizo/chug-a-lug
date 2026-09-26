import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissAlert, markSeen, readDismissed, readSeen, unseenCount } from '../../src/lib/live/seen';

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

describe('dismissed alerts', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });

  it('remembers a closed alert apart from the seen ones', () => {
    stubStorage();
    markSeen(['a1']);
    dismissAlert('a2');
    expect([...readDismissed()]).toEqual(['a2']);
    expect([...readSeen()]).toEqual(['a1']);
  });

  it('forgets nothing when storage throws', () => {
    stubStorage(true);
    expect(() => dismissAlert('a1')).not.toThrow();
    expect(readDismissed().size).toBe(0);
  });
});
