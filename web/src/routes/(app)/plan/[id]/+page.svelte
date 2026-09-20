<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { pb, auth, subscribe } from '$lib/pb';
  import { copy } from '$lib/labels';
  import ItineraryView from '$lib/components/ItineraryView.svelte';
  import Votes from '$lib/components/Votes.svelte';
  import Comments from '$lib/components/Comments.svelte';
  import ApprovalPanel from '$lib/components/ApprovalPanel.svelte';
  import type { Itinerary, Leg, Stop } from '$lib/types';

  let { data } = $props();
  let itinerary = $state<Itinerary | null>(null);
  let stops = $state<Stop[]>([]);
  let legs = $state<Leg[]>([]);
  let error = $state('');

  async function load() {
    try {
      const filter = pb.filter('itinerary = {:id}', { id: data.id });
      const [it, st, lg] = await Promise.all([
        pb.collection('itineraries').getOne<Itinerary>(data.id),
        pb.collection('stops').getFullList<Stop>({ filter, sort: 'order,created' }),
        pb.collection('legs').getFullList<Leg>({ filter })
      ]);
      itinerary = it; stops = st; legs = lg;
    } catch { error = copy.loadError; }
  }
  onMount(() => {
    void load();
    const filter = pb.filter('itinerary = {:id}', { id: data.id });
    const unsubs = [subscribe('stops', filter, load), subscribe('legs', filter, load), subscribe('itineraries', pb.filter('id = {:id}', { id: data.id }), load)];
    return () => unsubs.forEach((u) => u());
  });

  const isAdmin = $derived(!!$auth.user?.is_admin);
  const editable = $derived(!!itinerary && (itinerary.status === 'draft' || isAdmin));
  const canManage = $derived(!!itinerary && (isAdmin || itinerary.created_by === $auth.user?.id));

  async function deleteDraft() {
    if (!itinerary || !confirm(copy.deleteDraftConfirm)) return;
    try { await pb.collection('itineraries').delete(itinerary.id); await goto('/plan'); } catch (err) { error = (err as Error).message; }
  }
</script>

<p><a href="/plan">← {copy.backToPlanner}</a></p>
{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if itinerary}
  <ItineraryView {itinerary} {stops} {legs} {editable} {canManage} onerror={(m) => (error = m)} />
  <Votes targetCollection="itineraries" targetId={itinerary.id} />
  <Comments targetCollection="itineraries" targetId={itinerary.id} />
  <ApprovalPanel {itinerary} />
  {#if canManage && itinerary.status === 'draft'}
    <button type="button" class="secondary" onclick={deleteDraft} data-testid="delete-draft">{copy.deleteDraft}</button>
  {/if}
{/if}
