import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseCsv, parseGtfsTime, buildSchedule, servicesOn, stationsServedOn, unzipGtfs, ROUTE_IDS } from '../../src/lib/metra/gtfs';
import { fixtureFiles, fixtureSchedule } from '../fixtures/loadFixture';

describe('parseCsv', () => {
  it('trims cells, keeps quoted commas, strips BOM, skips blank lines', () => {
    const rows = parseCsv('﻿a, b,c\r\n1, "x, y" ,3\n\n');
    expect(rows).toEqual([{ a: '1', b: 'x, y', c: '3' }]);
  });
});

describe('parseGtfsTime', () => {
  it('handles times past midnight and drops seconds', () => {
    expect(parseGtfsTime('25:10:00')).toBe(1510);
    expect(parseGtfsTime('04:00:59')).toBe(240);
  });
});

describe('buildSchedule', () => {
  const s = fixtureSchedule();
  it('keeps only the three lines, with colors', () => {
    expect(s.routes.map((r) => r.id)).toEqual([...ROUTE_IDS]);
    expect(s.routes.find((r) => r.id === 'UP-W')?.color).toBe('#FE8D81');
    expect(s.trips.some((t) => t.routeId === 'HC')).toBe(false);
  });
  it('orders stop times and uses departure at origin', () => {
    const uw1 = s.trips.find((t) => t.id === 'UW1')!;
    expect(uw1.stops.map((x) => x.stopId)).toEqual(['OTC', 'OAKPARK', 'ELMHURST', 'WHEATON', 'GENEVA']);
    expect(uw1.stops[2]).toEqual({ stopId: 'ELMHURST', arr: 669, dep: 670, seq: 3 });
    expect(uw1.headsign).toBe('Geneva');
    expect(uw1.directionId).toBe(0);
  });
  it('builds ordered lines from downtown outward, merging express trips', () => {
    const upw = s.lines.find((l) => l.routeId === 'UP-W')!;
    expect(upw.stations.map((x) => x.id)).toEqual(['OTC', 'OAKPARK', 'ELMHURST', 'WHEATON', 'GENEVA']);
    expect(upw.stations[0].name).toBe('Chicago OTC');
    expect(s.lines.map((l) => l.routeId)).toEqual(['UP-W', 'MD-W', 'BNSF']);
    expect(s.lines.find((l) => l.routeId === 'BNSF')!.stations.map((x) => x.id)).toEqual(['CUS', 'LAGRANGE', 'NAPERVILLE']);
  });
  it('exposes stations with coordinates', () => {
    expect(s.stations.get('OTC')).toEqual({ id: 'OTC', name: 'Chicago OTC', lat: 41.8822222, lon: -87.6405556 });
  });
});

describe('servicesOn', () => {
  const s = fixtureSchedule();
  it('applies calendar weekdays and calendar_dates exceptions', () => {
    expect([...servicesOn(s, '2026-12-26')].sort()).toEqual(['A2A', 'H1']);
    expect([...servicesOn(s, '20261226')].sort()).toEqual(['A2A', 'H1']);
    expect([...servicesOn(s, '2026-12-27')]).toEqual([]);
    expect([...servicesOn(s, '2026-12-28')]).toEqual(['A1A']);
    expect([...servicesOn(s, '2027-01-02')]).toEqual([]);
  });
});

describe('stationsServedOn', () => {
  const s = fixtureSchedule();
  it('lists the stations some trip of the line stops at that day', () => {
    expect([...stationsServedOn(s, 'BNSF', '2026-12-26')].sort()).toEqual(['CUS', 'LAGRANGE', 'NAPERVILLE']);
  });
  it('is empty when no service of the line runs', () => {
    expect(stationsServedOn(s, 'BNSF', '2026-12-27').size).toBe(0);
    expect(stationsServedOn(s, 'BNSF', '2026-12-28').size).toBe(0);
  });
});

describe('unzipGtfs', () => {
  it('round-trips a zip made from the fixture folder', () => {
    const files = fixtureFiles();
    const zipped = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])));
    const out = unzipGtfs(zipped);
    expect(out['stops.txt']).toBe(files['stops.txt']);
    expect(buildSchedule(out, 'x').trips.length).toBe(fixtureSchedule().trips.length);
  });
});
