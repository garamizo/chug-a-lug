<script lang="ts">
  // Editing the stops. A draft is written as it is edited; The Route on the day is staged and saved
  // in one go, so the crew never sees a half-finished change.
  import { untrack } from 'svelte';
  import { clientClock } from '$lib/sim/clock.svelte';
  import { goto, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { auth } from '$lib/pb';
  import { api } from '$lib/api';
  import { copy } from '$lib/labels';
  import { canDelete, canEditSettings, canEditStops } from '$lib/permissions';
  import { draftFrom, loadDraft, watchDraft, type Draft } from '$lib/draft';
  import { deleteRoute } from '$lib/planList';
  import { cloneRoute } from '$lib/cloneRoute';
  import { liveDay } from '$lib/live/day.svelte';
  import { recordActions, type PlanActions } from '$lib/planActions';
  import { addStop, commitPayload, moveStop, newRecordId, removeStop, setAnchor, setDwell, setTitle, stagePlan, type StagedPlan, type StagedStop } from '$lib/live/staged';
  import { insertionIndex, plannerStations } from '$lib/lineMap';
  import { bulletinKind, bulletinText, planDiff, type BulletinKind, type PlanSnapshot } from '$lib/live/diff';
  import { previewPlan } from '$lib/live/preview';
  import { cohesionBlockers } from '$lib/live/cohesion';
  import { stopPhotos } from '$lib/photo';
  import ItineraryView from '$lib/components/ItineraryView.svelte';
  import BulletinSheet from '$lib/components/BulletinSheet.svelte';
  import StopSheet from '$lib/components/StopSheet.svelte';
  import { openStop } from '$lib/nav';
  import type { Leg, Line, Stop } from '$lib/types';
  import IconLink from '$lib/components/IconLink.svelte';
  import IconButton from '$lib/components/IconButton.svelte';

  let { data } = $props();
  let draft = $state<Draft | null>(null);
  let error = $state('');
  let saveError = $state('');
  let plan = $state<StagedPlan | null>(null);
  // The plan as it stood when the editor opened: what the Bulletin is diffed against (Task 14), and
  // what has to survive the trip to the venue picker along with the staged change itself.
  let before = $state<PlanSnapshot | null>(null);
  let previewRevision = $state<number | undefined>();
  let previewLegs = $state<Leg[]>([]);
  // Wait for an in-flight preview, but treat a failed check as a warning: the server validates Save.
  let previewPending = $state(false);
  let previewFailed = $state(false);
  let saving = $state(false);
  // The Bulletin drafted from `before` vs. the staged plan, waiting on the sheet: sent as-is,
  // edited, or skipped. Its id is minted once here so a retried save cannot post it twice.
  let pending = $state<{ id: string; text: string; kind: BulletinKind } | null>(null);
  // The name box renames on blur, asynchronously (a title-check round trip). Save and Clone both
  // read the staged/record title, so both have to wait for that check to land before they act on
  // it — otherwise a slow "taken" answer can lose a rename silently (Save commits the old name)
  // or Clone can copy the old name (see `askToTell` and `clone`). One tracker covers both: the
  // live editor's Save button only exists when `live`, Clone only when `!live`, so the two never
  // race each other. `renamedTitle` is the last title a tracked rename actually committed, so
  // Clone need not wait on `draft`'s realtime reload to see it.
  let renaming = $state<Promise<void> | null>(null);
  let renamedTitle = $state<string | null>(null);
  // `renaming` only covers the check while it is in flight — `trackRename`'s `finally` clears it
  // the moment the promise settles, success or refusal. A refused rename's error stays under the
  // box (`ItineraryView`'s `titleError`) long after that, so Save has to track the refusal
  // separately or a click landing after the error has already shown (not racing it) would find
  // `renaming` already null and sail through, publishing the stale staged title. Cleared on a
  // successful rename, or when the box tells us (via `renameCancelled`) that the Conductor backed
  // out of it — Escape, or a blur back to an empty/unchanged value.
  let renameRefused = $state(false);
  function trackRename(rename: (title: string) => Promise<void>): (title: string) => Promise<void> {
    return (title) => {
      const p = rename(title).then(() => { renamedTitle = title; });
      renaming = p;
      // A second observer of `p`, only to clear the tracker — its own rejection is not left
      // unhandled; the original `p` (returned below) still carries it for whoever awaits that.
      void p.catch(() => {}).finally(() => { if (renaming === p) renaming = null; });
      return p;
    };
  }
  /** The draft (non-live) screen's rename goes straight through `recordActions`; wrap it the same
   *  way so `clone()` can wait on it too. */
  function withTrackedRename(actions: PlanActions): PlanActions {
    return actions.rename ? { ...actions, rename: trackRename(actions.rename) } : actions;
  }

  const snapshot = (p: StagedPlan): PlanSnapshot => ({
    anchorStopId: p.anchorStopId,
    stops: p.stops.map((s) => ({ id: s.id, name: s.name, order: s.order, station_name: s.station_name, dwell_min: s.dwell_min }))
  });

  const live = $derived(!!draft && draft.itinerary.status === 'locked');
  // The sheet reads Stop records; a staged stop that is not saved yet borrows what it has.
  const sheetStops = $derived(!draft ? [] : live && plan
    ? plan.stops.map((s) => ({ ...(draft!.stops.find((d) => d.id === s.id) ?? {}), ...s }) as unknown as Stop)
    : draft.stops);
  const editable = $derived(!!draft && canEditStops(draft.itinerary, $auth.user));
  const canManage = $derived(!!draft && canEditSettings(draft.itinerary, $auth.user));

  async function load(first?: Promise<Draft>) {
    try {
      draft = await (first ?? loadDraft(data.id));
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

  // Arriving from Clone: the name box opens selected once; drop the flag so a reload does not. Read
  // per route, not per component: cloning from this editor reuses it for the new route's editor.
  let selectTitle = $state(false);
  $effect(() => {
    void data.id;
    untrack(() => {
      selectTitle = page.url.searchParams.get('named') === '1';
      // Dev builds throw here on a cold load, before the router starts; the flag then just stays.
      if (selectTitle) try { replaceState(page.url.pathname, {}); } catch { /* router not started */ }
    });
  });

  $effect(() => {
    draft = null; error = ''; saveError = ''; plan = null; before = null; previewLegs = [];
    renaming = null; renamedTitle = null; renameRefused = false; saveQueued = false;
    void load(draftFrom(data.early, data.id));
    // A staged edit must not be clobbered by the realtime reload, so on The Route only the first
    // load builds the plan (see `load`); the watcher keeps the draft path live as before.
    return watchDraft(data.id, () => void load());
  });

  // Re-plan whenever the staged plan changes, and once a minute so a plan that has quietly become
  // unrideable stops being savable. `previewLegs` is cleared the moment `plan` changes (not left
  // holding the previous plan's legs until the new response lands): `blockers` reads legs to find
  // an impossible one, and a removed stop's leg is simply absent from a stale list, so a stale
  // list under-reports blockers rather than over-reporting them. Every in-flight check gates Save.
  // Periodic checks keep the last good legs; a failure warns and leaves validation to the server.
  $effect(() => {
    const current = plan;
    const revision = clientClock.revision;
    previewRevision = undefined;
    previewLegs = [];
    if (!current || !draft) { previewPending = false; previewFailed = false; return; }
    let alive = true;
    let first = true;
    let request = 0;
    const run = () => {
      const id = ++request;
      previewPending = true;
      void previewPlan(current, data.id)
        .then((result) => { if (!alive || id !== request) return; if (clientClock.enabled && (revision !== clientClock.revision || result.clockRevision !== revision)) throw new Error(copy.simClockConflict); previewLegs = result.legs; previewRevision = result.clockRevision; previewFailed = false; })
        .catch(() => { if (!alive || id !== request) return; previewFailed = true; if (first) previewLegs = []; })
        .finally(() => { if (!alive || id !== request) return; previewPending = false; first = false; });
    };
    run();
    const timer = setInterval(run, 60_000);
    return () => { alive = false; clearInterval(timer); };
  });

  const blockers = $derived(plan && draft
    ? cohesionBlockers({
        eventDate: draft.itinerary.event_date, now: liveDay.realNow,
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
      // A rename in flight from the name box (its blur can land right before this click) has to
      // land before the plan is parked, or a slow "ok" answer only updates the departed editor's
      // state — see `renaming`'s comment. A refused rename leaves its error under the box and the
      // Conductor on this screen instead of the venue picker.
      void (async () => {
        if (renaming) { try { await renaming; } catch { return; } }
        park();
        await goto(`/plan/${data.id}/add?station=${encodeURIComponent(stationId)}&side=${side}&staged=1`);
      })();
    },
    get anchorStopId() { return plan?.anchorStopId ?? null; },
    setAnchor: (stopId) => { if (plan) plan = setAnchor(plan, stopId); },
    // Staged like the rest, but checked now so "taken" shows on blur, not at Save. Tracked so Save
    // can wait for it: see `renaming` above. `renameRefused` outlives `renaming` itself, so Save
    // stays blocked even once the tracker has cleared.
    rename: trackRename(async (title) => {
      // A fresh attempt supersedes whatever an earlier one left behind — cleared up front, not
      // just on success, so a retry starting is enough to let Save consider trying again once
      // this one settles (`renaming` alone keeps it disabled meanwhile).
      renameRefused = false;
      try {
        try { await api(`/api/plan/title-check?title=${encodeURIComponent(title)}&route=${data.id}`); }
        catch (err) { throw err instanceof TypeError ? new Error(copy.noSignal) : err; }
        if (plan) plan = setTitle(plan, title);
      } catch (err) {
        renameRefused = true;
        throw err;
      }
    }),
    // The box reverted the in-progress rename (Escape, or a blur back to the unchanged/empty
    // value) without committing it: any refusal it was showing no longer applies.
    renameCancelled: () => { renameRefused = false; }
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
  let saveQueued = $state(false);
  $effect(() => {
    if (!saveQueued || renaming) return;
    if (renameRefused) { saveQueued = false; return; }
    if (previewPending) return;
    saveQueued = false;
    void askToTell();
  });
  const simBlocked = $derived(clientClock.enabled && (!clientClock.synchronized || previewRevision !== clientClock.revision || previewFailed));
  async function askToTell() {
    // A rename in flight from the name box has to land — one way or the other — before Save reads
    // the title: waiting here (not just disabling the button) covers the blur-then-click race even
    // if the disabled attribute hasn't painted yet. A refused rename leaves its error under the
    // box; Save must not paper over it by committing and navigating away.
    // The button is only aria-disabled while a rename is in flight, not `disabled`: mousedown on it is what blurs the
    // box and starts the check, and a browser sends no click to a button that went disabled
    // between mousedown and mouseup. So the click lands here with the check still out; Save is
    // queued and runs (below) once the check has settled and the plan's fresh preview is back.
    // The same goes for the re-plan a staged title triggers: it can start between mousedown and
    // mouseup, so "waiting on a preview" is aria-disabled too and a click during it is queued.
    if (renaming || previewPending) { saveQueued = true; return; }
    // A rename refused earlier, whose error is still showing under the box, is not covered by
    // `renaming` any more (it cleared once the check settled) — see `renameRefused`'s comment.
    if (renameRefused) return;
    if (!plan || !before || blockers.length || simBlocked || saving || pending) return;
    const departAt = (stopId: string) => previewLegs.find((l) => l.from_stop === stopId)?.depart_at ?? null;
    const changes = planDiff(before, snapshot(plan), departAt);
    // The id is minted here, once, so a retried save cannot post the same Bulletin twice.
    pending = { id: newRecordId(), text: bulletinText(changes), kind: bulletinKind(changes) };
  }

  async function commit(bulletin: { id: string; kind: BulletinKind; body: string } | null) {
    if (!plan) return;
    pending = null; saving = true; saveError = '';
    try {
      await clientClock.ready();
      if (clientClock.enabled && (previewPending || previewFailed || previewRevision !== clientClock.revision)) throw new Error(copy.simClockConflict);
      const res = await api<{ ok: boolean; impossible: number }>('/api/plan/commit', {
        method: 'POST', json: { ...commitPayload(plan, data.id), bulletin, ...(clientClock.enabled ? { clockRevision: previewRevision } : {}) }
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

  // The Conductor's staged live editor never deletes mid-edit — that path is the view page's
  // `delete-route`, which always lands on `/plan` afterward, not this editor.
  const mayDelete = $derived(!!draft && canDelete(draft.itinerary, $auth.user) && !live);
  let cloning = $state(false);
  async function clone() {
    if (!draft) return;
    cloning = true; error = '';
    try {
      // Clicking Clone blurs the name box, which can start a rename; wait for it so the clone is
      // named after the title the Conductor actually landed on, not the one still on screen when
      // the click happened. A refused rename leaves its error under the box and the draft's own
      // title unchanged — either way `renamedTitle`/`draft.itinerary.title` is the right name.
      if (renaming) { try { await renaming; } catch { /* left visible in the title box */ } }
      const title = renamedTitle ?? draft.itinerary.title;
      const id = await cloneRoute({ id: draft.itinerary.id, title });
      await goto(`/plan/${id}/edit?named=1`);
    }
    catch (err) { error = (err as Error).message || copy.genericError; }
    finally { cloning = false; }
  }

  async function removeRoute() {
    if (!draft) return;
    error = '';
    try { if (await deleteRoute(draft.itinerary, liveDay.itinerary?.id ?? null, liveDay.today)) await goto('/plan'); }
    catch (err) { error = (err as Error).message || copy.genericError; }
  }
</script>

<nav class="bar">
  {#if draft}<IconLink href="/plan/{draft.itinerary.id}" icon="back" label={copy.doneEditing} testid="done-editing" />{:else}<IconLink href="/plan" icon="back" label={copy.backToPlanner} />{/if}
  <span class="sp"></span>
  {#if draft && !live && $auth.user}<IconButton icon="copy" label={copy.cloneRoute} onclick={() => void clone()} disabled={cloning} testid="clone-route" />{/if}
  {#if mayDelete}<IconButton icon="delete" tone="danger" label={copy.deleteRoute} onclick={() => void removeRoute()} testid="delete-route" />{/if}
</nav>
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
      itinerary={live && plan?.title !== undefined ? { ...draft.itinerary, title: plan.title } : draft.itinerary}
      stops={live && plan ? plan.stops : draft.stops}
      photos={live && plan ? stopPhotos(draft.stops) : undefined}
      legs={live ? previewLegs : draft.legs}
      {editable} {canManage} {selectTitle}
      actions={live ? stagedActions : withTrackedRename(recordActions(draft.itinerary.id, (m) => (error = m)))}
      onerror={(m) => (error = m)} onopenstop={openStop} />
    <!-- Over the editor, not away from it: the staged plan lives in this component. Edit details
         leaves the page, so only a draft (written as it goes) offers it. -->
    <StopSheet stops={sheetStops} media={[]} eventDate={draft.itinerary.event_date} itineraryId={draft.itinerary.id}
      isAdmin={editable} detailsLink={!live} detailsFrom="edit" />

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
        <button type="button" onclick={() => void askToTell()} disabled={!!blockers.length || simBlocked || saving || !!pending || renameRefused}
          aria-disabled={renaming || previewPending ? 'true' : undefined} data-testid="save-plan">
          {saving ? copy.saving : copy.savePlan}
        </button>
      </div>
      {#if pending}
        <BulletinSheet text={pending.text}
          onsend={(body) => commit({ id: pending!.id, kind: pending!.kind, body })}
          onskip={() => commit(null)} />
      {/if}
    {/if}
  {/if}
{/if}

<style>
  .bar { display: flex; gap: 8px; align-items: center; margin: 4px 0 8px; }
  .sp { flex: 1; }
  .warning { border: 1px solid #c0261c; border-left-width: 5px; border-radius: 10px; padding: 12px 14px; color: #ffd9d6; background: rgba(192,38,28,.12); }
  .savebar { position: sticky; bottom: 0; padding: 12px 0 20px; background: linear-gradient(to top, #111 70%, transparent); }
  .blockers { margin: 0 0 10px; padding-left: 20px; color: #ffb4ae; font-size: 14px; line-height: 1.5; }
</style>
