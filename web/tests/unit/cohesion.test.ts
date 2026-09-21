import { describe, expect, it } from 'vitest';
import { cohesionBlockers } from '../../src/lib/live/cohesion';
import { copy } from '../../src/lib/labels';

const stops = [
  { id: 'a', order: 1, name: 'The Hop Haus' },
  { id: 'b', order: 2, name: 'The Second Round' },
  { id: 'c', order: 3, name: 'Berwyn Beer Hall' }
];
const rideable = [
  { fromStopId: 'a', toStopId: 'b', kind: 'walk' as const },
  { fromStopId: 'b', toStopId: 'c', kind: 'train' as const }
];

describe('cohesionBlockers', () => {
  it('passes a rideable plan with the crew placed on it', () => {
    expect(cohesionBlockers({ stops, legs: rideable, anchorStopId: 'b' })).toEqual([]);
  });

  it('asks for the position first', () => {
    expect(cohesionBlockers({ stops, legs: rideable, anchorStopId: null }))
      .toEqual([{ code: 'no_position', message: copy.blockNoPosition }]);
  });

  it('says so when the crew is standing in a stop that was removed', () => {
    expect(cohesionBlockers({ stops, legs: rideable, anchorStopId: 'gone' }))
      .toEqual([{ code: 'anchor_missing', message: copy.blockAnchorMissing }]);
  });

  it('names the leg that cannot be ridden and how to fix it', () => {
    const legs = [rideable[0], { fromStopId: 'b', toStopId: 'c', kind: 'impossible' as const }];
    expect(cohesionBlockers({ stops, legs, anchorStopId: 'a' })).toEqual([{
      code: 'impossible_leg',
      message: `${copy.blockNoTrain} The Second Round ${copy.blockTo} Berwyn Beer Hall. ${copy.blockHint}`
    }]);
  });

  it('ignores an unrideable leg the crawl has already passed', () => {
    const legs = [{ fromStopId: 'a', toStopId: 'b', kind: 'impossible' as const }, rideable[1]];
    expect(cohesionBlockers({ stops, legs, anchorStopId: 'b' })).toEqual([]);
  });

  it('reports every blocked leg from the anchor onward', () => {
    const legs = [
      { fromStopId: 'a', toStopId: 'b', kind: 'impossible' as const },
      { fromStopId: 'b', toStopId: 'c', kind: 'impossible' as const }
    ];
    expect(cohesionBlockers({ stops, legs, anchorStopId: 'a' })).toHaveLength(2);
  });
});
