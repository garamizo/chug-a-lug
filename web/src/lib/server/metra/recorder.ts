// Naming and de-duplication for recorded feed snapshots. Kept separate from the script so it can be
// unit-tested without touching the disk.
import type { FeedName } from './realtime';

export const snapshotName = (feed: FeedName, timestampSec: number) => `${timestampSec}.${feed}.pb`;

/**
 * True when this feed has not been written at this timestamp yet. Metra republishes every 30 s but
 * only changes `header.timestamp` when something moved, so an all-day recording stays small.
 * Mutates `seen`, which the caller keeps for the life of the recording.
 */
export function shouldWrite(feed: FeedName, timestampSec: number, seen: Map<string, number>): boolean {
  if (seen.get(feed) === timestampSec) return false;
  seen.set(feed, timestampSec);
  return true;
}
