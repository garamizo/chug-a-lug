<script lang="ts">
  // A button that is only an icon. The words stay in labels.ts and become its accessible name.
  import { ICONS, type IconName } from '$lib/icons';
  let { icon, label, onclick, testid, tone = 'default', disabled = false, size = 44, type = 'button' }: {
    icon: IconName; label: string; onclick?: (e: MouseEvent) => void; testid?: string;
    tone?: 'default' | 'danger' | 'primary'; disabled?: boolean; size?: number; type?: 'button' | 'submit';
  } = $props();
</script>

<button {type} class="icon {tone}" style:--size="{size}px" aria-label={label} title={label} {disabled} {onclick} data-testid={testid}>
  <svg viewBox="0 0 24 24" width={Math.round(size / 2)} height={Math.round(size / 2)} aria-hidden="true">
    {#each ICONS[icon] as d}<path {d} />{/each}
  </svg>
</button>

<style>
  .icon { display: inline-grid; place-items: center; width: var(--size); height: var(--size); min-height: 0; margin: 0; padding: 0;
    border-radius: 50%; background: transparent; border: 1px solid #444; color: var(--gold-soft, #ffce5c); flex: none; }
  .icon:hover:not(:disabled) { background: #2a2a2a; }
  .icon:disabled { opacity: .4; }
  .danger { color: var(--danger, #ff8a80); border-color: #5a2a26; }
  .primary { background: var(--gold, #ffb400); color: #111; border-color: var(--gold, #ffb400); }
  .primary:hover:not(:disabled) { background: #ffc633; }
  svg { fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
</style>
