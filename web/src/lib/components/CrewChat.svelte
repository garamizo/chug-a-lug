<script lang="ts">
  // The crew's shared thread: Tab activity, Bulletins, photos, milestones and what people type.
  // Only Conductor Bulletins are ever pinned; a message is just a message.
  import { ClientResponseError } from 'pocketbase';
  import { SvelteSet } from 'svelte/reactivity';
  import { pb } from '$lib/pb';
  import { clientClock } from '$lib/sim/clock.svelte';
  import { copy, drinkIcons, labels } from '$lib/labels';
  import { fmtTime } from '$lib/time';
  import { chatEntries, reactionSummary, type ChatEntry } from '$lib/live/chat';
  import { liveDay } from '$lib/live/day.svelte';
  import { openLightbox } from '$lib/nav';
  import type { LightboxItem } from '$lib/types';

  let { itineraryId, userId }: { itineraryId: string; userId: string } = $props();
  let draft = $state(''), sending = $state(false), sendError = $state(''), shown = $state(40);
  const all = $derived(chatEntries(liveDay.feed.drinks, liveDay.bulletins, { messages: liveDay.feed.messages, media: liveDay.feed.media }));
  const entries = $derived(all.slice(-shown));
  const cheers = $derived(reactionSummary(liveDay.feed.reactions, userId));
  const photos = $derived(all.filter((e) => e.media));
  const viewer = $derived<LightboxItem[]>(photos.map((e) => ({ url: pb.files.getURL(e.media!, e.media!.file, { thumb: '1200x0' }), full: pb.files.getURL(e.media!, e.media!.file), kind: e.media!.kind, caption: e.author })));
  const error = $derived(sendError || (liveDay.feedError ? copy.chatLoadError : ''));

  // `cheers` (from `liveDay.feed.reactions`) is the only source of truth for who cheered what — no
  // local shadow of it. A rapid second tap on the same target before the feed has caught up with the
  // first is instead blocked outright: this tracks which targets have a create/delete plus its
  // following `loadFeed` still in flight, so the button disables itself and a stray click is a no-op
  // until the feed settles.
  const pending = new SvelteSet<string>();

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    sending = true; sendError = '';
    try {
      await clientClock.ready();
      await pb.collection('chat_messages').create({ itinerary: itineraryId, user: userId, body });
      draft = '';
      await liveDay.loadFeed();
    } catch { sendError = copy.noSignal; }
    finally { sending = false; }
  }

  async function toggle(entry: ChatEntry) {
    if (!entry.target) return;
    const key = `${entry.target.kind}:${entry.target.id}`;
    if (pending.has(key)) return;
    const mine = cheers.get(key)?.mine ?? null;
    pending.add(key);
    sendError = '';
    try {
      await clientClock.ready();
      if (mine) await pb.collection('reactions').delete(mine);
      else await pb.collection('reactions').create({ user: userId, target_kind: entry.target.kind, target_id: entry.target.id, itinerary: itineraryId });
    } catch (err) {
      // 400 on create: another tab already cheered this. 404 on delete: another tab already
      // uncheered it. Either way the reload below shows the true state, so neither is a real error.
      const known = err instanceof ClientResponseError && ((mine && err.status === 404) || (!mine && err.status === 400));
      if (!known) sendError = copy.noSignal;
    } finally {
      await liveDay.loadFeed();
      pending.delete(key);
    }
  }

  async function remove(entry: ChatEntry) {
    sendError = '';
    try { await pb.collection('chat_messages').delete(entry.target!.id); await liveDay.loadFeed(); }
    catch { sendError = copy.noSignal; }
  }
</script>

<section class="chat" data-testid="crew-chat">
  <h2>{copy.crewChat}</h2>
  {#if all.length > shown}<button type="button" class="more secondary" onclick={() => (shown += 40)} data-testid="chat-more">{copy.showEarlier}</button>{/if}
  <div role="log" aria-label={copy.crewChat} aria-live="polite" aria-relevant="additions text">
    {#each entries as entry (entry.id)}
      {@const key = entry.target ? `${entry.target.kind}:${entry.target.id}` : null}
      {@const c = key ? cheers.get(key) : undefined}
      <article class:bulletin={entry.kind === 'bulletin'} class:milestone={entry.kind === 'milestone'} class:mine={entry.userId === userId && entry.kind === 'message'}>
        <div class="meta"><strong>{entry.author}</strong><time datetime={entry.at}>{fmtTime(entry.at)}</time></div>
        {#if entry.kind === 'bulletin'}<p><span aria-hidden="true">📣</span> {entry.body}</p>
        {:else if entry.kind === 'message' || entry.kind === 'milestone'}<p>{entry.body}</p>
        {:else if entry.kind === 'photo' && entry.media}
          <p>{copy.chatPhoto}</p>
          <button type="button" class="photo" onclick={() => openLightbox(viewer, photos.findIndex((p) => p.id === entry.id))}>
            {#if entry.media.kind === 'image'}<img src={pb.files.getURL(entry.media, entry.media.file, { thumb: '400x300' })} alt="" width="160" height="120" loading="lazy" />{:else}<span class="video">▶</span>{/if}
          </button>
        {:else}<p><span aria-hidden="true">{drinkIcons[entry.kind] ?? '☕'}</span> {copy.chatAdded} {(copy as Record<string, string>)[`drink_${entry.kind}`] ?? copy.chatDrink}{#if entry.stop} · {entry.stop}{/if}</p>{/if}
        {#if entry.target}
          <div class="acts">
            <button type="button" class="cheers" class:on={!!c?.mine} aria-pressed={!!c?.mine} disabled={pending.has(key!)} onclick={() => void toggle(entry)}
              data-testid="cheers-{entry.id.replace(':', '-')}"><span aria-hidden="true">🍻</span> {labels.like}{#if c?.count} {c.count}{/if}</button>
            {#if entry.kind === 'message' && entry.userId === userId}<button type="button" class="del" onclick={() => void remove(entry)}>{copy.deleteMessage}</button>{/if}
          </div>
        {/if}
      </article>
    {:else}<p class="empty">{copy.chatEmpty}</p>{/each}
  </div>
  {#if error}<p role="status">{error}</p>{/if}
  <form class="composer" onsubmit={(e) => { e.preventDefault(); void send(); }}>
    <label class="sr" for="chat-input">{copy.messagePlaceholder}</label>
    <input id="chat-input" bind:value={draft} maxlength="280" placeholder={copy.messagePlaceholder} autocomplete="off" data-testid="chat-input" />
    <button type="submit" disabled={sending || !draft.trim()} data-testid="chat-send">{copy.sendMessage}</button>
  </form>
</section>

<style>
  .chat { padding: 16px 20px 28px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .09em; color: #aaa; }
  article { margin-top: 10px; border: 1px solid #39332a; background: #201c17; border-radius: 4px 16px 16px; padding: 11px 14px; }
  article.bulletin { border-color: #806329; background: #292113; }
  article.milestone { border-color: #4f6b3a; background: #1b2415; text-align: center; border-radius: 16px; }
  article.mine { border-radius: 16px 4px 16px 16px; background: #2a2418; margin-left: 32px; }
  .meta { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; }
  time, .empty { color: #aaa; }
  p { margin: 6px 0 0; line-height: 1.45; overflow-wrap: anywhere; }
  .acts { display: flex; gap: 8px; margin-top: 6px; }
  .acts button { width: auto; min-height: 32px; margin: 0; padding: 4px 10px; font-size: 13px; border-radius: 999px;
    background: transparent; border: 1px solid #4a4030; color: #cdb88a; font-weight: 600; }
  .cheers.on { background: #3a2e12; border-color: #ffb400; color: #ffce5c; }
  .cheers:disabled { opacity: .55; }
  .photo { width: auto; min-height: 0; margin: 6px 0 0; padding: 0; background: none; border: 0; }
  .photo img { border-radius: 10px; object-fit: cover; display: block; }
  .video { display: grid; place-items: center; width: 160px; height: 120px; background: #222; border-radius: 10px; color: #fff; }
  .composer { display: flex; gap: 8px; margin: 14px 0 0; position: sticky; bottom: calc(64px + env(safe-area-inset-bottom)); background: #111; padding-block: 8px; }
  .composer input { margin: 0; flex: 1; }
  .composer button { width: auto; margin: 0; }
  .more { width: auto; margin: 8px 0; }
  .sr { position: absolute; left: -9999px; }
</style>
