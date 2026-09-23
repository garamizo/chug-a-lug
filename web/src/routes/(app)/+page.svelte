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
  <li><a href="/plan" data-testid="nav-plan"><strong><span aria-hidden="true">🗺️</span> {label('planningPhase')} →</strong><span>{copy.plannerTeaser}</span></a></li>
  <li><a href="/route" data-testid="nav-route"><strong><span aria-hidden="true">🚂</span> {label('lockedItinerary')} →</strong><span>{locked ? locked.title : copy.noRoute}</span></a></li>
  {#if clientClock.enabled}<li><a href="/live" data-testid="nav-live"><strong><span aria-hidden="true">🎟️</span> {copy.rehearsalLive} →</strong><span>{copy.rehearsalLiveHint}</span></a></li>
  {:else}<li><strong>{label('livePhase')}</strong><span>{copy.comingSoon}</span></li>{/if}
  <li><strong>{label('wrapUpPhase')}</strong><span>{copy.comingSoon}</span></li>
</ul>
<p>{copy.notYou}</p>

<style>
  ul { list-style: none; padding: 0; margin: 28px 0; }
  li { margin-bottom: 12px; }
  li, li a { padding: 18px 0; display: flex; justify-content: space-between; gap: 16px; align-items: center; }
  li a { padding: 20px; border: 2px solid #b17d16; border-radius: 16px; background: #292216; box-shadow: 0 4px 0 #6b4c10; flex: 1; color: inherit; text-decoration: none; min-height: 48px; }
  li a:hover { background: #3a2e18; border-color: #ffb400; }
  li a:active { transform: translateY(2px); box-shadow: 0 2px 0 #6b4c10; }
  li strong { font-size: 18px; }
  li span { font-size: 14px; color: #aaa; text-align: right; }
</style>
