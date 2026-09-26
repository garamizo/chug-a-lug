import { describe, it, expect } from 'vitest';
import { labels, label, copy } from '../../src/lib/labels';

describe('labels', () => {
  it('names the Crew Board and its Bulletin statuses', () => {
    expect(labels.userRoster).toBe('Crew Board');
    expect(copy.seenBulletin).toBe('Seen');
    expect(copy.unseenBulletin).toBe('Not seen');
  });
  it('maps developer terms to the README glossary', () => {
    expect(label('planningPhase')).toBe('Route Planner');
    expect(label('lockedItinerary')).toBe('The Route');
    expect(label('livePhase')).toBe('Live');
    expect(label('wrapUpPhase')).toBe('Closing Time');
    expect(label('admin')).toBe('Conductor');
    expect(label('users')).toBe('Crew');
    expect(label('scoreboard')).toBe('Hall of Fame');
    expect(label('walk')).toBe('Walk');
  });
  it('has no empty labels', () => {
    for (const [k, v] of Object.entries(labels)) expect(v, k).not.toBe('');
  });
  it('has copy for every stop kind', () => {
    for (const k of ['kind_bar', 'kind_restaurant', 'kind_other']) {
      expect((copy as Record<string, string>)[k]).toBeTruthy();
    }
  });
  it('has copy for the new board, chat box and delete flows', () => {
    for (const k of ['ticketKicker', 'chipBoarding', 'chipCurrent', 'deleteRoute', 'deleteLockedConfirm', 'emojiTray', 'attachMedia', 'turnAround', 'statFinish']) {
      expect((copy as Record<string, string>)[k], k).toBeTruthy();
    }
  });
});
