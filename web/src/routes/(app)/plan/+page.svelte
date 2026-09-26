<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { pb, auth, subscribe } from '$lib/pb';
  import { label, copy } from '$lib/labels';
  import { liveDay } from '$lib/live/day.svelte';
  import { canDelete, canEditSettings } from '$lib/permissions';
  import { countBy, deleteRoute, routeChip, sortRoutes } from '$lib/planList';
  import Board from '$lib/components/Board.svelte';
  import BoardRow from '$lib/components/BoardRow.svelte';
  import IconButton from '$lib/components/IconButton.svelte';
  import type { Itinerary, UserRecord } from '$lib/types';

  // `created` is redeclared explicitly (RecordModel otherwise only implies it through its index
  // signature) so `sortRoutes`'s `Pick<Itinerary, 'status' | 'created'>` constraint is satisfied.
  type Row = Itinerary & { created: string; expand?: { created_by?: UserRecord } };
  let items = $state<Row[]>([]);
  let stops = $state(new Map<string, number>());
  let cheers = $state(new Map<string, number>());
  let title = $state('');
  let busy = $state(false);
  let error = $state('');

  // A burst of realtime events (a stop-heavy Save, or the cascade a route delete fires across
  // itineraries/stops/votes) can start several `load()`s at once; they are not guaranteed to
  // resolve in the order they started. `loadSeq` marks each call's turn, and a call only writes
  // its answer — success or error — while it is still the latest one in flight, so a slower older
  // answer can never overwrite a faster newer one.
  let loadSeq = 0;
  async function load() {
    const seq = ++loadSeq;
    try {
      const [its, st, vs] = await Promise.all([
        pb.collection('itineraries').getFullList<Row>({ sort: '-created', expand: 'created_by' }),
        pb.collection('stops').getFullList<{ itinerary: string }>({ fields: 'itinerary' }),
        pb.collection('votes').getFullList<{ target_id: string }>({ filter: "target_collection = 'itineraries' && value = 'up'", fields: 'target_id' })
      ]);
      if (seq !== loadSeq) return;
      items = sortRoutes(its);
      stops = countBy(st.map((s) => s.itinerary));
      cheers = countBy(vs.map((v) => v.target_id));
      error = '';
    } catch { if (seq === loadSeq) error = copy.loadError; }
  }
  // Coalesces a burst of subscription events (many rows changing at once) into one reload instead
  // of one per event; `load()` itself still guards out-of-order answers if two reloads overlap.
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  function queueLoad() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => { reloadTimer = undefined; void load(); }, 200);
  }
  onMount(() => {
    void load();
    const offs = [subscribe('itineraries', '', queueLoad), subscribe('stops', '', queueLoad), subscribe('votes', '', queueLoad)];
    return () => { offs.forEach((off) => off()); clearTimeout(reloadTimer); };
  });

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

  const currentId = $derived(liveDay.itinerary?.id ?? null);
  const hrefFor = (it: Row) => (it.status === 'locked' && it.id === currentId ? '/route' : `/plan/${it.id}`);
  const subtitle = (it: Row) => `${copy.byBuilder} ${it.expand?.created_by?.name ?? '…'} · ${stops.get(it.id) ?? 0} ${copy.stopsShort} · 🍻 ${cheers.get(it.id) ?? 0}`;

  async function remove(it: Row) {
    error = '';
    try { if (await deleteRoute(it, currentId, liveDay.today)) await load(); }
    catch (err) { error = (err as Error).message || copy.genericError; }
  }
</script>

<h1>{label('planningPhase')}</h1>
<p class="intro">{copy.plannerIntro}</p>

<form class="new" onsubmit={create} aria-busy={busy}>
  <label for="title" class="sr">{copy.draftTitle}</label>
  <input id="title" bind:value={title} placeholder={copy.newRoutePlaceholder} maxlength="80" required data-testid="draft-title" disabled={busy} />
  <IconButton type="submit" icon="add" tone="primary" label={copy.newRoute} disabled={busy} testid="create-draft" size={48} />
</form>
{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if items.length === 0}<p>{copy.noDrafts}</p>{/if}
<Board heads={[copy.boardRoute, copy.boardStatus]} testid="route-board">
  {#each items as it, i (it.id)}
    <BoardRow index={i} href={hrefFor(it)} testid="route-link-{it.id}" title={it.title} subtitle={subtitle(it)} chip={routeChip(it, currentId)}>
      {#snippet actions()}
        {#if canEditSettings(it, $auth.user)}<IconButton icon="edit" size={36} label={copy.editRoute} onclick={() => goto(`/plan/${it.id}/edit`)} testid="edit-route-{it.id}" />{/if}
        {#if canDelete(it, $auth.user)}<IconButton icon="delete" tone="danger" size={36} label={copy.deleteRoute} onclick={() => void remove(it)} testid="delete-route-{it.id}" />{/if}
      {/snippet}
    </BoardRow>
  {/each}
</Board>

<style>
  .intro { color: #aaa; margin-top: 0; }
  .new { display: flex; gap: 8px; align-items: center; margin: 16px 0; }
  .new input { flex: 1; margin: 0; border-radius: 24px; }
  .sr { position: absolute; left: -9999px; }
</style>
