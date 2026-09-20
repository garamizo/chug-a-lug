// Layover choices for a stop card. With trains to pick from, each option is the layover that puts
// the crawl on that train (departure minus arrival minus the walk to the station); otherwise plain
// half-hour steps. The stop's current layover is always one of the options so the select never
// shows something the database does not hold.

export type DwellOption = { value: number; depart?: Date; current?: boolean };

export const GENERIC_DWELL = [0, 30, 60, 90, 120, 150, 180, 240];

export function dwellOptions(arrive: Date | null, walkMin: number, trips: { schedDepart: string }[], current: number): DwellOption[] {
  const out: DwellOption[] = [];
  if (arrive && trips.length) {
    for (const t of trips) {
      const depart = new Date(t.schedDepart);
      const value = Math.max(0, Math.floor((depart.getTime() - arrive.getTime()) / 60_000) - walkMin);
      if (!out.some((o) => o.value === value)) out.push({ value, depart });
    }
  } else {
    for (const value of GENERIC_DWELL) out.push({ value });
  }
  const hit = out.find((o) => o.value === current);
  if (hit) hit.current = true; else out.push({ value: current, current: true });
  return out.sort((a, b) => a.value - b.value);
}
