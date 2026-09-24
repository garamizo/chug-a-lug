<script lang="ts">
  import { copy, label } from '$lib/labels';
  import { fmtDateTime } from '$lib/time';
  import { mirrorSavedWhen } from '$lib/offline';
  import { auth } from '$lib/pb';
  import { liveDay } from '$lib/live/day.svelte';
  import { recordActions } from '$lib/planActions';
  import { openStop } from '$lib/nav';
  import ItineraryView from '$lib/components/ItineraryView.svelte';
  import StopSheet from '$lib/components/StopSheet.svelte';
</script>

<p><a href="/">← {copy.appTitle}</a></p>
{#if liveDay.fromMirror && liveDay.mirrorSavedAt}
  <p class="stale" data-testid="mirror-notice">{copy.showingMirror} {mirrorSavedWhen(liveDay.mirrorSavedAt, liveDay.wallNow)}.</p>
{/if}
{#if !liveDay.itinerary}
  <h1>{label('lockedItinerary')}</h1>
  <p data-testid="no-route">{copy.noRoute}</p>
  <p><a href="/plan">{copy.backToPlanner}</a></p>
{:else}
  <ItineraryView itinerary={liveDay.itinerary} stops={liveDay.stops} legs={liveDay.legs} editable={false} canManage={false} actions={recordActions(liveDay.itinerary.id, () => {})}
    onopenstop={liveDay.isToday ? openStop : undefined} />
  {#if liveDay.itinerary.locked_at}<p class="meta" data-testid="locked-on">{copy.lockedOn} {fmtDateTime(liveDay.itinerary.locked_at)}</p>{/if}
  {#if liveDay.isToday}<StopSheet stops={liveDay.stops} media={liveDay.feed.media} eventDate={liveDay.itinerary.event_date} itineraryId={liveDay.itinerary.id} isAdmin={!!$auth.user?.is_admin} />{/if}
{/if}

<style>
  .stale { margin: 12px 20px; padding: 10px 12px; border: 1px solid #555; border-radius: 9px; font-size: 13px; color: #cfcfcf; }
  .meta { color: #aaa; font-size: 14px; margin-top: 24px; }
</style>
