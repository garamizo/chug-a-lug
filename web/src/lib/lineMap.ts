// The planner draws one line, top to bottom: the outer terminal at the top, downtown at the bottom.
// A stop sits on the left of the line when the crawl reached it heading toward Chicago and on the
// right when it was reached on the way back out. Pure so the placement can be unit-tested without
// Svelte.
import type { Line, Station } from './types';

/** The crawl is settled on the BNSF line (Aurora to Union Station). */
export const PLANNER_ROUTE = 'BNSF';

/** Ogilvie is a six-minute walk from Union Station: on a BNSF-only map it shares Union's row. */
const ROW_ALIASES: Record<string, string> = { OTC: 'CUS' };

export type Side = 'left' | 'right';
/** Which way the crawl is heading when it visits a stop: out toward Chicago, or back to Aurora. */
export type Direction = 'out' | 'back';
export const sideOf = (d: Direction): Side => (d === 'back' ? 'right' : 'left');
export const directionOf = (s: Side): Direction => (s === 'right' ? 'back' : 'out');
type StopLike = { station_id: string; direction?: Direction | '' };
export type MapRow = { station: Station; left: number[]; right: number[] };
export type Placement = { rows: MapRow[]; offLine: number[]; side: Side[] };

/** Stations of the planner line, top to bottom. GTFS lists them downtown outward, so flip. */
export function plannerStations(lines: Line[]): Station[] {
  const line = lines.find((l) => l.routeId === PLANNER_ROUTE);
  return line ? [...line.stations].reverse() : [];
}

const positions = (stations: Station[], sorted: StopLike[]) => {
  const index = new Map(stations.map((s, i) => [s.id, i]));
  return sorted.map((s) => index.get(ROW_ALIASES[s.station_id] ?? s.station_id) ?? null);
};

/**
 * Places `sorted` (already in crawl order) on the map. Indexes in the result refer to `sorted`.
 * A stop's side is its own `direction` (out = left, back = right). A stop saved without one gets
 * the direction the crawl arrived in (down the map = toward Chicago = left); the first such stop,
 * or one preceded only by same-station stops, uses the direction the crawl leaves in. Stops whose
 * station is not on the line are listed in `offLine`.
 */
export function placeStops(stations: Station[], sorted: StopLike[]): Placement {
  const pos = positions(stations, sorted);
  const side: Side[] = [];
  const rows: MapRow[] = stations.map((station) => ({ station, left: [], right: [] }));
  const offLine: number[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const here = pos[i];
    const own = sorted[i].direction ? sideOf(sorted[i].direction as Direction) : null;
    if (here === null) { offLine.push(i); side.push(own ?? side[i - 1] ?? 'left'); continue; }
    let s = own;
    if (!s) {
      let dir = 0;
      for (let j = i - 1; j >= 0 && dir === 0; j--) if (pos[j] !== null) dir = Math.sign(here - pos[j]!);
      for (let j = i + 1; j < sorted.length && dir === 0; j++) if (pos[j] !== null) dir = Math.sign(pos[j]! - here);
      s = dir < 0 ? 'right' : dir > 0 ? 'left' : (side[i - 1] ?? 'left');
    }
    side.push(s);
    rows[here][s].push(i);
  }
  return { rows, offLine, side };
}

/**
 * Where a new stop at `stationId` heading `direction` goes in the crawl (0 = first). The crawl is
 * the going stops top to bottom, then the return stops bottom to top; a stop at a station that is
 * already visited in that direction goes right after the existing ones. Off-line stations, and
 * stops without a direction, count as passed.
 */
export function insertionIndex(stations: Station[], sorted: StopLike[], stationId: string, direction: Direction): number {
  const pos = positions(stations, sorted);
  const here = positions(stations, [{ station_id: stationId }])[0];
  const { side } = placeStops(stations, sorted);
  let at = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (side[i] === 'left') {
      // Every going stop precedes a return stop; a going stop goes after those at or above it.
      if (direction === 'back' || here === null || pos[i] === null || pos[i]! <= here) at = i + 1;
    } else if (direction === 'back' && (here === null || pos[i] === null || pos[i]! >= here)) {
      at = i + 1;
    }
  }
  return at;
}
