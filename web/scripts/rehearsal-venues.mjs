// Bounded, cached Google Places download. Keys stay in request headers and never enter artifacts.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export async function rehearsalVenues(stations, directory) {
  const key = process.env.GOOGLE_PLACES_KEY;
  if (!key) throw new Error('Google Places must be configured to prepare rehearsal venue photos and details.');
  await mkdir(directory, { recursive: true });
  async function google(path, mask, body) {
    const response = await fetch(`https://places.googleapis.com/v1/${path}`, {
      method: body ? 'POST' : 'GET', headers: { 'X-Goog-Api-Key': key, ...(mask ? { 'X-Goog-FieldMask': mask } : {}), 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) throw new Error(`Google Places HTTP ${response.status}`);
    return response;
  }
  const stops = [];
  for (const station of stations) {
    const cache = join(directory, `${station.id}.json`);
    let venues = await readFile(cache, 'utf8').then(JSON.parse).catch(() => null);
    if (!venues) {
      const result = await google('places:searchNearby', 'places.id,places.displayName,places.location,places.primaryType,places.businessStatus,places.userRatingCount', {
        includedTypes: ['bar', 'pub', 'brewery', 'restaurant'], maxResultCount: 20,
        locationRestriction: { circle: { center: { latitude: station.lat, longitude: station.lon }, radius: 1000 } }
      }).then(r => r.json());
      const distance = p => Math.hypot((p.location.latitude - station.lat) * 111000, (p.location.longitude - station.lon) * 83000);
      const candidates = (result.places ?? []).filter(p => p.location && p.businessStatus === 'OPERATIONAL' && (p.userRatingCount ?? 0) >= 20 && !/^(bar|pub|restaurant)$/i.test(p.displayName?.text?.trim() ?? '')).sort((a, b) => distance(a) - distance(b));
      const bar = candidates.find(p => ['bar', 'pub', 'brewery'].includes(p.primaryType)) ?? candidates[0];
      const food = candidates.find(p => p.id !== bar?.id && p.primaryType?.endsWith('restaurant')) ?? candidates.find(p => p.id !== bar?.id);
      if (!bar || !food) throw new Error(`Need two walkable venues at ${station.name}.`);
      venues = [];
      for (const [i, p] of [bar, food].entries()) {
        const detail = await google(`places/${p.id}`, 'id,displayName,formattedAddress,location,regularOpeningHours,rating,userRatingCount,reviews,nationalPhoneNumber,websiteUri,googleMapsUri,photos').then(r => r.json());
        const photos = [];
        for (const [j, photo] of (detail.photos ?? []).slice(0, 2).entries()) {
          const filename = `${station.id}-${i}-${j}.jpg`;
          const response = await google(`${photo.name}/media?maxWidthPx=800`);
          await writeFile(join(directory, filename), new Uint8Array(await response.arrayBuffer()));
          photos.push({ file: filename, attribution: (photo.authorAttributions ?? []).map(a => a.displayName).join(', ') });
        }
        venues.push({ place_id: p.id, name: detail.displayName?.text, address: detail.formattedAddress,
          lat: detail.location.latitude, lon: detail.location.longitude, kind: i === 0 ? 'bar' : 'restaurant',
          hours: { source: 'google', weekday: detail.regularOpeningHours?.weekdayDescriptions ?? [] },
          rating: detail.rating, rating_count: detail.userRatingCount, phone: detail.nationalPhoneNumber,
          website: detail.websiteUri, maps_url: detail.googleMapsUri, photos,
          reviews: (detail.reviews ?? []).slice(0, 3).map(r => ({ text: r.text?.text ?? '', author: r.authorAttribution?.displayName ?? '', url: r.googleMapsUri ?? '', rating: r.rating })),
          fetched_at: new Date().toISOString(), walk_min: Math.max(2, Math.ceil(distance(p) * 1.4 / 75)) });
      }
      await writeFile(cache, JSON.stringify(venues, null, 2));
    }
    for (const [i, venue] of venues.entries()) stops.push({ ...venue, station_id: station.id, station_name: station.name,
      dwell_min: i === 0 ? 25 : 40, direction: 'out' });
  }
  return stops;
}
