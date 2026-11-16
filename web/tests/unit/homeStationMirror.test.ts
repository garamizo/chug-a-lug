// The hooks cannot import `$lib`, so the home station is written out by hand in each of them. They
// must name the same station as `HOME_STATION`, or a cloned or backfilled route rides home somewhere
// the planner's default does not.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOME_STATION } from '../../src/lib/homeStation';

const read = (path: string) => readFileSync(new URL(`../../../pocketbase/${path}`, import.meta.url), 'utf8');
// A station value written to the field: `.set('start_station', 'X')` in a hook, `start_station = 'X'`
// in SQL. Station ids are upper case and names capitalised, which keeps field lists and the
// migration's `WHERE start_station = ''` out of it.
const ids = (text: string) => [...text.matchAll(/start_station'?\s*[,=]\s*'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]);
const names = (text: string) => [...text.matchAll(/start_station_name'?\s*[,=]\s*'([A-Z][^']*)'/g)].map((m) => m[1]);

describe('the hooks\' hard-coded home station', () => {
  it.each(['pb_hooks/clone.pb.js', 'pb_migrations/1759200000_run_home.js'])('%s names HOME_STATION', (path) => {
    const text = read(path);
    expect(ids(text).length).toBeGreaterThan(0);
    expect(new Set(ids(text))).toEqual(new Set([HOME_STATION.id]));
    expect(new Set(names(text))).toEqual(new Set([HOME_STATION.name]));
  });
  it('pb_hooks/planning.pb.js hard-codes no other station', () => {
    const text = read('pb_hooks/planning.pb.js');
    for (const id of ids(text)) expect(id).toBe(HOME_STATION.id);
    for (const name of names(text)) expect(name).toBe(HOME_STATION.name);
  });
});
