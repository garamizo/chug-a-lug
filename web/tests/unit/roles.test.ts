import { describe, expect, it } from 'vitest';
import { noTab, riderFilter, ridersOnly, roleOf } from '$lib/roles';

describe('roles', () => {
  it('reads a missing or empty role as Crew', () => {
    expect(roleOf({})).toBe('crew');
    expect(roleOf({ role: '' })).toBe('crew');
    expect(roleOf({ role: null })).toBe('crew');
    expect(roleOf(null)).toBe('crew');
    expect(roleOf(undefined)).toBe('crew');
    expect(roleOf({ role: 'trainspotter' })).toBe('trainspotter');
    expect(roleOf({ role: 'put_off' })).toBe('put_off');
  });

  it('counts everyone but trainspotters and put-off people as riders, unknown ids included', () => {
    const isRider = riderFilter([{ id: 'a', role: 'trainspotter' }, { id: 'b', role: 'put_off' }, { id: 'c', role: '' }]);
    expect(isRider('a')).toBe(false);
    expect(isRider('b')).toBe(false);
    expect(isRider('c')).toBe(true);
    // A user missing from the roster fails open: a stale roster never empties the night.
    expect(isRider('z')).toBe(true);
  });

  it('keeps riders\' rows in their order', () => {
    const isRider = riderFilter([{ id: 'ts', role: 'trainspotter' }]);
    const rows = [{ id: '1', user: 'c' }, { id: '2', user: 'ts' }, { id: '3', user: 'z' }, { id: '4', user: 'c' }];
    expect(ridersOnly(rows, isRider).map((r) => r.id)).toEqual(['1', '3', '4']);
  });

  it('keeps the Tab from trainspotters only', () => {
    expect(noTab({ role: 'trainspotter' })).toBe(true);
    for (const u of [{ role: 'crew' }, { role: '' }, { role: 'put_off' }, null, undefined]) expect(noTab(u)).toBe(false);
  });
});
