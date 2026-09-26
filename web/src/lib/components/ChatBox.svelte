<script lang="ts">
  // The one composer: text, a tray of crawl emoji, gallery and camera pickers, and a round button
  // that is the camera until there is something to send. Pinned to the bottom of the page.
  import { tick } from 'svelte';
  import { copy } from '$lib/labels';
  import { CHAT_EMOJI, composerMode, draftAfterFailedSend, insertAt } from '$lib/chatBox';
  import IconButton from './IconButton.svelte';

  let { onsend, onfiles, busy = false, mediaOff, status, maxlength = 280, placeholder, inputTestid, sendTestid, fileTestid, cameraTestid }: {
    onsend: (text: string) => Promise<void>; onfiles?: (files: File[]) => Promise<void>; busy?: boolean;
    /** Why photos are off right now; attach and camera are hidden while set. */
    mediaOff?: string;
    /** A short note under the box while something is under way (e.g. an upload). */
    status?: string; maxlength?: number; placeholder: string;
    inputTestid: string; sendTestid: string; fileTestid?: string; cameraTestid?: string;
  } = $props();

  let text = $state(''), tray = $state(false);
  let input: HTMLInputElement | undefined = $state(), gallery: HTMLInputElement | undefined = $state(), camera: HTMLInputElement | undefined = $state();
  const media = $derived(!!onfiles && !mediaOff);
  const mode = $derived(composerMode(text, media));

  async function send() {
    const body = text.trim();
    if (!body) return;
    // WhatsApp style: the box empties at once and stays usable while the message is in flight.
    // Never clear it on completion — that would eat whatever was typed meanwhile. `onsend` throws
    // on failure, and the text comes back only into an empty box.
    text = '';
    try { await onsend(body); } catch { text = draftAfterFailedSend(text, body); }
  }
  async function pick(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length && onfiles) await onfiles(files);
  }
  async function addEmoji(e: string) {
    const start = input?.selectionStart ?? text.length, end = input?.selectionEnd ?? text.length;
    const next = insertAt(text, e, start, end);
    if (next.text.length > maxlength) return;
    text = next.text;
    await tick();
    input?.setSelectionRange(next.caret, next.caret);
  }
</script>

<form class="composer" onsubmit={(e) => { e.preventDefault(); void send(); }}>
  {#if tray}
    <div class="tray" role="group" aria-label={copy.emojiTray}>
      {#each CHAT_EMOJI as e (e)}<button type="button" class="emo" onclick={() => void addEmoji(e)}>{e}</button>{/each}
    </div>
  {/if}
  <div class="line">
    <div class="field">
      <IconButton icon={tray ? 'keyboard' : 'emoji'} size={34} label={tray ? copy.keyboard : copy.emojiTray} onclick={() => { tray = !tray; if (!tray) input?.focus(); }} expanded={tray} testid="emoji-toggle" />
      <label class="sr" for={inputTestid}>{placeholder}</label>
      <input id={inputTestid} bind:this={input} bind:value={text} {maxlength} {placeholder} autocomplete="off" data-testid={inputTestid} />
      {#if media}
        <IconButton icon="attach" size={34} label={copy.attachMedia} disabled={busy} onclick={() => gallery?.click()} testid="attach-media" />
        <input class="file" bind:this={gallery} type="file" accept="image/*,video/*" multiple disabled={busy}
          onchange={(e) => { void pick(e.currentTarget.files); e.currentTarget.value = ''; }} data-testid={fileTestid} />
        <input class="file" bind:this={camera} type="file" accept="image/*" capture="environment" disabled={busy}
          onchange={(e) => { void pick(e.currentTarget.files); e.currentTarget.value = ''; }} data-testid={cameraTestid} />
      {/if}
    </div>
    {#if mode === 'camera'}
      <IconButton icon="camera" tone="primary" size={48} label={copy.takePhoto} disabled={busy} onclick={() => camera?.click()} testid="camera-button" />
    {:else}
      <IconButton type="submit" icon="send" tone="primary" size={48} label={copy.sendMessage} disabled={!text.trim()} testid={sendTestid} />
    {/if}
  </div>
  {#if status}<p class="off" role="status">{status}</p>
  {:else if mediaOff && onfiles}<p class="off">{mediaOff}</p>{/if}
</form>

<style>
  .composer { position: sticky; bottom: 0; background: #111; padding: 8px 0; margin-top: 12px; z-index: 4; }
  /* The TabBar mounts on the event day and on a practice day's Live (see (app)/+layout.svelte);
     without it there is nothing to clear, so the composer sits flush with the viewport bottom. A
     practice day's footer banner is shorter, and stacks on top of the TabBar when both show. */
  :global(body:has(.tabbar)) .composer { bottom: calc(64px + env(safe-area-inset-bottom)); }
  :global(body:has(.practice-banner)) .composer { bottom: calc(24px + env(safe-area-inset-bottom)); }
  :global(body:has(.tabbar):has(.practice-banner)) .composer { bottom: calc(88px + env(safe-area-inset-bottom)); }
  .line { display: flex; gap: 8px; align-items: center; }
  .field { flex: 1; min-width: 0; display: flex; align-items: center; gap: 2px; background: #202020; border: 1px solid #444; border-radius: 24px; padding: 3px 4px; }
  .field :global(.icon) { border: 0; }
  .field input { flex: 1; min-width: 0; margin: 0; padding: 8px 4px; border: 0; background: transparent; font-size: 16px; }
  .field input:focus { outline: none; }
  .tray { display: flex; flex-wrap: wrap; gap: 4px; background: #1b1b1b; border: 1px solid #333; border-radius: 14px; padding: 6px; margin-bottom: 6px; }
  .emo { width: 40px; height: 40px; min-height: 0; margin: 0; padding: 0; font-size: 22px; background: transparent; border: 0; border-radius: 10px; }
  .emo:hover { background: #2a2a2a; }
  .file { display: none; }
  .off { margin: 4px 0 0; font-size: 12px; color: #888; text-align: center; }
  .sr { position: absolute; left: -9999px; }
</style>
