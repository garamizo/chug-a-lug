// Cloning names the new route's id up front and keeps it until a clone of that route succeeds, so a
// retry after a lost response gets back the clone the server already made instead of another. The
// server clones in one transaction (pocketbase/pb_hooks/clone.pb.js); the "Copy of …" name is ours
// to choose, so a taken one moves on to "(2)", "(3)"….
import { pb } from '$lib/pb';
import { copy } from '$lib/labels';
import { newRecordId } from '$lib/live/staged';
import { cloneTitle, hookCode, titleError } from '$lib/routeTitle';

const MAX_TRIES = 50;
const pending = new Map<string, string>();

export async function cloneRoute(source: { id: string; title: string }): Promise<string> {
  const id = pending.get(source.id) ?? newRecordId();
  pending.set(source.id, id);
  for (let n = 1; n <= MAX_TRIES; n++) {
    try {
      const res = await pb.send<{ id: string }>('/api/crawl/clone', { method: 'POST', body: { source: source.id, id, title: cloneTitle(source.title, n) } });
      pending.delete(source.id);
      return res.id;
    } catch (err) {
      if (titleError(err) === copy.titleTaken) continue;
      const code = hookCode(err);
      throw new Error(code === 'route_gone' ? copy.routeGone : code === 'clone_conflict' ? copy.genericError : (err as Error).message || copy.genericError);
    }
  }
  throw new Error(copy.titleTaken);
}
