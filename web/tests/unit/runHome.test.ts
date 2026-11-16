import { describe, expect, it } from 'vitest';
import { copy } from '../../src/lib/labels';
import { runHomeReason } from '../../src/lib/runHome';

describe('runHomeReason', () => {
  it('says the last train must arrive before midnight', () => {
    expect(runHomeReason('after_midnight', 'Stone Ave has no trains on a Saturday.', 'Aurora')).toBe(copy.runHomeMidnight);
  });
  it('names a station with no service that day', () => {
    expect(runHomeReason(undefined, 'Stone Ave has no trains on a Saturday.', 'Aurora')).toBe('Stone Ave has no trains on a Saturday.');
  });
  it('falls back to the no-train text naming the home station', () => {
    expect(runHomeReason(undefined, undefined, 'Aurora')).toBe(`${copy.runHome} Aurora: ${copy.noTrain}`);
  });
});
