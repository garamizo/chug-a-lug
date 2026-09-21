<script lang="ts">
  // Editing the stops. A draft is written as it is edited; The Route on the day is staged and saved
  // in one go, so the crew never sees a half-finished change.
  import { goto } from '$app/navigation';
  import { pb, auth } from '$lib/pb';
  import { api } from '$lib/api';
  import { copy } from '$lib/labels';
  import { loadDraft, watchDraft, type Draft } from '$lib/draft';
  import { recordActions, type PlanActions } from '$lib/planActions';
  import { addStop, commitPayload, moveStop, newRecordId, removeStop, setAnchor, setDwell, stagePlan, type StagedPlan, type StagedStop } from '$lib/live/staged';
  import { insertionIndex, plannerStations } from '$lib/lineMap';
  import { bulletinKind, bulletinText, planDiff, type BulletinKind, type PlanSnapshot } from '$lib/live/diff';
  import { previewPlan } from '$lib/live/preview';
  import { cohesionBlockers } from '$lib/live/cohesion';
  import { liveDay } from '$lib/live/day.svelte';
  import ItineraryView from '$lib/components/ItineraryView.svelte';
  import BulletinSheet from '$lib/components/BulletinSheet.svelte';
  import type { Leg, Line } from '$lib/types';

  let { data } = $props();
  let draft = $state<Draft | null>(null);
  let error = $state('');
  let saveError = $state('');
  let plan = $state<StagedPlan | null>(null);
  // The plan as it stood when the editor opened: what the Bulletin is diffed against (Task 14), and
  // what has to survive the trip to the venue picker along with the staged change itself.
  let before = $state<PlanSnapshot | null>(null);
  let previewLegs = $state<Leg[]>([]);
  // Wait for an in-flight preview, but treat a failed check as a warning: the server validates Save.
  let previewPending = $state(false);
  let previewFailed = $state(false);
  let saving = $state(false);
  // The Bulletin drafted from `before` vs. the staged plan, waiting on the sheet: sent as-is,
  // edited, or skipped. Its id is minted once here so a retried save cannot post it twice.
  let pending = $state<{ id: string; text: string; kind: BulletinKind } | null>(null);

  const snapshot = (p: StagedPlan): PlanSnapshot => ({
    anchorStopId: p.anchorStopId,
    stops: p.stops.map((s) => ({ id: s.id, name: s.name, order: s.order, station_name: s.station_name, dwell_min: s.dwell_min }))
  });

  const isAdmin = $derived(!!$auth.user?.is_admin);
  const live = $derived(!!draft && draft.itinerary.status === 'locked');
  const editable = $derived(!!draft && (draft.itinerary.status === 'draft' || isAdmin));
  const canManage = $derived(!!draft && (isAdmin || (draft.itinerary.created_by === $auth.user?.id && draft.itinerary.status === 'draft')));

  async function load() {
    try {
      draft = await loadDraft(data.id);
      // On The Route the staged plan is built once: from a plan parked before the add screen if
      // there is one, otherwise from the records. Later realtime reloads must not clobber an edit
      // in progress.
      if (draft.itinerary.status === 'locked' && !plan) {
        const parked = readParked();
        if (parked) { plan = parked.plan; before = parked.before; }
        else {
          // The shared live day owns the "newest check-in belonging to an admin" rule; force a
          // fresh read so the staged plan starts from where the Conductor actually is, not from
          // whatever `liveDay` happened to have loaded first.
          await liveDay.loadAnchor(data.id);
          plan = stagePlan(draft.stops, liveDay.anchor?.stopId ?? null);
          before = snapshot(plan);
        }
      }
    } catch { error = copy.loadError; }
  }

  const PARK_KEY = $derived(`chugalug.stagedPlan:${data.id}`);
  const PARK_MAX_AGE_MS = 60 * 60 * 1000;

  /**
   * Park the whole staged change right before leaving for the venue picker, and only then — not on
   * every edit. The picker round trip is the one navigation this component cannot survive on its
   * own, so parking is scoped exactly to it: nothing else should ever read this key back, or a plan
   * abandoned here (backed out of without saving, or made stale by someone else's edit) would keep
   * resurrecting itself on a later, unrelated visit — including after a 409 stale, where the
   * Conductor's only instruction is "reload and make the change again" and a resurrected plan would
   * just reproduce the same conflict forever.
   */
  function park() {
    if (!plan || !before) return;
    try { sessionStorage.setItem(PARK_KEY, JSON.stringify({ plan, before, parkedAt: Date.now() })); } catch { /* private mode */ }
  }
  /** Consumes the parked copy if there is one fresh enough to trust; an older one is discarded. */
  function readParked(): { plan: StagedPlan; before: PlanSnapshot } | null {
    try {
      const raw = sessionStorage.getItem(PARK_KEY);
      if (!raw) return null;
      sessionStorage.removeItem(PARK_KEY);
      const parked = JSON.parse(raw) as { plan: StagedPlan; before: PlanSnapshot; parkedAt?: number };
      if (!parked.plan?.stops?.length) return null;
      if (typeof parked.parkedAt !== 'number' || Date.now() - parked.parkedAt > PARK_MAX_AGE_MS) return null;
      return parked;
    } catch { return null; }
  }
  function clearParked() {
    try { sessionStorage.removeItem(PARK_KEY); } catch { /* private mode */ }
  }

  $effect(() => {
    draft = null; error = ''; saveError = ''; plan = null; before = null; previewLegs = [];
    void load();
    // A staged edit must not be clobbered by the realtime reload, so on The Route only the first
    // load builds the plan (see `load`); the watcher keeps the draft path live as before.
    return watchDraft(data.id, load);
  });

  // Re-plan whenever the staged plan changes, and once a minute so a plan that has quietly become
  // unrideable stops being savable. `previewLegs` is cleared the moment `plan` changes (not left
  // holding the previous plan's legs until the new response lands): `blockers` reads legs to find
  // an impossible one, and a removed stop's leg is simply absent from a stale list, so a stale
  // list under-reports blockers rather than over-reporting them. Every in-flight check gates Save.
  // Periodic checks keep the last good legs; a failure warns and leaves validation to the server.
  $effect(() => {
    const current = plan;
    previewLegs = [];
    if (!current || !draft) { previewPending = false; previewFailed = false; return; }
    let alive = true;
    let first = true;
    const run = () => {
      previewPending = true;
      void previewPlan(current, data.id)
        .then((legs) => { if (!alive) return; previewLegs = legs; previewFailed = false; })
        .catch(() => { if (!alive) return; previewFailed = true; if (first) previewLegs = []; })
        .finally(() => { if (!alive) return; previewPending = false; first = false; });
    };
    run();
    const timer = setInterval(run, 60_000);
    return () => { alive = false; clearInterval(timer); };
  });

  const blockers = $derived(plan && draft
    ? cohesionBlockers({
        eventDate: draft.itinerary.event_date, now: liveDay.now,
        stops: plan.stops.map((s) => ({ id: s.id, order: s.order, name: s.name })),
        legs: previewLegs.map((l) => ({ fromStopId: l.from_stop, toStopId: l.to_stop, kind: l.kind })),
        anchorStopId: plan.anchorStopId
      })
    : []);

  const stagedActions: PlanActions = {
    // No `setStartTime`: The Route's start time is fixed once the crew is riding it, and
    // `ItineraryView` only renders that control when `actions.setStartTime` is present.
    setDwell: (stopId, dwellMin) => { if (plan) plan = setDwell(plan, stopId, dwellMin); },
    move: (stopId, dir) => { if (plan) plan = moveStop(plan, stopId, dir); },
    remove: (stopId) => { if (plan) plan = removeStop(plan, stopId); },
    add: (stationId, side) => {
      park();
      void goto(`/plan/${data.id}/add?station=${encodeURIComponent(stationId)}&side=${side}&staged=1`);
    },
    get anchorStopId() { return plan?.anchorStopId ?? null; },
    setAnchor: (stopId) => { if (plan) plan = setAnchor(plan, stopId); }
  };

  // A venue picked on the add screen comes back through sessionStorage and slots into the staged
  // plan — not the database's — using the same rule the planner uses: going stops top to bottom,
  // then return stops bottom to top.
  $effect(() => {
    if (!plan || !draft) return;
    const key = `chugalug.stagedAdd:${data.id}`;
    let raw: string | null = null;
    try { raw = sessionStorage.getItem(key); if (raw) sessionStorage.removeItem(key); } catch { return; }
    if (!raw) return;
    let stop: Omit<StagedStop, 'id' | 'order' | 'isNew'>;
    try { stop = JSON.parse(raw); } catch { return; }
    const current = plan;
    void api<{ lines: Line[] }>(`/api/metra/stations?date=${encodeURIComponent(draft.itinerary.event_date)}`)
      .then(({ lines }) => {
        const at = insertionIndex(plannerStations(lines), current.stops, stop.station_id, stop.direction === 'back' ? 'back' : 'out');
        plan = addStop(current, stop, at);
      })
      .catch(() => { plan = addStop(current, stop, current.stops.length); });
  });

  /** The Save button: drafts the Bulletin from what actually changed and opens the sheet. The
   *  commit itself waits for the sheet's answer (sent, edited, or skipped) in `commit()`. */
  function askToTell() {
    if (!plan || !before || blockers.length || previewPending || saving || pending) return;
    const departAt = (stopId: string) => previewLegs.find((l) => l.from_stop === stopId)?.depart_at ?? null;
    const changes = planDiff(before, snapshot(plan), departAt);
    // The id is minted here, once, so a retried save cannot post the same Bulletin twice.
    pending = { id: newRecordId(), text: bulletinText(changes), kind: bulletinKind(changes) };
  }

  async function commit(bulletin: { id: string; kind: BulletinKind; body: string } | null) {
    if (!plan) return;
    pending = null; saving = true; saveError = '';
    try {
      const res = await api<{ ok: boolean; impossible: number }>('/api/plan/commit', {
        method: 'POST', json: { ...commitPayload(plan, data.id), bulletin }
      });
      // The write landed either way: a leftover park from an abandoned trip to the picker has no
      // reason to survive a save that superseded it.
      clearParked();
      if (res.impossible > 0) {
        // Saved, but a later leg has no train: stay on the editor so the Conductor can fix it and
        // save again, rather than navigating away as though this were a plain success.
        saveError = copy.savedButBroken;
        return;
      }
      await goto(`/plan/${data.id}`);
    } catch (err) {
      saveError = err instanceof TypeError ? copy.noSignal : (err as Error).message || copy.saveFailed;
      // The server may have posted this already, even if its response never reached us.
      // Reopen the edited Bulletin under the same id so retrying cannot announce it twice.
      if (bulletin) pending = { id: bulletin.id, kind: bulletin.kind, text: bulletin.body };
    } finally {
      saving = false;
    }
  }

  $effect(() => { if (draft && !editable) void goto(`/plan/${draft.itinerary.id}`, { replaceState: true }); });

  async function deleteDraft() {
    if (!draft || !confirm(copy.deleteDraftConfirm)) return;
    try { await pb.collection('itineraries').delete(draft.itinerary.id); await goto('/plan'); } catch (err) { error = (err as Error).message; }
  }
</script>

{#if draft}<p><a href="/plan/{draft.itinerary.id}" data-testid="done-editing">← {copy.doneEditing}</a></p>{:else}<p><a href="/plan">← {copy.backToPlanner}</a></p>{/if}
{#if error}<p class="error" role="alert">{error}</p>{/if}

{#if draft && editable}
  {#if live}
    <p class="warning" data-testid="live-route-warning">{copy.liveRouteWarning}</p>
  {/if}
  {#if live && !plan}
    <!-- `draft` (and so `live`) is set the moment the itinerary loads, but the staged plan needs a
         second, separate await (the anchor lookup) before it exists. Rendering the staged controls
         any earlier would wire "Set here"/"Remove" to a `plan` that is still null, so the click's
         `if (plan) ...` guard would silently discard the very first tap. -->
    <p>{copy.working}</p>
  {:else}
    <ItineraryView
      itinerary={draft.itinerary}
      stops={live && plan ? plan.stops : draft.stops}
      legs={live ? previewLegs : draft.legs}
      {editable} {canManage}
      actions={live ? stagedActions : recordActions(draft.itinerary.id, (m) => (error = m))}
      onerror={(m) => (error = m)} />

    {#if live}
      <div class="savebar">
        {#if saveError}<p class="error" role="alert">{saveError}</p>{/if}
        {#if previewPending}
          <p data-testid="preview-status">{copy.checkingRoute}</p>
        {:else if previewFailed}
          <p data-testid="preview-status" class="error">{copy.checkFailed}</p>
        {/if}
        {#if blockers.length}
          <ul class="blockers" data-testid="save-blockers">
            {#each blockers as blocker (blocker.message)}<li>{blocker.message}</li>{/each}
          </ul>
        {/if}
        <button type="button" onclick={askToTell} disabled={!!blockers.length || previewPending || saving || !!pending} data-testid="save-plan">
          {saving ? copy.saving : copy.savePlan}
        </button>
      </div>
      {#if pending}
        <BulletinSheet text={pending.text}
          onsend={(body) => commit({ id: pending!.id, kind: pending!.kind, body })}
          onskip={() => commit(null)} />
      {/if}
    {:else if canManage && draft.itinerary.status === 'draft'}
      <button type="button" class="secondary" onclick={deleteDraft} data-testid="delete-draft">{copy.deleteDraft}</button>
    {/if}
  {/if}
{/if}

<style>
  .warning { border: 1px solid #c0261c; border-left-width: 5px; border-radius: 10px; padding: 12px 14px; color: #ffd9d6; background: rgba(192,38,28,.12); }
  .savebar { position: sticky; bottom: 0; padding: 12px 0 20px; background: linear-gradient(to top, #111 70%, transparent); }
  .blockers { margin: 0 0 10px; padding-left: 20px; color: #ffb4ae; font-size: 14px; line-height: 1.5; }
</style>
