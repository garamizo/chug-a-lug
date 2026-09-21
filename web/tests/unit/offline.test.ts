import { describe, expect, it } from 'vitest';
import { mirrorAgeMin, mirrorPayload, mirrorSavedWhen, readMirror, saveMirror } from '../../src/lib/offline';
import { copy } from '../../src/lib/labels';
import { fmtDateTime } from '../../src/lib/time';
import type { Itinerary, Leg, Stop } from '../../src/lib/types';

const itinerary = { id: 'itinerary000001', title: 'The Route', status: 'locked', event_date: '2026-12-26' } as Itinerary;
const stops = [{ id: 'a', order: 1, name: 'The Hop Haus' }] as Stop[];
const legs = [{ id: 'l1', from_stop: 'a', to_stop: 'b' }] as Leg[];

describe('mirrorPayload', () => {
  it('stamps when it was taken and keeps the three collections', () => {
    const mirror = mirrorPayload(itinerary, stops, legs, new Date('2026-12-26T20:00:00.000Z'));
    expect(mirror).toEqual({ savedAt: '2026-12-26T20:00:00.000Z', itinerary, stops, legs });
  });

  it('keeps empty collections and normalizes the timestamp to UTC', () => {
    expect(mirrorPayload(itinerary, [], [], new Date('2026-12-26T14:00:00-06:00')))
      .toEqual({ savedAt: '2026-12-26T20:00:00.000Z', itinerary, stops: [], legs: [] });
  });
});

describe('mirrorAgeMin', () => {
  it('reports how stale the copy is, rounded down', () => {
    const mirror = mirrorPayload(itinerary, stops, legs, new Date('2026-12-26T20:00:00.000Z'));
    expect(mirrorAgeMin(mirror, new Date('2026-12-26T20:44:30.000Z'))).toBe(44);
    expect(mirrorAgeMin(mirror, new Date('2026-12-26T19:00:00.000Z'))).toBe(0);
  });

  it('counts whole minutes across midnight without wrapping at a day', () => {
    const mirror = mirrorPayload(itinerary, stops, legs, new Date('2026-12-26T20:00:00.000Z'));
    expect(mirrorAgeMin(mirror, new Date('2026-12-26T20:00:59.999Z'))).toBe(0);
    expect(mirrorAgeMin(mirror, new Date('2026-12-26T20:01:00.000Z'))).toBe(1);
    expect(mirrorAgeMin(mirror, new Date('2026-12-27T20:01:00.000Z'))).toBe(1441);
  });
});

describe('mirrorSavedWhen', () => {
  const savedAt = '2026-12-26T20:00:00.000Z';

  it.each([
    ['2026-12-26T20:00:00.000Z', 0],
    ['2026-12-26T20:44:30.000Z', 44],
    ['2026-12-26T20:59:59.999Z', 59]
  ])('shows elapsed whole minutes at %s', (now, minutes) => {
    expect(mirrorSavedWhen(savedAt, new Date(now))).toBe(`${minutes} ${copy.minutesAgo}`);
  });

  it('switches to a dated Chicago timestamp at exactly one hour', () => {
    expect(mirrorSavedWhen(savedAt, new Date('2026-12-26T21:00:00.000Z'))).toBe(fmtDateTime(savedAt));
  });

  it.each(['2026-12-27T20:00:00.000Z', '2027-01-02T20:00:00.000Z'])('keeps the saved date visible days later at %s', (now) => {
    expect(mirrorSavedWhen(savedAt, new Date(now))).toBe(fmtDateTime(savedAt));
    expect(mirrorSavedWhen(savedAt, new Date(now))).toContain('Dec 26');
  });

  it('uses elapsed minutes even across Chicago midnight when still under an hour', () => {
    expect(mirrorSavedWhen('2026-12-27T05:50:00.000Z', new Date('2026-12-27T06:10:00.000Z')))
      .toBe(`20 ${copy.minutesAgo}`);
  });
});

describe('without browser storage', () => {
  it('has no saved route in Node', async () => {
    await expect(readMirror()).resolves.toBeNull();
  });

  it('does not require IndexedDB to use an online route', async () => {
    await expect(saveMirror(mirrorPayload(itinerary, stops, legs, new Date()))).resolves.toBeUndefined();
  });
});
