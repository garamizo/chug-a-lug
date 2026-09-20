<script lang="ts">
  import { onMount } from 'svelte';
  import { pb, auth, subscribe } from '$lib/pb';
  import { label } from '$lib/labels';
  import type { Vote } from '$lib/types';

  let { targetCollection, targetId }: { targetCollection: string; targetId: string } = $props();
  let votes = $state<Vote[]>([]);
  let busy = $state(false);
  const filter = $derived(pb.filter('target_collection = {:c} && target_id = {:t}', { c: targetCollection, t: targetId }));

  async function load() { try { votes = await pb.collection('votes').getFullList<Vote>({ filter }); } catch { /* keep last */ } }
  onMount(() => { void load(); return subscribe('votes', filter, load); });

  const mine = $derived(votes.find((v) => v.user === $auth.user?.id));
  const ups = $derived(votes.filter((v) => v.value === 'up').length);
  const downs = $derived(votes.filter((v) => v.value === 'down').length);

  async function cast(value: 'up' | 'down') {
    if (busy) return;
    busy = true;
    try {
      if (mine?.value === value) await pb.collection('votes').delete(mine.id);
      else if (mine) await pb.collection('votes').update(mine.id, { value });
      else await pb.collection('votes').create({ user: $auth.user?.id, target_collection: targetCollection, target_id: targetId, value });
      await load();
    } catch { /* realtime will resync */ }
    finally { busy = false; }
  }
</script>

<div class="votes">
  <button type="button" class="secondary" class:active={mine?.value === 'up'} aria-pressed={mine?.value === 'up'} onclick={() => cast('up')} disabled={busy} data-testid="vote-up">
    🍻 {label('like')} <span data-testid="vote-up-count">{ups}</span>
  </button>
  <button type="button" class="secondary" class:active={mine?.value === 'down'} aria-pressed={mine?.value === 'down'} onclick={() => cast('down')} disabled={busy} data-testid="vote-down">
    👎 {label('dislike')} <span data-testid="vote-down-count">{downs}</span>
  </button>
</div>

<style>
  .votes { display: flex; gap: 10px; margin: 20px 0; }
  .votes button { margin: 0; }
  .active { background: #ffb400; color: #111; border-color: #ffb400; }
</style>
