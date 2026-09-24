<script lang="ts">
  import { copy, drinkIcons } from '$lib/labels';
  import { fmtTime } from '$lib/time';
  import { chatEntries } from '$lib/live/chat';
  import { liveDay } from '$lib/live/day.svelte';
  const entries = $derived(chatEntries(liveDay.feed.drinks, liveDay.bulletins));
  const error = $derived(liveDay.feedError ? copy.chatLoadError : '');
</script>
<section class="chat" data-testid="crew-chat">
  <h2>{copy.crewChat}</h2>
  {#if error}<p role="status">{error}</p>{/if}
  <div role="log" aria-label={copy.crewChat} aria-live="polite" aria-relevant="additions text">
    {#each entries as entry (entry.id)}
      <article class:bulletin={entry.kind === 'bulletin'}>
        <div class="meta"><strong>{entry.author}</strong><time datetime={entry.at}>{fmtTime(entry.at)}</time></div>
        {#if entry.kind === 'bulletin'}<p><span aria-hidden="true">📣</span> {entry.body}</p>
        {:else}<p><span aria-hidden="true">{drinkIcons[entry.kind] ?? '☕'}</span> {copy.chatAdded} {(copy as Record<string, string>)[`drink_${entry.kind}`] ?? copy.chatDrink}{#if entry.stop} · {entry.stop}{/if}</p>{/if}
      </article>
    {:else}<p class="empty">{copy.chatEmpty}</p>{/each}
  </div>
</section>
<style>
  .chat { padding: 16px 20px 28px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .09em; color: #aaa; }
  article { margin-top: 10px; border: 1px solid #39332a; background: #201c17; border-radius: 4px 16px 16px; padding: 11px 14px; }
  article.bulletin { border-color: #806329; background: #292113; }
  .meta { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; }
  time, .empty { color: #aaa; }
  p { margin: 6px 0 0; line-height: 1.45; overflow-wrap: anywhere; }
</style>
