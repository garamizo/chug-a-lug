// What the stop sheet needs from a venue record, as plain functions.
import type { Hours, Stop } from '$lib/types';

export function hoursFor(hours: Hours | null, weekday: string): { line: string | null; rest: string[] } {
  if (!hours) return { line: null, rest: [] };
  if (hours.source === 'osm') return { line: hours.raw, rest: [] };
  const line = hours.weekday.find((l) => l.startsWith(weekday)) ?? null;
  return { line, rest: hours.weekday.filter((l) => l !== line) };
}

export function walkUrl(stop: Pick<Stop, 'name' | 'lat' | 'lon' | 'place_id'>): string {
  const params = new URLSearchParams({ api: '1', destination: `${stop.lat},${stop.lon}`, travelmode: 'walking' });
  if (stop.place_id) { params.set('destination', stop.name); params.set('destination_place_id', stop.place_id); }
  return `https://www.google.com/maps/dir/?${params}`;
}

export const telHref = (phone: string | undefined): string => {
  const digits = (phone ?? '').replace(/[^\d+]/g, '');
  return digits ? `tel:${digits}` : '';
};

/** `website` comes from Google or a hand edit and could be anything, including a javascript: URL. */
export const safeWebsite = (url: string | undefined): string => (/^https?:\/\//i.test(url ?? '') ? url! : '');
