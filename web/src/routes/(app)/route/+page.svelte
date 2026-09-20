<script lang="ts">
  import { onMount } from 'svelte';
  import { pb, subscribe } from '$lib/pb';
  import { copy, label } from '$lib/labels';
  import { fmtDate } from '$lib/time';
  import ItineraryView from '$lib/components/ItineraryView.svelte';
  import type { Itinerary, Leg, Stop } from '$lib/types';

  let itinerary = $state<Itinerary | null | undefined>(undefined);
  let stops = $state<Stop[]>([]);
  let legs = $state<Leg[]>([]);

  async function load() {
    try {
      const list = await pb.collection('itineraries').getList<Itinerary>(1, 1, { filter: 'status = "locked"', sort: '-locked_at' });
      const it = list.items[0] ?? null;
      itinerary = it;
      if (!it) return;
      const filter = pb.filter('itinerary = {:id}', { id: it.id });
      [stops, legs] = await Promise.all([
        pb.collection('stops').getFullList<Stop>({ filter, sort: 'order,created' }),
        pb.collection('legs').getFullList<Leg>({ filter })
      ]);
    } catch { itinerary = null; }
  }
  onMount(() => {
    void load();
    const unsubs = [subscribe('itineraries', '', load), subscribe('stops', '', load), subscribe('legs', '', load)];
    return () => unsubs.forEach((u) => u());
  });
</script>

<p><a href="/">← {copy.appTitle}</a></p>
{#if itinerary === null}
  <h1>{label('lockedItinerary')}</h1>
  <p data-testid="no-route">{copy.noRoute}</p>
  <p><a href="/plan">{copy.backToPlanner}</a></p>
{:else if itinerary}
  <ItineraryView {itinerary} {stops} {legs} editable={false} canManage={false} />
  <p class="meta" data-testid="locked-on">{copy.lockedOn} {fmtDate(itinerary.locked_at.slice(0, 10))}</p>
{/if}

<style>
  .meta { color: #aaa; font-size: 14px; margin-top: 24px; }
</style>
