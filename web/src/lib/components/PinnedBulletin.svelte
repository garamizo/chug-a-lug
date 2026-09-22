<script lang="ts">
  // The Conductor's Bulletin, pinned on every screen until this person taps Got it.
  import { copy } from '$lib/labels';
  import { fmtTime } from '$lib/time';
  import type { Broadcast } from '$lib/types';
  let { bulletin, onack }: { bulletin: Broadcast; onack: () => void } = $props();
</script>

<aside class="pinned" data-testid="pinned-bulletin" role="status">
  <div class="head"><span>{copy.fromTheConductor}</span><span>{fmtTime(bulletin.at || bulletin.created)}</span></div>
  <p class="body">{bulletin.body}</p>
  <button type="button" onclick={onack} data-testid="bulletin-ack">{copy.gotIt}</button>
</aside>

<style>
  .pinned { margin: 12px 16px; padding: 14px 16px; border-radius: 12px; background: #ffb400; color: #111; }
  .head { display: flex; justify-content: space-between; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; font-weight: 700; }
  .body { margin: 6px 0 12px; color: #111; font-size: 16px; line-height: 1.45; font-weight: 600; }
  .pinned button { background: #111; color: #ffb400; margin: 0; }
</style>
