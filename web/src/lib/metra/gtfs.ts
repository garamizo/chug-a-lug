// Pure GTFS static model for the three lines. No I/O here: the server loader feeds file contents in.
import { unzipSync, strFromU8 } from 'fflate';

export const ROUTE_IDS = ['UP-W', 'MD-W', 'BNSF'] as const;
export const DOWNTOWN = new Set(['OTC', 'CUS']);

export type Station = { id: string; name: string; lat: number; lon: number };
export type Route = { id: string; name: string; color: string };
export type StopTime = { stopId: string; arr: number; dep: number; seq: number };
export type Trip = { id: string; routeId: string; serviceId: string; directionId: number; headsign: string; stops: StopTime[] };
export type Line = { routeId: string; name: string; color: string; stations: Station[] };
export type Service = { days: boolean[]; start: string; end: string };
export type Schedule = {
  publishedAt: string;
  routes: Route[];
  stations: Map<string, Station>;
  trips: Trip[];
  lines: Line[];
  services: Map<string, Service>;
  exceptions: Map<string, Map<string, 1 | 2>>;
};

export function parseCsv(text: string): Record<string, string>[] {
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body
    .filter((r) => r.some((v) => v.trim() !== ''))
    .map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

/** "25:10:00" -> 1510 minutes since the service day's midnight. Seconds are dropped. */
export function parseGtfsTime(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function unzipGtfs(zip: Uint8Array): Record<string, string> {
  const entries = unzipSync(zip);
  return Object.fromEntries(Object.entries(entries).filter(([name]) => name.endsWith('.txt')).map(([name, bytes]) => [name.split('/').pop()!, strFromU8(bytes)]));
}

export function buildSchedule(files: Record<string, string>, publishedAt: string): Schedule {
  const wanted = new Set<string>(ROUTE_IDS);
  const routes: Route[] = ROUTE_IDS.map((id) => {
    const row = parseCsv(files['routes.txt'] ?? '').find((r) => r.route_id === id);
    return { id, name: row?.route_long_name || id, color: '#' + (row?.route_color || '888888') };
  });
  const stations = new Map<string, Station>();
  for (const r of parseCsv(files['stops.txt'] ?? '')) {
    stations.set(r.stop_id, { id: r.stop_id, name: r.stop_name, lat: Number(r.stop_lat), lon: Number(r.stop_lon) });
  }
  const services = new Map<string, Service>();
  for (const r of parseCsv(files['calendar.txt'] ?? '')) {
    services.set(r.service_id, {
      days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => r[d] === '1'),
      start: r.start_date, end: r.end_date
    });
  }
  const exceptions = new Map<string, Map<string, 1 | 2>>();
  for (const r of parseCsv(files['calendar_dates.txt'] ?? '')) {
    if (!exceptions.has(r.service_id)) exceptions.set(r.service_id, new Map());
    exceptions.get(r.service_id)!.set(r.date, r.exception_type === '2' ? 2 : 1);
  }
  const tripsById = new Map<string, Trip>();
  for (const r of parseCsv(files['trips.txt'] ?? '')) {
    if (!wanted.has(r.route_id)) continue;
    tripsById.set(r.trip_id, { id: r.trip_id, routeId: r.route_id, serviceId: r.service_id, directionId: Number(r.direction_id || 0), headsign: r.trip_headsign, stops: [] });
  }
  for (const r of parseCsv(files['stop_times.txt'] ?? '')) {
    const trip = tripsById.get(r.trip_id);
    if (!trip) continue;
    trip.stops.push({ stopId: r.stop_id, arr: parseGtfsTime(r.arrival_time), dep: parseGtfsTime(r.departure_time), seq: Number(r.stop_sequence) });
  }
  const trips = [...tripsById.values()].filter((t) => t.stops.length >= 2);
  for (const t of trips) t.stops.sort((a, b) => a.seq - b.seq);
  return { publishedAt, routes, stations, trips, lines: buildLines(routes, trips, stations), services, exceptions };
}

function buildLines(routes: Route[], trips: Trip[], stations: Map<string, Station>): Line[] {
  return routes.map((route) => {
    let candidates = trips.filter((t) => t.routeId === route.id && t.directionId === 0).map((t) => t.stops.map((s) => s.stopId));
    if (!candidates.length) candidates = trips.filter((t) => t.routeId === route.id).map((t) => t.stops.map((s) => s.stopId).reverse());
    candidates.sort((a, b) => b.length - a.length);
    const order: string[] = [...(candidates[0] ?? [])];
    for (const seq of candidates.slice(1)) {
      for (let i = 0; i < seq.length; i++) {
        if (order.includes(seq[i])) continue;
        const prev = [...seq.slice(0, i)].reverse().find((id) => order.includes(id));
        order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, seq[i]);
      }
    }
    return { routeId: route.id, name: route.name, color: route.color, stations: order.map((id) => stations.get(id)).filter((s): s is Station => !!s) };
  });
}

/** Service ids running on a date ("YYYY-MM-DD" or "YYYYMMDD"), from calendar plus calendar_dates. */
export function servicesOn(s: Schedule, date: string): Set<string> {
  const ymd = date.replace(/-/g, '');
  const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(4, 6)), d = Number(ymd.slice(6, 8));
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Monday = 0
  const out = new Set<string>();
  for (const [id, svc] of s.services) {
    if (svc.start <= ymd && ymd <= svc.end && svc.days[weekday]) out.add(id);
  }
  for (const [id, byDate] of s.exceptions) {
    const ex = byDate.get(ymd);
    if (ex === 1) out.add(id);
    if (ex === 2) out.delete(id);
  }
  return out;
}
