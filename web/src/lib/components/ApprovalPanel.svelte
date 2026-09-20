<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { pb, auth, subscribe } from '$lib/pb';
  import { copy, label } from '$lib/labels';
  import type { ApprovalVote, Itinerary, UserRecord } from '$lib/types';

  let { itinerary }: { itinerary: Itinerary } = $props();
  let votes = $state<ApprovalVote[]>([]);
  let users = $state<UserRecord[]>([]);
  let busy = $state(false);
  let error = $state('');
  const filter = $derived(pb.filter('itinerary = {:id}', { id: itinerary.id }));

  async function load() {
    try {
      [votes, users] = await Promise.all([
        pb.collection('approval_votes').getFullList<ApprovalVote>({ filter, expand: 'user' }),
        pb.collection('users').getFullList<UserRecord>({ sort: 'name' })
      ]);
    } catch { /* keep last */ }
  }
  onMount(() => { void load(); return subscribe('approval_votes', filter, load); });

  const isAdmin = $derived(!!$auth.user?.is_admin);
  const mine = $derived(votes.find((v) => v.user === $auth.user?.id));
  const names = (value: 'go' | 'nogo') => votes.filter((v) => v.value === value).map((v) => v.expand?.user?.name ?? '…');
  const pending = $derived(users.filter((u) => !votes.some((v) => v.user === u.id)).map((u) => u.name));
  const open = $derived(itinerary.status === 'draft' && itinerary.vote_open);

  // `skipReload` for the lock path: it navigates away, and reloading into an unmounted component
  // writes to state nobody reads any more (the `derived_inert` warning).
  async function run(fn: () => Promise<unknown>, skipReload = false) {
    if (busy) return;
    busy = true; error = '';
    try { await fn(); if (!skipReload) await load(); } catch (err) { error = (err as Error).message || copy.genericError; }
    finally { busy = false; }
  }
  const toggleVote = () => run(() => pb.collection('itineraries').update(itinerary.id, { vote_open: !itinerary.vote_open }));
  const cast = (value: 'go' | 'nogo') => run(() => mine
    ? pb.collection('approval_votes').update(mine.id, { value })
    : pb.collection('approval_votes').create({ itinerary: itinerary.id, user: $auth.user?.id, value }));
  const lock = () => {
    if (!confirm(copy.lockConfirm)) return;
    void run(async () => { await pb.collection('itineraries').update(itinerary.id, { status: 'locked' }); await goto('/route'); }, true);
  };
</script>

<section class="approval">
  <h2>{label('approvalVote')}</h2>
  <p>{copy.approvalIntro}</p>
  <p class="meta">{open ? copy.voteOpen : copy.voteClosed}</p>

  {#if open}
    <div class="row">
      <button type="button" class:active={mine?.value === 'go'} aria-pressed={mine?.value === 'go'} onclick={() => cast('go')} disabled={busy} data-testid="vote-go">✅ {copy.go}</button>
      <button type="button" class="secondary" class:active={mine?.value === 'nogo'} aria-pressed={mine?.value === 'nogo'} onclick={() => cast('nogo')} disabled={busy} data-testid="vote-nogo">🚫 {copy.nogo}</button>
    </div>
  {/if}

  {#if votes.length || open}
    <dl data-testid="tally">
      <dt>{copy.go}</dt><dd>{names('go').join(', ') || '—'}</dd>
      <dt>{copy.nogo}</dt><dd>{names('nogo').join(', ') || '—'}</dd>
      <dt>…</dt><dd>{pending.join(', ') || '—'}</dd>
    </dl>
  {/if}

  {#if isAdmin && itinerary.status === 'draft'}
    <div class="row">
      <button type="button" class="secondary" onclick={toggleVote} disabled={busy} data-testid={itinerary.vote_open ? 'close-vote' : 'open-vote'}>{itinerary.vote_open ? copy.closeVote : copy.openVote}</button>
      <button type="button" onclick={lock} disabled={busy} data-testid="lock-route">{copy.lockRoute}</button>
    </div>
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  .approval { margin-top: 32px; padding-top: 16px; border-top: 1px solid #444; }
  h2 { font-size: 18px; }
  .meta { color: #aaa; }
  .row { display: flex; gap: 10px; margin: 12px 0; }
  .row button { margin: 0; }
  .active { outline: 3px solid #fff; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; color: #ccc; }
  dt { font-weight: 700; }
  dd { margin: 0; }
</style>
