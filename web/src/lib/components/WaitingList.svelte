<script lang="ts">
  import { boardingQueue, type WaitingRequest } from '$lib/live/boardingQueue.svelte';
  import { copy } from '$lib/labels';
  import { fmtDateTime } from '$lib/time';
  let { items, showLater = false }: { items: WaitingRequest[]; showLater?: boolean } = $props();
  let note = $state('');
  async function act(id: string, verdict: 'let-aboard' | 'turn-away') {
    const outcome = await boardingQueue.decide(id, verdict);
    note = outcome === 'answered' ? copy.alreadyAnswered : outcome === 'error' ? copy.noSignal : '';
  }
</script>
{#each items as r (r.id)}
  <div class="req" data-testid="boarding-request">
    <strong>{r.name}</strong> <span class="email">{r.email}</span>
    <small>{r.user_agent.slice(0, 40)} · {r.country || copy.none} · {fmtDateTime(r.created.replace(' ', 'T'))}</small>
    <div class="actions">
      <button type="button" onclick={() => void act(r.id, 'let-aboard')} data-testid="let-aboard">{copy.letAboard}</button>
      <button type="button" class="secondary" onclick={() => void act(r.id, 'turn-away')} data-testid="turn-away">{copy.turnAway}</button>
      {#if showLater}<button type="button" class="secondary" onclick={() => boardingQueue.later(r.id)} data-testid="later">{copy.later}</button>{/if}
    </div>
  </div>
{/each}
{#if note}<p role="status">{note}</p>{/if}
<style>
  .req { padding: 12px 0; border-bottom: 1px solid #2a2a2a; display: grid; gap: 4px; }
  .email { color: #bbb; word-break: break-all; }
  small { color: #9a9a9a; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .actions button { width: auto; flex: 1 1 auto; }
</style>
