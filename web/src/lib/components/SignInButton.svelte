<script lang="ts">
  // The sign-in choices, drawn the way people expect them: Google's own button (its G mark on white in
  // Google Sans Medium, per Google's branding guidelines, which app verification requires) and an
  // envelope for email. The words stay in labels.ts.
  import { ICONS } from '$lib/icons';
  let { provider, label, onclick, testid, disabled = false, type = 'button' }: {
    provider: 'google' | 'email'; label: string; onclick?: (e: MouseEvent) => void; testid?: string;
    disabled?: boolean; type?: 'button' | 'submit';
  } = $props();
</script>

<button {type} class="signin {provider}" {disabled} {onclick} data-testid={testid}>
  {#if provider === 'google'}
    <!-- Cropped from Google's approved sign-in asset pack (signin-assets.zip, Light, @4x): never redraw it. -->
    <img class="mark" src="/google-g.png" width="24" height="24" alt="" />
  {:else}
    <svg class="mark envelope" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      {#each ICONS.mail as d}<path {d} />{/each}
    </svg>
  {/if}
  <span>{label}</span>
</button>

<style>
  /* Self-hosted (OFL, static/fonts/OFL-GoogleSans.txt) so the installed app has it offline. */
  @font-face { font-family: 'Google Sans'; font-style: normal; font-weight: 500; font-display: swap;
    src: url('/fonts/google-sans-500-latin.woff2') format('woff2'); }
  .signin { display: flex; align-items: center; justify-content: center; gap: 12px; font-weight: 600; }
  .mark { flex: none; }
  /* Google's light button: white, #747775 outline, #1f1f1f Google Sans Medium. Google's 40px button with a
     20px G and a 10px gap is scaled 1.2x to the app's 48px (24px G, 12px gap), which Google allows as long
     as the G keeps its aspect ratio. */
  .google { background: #fff; color: #1f1f1f; border: 1px solid #747775; font-family: 'Google Sans', system-ui, sans-serif; font-weight: 500; }
  .google:hover:not(:disabled) { background: #f2f2f2; }
  .email { background: #202020; color: #fff; border: 1px solid #666; }
  .email:hover:not(:disabled) { background: #2a2a2a; }
  .envelope { fill: none; stroke: var(--gold-soft, #ffce5c); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
</style>
