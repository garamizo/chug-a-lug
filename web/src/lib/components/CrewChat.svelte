<script lang="ts">
  import { pb, subscribe } from '$lib/pb';
  import { clientClock } from '$lib/sim/clock.svelte';
  import { copy, drinkIcons } from '$lib/labels';
  import { fmtTime } from '$lib/time';
  import { chatEntries } from '$lib/live/chat';
  import type { Broadcast, DrinkEntry } from '$lib/types';
  let { itineraryId }: { itineraryId: string } = $props();
  let drinks = $state<DrinkEntry[]>([]), bulletins = $state<Broadcast[]>([]);
  let error = $state('');
  const entries = $derived(chatEntries(drinks, bulletins));
  $effect(() => {
    const id = itineraryId;
    void clientClock.revision;
    void clientClock.runId;
    drinks = []; bulletins = []; error = '';
    let active = true, version = 0;
    const load = async () => {
      const request = ++version;
      try {
        const [d, b] = await Promise.all([
          pb.collection('drink_entries').getFullList<DrinkEntry>({ filter: pb.filter('stop.itinerary = {:id}', { id }), expand: 'user,stop', sort: 'at,action_order,created,id' }),
          pb.collection('broadcasts').getFullList<Broadcast>({ filter: pb.filter('itinerary = {:id}', { id }), expand: 'created_by', sort: 'at,created,id' })
        ]);
        if (!active || request !== version) return;
        drinks = d; bulletins = b; error = '';
      } catch { if (active && request === version) error = copy.chatLoadError; }
    };
    const unsubs = ['drink_entries', 'broadcasts', 'users', 'stops'].map(name => subscribe(name, '', () => void load()));
    const timer = setInterval(() => void load(), 30_000);
    const refresh = () => void load();
    window.addEventListener('online', refresh);
    void load();
    return () => { active = false; clearInterval(timer); unsubs.forEach(fn => fn()); window.removeEventListener('online', refresh); };
  });
</script>
<section class="chat" data-testid="crew-chat">
  <h2>{copy.crewChat}</h2>
  {#if error}<p role="status">{error}</p>{/if}
  <div role="log" aria-label={copy.crewChat} aria-live="polite" aria-relevant="additions text">
    {#each entries as entry (entry.id)}
      <article class:bulletin={entry.kind === 'bulletin'}>
        <div class="meta"><strong>{entry.author}</strong><time datetime={entry.at}>{fmtTime(entry.at)}</time></div>
        {#if entry.kind === 'bulletin'}<p><span aria-hidden="true">📣</span> {entry.body}</p>
        {:else}<p><span aria-hidden="true">{drinkIcons[entry.kind] ?? '☕'}</span> {copy.chatAdded} {(copy as Record<string, string>)[`drink_${entry.kind}`] ?? copy.chatDrink}{#if entry.stop} · {entry.stop}{/if}</p>{/if}
      </article>
    {:else}<p class="empty">{copy.chatEmpty}</p>{/each}
  </div>
</section>
<style>
  .chat { padding: 16px 20px 28px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .09em; color: #aaa; }
  article { margin-top: 10px; border: 1px solid #39332a; background: #201c17; border-radius: 4px 16px 16px; padding: 11px 14px; }
  article.bulletin { border-color: #806329; background: #292113; }
  .meta { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; }
  time, .empty { color: #aaa; }
  p { margin: 6px 0 0; line-height: 1.45; overflow-wrap: anywhere; }
</style>
