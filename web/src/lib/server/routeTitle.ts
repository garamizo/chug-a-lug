import type PocketBase from 'pocketbase';
import { copy } from '$lib/labels';
import { normalizeTitle } from '$lib/routeTitle';

/** The hook's name rule, asked ahead of a write so a refusal comes before anything changes. */
export async function checkTitle(pb: PocketBase, input: unknown, routeId = ''): Promise<{ ok: true; title: string } | { ok: false; message: string }> {
  const name = normalizeTitle(input);
  if (!name) return { ok: false, message: copy.titleInvalid };
  const clash = await pb.collection('itineraries').getList(1, 1, {
    filter: pb.filter('title_key = {:k} && id != {:id}', { k: name.key, id: routeId }), fields: 'id'
  });
  return clash.totalItems ? { ok: false, message: copy.titleTaken } : { ok: true, title: name.display };
}
