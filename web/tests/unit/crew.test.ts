import { describe, expect, it } from 'vitest';
import { drinkCount, hasSeen } from '../../src/lib/live/crew';
import type { BroadcastAck, DrinkEntry } from '../../src/lib/types';

const entry = (user: string, at: string, stop = 'first') =>
  ({ user, at, stop, kind: 'beer' } as DrinkEntry);
const ack = (user: string, broadcast: string) => ({ user, broadcast } as BroadcastAck);

describe('Crew Board drink counts', () => {
  it('counts each person across stops and returns zero for someone without entries', () => {
    const entries = [
      entry('one', '2026-12-26T20:00:00.000Z'),
      entry('one', '2026-12-26T22:00:00.000Z', 'second'),
      entry('two', '2026-12-26T20:00:00.000Z')
    ];
    expect(drinkCount(entries, 'one', '2026-12-26')).toBe(2);
    expect(drinkCount(entries, 'two', '2026-12-26')).toBe(1);
    expect(drinkCount(entries, 'three', '2026-12-26')).toBe(0);
    expect(drinkCount([], 'one', '2026-12-26')).toBe(0);
  });

  it('uses Chicago midnight boundaries rather than UTC dates or all stored days', () => {
    const entries = [
      entry('one', '2026-12-26T05:59:59.999Z'),
      entry('one', '2026-12-26T06:00:00.000Z'),
      entry('one', '2026-12-27T05:59:59.999Z'),
      entry('one', '2026-12-27T06:00:00.000Z')
    ];
    expect(drinkCount(entries, 'one', '2026-12-26')).toBe(2);
  });

  it('uses the correct Chicago boundaries during daylight saving time', () => {
    const entries = [
      entry('one', '2026-09-20T04:59:59.999Z'),
      entry('one', '2026-09-20T05:00:00.000Z'),
      entry('one', '2026-09-21T04:59:59.999Z'),
      entry('one', '2026-09-21T05:00:00.000Z')
    ];
    expect(drinkCount(entries, 'one', '2026-09-20')).toBe(2);
  });
});

describe('Crew Board Bulletin status', () => {
  const acks = [ack('one', 'current'), ack('two', 'old')];

  it('matches both the person and the current Bulletin', () => {
    expect(hasSeen(acks, 'one', 'current')).toBe(true);
    expect(hasSeen(acks, 'two', 'current')).toBe(false);
    expect(hasSeen(acks, 'three', 'current')).toBe(false);
  });

  it('does not carry acknowledgements forward to a newer Bulletin', () => {
    expect(hasSeen(acks, 'one', 'newer')).toBe(false);
  });

  it('does not mark anyone seen when no Bulletin or acknowledgements exist', () => {
    expect(hasSeen(acks, 'one', null)).toBe(false);
    expect(hasSeen([], 'one', 'current')).toBe(false);
  });
});
