<script lang="ts">
  // The Crew Board. No location column: nothing in the app knows where an individual is, and a
  // column of guesses would be a lie.
  import { clientClock } from '$lib/sim/clock.svelte';
  import { copy, labels, drinkIcons } from '$lib/labels';
  import { pb, subscribe } from '$lib/pb';
  import { liveDay } from '$lib/live/day.svelte';
  import { coalesce, crewScore, compareScores, hasSeen as seenBulletin } from '$lib/live/crew';
  import { dayBounds } from '$lib/time';
  import { spikes, spikeTally, SPIKE_LABELS, type SpikeKind } from '$lib/live/spikes';
  import type { BroadcastAck, ChatMessage, DrinkEntry, Media, UserRecord } from '$lib/types';
  import IconLink from '$lib/components/IconLink.svelte';

  let crew = $state<UserRecord[]>([]);
  let drinks = $state<DrinkEntry[]>([]);
  let acks = $state<BroadcastAck[]>([]);
  let media = $state<Media[]>([]);
  let messages = $state<ChatMessage[]>([]);
  let error = $state('');

  const current = $derived(liveDay.bulletins[0] ?? null);
  const date = $derived(liveDay.clockKnown ? liveDay.today : '');
  const ranked = $derived(crew.map(person => ({ person, score: crewScore(drinks, person.id, date) })).sort((a, b) => compareScores(a.score, b.score) || a.person.name.localeCompare(b.person.name)));
  const tally = $derived(spikeTally(spikes({ drinks, media, messages, stops: liveDay.stops, date, closedAt: liveDay.closedAt })));
  // "Pathfinder ×2": a Pathfinder is won once per Tab kind, so a person can hold several.
  const laurelNames = (kinds: SpikeKind[]) => [...new Set(kinds)].map((k) => {
    const n = kinds.filter((x) => x === k).length;
    return n > 1 ? `${SPIKE_LABELS[k].name} ${copy.spikeTimes}${n}` : SPIKE_LABELS[k].name;
  }).join(', ');
  const categories = ['shot', 'cocktail', 'beer', 'water', 'food'] as const;
  const hasSeen = (userId: string) => seenBulletin(acks, userId, current?.id ?? null);

  // The board is today's, on the current route: reload when either changes.
  const routeId = $derived(liveDay.itinerary?.id ?? '');
  const day = $derived(liveDay.today);

  $effect(() => {
    void clientClock.revision;
    const id = routeId, today = day;
    let active = true;
    let version = 0;
    const load = async () => {
      const request = ++version;
      try {
        // Dates, not ISO strings: pb.filter writes a Date in PocketBase's stored datetime form.
        const bounds = dayBounds(today), start = new Date(bounds.start), end = new Date(bounds.end);
        const rows = await Promise.all([
          pb.collection('users').getFullList<UserRecord>({ sort: 'name' }),
          pb.collection('drink_entries').getFullList<DrinkEntry>({ filter: pb.filter('stop.itinerary = {:id} && at >= {:start} && at < {:end}', { id, start, end }) }),
          pb.collection('broadcast_acks').getFullList<BroadcastAck>({ filter: pb.filter('broadcast.itinerary = {:id} && broadcast.at >= {:start} && broadcast.at < {:end}', { id, start, end }) }),
          // Golden Spikes read the same rows as Crew chat, with the filters of `loadFeed`.
          pb.collection('media').getFullList<Media>({ filter: pb.filter('(itinerary = {:id} || stop.itinerary = {:id}) && at >= {:start} && at < {:end}', { id, start, end }), expand: 'user', sort: 'at,created,id', cache: 'no-store' }),
          pb.collection('chat_messages').getFullList<ChatMessage>({ filter: pb.filter('itinerary = {:id} && at >= {:start} && at < {:end}', { id, start, end }), expand: 'user', sort: 'at,created,id', cache: 'no-store' })
        ]);
        if (!active || request !== version) return;
        [crew, drinks, acks, media, messages] = rows;
        error = '';
      } catch { if (active && request === version) error = copy.loadError; }
    };
    // A chatty night sends a burst of events; each would reload all five lists, so they share one trailing load.
    const reload = coalesce(() => void load(), 300);
    const unsubs = ['users', 'drink_entries', 'broadcast_acks', 'media', 'chat_messages'].map((name) => subscribe(name, '', reload.call));
    // Recover changes missed while the realtime connection was down.
    const timer = setInterval(() => void load(), 30_000);
    void load();
    return () => {
      active = false;
      reload.cancel();
      clearInterval(timer);
      unsubs.forEach((unsubscribe) => unsubscribe());
    };
  });
</script>

<svelte:head><title>{labels.userRoster}</title></svelte:head>

{#if !liveDay.isEventDay}<nav><IconLink href="/live" icon="back" label={copy.backToLive} /></nav>{/if}
<h1>{labels.userRoster}</h1>
{#if error}<p class="error" role="alert">{error}</p>{/if}

{#each ranked as { person, score } (person.id)}
  <div class="row" data-testid="crew-row">
    <span class="name">{person.name}{#if person.is_admin}<small> · {labels.admin}</small>{/if}</span>
    {#if tally.get(person.id)?.length}
      {@const kinds = tally.get(person.id) ?? []}
      <span class="laurel" role="img" aria-label="{copy.spikeLaurel}: {laurelNames(kinds)}" title={laurelNames(kinds)} data-testid="spike-laurel">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M12 21c-4-1-7-5-7-10M12 21c4-1 7-5 7-10M6 8l-2-1M5.5 12l-2.2.2M7 16l-1.8 1.2M18 8l2-1M18.5 12l2.2.2M17 16l1.8 1.2"/></svg>{kinds.length}
      </span>
    {/if}
    <span class="tab">{#each categories as kind}<span title={copy[`drink_${kind}`]}><span aria-hidden="true">{drinkIcons[kind]}</span><span class="sr-only">{copy[`drink_${kind}`]}: </span>{score[kind]}</span>{/each}</span>
    {#if current}<span class="seen" class:yes={hasSeen(person.id)}>{hasSeen(person.id) ? copy.seenBulletin : copy.unseenBulletin}</span>{/if}
  </div>
{/each}

<style>
  .row { display: flex; align-items: baseline; gap: 12px; padding: 13px 0; border-bottom: 1px solid #2a2a2a; }
  .name { flex-grow: 1; font-size: 16px; }
  .name small { color: #9a9a9a; font-size: 12px; }
  .row { flex-wrap: wrap; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .tab { display: flex; gap: 10px; font-variant-numeric: tabular-nums; font-size: 16px; font-weight: 700; }
  .laurel { display: inline-flex; align-items: center; gap: 3px; color: #e0b84a; font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .seen { font-size: 12px; color: #9a9a9a; }
  .seen.yes { color: #7fd17f; }
</style>
