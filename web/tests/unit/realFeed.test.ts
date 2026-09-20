// Decodes bytes captured from the live feed with `just record`, so the parsing above is proved
// against Metra's actual output and not only against fixtures we encoded ourselves.
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import { readPredictions, selectAlerts } from '../../src/lib/server/metra/decode';

const { FeedMessage } = GtfsRealtimeBindings.transit_realtime;
const dir = join(import.meta.dirname, '../fixtures/rt-real');
const load = (name: string) => FeedMessage.decode(new Uint8Array(readFileSync(join(dir, `${name}.pb`))));

describe('real Metra feeds', () => {
  it('decodes a captured tripupdates feed into predictions', () => {
    expect(existsSync(join(dir, 'tripupdates.pb'))).toBe(true);
    const preds = readPredictions(load('tripupdates'), 'BNSF');
    // The capture was taken during service, so there is at least one BNSF trip to speak of.
    expect(Object.keys(preds).length).toBeGreaterThan(0);
    for (const [tripId, pred] of Object.entries(preds)) {
      expect(tripId).toBeTruthy();
      for (const at of Object.values(pred.stops)) {
        if (at.departAt) expect(Number.isNaN(Date.parse(at.departAt))).toBe(false);
        if (at.arriveAt) expect(Number.isNaN(Date.parse(at.arriveAt))).toBe(false);
      }
    }
  });

  it('keeps only BNSF out of a feed carrying every line', () => {
    const all = load('tripupdates').entity.filter((e) => e.tripUpdate?.trip?.tripId).length;
    const ours = Object.keys(readPredictions(load('tripupdates'), 'BNSF')).length;
    expect(all).toBeGreaterThan(ours);
  });

  it('decodes a captured alerts feed without throwing', () => {
    const alerts = selectAlerts(load('alerts'), { routeId: 'BNSF', stationIds: new Set(['CUS', 'LAGRANGE']), now: new Date() });
    for (const a of alerts) {
      expect(typeof a.id).toBe('string');
      expect(typeof a.header).toBe('string');
    }
  });

  it('decodes a captured positions feed', () => {
    expect(load('positions').entity.length).toBeGreaterThan(0);
  });
});
