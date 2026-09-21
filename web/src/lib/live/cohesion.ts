// What stops the Conductor saving. The rule is narrow on purpose: legs before the crawl's position
// are history and can look as broken as they like — the day already happened that way.
import { copy } from '$lib/labels';

export type CohesionStop = { id: string; order: number; name: string };
export type CohesionLeg = { fromStopId: string; toStopId: string; kind: 'train' | 'walk' | 'impossible' };
export type Blocker = { code: 'no_position' | 'anchor_missing' | 'impossible_leg'; message: string };

export function cohesionBlockers(input: {
  stops: CohesionStop[]; legs: CohesionLeg[]; anchorStopId: string | null;
}): Blocker[] {
  if (!input.anchorStopId) return [{ code: 'no_position', message: copy.blockNoPosition }];
  const ordered = [...input.stops].sort((a, b) => a.order - b.order);
  const index = new Map(ordered.map((s, i) => [s.id, i]));
  const anchorAt = index.get(input.anchorStopId);
  if (anchorAt === undefined) return [{ code: 'anchor_missing', message: copy.blockAnchorMissing }];
  const name = (id: string) => ordered.find((s) => s.id === id)?.name ?? id;

  return input.legs
    .filter((leg) => leg.kind === 'impossible' && (index.get(leg.fromStopId) ?? -1) >= anchorAt)
    .map((leg) => ({
      code: 'impossible_leg' as const,
      message: `${copy.blockNoTrain} ${name(leg.fromStopId)} ${copy.blockTo} ${name(leg.toStopId)}. ${copy.blockHint}`
    }));
}
