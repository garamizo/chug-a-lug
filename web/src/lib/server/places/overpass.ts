// Bars and restaurants near a point from OpenStreetMap. Results are cached forever by the caller.
import { haversineM } from '$lib/geo';
import type { Venue, VenueKind } from '$lib/types';

export const USER_AGENT = 'chugalug.app/1.0 (private family app; contact via github)';

export function overpassQuery(lat: number, lon: number, radiusM: number): string {
  const around = `around:${radiusM},${lat},${lon}`;
  return `[out:json][timeout:25];(nwr(${around})["amenity"~"^(bar|pub|biergarten|restaurant|cafe|nightclub)$"];nwr(${around})["craft"="brewery"];nwr(${around})["microbrewery"="yes"];);out center tags;`;
}

type Element = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

function kindOf(tags: Record<string, string>): VenueKind {
  if (tags.craft === 'brewery' || tags.microbrewery === 'yes') return 'bar';
  if (['bar', 'pub', 'biergarten', 'nightclub'].includes(tags.amenity)) return 'bar';
  if (['restaurant', 'cafe', 'fast_food', 'food_court'].includes(tags.amenity)) return 'restaurant';
  return 'other';
}

export function parseOverpass(json: unknown, origin: { lat: number; lon: number }): Venue[] {
  const elements = ((json as { elements?: Element[] })?.elements ?? []);
  const venues: Venue[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!tags.name || lat === undefined || lon === undefined) continue;
    const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
    const address = [street, tags['addr:city']].filter(Boolean).join(', ') || undefined;
    venues.push({
      source: 'osm', id: `${el.type}/${el.id}`, name: tags.name, kind: kindOf(tags), lat, lon, address,
      hours: tags.opening_hours ? { source: 'osm', raw: tags.opening_hours } : undefined,
      phone: tags.phone || tags['contact:phone'] || undefined,
      website: tags.website || tags['contact:website'] || undefined,
      distanceM: Math.round(haversineM(origin.lat, origin.lon, lat, lon))
    });
  }
  return venues.sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
}

export async function fetchNearby(cfg: { url: string; fetchImpl?: typeof fetch }, lat: number, lon: number, radiusM = 800): Promise<Venue[]> {
  const res = await (cfg.fetchImpl ?? fetch)(cfg.url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT, accept: 'application/json' },
    body: 'data=' + encodeURIComponent(overpassQuery(lat, lon, radiusM))
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  return parseOverpass(await res.json(), { lat, lon });
}
