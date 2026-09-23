<script lang="ts">
  // The Crew Board. No location column: nothing in the app knows where an individual is, and a
  // column of guesses would be a lie.
  import { clientClock } from '$lib/sim/clock.svelte';
  import { copy, labels, drinkIcons } from '$lib/labels';
  import { pb, subscribe } from '$lib/pb';
  import { liveDay } from '$lib/live/day.svelte';
  import { crewScore, compareScores, hasSeen as seenBulletin } from '$lib/live/crew';
  import { todayInTz } from '$lib/time';
  import type { BroadcastAck, DrinkEntry, UserRecord } from '$lib/types';

  let crew = $state<UserRecord[]>([]);
  let drinks = $state<DrinkEntry[]>([]);
  let acks = $state<BroadcastAck[]>([]);
  let error = $state('');

  const current = $derived(liveDay.bulletins[0] ?? null);
  const date = $derived(liveDay.clockKnown ? todayInTz(liveDay.now) : '');
  const ranked = $derived(crew.map(person => ({ person, score: crewScore(drinks, person.id, date) })).sort((a, b) => compareScores(a.score, b.score) || a.person.name.localeCompare(b.person.name)));
  const categories = ['shot', 'cocktail', 'beer', 'water', 'food'] as const;
  const hasSeen = (userId: string) => seenBulletin(acks, userId, current?.id ?? null);

  $effect(() => {
    void clientClock.revision;
    let active = true;
    let version = 0;
    const load = async () => {
      const request = ++version;
      try {
        const rows = await Promise.all([
          pb.collection('users').getFullList<UserRecord>({ sort: 'name' }),
          pb.collection('drink_entries').getFullList<DrinkEntry>(),
          pb.collection('broadcast_acks').getFullList<BroadcastAck>()
        ]);
        if (!active || request !== version) return;
        [crew, drinks, acks] = rows;
        error = '';
      } catch { if (active && request === version) error = copy.loadError; }
    };
    const unsubs = ['users', 'drink_entries', 'broadcast_acks'].map((name) => subscribe(name, '', () => void load()));
    // Recover changes missed while the realtime connection was down.
    const timer = setInterval(() => void load(), 30_000);
    void load();
    return () => {
      active = false;
      clearInterval(timer);
      unsubs.forEach((unsubscribe) => unsubscribe());
    };
  });
</script>

<svelte:head><title>{labels.userRoster}</title></svelte:head>

<p><a href="/live">← {copy.backToLive}</a></p>
<h1>{labels.userRoster}</h1>
{#if error}<p class="error" role="alert">{error}</p>{/if}

{#each ranked as { person, score } (person.id)}
  <div class="row" data-testid="crew-row">
    <span class="name">{person.name}{#if person.is_admin}<small> · {labels.admin}</small>{/if}</span>
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
  .seen { font-size: 12px; color: #9a9a9a; }
  .seen.yes { color: #7fd17f; }
</style>
