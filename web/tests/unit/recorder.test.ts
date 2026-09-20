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
