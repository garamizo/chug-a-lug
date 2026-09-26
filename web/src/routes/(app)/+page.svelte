<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { pb, auth, subscribe } from '$lib/pb';
  import { label, copy } from '$lib/labels';
  import { fmtDate } from '$lib/time';
  import { liveDay } from '$lib/live/day.svelte';
  import { countdownText, liveChip, plannerChip, wrapUpChip } from '$lib/home';
  import Ticket from '$lib/components/Ticket.svelte';
  import Board from '$lib/components/Board.svelte';
  import BoardRow from '$lib/components/BoardRow.svelte';

  // liveDay already resolves and follows the current route (the same newest-locked fallback, kept
  // fresh by liveDay.start() in the layout); a one-shot onMount resolve here would go stale the
  // moment the Conductor uses "Make current" and, offline, would show "no route" even though the
  // Live link above it (driven by liveDay.hasRoute) still shows.
  const locked = $derived(liveDay.itinerary);
  // On the day itself the app is the Departure Board; the planner is reached through the menu, not
  // a tab — the event-day TabBar links Live, The Route and the Crew Board only.
  $effect(() => { if (liveDay.isEventDay) void goto('/live', { replaceState: true }); });

  let drafts = $state(0);
  let voting = $state(false);
  async function loadCounts() {
    try {
      const [d, v] = await Promise.all([
        pb.collection('itineraries').getList(1, 1, { filter: "status = 'draft'", fields: 'id' }),
        pb.collection('itineraries').getList(1, 1, { filter: "status = 'draft' && vote_open = true", fields: 'id' })
      ]);
      drafts = d.totalItems;
      voting = v.totalItems > 0;
    } catch { /* keep the last counts */ }
  }
  onMount(() => { void loadCounts(); return subscribe('itineraries', '', loadCounts); });

  const plannerSub = $derived(`${drafts} ${drafts === 1 ? copy.draftsOne : copy.draftsCount}${voting ? ` · ${copy.voteOpenShort}` : ''}`);
</script>

<p class="hello">{copy.welcome}</p>
<h1 data-testid="name">{$auth.user?.name}</h1>

{#if locked}
  <Ticket testid="nav-route" href="/route" kicker={copy.ticketKicker} title={locked.title}
    when="{fmtDate(locked.event_date)} · {locked.start_time}" countdown={countdownText(locked.event_date, liveDay.today)} />
{:else}
  <Ticket testid="nav-route" href="/plan" kicker={copy.ticketKicker} title={copy.noRouteYet} when={copy.noRouteHint} />
{/if}

<Board heads={[copy.boardDestination, copy.boardStatus]}>
  <BoardRow index={0} icon="🗺️" href="/plan" testid="nav-plan" title={label('planningPhase')} subtitle={plannerSub} chip={plannerChip(drafts)} />
  <BoardRow index={1} icon="🎟️" href={liveDay.hasRoute ? '/live' : undefined} testid={liveDay.hasRoute ? 'nav-live' : undefined}
    title={label('livePhase')} subtitle={liveDay.hasRoute ? copy.liveHint : copy.comingSoon}
    chip={liveChip({ hasRoute: liveDay.hasRoute, isEventDay: liveDay.isEventDay, eventDate: locked?.event_date ?? null })} />
  <BoardRow index={2} icon="🍻" title={label('wrapUpPhase')} subtitle={copy.wrapUpHint} chip={wrapUpChip} />
</Board>

<p class="foot">{copy.notYou}</p>

<style>
  .hello { margin: 16px 0 0; color: #999; font-size: 15px; }
  h1 { margin: 0 0 4px; }
  .foot { color: #777; font-size: 13px; text-align: center; margin-top: 20px; }
</style>
