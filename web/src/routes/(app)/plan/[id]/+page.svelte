<script lang="ts">
  // The draft as the crew sees it: the route, cheers and comments, and the Highball. Changing the
  // stops happens on the edit screen.
  import { auth } from '$lib/pb';
  import { copy } from '$lib/labels';
  import { draftFrom, loadDraft, watchDraft, type Draft } from '$lib/draft';
  import { recordActions } from '$lib/planActions';
  import { liveDay } from '$lib/live/day.svelte';
  import { setCurrentRoute } from '$lib/live/route';
  import ItineraryView from '$lib/components/ItineraryView.svelte';
  import Votes from '$lib/components/Votes.svelte';
  import Comments from '$lib/components/Comments.svelte';
  import ApprovalPanel from '$lib/components/ApprovalPanel.svelte';
  import IconLink from '$lib/components/IconLink.svelte';

  let { data } = $props();
  let draft = $state<Draft | null>(null);
  let error = $state('');

  async function load(first?: Promise<Draft>) {
    try { draft = await (first ?? loadDraft(data.id)); } catch { error = copy.loadError; }
  }
  $effect(() => {
    // Clear the previous itinerary first so navigating between drafts never shows the old one's
    // stops and legs while the new one loads.
    draft = null; error = '';
    void load(draftFrom(data.early, data.id));
    return watchDraft(data.id, () => void load());
  });

  const isAdmin = $derived(!!$auth.user?.is_admin);
  const canEdit = $derived(!!draft && (draft.itinerary.status === 'draft' || isAdmin));

  // The Conductor chooses which locked route Live, The Route and photos follow. Every phone reloads
  // through its `crawl_settings` subscription; this one reloads now so the answer shows at once.
  let choosing = $state(false);
  async function makeCurrent(id: string) {
    choosing = true; error = '';
    try { await setCurrentRoute(id); await liveDay.loadRoute(); }
    catch { error = copy.noSignal; }
    finally { choosing = false; }
  }
</script>

<nav class="bar">
  <IconLink href="/plan" icon="back" label={copy.backToPlanner} />
  {#if draft && canEdit}<IconLink href="/plan/{draft.itinerary.id}/edit" icon="edit" label={copy.editDraft} testid="edit-draft" />{/if}
</nav>
{#if error}<p class="error" role="alert">{error}</p>{/if}
{#if draft}
  <ItineraryView itinerary={draft.itinerary} stops={draft.stops} legs={draft.legs} editable={false} canManage={false}
    actions={recordActions(draft.itinerary.id, (m) => (error = m))} />
  <Votes targetCollection="itineraries" targetId={draft.itinerary.id} />
  <Comments targetCollection="itineraries" targetId={draft.itinerary.id} />
  <ApprovalPanel itinerary={draft.itinerary} />
  {#if isAdmin && draft.itinerary.status === 'locked'}
    {#if liveDay.itinerary?.id === draft.itinerary.id}
      <p data-testid="current-route"><strong>{copy.currentRoute}</strong></p>
    {:else}
      <button type="button" data-testid="make-current" disabled={choosing} onclick={() => void makeCurrent(draft!.itinerary.id)}>{copy.makeCurrent}</button>
    {/if}
  {/if}
{/if}

<style>
  .bar { display: flex; justify-content: space-between; align-items: center; margin: 4px 0 8px; }
</style>
