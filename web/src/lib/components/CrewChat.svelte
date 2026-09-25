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
  import { milestones } from '$lib/live/milestones';
  import { liveDay } from '$lib/live/day.svelte';
  import { openLightbox } from '$lib/nav';
  import type { LightboxItem } from '$lib/types';

  let { itineraryId, userId }: { itineraryId: string; userId: string } = $props();
  let draft = $state(''), sending = $state(false), sendError = $state(''), shown = $state(40);
  const marks = $derived(milestones(liveDay.feed.drinks, liveDay.feed.media, liveDay.stops, liveDay.today));
  const all = $derived(chatEntries(liveDay.feed.drinks, liveDay.bulletins, { messages: liveDay.feed.messages, media: liveDay.feed.media, milestones: marks }));
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

  // Actions stay out of the way until asked for, WhatsApp style: press and hold a bubble (or
  // right-click it, or Enter on it from the keyboard) to open its menu.
  let menuFor = $state<string | null>(null);
  let hold: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null;
  const HOLD_MS = 450;
  function holdStart(e: PointerEvent, entry: ChatEntry) {
    if (!entry.target || (e.pointerType === 'mouse' && e.button !== 0)) return;
    holdCancel();
    hold = { timer: setTimeout(() => { hold = null; menuFor = entry.id; navigator.vibrate?.(15); }, HOLD_MS), x: e.clientX, y: e.clientY };
  }
  function holdMove(e: PointerEvent) {
    if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 10) holdCancel();
  }
  function holdCancel() { if (hold) clearTimeout(hold.timer); hold = null; }
  function closeMenu(e: PointerEvent) {
    if (menuFor && !(e.target instanceof Element && e.target.closest('.menu'))) menuFor = null;
  }

  // A stable colour per person, so names can be told apart at a glance.
  const NAME_COLOURS = ['#ff8a65', '#ffd54f', '#81c784', '#4fc3f7', '#ba68c8', '#f06292', '#4db6ac', '#aed581', '#9fa8da', '#ffb74d'];
  function nameColour(id: string): string {
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return NAME_COLOURS[Math.abs(h) % NAME_COLOURS.length];
  }

  async function remove(entry: ChatEntry) {
    sendError = '';
    try { await pb.collection('chat_messages').delete(entry.target!.id); await liveDay.loadFeed(); }
    catch { sendError = copy.noSignal; }
  }
</script>

<svelte:window onpointerdown={closeMenu} onkeydown={(e) => { if (e.key === 'Escape') menuFor = null; }} />

<section class="chat" data-testid="crew-chat">
  <h2>{copy.crewChat}</h2>
  {#if all.length > shown}<button type="button" class="more secondary" onclick={() => (shown += 40)} data-testid="chat-more">{copy.showEarlier}</button>{/if}
  <div class="log" role="log" aria-label={copy.crewChat} aria-live="polite" aria-relevant="additions text">
    {#each entries as entry (entry.id)}
      {@const key = entry.target ? `${entry.target.kind}:${entry.target.id}` : null}
      {@const c = key ? cheers.get(key) : undefined}
      {@const mine = entry.userId === userId && entry.kind !== 'milestone' && entry.kind !== 'bulletin'}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
      <article class:bulletin={entry.kind === 'bulletin'} class:milestone={entry.kind === 'milestone'} class:mine class:open={menuFor === entry.id}
        tabindex={entry.target ? 0 : undefined} title={entry.target ? copy.chatHoldHint : undefined}
        onpointerdown={(e) => holdStart(e, entry)} onpointermove={holdMove} onpointerup={holdCancel} onpointercancel={holdCancel} onpointerleave={holdCancel}
        oncontextmenu={(e) => { if (!entry.target) return; e.preventDefault(); holdCancel(); menuFor = entry.id; }}
        onkeydown={(e) => { if (entry.target && e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); menuFor = entry.id; } }}>
        {#if !mine && entry.kind !== 'milestone'}<strong class="who" style:color={nameColour(entry.userId || entry.author)}>{entry.author}</strong>{/if}
        {#if entry.kind === 'bulletin'}<p><span aria-hidden="true">📣</span> {entry.body}<span class="pad"></span></p>
        {:else if entry.kind === 'message' || entry.kind === 'milestone'}<p>{entry.body}<span class="pad"></span></p>
        {:else if entry.kind === 'photo' && entry.media}
          <button type="button" class="photo" aria-label={entry.media.kind === 'image' ? copy.openFreightPhoto : copy.openFreightVideo}
            onclick={() => openLightbox(viewer, photos.findIndex((p) => p.id === entry.id))}>
            {#if entry.media.kind === 'image'}<img src={pb.files.getURL(entry.media, entry.media.file, { thumb: '400x300' })} alt="" width="160" height="120" loading="lazy" draggable="false" />{:else}<span class="video">▶</span>{/if}
          </button>
          <p class="sr">{copy.chatPhoto}</p>
        {:else}<p><span aria-hidden="true">{drinkIcons[entry.kind] ?? '☕'}</span> {copy.chatAdded} {(copy as Record<string, string>)[`drink_${entry.kind}`] ?? copy.chatDrink}{#if entry.stop}{' · '}{entry.stop}{/if}<span class="pad"></span></p>{/if}
        <time datetime={entry.at}>{fmtTime(entry.at)}</time>
        {#if c?.count}<span class="react" class:on={!!c.mine} data-testid="chat-cheers"><span aria-hidden="true">🍻</span>{#if c.count > 1} {c.count}{:else}<span class="sr"> 1</span>{/if}</span>{/if}
        {#if menuFor === entry.id && entry.target}
          <div class="menu" data-testid="chat-menu">
            <button type="button" class="cheers" class:on={!!c?.mine} aria-pressed={!!c?.mine} disabled={pending.has(key!)}
              onclick={() => { menuFor = null; void toggle(entry); }}
              data-testid="cheers-{entry.id.replace(':', '-')}"><span aria-hidden="true">🍻</span> {labels.like}</button>
            {#if entry.kind === 'message' && entry.userId === userId}<button type="button" class="del" onclick={() => { menuFor = null; void remove(entry); }}>{copy.deleteMessage}</button>{/if}
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
  .chat { padding: 12px 0 28px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .09em; color: #aaa; margin: 0 0 6px; }
  .log { display: flex; flex-direction: column; gap: 3px; }
  article { position: relative; align-self: flex-start; max-width: 85%; min-width: 88px; padding: 4px 8px 5px;
    background: #22201c; border-radius: 3px 10px 10px 10px; font-size: 15px;
    -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; touch-action: manipulation; }
  article.mine { align-self: flex-end; background: #3a2f17; border-radius: 10px 3px 10px 10px; }
  article.bulletin { background: #3a2c0f; border: 1px solid #806329; }
  article.milestone { align-self: center; background: #1b2415; border-radius: 8px; text-align: center; font-size: 13px; color: #cfe3bf; }
  article.open { outline: 2px solid #ffb400; }
  article:has(.react) { margin-bottom: 12px; }
  .who { display: block; font-size: 13px; font-weight: 700; line-height: 1.3; }
  p { margin: 0; line-height: 1.35; color: #e8e2d6; overflow-wrap: anywhere; }
  /* Reserves room on the last line so the timestamp tucks into its bottom-right corner. */
  .pad { display: inline-block; width: 64px; }
  time { position: absolute; right: 8px; bottom: 3px; font-size: 11px; color: #9a927f; font-variant-numeric: tabular-nums; }
  .empty { color: #aaa; }
  .react { position: absolute; left: 8px; bottom: -13px; padding: 0 6px; border-radius: 999px; background: #2b2821; border: 1px solid #111;
    font-size: 12px; line-height: 20px; color: #ddd; }
  .react.on { background: #4a3a14; }
  .menu { position: absolute; z-index: 5; top: calc(100% + 4px); left: 0; display: flex; gap: 6px; padding: 6px; border-radius: 12px;
    background: #2b2821; border: 1px solid #4a4030; box-shadow: 0 6px 18px #000a; }
  .mine .menu { left: auto; right: 0; }
  .menu button { width: auto; min-height: 36px; margin: 0; padding: 4px 12px; font-size: 14px; border-radius: 999px; white-space: nowrap;
    background: transparent; border: 1px solid #4a4030; color: #cdb88a; font-weight: 600; }
  .cheers.on { background: #3a2e12; border-color: #ffb400; color: #ffce5c; }
  .cheers:disabled { opacity: .55; }
  .del { color: #ff9a9a !important; }
  .photo { display: block; width: auto; min-height: 0; margin: 2px 0 14px; padding: 0; background: none; border: 0; }
  .photo img { border-radius: 8px; object-fit: cover; display: block; -webkit-user-drag: none; }
  .video { display: grid; place-items: center; width: 160px; height: 120px; background: #222; border-radius: 8px; color: #fff; }
  .composer { display: flex; gap: 8px; margin: 14px 0 0; position: sticky; bottom: 0; background: #111; padding-block: 8px; }
  /* The TabBar only mounts on the event day (see (app)/+layout.svelte); without it there is nothing
     to clear, so the composer sits flush with the viewport bottom instead of leaving a phantom gap.
     A practice day's footer banner is shorter but needs the same clearance. */
  :global(body:has(.tabbar)) .composer { bottom: calc(64px + env(safe-area-inset-bottom)); }
  :global(body:has(.practice-banner)) .composer { bottom: calc(24px + env(safe-area-inset-bottom)); }
  .composer input { margin: 0; flex: 1; }
  .composer button { width: auto; margin: 0; }
  .more { width: auto; margin: 8px 0; }
  .sr { position: absolute; left: -9999px; }
</style>
