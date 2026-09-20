<script lang="ts">
  import { onMount } from 'svelte';
  import { pb, auth, subscribe } from '$lib/pb';
  import { copy } from '$lib/labels';
  import { fmtDateTime } from '$lib/time';
  import type { Comment } from '$lib/types';

  let { targetCollection, targetId }: { targetCollection: string; targetId: string } = $props();
  let comments = $state<Comment[]>([]);
  let body = $state('');
  let busy = $state(false);
  let error = $state('');
  const filter = $derived(pb.filter('target_collection = {:c} && target_id = {:t}', { c: targetCollection, t: targetId }));

  async function load() {
    try { comments = await pb.collection('comments').getFullList<Comment>({ filter, sort: 'created', expand: 'user' }); } catch { /* keep last */ }
  }
  onMount(() => { void load(); return subscribe('comments', filter, load); });

  async function post(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !body.trim()) return;
    busy = true; error = '';
    try {
      await pb.collection('comments').create({ user: $auth.user?.id, target_collection: targetCollection, target_id: targetId, body: body.trim() });
      body = '';
      await load();
    } catch (err) { error = (err as Error).message || copy.genericError; }
    finally { busy = false; }
  }
  async function remove(c: Comment) {
    try { await pb.collection('comments').delete(c.id); await load(); } catch (err) { error = (err as Error).message; }
  }
  const canDelete = (c: Comment) => c.user === $auth.user?.id || !!$auth.user?.is_admin;
</script>

<section data-testid="comments">
  <h2>{copy.comments}</h2>
  {#if comments.length === 0}<p>{copy.noComments}</p>{/if}
  <ul>
    {#each comments as c (c.id)}
      <li>
        <div class="who"><strong>{c.expand?.user?.name ?? '…'}</strong> <span>{fmtDateTime(c.created)}</span></div>
        <p>{c.body}</p>
        {#if canDelete(c)}<button type="button" class="link" onclick={() => remove(c)} data-testid="comment-delete-{c.id}">{copy.delete}</button>{/if}
      </li>
    {/each}
  </ul>
  <form onsubmit={post}>
    <label for="comment" class="sr">{copy.comments}</label>
    <input id="comment" bind:value={body} placeholder={copy.commentPlaceholder} maxlength="1000" data-testid="comment-input" disabled={busy} />
    <button type="submit" disabled={busy || !body.trim()} data-testid="comment-post">{copy.post}</button>
  </form>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
</section>

<style>
  h2 { font-size: 18px; margin-top: 28px; }
  ul { list-style: none; padding: 0; }
  li { border-top: 1px solid #333; padding: 12px 0; }
  .who span { color: #888; font-size: 13px; margin-left: 8px; }
  li p { margin: 4px 0; color: #ddd; }
  .link { background: none; color: #ffce5c; border: 0; padding: 0; width: auto; min-height: 0; font-size: 14px; text-decoration: underline; }
  .sr { position: absolute; left: -9999px; }
</style>
