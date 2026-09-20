<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { pb, auth, subscribe } from '$lib/pb';
  import { label, copy } from '$lib/labels';
  import { fmtDate } from '$lib/time';
  import type { Itinerary } from '$lib/types';

  let items = $state<Itinerary[]>([]);
  let title = $state('');
  let busy = $state(false);
  let error = $state('');

  async function load() {
    try { items = await pb.collection('itineraries').getFullList<Itinerary>({ sort: '-created' }); }
    catch { error = copy.loadError; }
  }
  onMount(() => { void load(); return subscribe('itineraries', '', load); });

  async function create(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !title.trim()) return;
    busy = true; error = '';
    try {
      const record = await pb.collection('itineraries').create<Itinerary>({ title: title.trim(), created_by: $auth.user?.id });
      await goto(`/plan/${record.id}/edit`);
    } catch (err) { error = (err as Error).message || copy.genericError; }
    finally { busy = false; }
  }

  const drafts = $derived(items.filter((i) => i.status === 'draft'));
  const others = $derived(items.filter((i) => i.status !== 'draft'));
  const statusLabel = (s: Itinerary['status']) => copy[`status_${s}` as keyof typeof copy];
</script>

<h1>{label('planningPhase')}</h1>
<p>{copy.plannerIntro}</p>

<form onsubmit={create} aria-busy={busy}>
  <label for="title">{copy.draftTitle}</label>
  <input id="title" bind:value={title} placeholder={copy.draftTitlePlaceholder} maxlength="80" required data-testid="draft-title" disabled={busy} />
  <button type="submit" disabled={busy} data-testid="create-draft">{busy ? copy.working : copy.newDraft}</button>
</form>
{#if error}<p class="error" role="alert">{error}</p>{/if}

<h2>{copy.drafts}</h2>
{#if drafts.length === 0}<p>{copy.noDrafts}</p>{/if}
<ul>
  {#each drafts as it (it.id)}
    <li><a href="/plan/{it.id}" data-testid="draft-link-{it.id}"><strong>{it.title}</strong><span>{fmtDate(it.event_date)} · {it.start_time}</span></a></li>
  {/each}
</ul>

{#if others.length}
  <h2>{copy.pastRoutes}</h2>
  <ul>
    {#each others as it (it.id)}
      <li><a href={it.status === 'locked' ? '/route' : `/plan/${it.id}`}><strong>{it.title}</strong><span>{statusLabel(it.status)}</span></a></li>
    {/each}
  </ul>
{/if}

<style>
  h2 { font-size: 18px; margin-top: 32px; }
  ul { list-style: none; padding: 0; margin: 12px 0; }
  li { border-top: 1px solid #444; }
  li a { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 16px 0; color: inherit; text-decoration: none; min-height: 48px; }
  li span { color: #aaa; font-size: 14px; }
</style>
