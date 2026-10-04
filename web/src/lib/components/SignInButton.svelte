<script lang="ts">
  // The sign-in choices, drawn the way people expect them: Google's own button (its G mark on white,
  // per Google's branding guidelines) and an envelope for email. The words stay in labels.ts.
  import { ICONS } from '$lib/icons';
  let { provider, label, onclick, testid, disabled = false, type = 'button' }: {
    provider: 'google' | 'email'; label: string; onclick?: (e: MouseEvent) => void; testid?: string;
    disabled?: boolean; type?: 'button' | 'submit';
  } = $props();
</script>

<button {type} class="signin {provider}" {disabled} {onclick} data-testid={testid}>
  {#if provider === 'google'}
    <svg class="mark" viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  {:else}
    <svg class="mark envelope" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      {#each ICONS.mail as d}<path {d} />{/each}
    </svg>
  {/if}
  <span>{label}</span>
</button>

<style>
  .signin { display: flex; align-items: center; justify-content: center; gap: 12px; font-weight: 600; }
  .mark { flex: none; }
  /* Google's light button: white, #747775 outline, #1f1f1f text. */
  .google { background: #fff; color: #1f1f1f; border: 1px solid #747775; }
  .google:hover:not(:disabled) { background: #f2f2f2; }
  .email { background: #202020; color: #fff; border: 1px solid #666; }
  .email:hover:not(:disabled) { background: #2a2a2a; }
  .envelope { fill: none; stroke: var(--gold-soft, #ffce5c); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
</style>
