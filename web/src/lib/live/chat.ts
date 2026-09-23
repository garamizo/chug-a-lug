import type { Broadcast, DrinkEntry } from '$lib/types';
import { copy } from '$lib/labels';
export function chatEntries(drinks: DrinkEntry[], bulletins: Broadcast[]) {
  return [
    ...drinks.map(d => ({ id: `drink:${d.id}`, at: d.at, created: d.created ?? '', order: d.action_order ?? 0,
      author: d.expand?.user?.name || copy.chatCrew, stop: d.expand?.stop?.name || '', kind: d.kind as string, body: '' })),
    ...bulletins.map(b => ({ id: `bulletin:${b.id}`, at: b.at || b.created, created: b.created ?? '', order: 0,
      author: b.expand?.created_by?.name || copy.fromTheConductor, stop: '', kind: 'bulletin', body: b.body }))
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.created.localeCompare(b.created) || a.order - b.order || a.id.localeCompare(b.id));
}
