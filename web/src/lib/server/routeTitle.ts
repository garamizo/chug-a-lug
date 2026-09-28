import type PocketBase from 'pocketbase';
import { copy } from '$lib/labels';
import { normalizeTitle } from '$lib/routeTitle';

/**
 * The hook's name rule, asked ahead of a write so a refusal comes before anything changes. The
 * migration deliberately preserves legacy duplicate names, and the update hook's `nameChanged`
 * test (pocketbase/pb_hooks/planning.pb.js) only checks for a clash when the key is actually
 * changing — so a route keeping its own (possibly re-cased) key must not be rejected just because
 * some other route happens to share it. Read the route's current key first and, if the checked
 * name resolves to that same key, allow it without looking at any other route at all: this also
 * covers a commit retry that resends the same title unchanged.
 */
export async function checkTitle(pb: PocketBase, input: unknown, routeId = ''): Promise<{ ok: true; title: string } | { ok: false; message: string }> {
  const name = normalizeTitle(input);
  if (!name) return { ok: false, message: copy.titleInvalid };
  if (routeId) {
    const own = await pb.collection('itineraries').getOne<{ title_key?: string }>(routeId, { fields: 'title_key' }).catch(() => null);
    if (own?.title_key === name.key) return { ok: true, title: name.display };
  }
  const clash = await pb.collection('itineraries').getList(1, 1, {
    filter: pb.filter('title_key = {:k} && id != {:id}', { k: name.key, id: routeId }), fields: 'id'
  });
  return clash.totalItems ? { ok: false, message: copy.titleTaken } : { ok: true, title: name.display };
}
