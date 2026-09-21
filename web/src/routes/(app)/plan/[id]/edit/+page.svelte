<script lang="ts">
  // Editing the stops: the map with its controls, the start time, and delete. No cheers,
  // comments or Highball here; those live on the draft's view screen.
  import { goto } from '$app/navigation';
  import { pb, auth } from '$lib/pb';
  import { copy } from '$lib/labels';
  import { loadDraft, watchDraft, type Draft } from '$lib/draft';
  import { recordActions } from '$lib/planActions';
  import ItineraryView from '$lib/components/ItineraryView.svelte';

  let { data } = $props();
  let draft = $state<Draft | null>(null);
  let error = $state('');

  async function load() {
    try { draft = await loadDraft(data.id); } catch { error = copy.loadError; }
  }
  $effect(() => {
    draft = null; error = '';
    void load();
    return watchDraft(data.id, load);
  });

  const isAdmin = $derived(!!$auth.user?.is_admin);
  const editable = $derived(!!draft && (draft.itinerary.status === 'draft' || isAdmin));
  // The creator manages their own draft; once it is locked or archived only the admin still can
  // (the PocketBase hook rejects a non-admin's edit of a non-draft itinerary).
  const canManage = $derived(!!draft && (isAdmin || (draft.itinerary.created_by === $auth.user?.id && draft.itinerary.status === 'draft')));
  // Nothing to edit here for this person: show the draft instead.
  $effect(() => { if (draft && !editable) void goto(`/plan/${draft.itinerary.id}`, { replaceState: true }); });

  async function deleteDraft() {
    if (!draft || !confirm(copy.deleteDraftConfirm)) return;
    try { await pb.collection('itineraries').delete(draft.itinerary.id); await goto('/plan'); } catch (err) { error = (err as Error).message; }
  }
</script>

{#if draft}<p><a href="/plan/{draft.itinerary.id}" data-testid="done-editing">← {copy.doneEditing}</a></p>{:else}<p><a href="/plan">← {copy.backToPlanner}</a></p>{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if draft && editable}
  <ItineraryView itinerary={draft.itinerary} stops={draft.stops} legs={draft.legs} {editable} {canManage}
    actions={recordActions(draft.itinerary.id, (m) => (error = m))} onerror={(m) => (error = m)} />
  {#if canManage && draft.itinerary.status === 'draft'}
    <button type="button" class="secondary" onclick={deleteDraft} data-testid="delete-draft">{copy.deleteDraft}</button>
  {/if}
{/if}
