<script lang="ts">
  // The Crew Board. No location column: nothing in the app knows where an individual is, and a
  // column of guesses would be a lie.
  import { copy, labels } from '$lib/labels';
  import { pb } from '$lib/pb';
  import { liveDay } from '$lib/live/day.svelte';
  import { drinkCount as countDrinks, hasSeen as seenBulletin } from '$lib/live/crew';
  import { todayInTz } from '$lib/time';
  import type { BroadcastAck, DrinkEntry, UserRecord } from '$lib/types';

  let crew = $state<UserRecord[]>([]);
  let drinks = $state<DrinkEntry[]>([]);
  let acks = $state<BroadcastAck[]>([]);
  let error = $state('');

  const current = $derived(liveDay.bulletins[0] ?? null);
  const date = $derived(todayInTz(liveDay.now));
  const drinkCount = (userId: string) => countDrinks(drinks, userId, date);
  const hasSeen = (userId: string) => seenBulletin(acks, userId, current?.id ?? null);

  $effect(() => {
    void (async () => {
      try {
        [crew, drinks, acks] = await Promise.all([
          pb.collection('users').getFullList<UserRecord>({ sort: 'name' }),
          pb.collection('drink_entries').getFullList<DrinkEntry>(),
          pb.collection('broadcast_acks').getFullList<BroadcastAck>()
        ]);
      } catch { error = copy.loadError; }
    })();
  });
</script>

<svelte:head><title>{labels.userRoster}</title></svelte:head>

<p><a href="/live">← {copy.backToLive}</a></p>
<h1>{labels.userRoster}</h1>
{#if error}<p class="error" role="alert">{error}</p>{/if}

{#each crew as person (person.id)}
  <div class="row" data-testid="crew-row">
    <span class="name">{person.name}{#if person.is_admin}<small> · {labels.admin}</small>{/if}</span>
    <span class="tab">{drinkCount(person.id)}</span>
    {#if current}<span class="seen" class:yes={hasSeen(person.id)}>{hasSeen(person.id) ? copy.seenBulletin : copy.unseenBulletin}</span>{/if}
  </div>
{/each}

<style>
  .row { display: flex; align-items: baseline; gap: 12px; padding: 13px 0; border-bottom: 1px solid #2a2a2a; }
  .name { flex-grow: 1; font-size: 16px; }
  .name small { color: #9a9a9a; font-size: 12px; }
  .tab { font-variant-numeric: tabular-nums; font-size: 16px; font-weight: 700; }
  .seen { font-size: 12px; color: #9a9a9a; }
  .seen.yes { color: #7fd17f; }
</style>
