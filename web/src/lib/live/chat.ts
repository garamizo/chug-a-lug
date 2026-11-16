import type { Broadcast, ChatMessage, DrinkEntry, Media, Reaction, ReactionTarget } from '$lib/types';
import { copy, drinkIcons } from '$lib/labels';
import { SPIKE_LABELS, type SpikeEvent } from './spikes';

export type ChatEntry = {
  id: string; at: string; created: string; order: number; author: string; userId: string; stop: string;
  kind: string; body: string; target: { kind: ReactionTarget; id: string } | null; media?: Media;
};

export function chatEntries(drinks: DrinkEntry[], bulletins: Broadcast[], extra: { messages?: ChatMessage[]; media?: Media[]; milestones?: ChatEntry[] } = {}): ChatEntry[] {
  return [
    // A drink with a photo is shown as that photo (and Cheers target the media); only legacy drinks announce themselves.
    ...drinks.filter((d) => !d.media).map((d): ChatEntry => ({ id: `drink:${d.id}`, at: d.at, created: d.created ?? '', order: d.action_order ?? 0,
      author: d.expand?.user?.name || copy.chatCrew, userId: d.user, stop: d.expand?.stop?.name || '', kind: d.kind as string, body: '',
      target: { kind: 'drink', id: d.id } })),
    ...bulletins.map((b): ChatEntry => ({ id: `bulletin:${b.id}`, at: b.at || b.created, created: b.created ?? '', order: 0,
      author: b.expand?.created_by?.name || copy.fromTheConductor, userId: b.created_by, stop: '', kind: 'bulletin', body: b.body,
      target: { kind: 'bulletin', id: b.id } })),
    ...(extra.messages ?? []).map((m): ChatEntry => ({ id: `message:${m.id}`, at: m.at || m.created, created: m.created ?? '', order: 0,
      author: m.expand?.user?.name || copy.chatCrew, userId: m.user, stop: '', kind: 'message', body: m.body,
      target: { kind: 'message', id: m.id } })),
    ...(extra.media ?? []).map((p): ChatEntry => ({ id: `photo:${p.id}`, at: p.at || p.created, created: p.created ?? '', order: 0,
      author: p.expand?.user?.name || copy.chatCrew, userId: p.user, stop: '', kind: 'photo', body: '',
      target: { kind: 'media', id: p.id }, media: p })),
    ...(extra.milestones ?? [])
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.created.localeCompare(b.created) || a.order - b.order || a.id.localeCompare(b.id));
}

/** Golden Spikes as chat lines; a hand-over names the previous holder from the earlier event of the same spike. */
export function spikeEntries(events: SpikeEvent[]): ChatEntry[] {
  const names = new Map<string, string>();
  return events.map((e): ChatEntry => {
    const { name } = SPIKE_LABELS[e.kind];
    let body = `🏅 ${name} · ${e.name}`;
    if (e.kind === 'pathfinder') {
      const kind = e.detail ?? '';
      body += ` — ${copy.spikeFirst} ${drinkIcons[kind] ?? '☕'} ${(copy as Record<string, string>)[`drink_${kind}`] ?? copy.chatDrink}`;
    } else if (e.from) {
      body += ` ${copy.spikeTakesFrom} ${names.get(`${e.kind}:${e.from}`) ?? copy.chatCrew}`;
    }
    names.set(`${e.kind}:${e.user}`, e.name);
    return { id: e.id, at: e.at, created: e.created, order: e.order, author: copy.spikeAuthor, userId: '', stop: '', kind: 'spike', body, target: null };
  });
}

export function reactionSummary(reactions: Reaction[], me: string): Map<string, { count: number; mine: string | null }> {
  const summary = new Map<string, { count: number; mine: string | null }>();
  for (const r of reactions) {
    const key = `${r.target_kind}:${r.target_id}`;
    const entry = summary.get(key) ?? { count: 0, mine: null };
    entry.count += 1;
    if (r.user === me) entry.mine = r.id;
    summary.set(key, entry);
  }
  return summary;
}
