import { describe, expect, it } from 'vitest';
import { boardTone, compactLine, leadLine } from '../../src/lib/live/present';
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

describe('compactLine', () => {
  const trip = (depart: string) => ({
    tripId: '1244', routeId: 'BNSF', headsign: 'Chicago', schedDepart: depart, schedArrive: depart,
    liveDepart: depart, liveArrive: depart, delayMin: 0, status: 'live' as const
  });

  it('names the stop and counts down to the run', () => {
    expect(compactLine('The Hop Haus', 5, trip('2026-12-26T20:34:00.000Z'), new Date('2026-12-26T20:00:00.000Z')))
      .toBe('The Hop Haus · Leave in 26 min');
  });

  it('shouts at All Aboard', () => {
    expect(compactLine('The Hop Haus', 5, trip('2026-12-26T20:34:00.000Z'), new Date('2026-12-26T20:27:00.000Z')))
      .toBe('The Hop Haus · All Aboard');
  });

  it('says so when no train is left', () => {
    expect(compactLine('The Hop Haus', 5, null, new Date('2026-12-26T23:00:00.000Z')))
      .toBe(`The Hop Haus · ${copy.noTrainLeft}`);
  });
});
