<script lang="ts">
  import { clientClock } from '$lib/sim/clock.svelte';
  import { onMount } from 'svelte';
  import { auth, pb } from '$lib/pb';
  import { label, copy } from '$lib/labels';
  import type { Itinerary } from '$lib/types';

  let locked = $state<Itinerary | null>(null);
  onMount(async () => {
    try {
      const list = await pb.collection('itineraries').getList<Itinerary>(1, 1, { filter: 'status = "locked"', sort: '-locked_at' });
      locked = list.items[0] ?? null;
    } catch { locked = null; }
  });
</script>

<h1>{copy.welcome} <span data-testid="name">{$auth.user?.name}</span></h1>
<p data-testid="role">{$auth.user?.is_admin ? label('admin') : label('users')}</p>
<ul>
  <li><a href="/plan" data-testid="nav-plan"><strong>{label('planningPhase')}</strong><span>{copy.plannerTeaser}</span></a></li>
  <li><a href="/route" data-testid="nav-route"><strong>{label('lockedItinerary')}</strong><span>{locked ? locked.title : copy.noRoute}</span></a></li>
  {#if clientClock.enabled}<li><a href="/live" data-testid="nav-live"><strong>{copy.rehearsalLive}</strong><span>{copy.rehearsalLiveHint}</span></a></li>
  {:else}<li><strong>{label('livePhase')}</strong><span>{copy.comingSoon}</span></li>{/if}
  <li><strong>{label('wrapUpPhase')}</strong><span>{copy.comingSoon}</span></li>
</ul>
<p>{copy.notYou}</p>

<style>
  ul { list-style: none; padding: 0; margin: 28px 0; }
  li { border-top: 1px solid #444; }
  li, li a { padding: 18px 0; display: flex; justify-content: space-between; gap: 16px; align-items: center; }
  li a { padding: 0; flex: 1; color: inherit; text-decoration: none; min-height: 48px; }
  li span { font-size: 14px; color: #aaa; text-align: right; }
</style>
