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
