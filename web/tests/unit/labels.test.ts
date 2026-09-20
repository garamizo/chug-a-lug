import { describe, it, expect } from 'vitest';
import { labels, label, copy } from '../../src/lib/labels';

describe('labels', () => {
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
  it('has copy for every stop kind and itinerary status', () => {
    for (const k of ['kind_bar', 'kind_restaurant', 'kind_other', 'status_draft', 'status_locked', 'status_archived']) {
      expect((copy as Record<string, string>)[k]).toBeTruthy();
    }
  });
});
