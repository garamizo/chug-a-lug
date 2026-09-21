<script lang="ts">
  // The draft as the crew sees it: the route, cheers and comments, and the Highball. Changing the
  // stops happens on the edit screen.
  import { auth } from '$lib/pb';
  import { copy } from '$lib/labels';
  import { loadDraft, watchDraft, type Draft } from '$lib/draft';
  import { recordActions } from '$lib/planActions';
  import ItineraryView from '$lib/components/ItineraryView.svelte';
  import Votes from '$lib/components/Votes.svelte';
  import Comments from '$lib/components/Comments.svelte';
  import ApprovalPanel from '$lib/components/ApprovalPanel.svelte';

  let { data } = $props();
  let draft = $state<Draft | null>(null);
  let error = $state('');

  async function load() {
    try { draft = await loadDraft(data.id); } catch { error = copy.loadError; }
  }
  $effect(() => {
    // Clear the previous itinerary first so navigating between drafts never shows the old one's
    // stops and legs while the new one loads.
    draft = null; error = '';
    void load();
    return watchDraft(data.id, load);
  });

  const isAdmin = $derived(!!$auth.user?.is_admin);
  const canEdit = $derived(!!draft && (draft.itinerary.status === 'draft' || isAdmin));
</script>

<p><a href="/plan">← {copy.backToPlanner}</a></p>
{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if draft}
  {#if canEdit}<p><a class="button" href="/plan/{draft.itinerary.id}/edit" data-testid="edit-draft">{copy.editDraft}</a></p>{/if}
  <ItineraryView itinerary={draft.itinerary} stops={draft.stops} legs={draft.legs} editable={false} canManage={false}
    actions={recordActions(draft.itinerary.id, (m) => (error = m))} />
  <Votes targetCollection="itineraries" targetId={draft.itinerary.id} />
  <Comments targetCollection="itineraries" targetId={draft.itinerary.id} />
  <ApprovalPanel itinerary={draft.itinerary} />
{/if}

<style>
  a.button { display: block; text-align: center; background: transparent; color: #ffce5c; border: 1px solid #555; font-weight: 700; padding: 12px; border-radius: 10px; text-decoration: none; min-height: 48px; }
</style>
