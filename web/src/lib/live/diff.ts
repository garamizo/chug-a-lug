// What changed in the plan, and the Bulletin that describes it. The Conductor edits the words before
// they go out, so this only has to be right enough to save typing in a loud bar.
import { copy } from '$lib/labels';
import { fmtTime } from '$lib/time';

export type DiffStop = { id: string; name: string; order: number; station_name: string; dwell_min: number };
export type PlanSnapshot = { anchorStopId: string | null; stops: DiffStop[] };
export type Change =
  | { kind: 'position'; stopName: string }
  | { kind: 'hold'; stopName: string; departAt: string | null }
  | { kind: 'annul'; stopName: string }
  | { kind: 'extra'; stopName: string; stationName: string }
  | { kind: 'reroute'; stopName: string; beforeName: string };
export type BulletinKind = 'reroute' | 'extra' | 'annul' | 'hold' | 'message';

/**
 * `departAt` answers "when does the crawl leave this stop under the new plan", so a Hold can name
 * the train it is waiting for. It comes from the previewed legs; without it the Hold reads plainly.
 */
export function planDiff(before: PlanSnapshot, after: PlanSnapshot, departAt?: (stopId: string) => string | null): Change[] {
  const changes: Change[] = [];
  const byId = new Map(before.stops.map((s) => [s.id, s]));
  const afterById = new Map(after.stops.map((s) => [s.id, s]));
  const ordered = [...after.stops].sort((a, b) => a.order - b.order);

  if (after.anchorStopId && after.anchorStopId !== before.anchorStopId) {
    const stop = afterById.get(after.anchorStopId);
    if (stop) changes.push({ kind: 'position', stopName: stop.name });
  }
  for (const stop of before.stops) {
    if (!afterById.has(stop.id)) changes.push({ kind: 'annul', stopName: stop.name });
  }
  for (const stop of ordered) {
    const was = byId.get(stop.id);
    if (!was) {
      changes.push({ kind: 'extra', stopName: stop.name, stationName: stop.station_name });
    } else if (was.dwell_min !== stop.dwell_min) {
      changes.push({ kind: 'hold', stopName: stop.name, departAt: departAt?.(stop.id) ?? null });
    }
  }
  // A reorder is reported once, on the stop that moved earliest in the new plan.
  const kept = ordered.filter((s) => byId.has(s.id));
  const wasOrder = kept.map((s) => byId.get(s.id)!.order);
  const moved = kept.find((s, i) => wasOrder.slice(i + 1).some((o) => o < byId.get(s.id)!.order));
  if (moved) {
    const after = kept[kept.indexOf(moved) + 1];
    changes.push({ kind: 'reroute', stopName: moved.name, beforeName: after?.name ?? '' });
  }
  return changes;
}

const RANK: Record<Change['kind'], number> = { reroute: 5, extra: 4, annul: 3, hold: 2, position: 1 };

export function bulletinKind(changes: Change[]): BulletinKind {
  const top = [...changes].sort((a, b) => RANK[b.kind] - RANK[a.kind])[0];
  return !top || top.kind === 'position' ? 'message' : top.kind;
}

export function bulletinText(changes: Change[]): string {
  return changes.map((c) => {
    switch (c.kind) {
      case 'position': return `${copy.bulletinPosition} ${c.stopName}.`;
      case 'hold': return c.departAt
        ? `${copy.bulletinHold} ${c.stopName} ${copy.bulletinUntil} ${fmtTime(c.departAt)}.`
        : `${copy.bulletinHoldPlain} ${c.stopName}.`;
      case 'annul': return `${c.stopName} ${copy.bulletinAnnul}`;
      case 'extra': return `${copy.bulletinExtra} ${c.stopName}, ${c.stationName}.`;
      case 'reroute': return `${copy.bulletinReroute} ${c.stopName} ${copy.bulletinBefore} ${c.beforeName}.`;
    }
  }).join(' ');
}
