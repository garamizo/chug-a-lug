<script lang="ts">
  import { goto } from '$app/navigation';
  import { auth } from '$lib/pb';
  import { label, copy } from '$lib/labels';
  import { liveDay } from '$lib/live/day.svelte';

  // liveDay already resolves and follows the current route (the same newest-locked fallback, kept
  // fresh by liveDay.start() in the layout); a one-shot onMount resolve here would go stale the
  // moment the Conductor uses "Make current" and, offline, would show "no route" even though the
  // Live link above it (driven by liveDay.hasRoute) still shows.
  const locked = $derived(liveDay.itinerary);
  // On the day itself the app is the Departure Board; the planner is reached through the menu, not
  // a tab — the event-day TabBar links Live, The Route and the Crew Board only.
  $effect(() => { if (liveDay.isEventDay) void goto('/live', { replaceState: true }); });
</script>

<h1>{copy.welcome} <span data-testid="name">{$auth.user?.name}</span></h1>
<p data-testid="role">{$auth.user?.is_admin ? label('admin') : label('users')}</p>
<ul>
  <li><a href="/plan" data-testid="nav-plan"><strong><span aria-hidden="true">🗺️</span> {label('planningPhase')} →</strong><span>{copy.plannerTeaser}</span></a></li>
  <li><a href="/route" data-testid="nav-route"><strong><span aria-hidden="true">🚂</span> {label('lockedItinerary')} →</strong><span>{locked ? locked.title : copy.noRoute}</span></a></li>
  {#if liveDay.hasRoute}<li><a href="/live" data-testid="nav-live"><strong><span aria-hidden="true">🎟️</span> {label('livePhase')} →</strong><span>{copy.liveHint}</span></a></li>
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
