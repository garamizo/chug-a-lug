// What stops the Conductor saving. The rule is narrow on purpose: legs before the crawl's position
// are history and can look as broken as they like — the day already happened that way.
import { copy } from '$lib/labels';

export type CohesionStop = { id: string; order: number; name: string };
export type CohesionLeg = { fromStopId: string; toStopId: string; kind: 'train' | 'walk' | 'impossible' };
export type Blocker = { code: 'no_position' | 'anchor_missing' | 'impossible_leg'; message: string };

/**
 * Impossible legs at or after the anchor's stop — the ones a Conductor still riding the route can
 * actually act on. A leg before the anchor is history and can look as broken as it likes.
 *
 * Exported so the server's recompute can report the same count the editor gates Save on: without
 * a shared rule here, a save can land clean by this function's definition of "broken" and come
 * back reporting it landed broken by a looser one (every impossible leg, history included) —
 * which is exactly a leg the Conductor cannot fix, on a message that says to.
 */
export function impossibleFromAnchor(input: { stops: CohesionStop[]; legs: CohesionLeg[]; anchorStopId: string | null }): CohesionLeg[] {
  if (!input.anchorStopId) return [];
  const ordered = [...input.stops].sort((a, b) => a.order - b.order);
  const index = new Map(ordered.map((s, i) => [s.id, i]));
  const anchorAt = index.get(input.anchorStopId);
  if (anchorAt === undefined) return [];
  return input.legs.filter((leg) => leg.kind === 'impossible' && (index.get(leg.fromStopId) ?? -1) >= anchorAt);
}

export function cohesionBlockers(input: {
  stops: CohesionStop[]; legs: CohesionLeg[]; anchorStopId: string | null;
}): Blocker[] {
  if (!input.anchorStopId) return [{ code: 'no_position', message: copy.blockNoPosition }];
  const ordered = [...input.stops].sort((a, b) => a.order - b.order);
  const index = new Map(ordered.map((s, i) => [s.id, i]));
  if (index.get(input.anchorStopId) === undefined) return [{ code: 'anchor_missing', message: copy.blockAnchorMissing }];
  const name = (id: string) => ordered.find((s) => s.id === id)?.name ?? id;

  return impossibleFromAnchor(input).map((leg) => ({
    code: 'impossible_leg' as const,
    message: `${copy.blockNoTrain} ${name(leg.fromStopId)} ${copy.blockTo} ${name(leg.toStopId)}. ${copy.blockHint}`
  }));
}
