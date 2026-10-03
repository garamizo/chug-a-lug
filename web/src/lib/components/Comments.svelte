<script lang="ts">
  // The planner's chat: the same bubbles and chat box as Live, for a route or a single stop.
  import { onMount } from 'svelte';
  import { pb, auth, subscribe } from '$lib/pb';
  import { copy } from '$lib/labels';
  import { fmtDateTime } from '$lib/time';
  import { nameColour } from '$lib/chatColour';
  import { HoldMenu } from '$lib/live/holdMenu.svelte';
  import { compressForUpload, uploadBatch } from '$lib/live/upload';
  import { openLightbox } from '$lib/nav';
  import ChatBox from './ChatBox.svelte';
  import type { Comment, LightboxItem } from '$lib/types';

  let { targetCollection, targetId }: { targetCollection: string; targetId: string } = $props();
  let comments = $state<Comment[]>([]);
  // Only uploads lock the attach/camera buttons; text can always be sent.
  let uploading = $state(false), error = $state('');
  const me = $derived($auth.user?.id ?? '');
  const menu = new HoldMenu();
  const filter = $derived(pb.filter('target_collection = {:c} && target_id = {:t}', { c: targetCollection, t: targetId }));

  // Loads overlap (mount, realtime pings, the send's own refresh) and may finish out of order: a slow
  // early answer, often the empty first page, must not overwrite a newer one.
  let started = 0, applied = 0;
  async function load() {
    const mine = ++started;
    try {
      const list = await pb.collection('comments').getFullList<Comment>({ filter, sort: 'created', expand: 'user' });
      if (mine > applied) { applied = mine; comments = list; }
    } catch { /* keep last */ }
  }
  onMount(() => { void load(); return subscribe('comments', filter, load); });

  const base = () => ({ user: me, target_collection: targetCollection, target_id: targetId });
  // ChatBox has already emptied its box; throwing hands the text back to it.
  async function send(body: string) {
    error = '';
    try { await pb.collection('comments').create({ ...base(), body }); }
    catch (err) { error = (err as Error).message || copy.genericError; throw err; }
    await load();
  }
  async function files(list: File[]) {
    uploading = true; error = '';
    try {
      error = await uploadBatch(list, async (file) => {
        const prepared = await compressForUpload(file);
        const form = new FormData();
        for (const [k, v] of Object.entries(base())) form.set(k, v);
        form.set('file', prepared.file);
        await pb.collection('comments').create(form);
      }, load);
    } finally { uploading = false; }
  }
  async function remove(c: Comment) {
    menu.close();
    try { await pb.collection('comments').delete(c.id); await load(); } catch (err) { error = (err as Error).message || copy.genericError; }
  }
  // A note is the server's record of a clone or rename: only the admin may clear one away.
  const canDelete = (c: Comment) => c.kind ? !!$auth.user?.is_admin : c.user === me || !!$auth.user?.is_admin;
  const isVideo = (c: Comment) => /\.(mp4|mov|webm)$/i.test(c.file ?? '');
  const withFiles = $derived(comments.filter((c) => c.file));
  const viewer = $derived<LightboxItem[]>(withFiles.map((c) => ({ url: pb.files.getURL(c, c.file!, { thumb: '1200x0' }), full: pb.files.getURL(c, c.file!), kind: isVideo(c) ? 'video' : 'image', caption: c.expand?.user?.name ?? '' })));
</script>

<svelte:window onpointerdown={(e) => menu.closeOutside(e)} onkeydown={(e) => { if (e.key === 'Escape') menu.close(); }} />

<section class="chat" data-testid="comments">
  <h2>{copy.comments}</h2>
  <div class="log" role="log" aria-label={copy.comments} aria-live="polite">
    {#each comments as c (c.id)}
      {@const mine = c.user === me}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <article class:mine={mine && !c.kind} class:note={!!c.kind} class:open={menu.openFor === c.id} data-testid={c.kind ? `note-${c.kind}` : undefined} tabindex={canDelete(c) ? 0 : undefined}
        onpointerdown={(e) => { if (canDelete(c)) menu.start(e, c.id); }} onpointermove={(e) => menu.move(e)} onpointerup={() => menu.cancel()} onpointercancel={() => menu.cancel()} onpointerleave={() => menu.cancel()}
        oncontextmenu={(e) => { if (!canDelete(c)) return; e.preventDefault(); menu.open(c.id); }}
        onkeydown={(e) => { if (canDelete(c) && e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); menu.open(c.id); } }}>
        {#if c.kind}
          <p>
            <strong>{c.expand?.user?.name ?? '…'}</strong>
            {#if c.kind === 'renamed'}{copy.noteRenamedFrom} “{c.meta?.from}” {copy.noteRenamedTo} “{c.meta?.to}”
            {:else}{c.kind === 'cloned_from' ? copy.noteClonedFrom : copy.noteClonedTo} <a href="/plan/{c.meta?.route}">{c.meta?.title}</a>{/if}
          </p>
        {:else}
        {#if !mine}<strong class="who" style:color={nameColour(c.user)}>{c.expand?.user?.name ?? '…'}</strong>{/if}
        {#if c.file}
          <button type="button" class="photo" aria-label={isVideo(c) ? copy.openFreightVideo : copy.openFreightPhoto} data-testid="comment-photo-{c.id}"
            onclick={() => openLightbox(viewer, withFiles.findIndex((x) => x.id === c.id))}>
            {#if isVideo(c)}<span class="video">▶</span>{:else}<img src={pb.files.getURL(c, c.file, { thumb: '400x300' })} alt="" width="160" height="120" loading="lazy" draggable="false" />{/if}
          </button>
        {/if}
        {#if c.body}<p>{c.body}<span class="pad"></span></p>{/if}
        {/if}
        <time datetime={c.created}>{fmtDateTime(c.created)}</time>
        {#if menu.openFor === c.id}
          <div class="menu"><button type="button" class="del" onclick={() => void remove(c)} data-testid="comment-delete-{c.id}">{copy.deleteMessage}</button></div>
        {/if}
      </article>
    {:else}<p class="empty">{copy.noComments}</p>{/each}
  </div>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <ChatBox onsend={send} onfiles={files} busy={uploading} status={uploading ? copy.uploading : undefined} maxlength={1000} placeholder={copy.commentPlaceholder}
    inputTestid="comment-input" sendTestid="comment-post" fileTestid="comment-file" cameraTestid="comment-camera" />
</section>

<style>
  .chat { padding: 12px 0 28px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .09em; color: #aaa; margin: 0 0 6px; }
  .log { display: flex; flex-direction: column; gap: 3px; }
  article { position: relative; align-self: flex-start; max-width: 85%; min-width: 140px; padding: 4px 8px 5px;
    background: #22201c; border-radius: 3px 10px 10px 10px; font-size: 15px;
    -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; touch-action: manipulation; }
  article.mine { align-self: flex-end; background: #3a2f17; border-radius: 10px 3px 10px 10px; }
  article.open { outline: 2px solid #ffb400; }
  .who { display: block; font-size: 13px; font-weight: 700; line-height: 1.3; }
  p { margin: 0; line-height: 1.35; color: #e8e2d6; overflow-wrap: anywhere; }
  /* Reserves room on the last line so the timestamp tucks into its bottom-right corner. Planner
     chats span days, so the stamp carries the date and needs more room than Live's. */
  .pad { display: inline-block; width: 124px; }
  time { position: absolute; right: 8px; bottom: 3px; font-size: 11px; color: #9a927f; font-variant-numeric: tabular-nums; pointer-events: none; }
  .empty { color: #aaa; }
  article.note { align-self: center; max-width: 95%; background: transparent; border: 1px dashed #3a352b; border-radius: 10px; text-align: center; }
  article.note p { color: #b8ad96; font-size: 13px; }
  article.note a { color: #ffce5c; }
  article.note time { position: static; display: block; }
  .menu { position: absolute; z-index: 5; top: calc(100% + 4px); left: 0; display: flex; gap: 6px; padding: 6px; border-radius: 12px;
    background: #2b2821; border: 1px solid #4a4030; box-shadow: 0 6px 18px #000a; }
  .mine .menu { left: auto; right: 0; }
  .menu button { width: auto; min-height: 36px; margin: 0; padding: 4px 12px; font-size: 14px; border-radius: 999px; white-space: nowrap;
    background: transparent; border: 1px solid #4a4030; color: #cdb88a; font-weight: 600; }
  .del { color: #ff9a9a !important; }
  .photo { display: block; width: auto; min-height: 0; margin: 2px 0 14px; padding: 0; background: none; border: 0; }
  .photo img { border-radius: 8px; object-fit: cover; display: block; -webkit-user-drag: none; }
  .video { display: grid; place-items: center; width: 160px; height: 120px; background: #222; border-radius: 8px; color: #fff; }
</style>
