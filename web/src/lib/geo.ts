const R = 6371000;
const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Walking at 80 m/min (about 3 mph), rounded up, never less than a minute. */
export function walkMinutes(meters: number): number {
  return Math.max(1, Math.ceil(meters / 80));
}
