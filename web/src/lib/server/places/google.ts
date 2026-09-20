// Google Places API (New). Called only by the server; the key never leaves the box.
import type { Venue, VenueKind } from '$lib/types';

export type GoogleConfig = { key: string; fetchImpl?: typeof fetch };
export type PlaceMeta = {
  id: string; name: string; address: string; lat: number; lon: number; hours: string[]; rating?: number;
  phone: string; website: string; mapsUrl: string; photos: { name: string; attribution: string }[]; fetchedAt: string;
};

const BASE = 'https://places.googleapis.com/v1';

export function kindFromGoogleType(t?: string): VenueKind {
  if (!t) return 'other';
  if (['bar', 'pub', 'wine_bar', 'night_club', 'brewery'].includes(t)) return 'bar';
  if (t.endsWith('restaurant') || ['cafe', 'coffee_shop', 'bakery', 'diner', 'pizza_restaurant'].includes(t)) return 'restaurant';
  return 'other';
}

async function call(cfg: GoogleConfig, url: string, init: RequestInit, fieldMask?: string): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('X-Goog-Api-Key', cfg.key);
  if (fieldMask) headers.set('X-Goog-FieldMask', fieldMask);
  const res = await (cfg.fetchImpl ?? fetch)(url, { ...init, headers });
  if (!res.ok) throw new Error(`Google ${res.status}`);
  return res;
}

type GPlace = {
  id: string; displayName?: { text: string }; formattedAddress?: string; location?: { latitude: number; longitude: number };
  primaryType?: string; regularOpeningHours?: { weekdayDescriptions?: string[] }; rating?: number; nationalPhoneNumber?: string;
  websiteUri?: string; googleMapsUri?: string; photos?: { name: string; authorAttributions?: { displayName?: string }[] }[];
};

export async function searchText(cfg: GoogleConfig, query: string, bias: { lat: number; lon: number; radiusM: number }): Promise<Venue[]> {
  const res = await call(cfg, `${BASE}/places:searchText`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ textQuery: query, maxResultCount: 8, locationBias: { circle: { center: { latitude: bias.lat, longitude: bias.lon }, radius: bias.radiusM } } })
  }, 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryType');
  const places = ((await res.json()).places ?? []) as GPlace[];
  return places.filter((p) => p.location).map((p) => ({
    source: 'google', id: p.id, name: p.displayName?.text ?? '', kind: kindFromGoogleType(p.primaryType),
    lat: p.location!.latitude, lon: p.location!.longitude, address: p.formattedAddress
  }));
}

export async function placeDetails(cfg: GoogleConfig, placeId: string): Promise<PlaceMeta> {
  const res = await call(cfg, `${BASE}/places/${encodeURIComponent(placeId)}`, { method: 'GET' },
    'id,displayName,formattedAddress,location,regularOpeningHours,rating,nationalPhoneNumber,websiteUri,googleMapsUri,photos');
  const p = (await res.json()) as GPlace;
  return {
    id: p.id, name: p.displayName?.text ?? '', address: p.formattedAddress ?? '', lat: p.location?.latitude ?? 0, lon: p.location?.longitude ?? 0,
    hours: p.regularOpeningHours?.weekdayDescriptions ?? [], rating: p.rating, phone: p.nationalPhoneNumber ?? '', website: p.websiteUri ?? '',
    mapsUrl: p.googleMapsUri ?? '', photos: (p.photos ?? []).slice(0, 5).map((ph) => ({ name: ph.name, attribution: ph.authorAttributions?.[0]?.displayName ?? '' })),
    fetchedAt: new Date().toISOString()
  };
}

export async function photoBytes(cfg: GoogleConfig, photoName: string, maxWidthPx = 800): Promise<Uint8Array> {
  const res = await call(cfg, `${BASE}/${photoName}/media?maxWidthPx=${maxWidthPx}&key=${encodeURIComponent(cfg.key)}`, { method: 'GET' });
  return new Uint8Array(await res.arrayBuffer());
}
