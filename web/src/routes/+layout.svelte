<script lang="ts">
  import { onMount } from 'svelte';
  import { copy } from '$lib/labels';
  let { children } = $props();
  onMount(() => {
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Online use remains available when the browser declines offline storage.
      });
    }
  });
</script>

<svelte:head>
  <title>{copy.appTitle}</title>
  <meta name="description" content={copy.appSubtitle} />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="apple-touch-icon" href="/icon-192.png" />
</svelte:head>

<main class="wrap">
  <header><img src="/icon.svg" alt="" width="56" height="56" /><span>{copy.appTitle}</span></header>
  {@render children()}
  <footer>{copy.footer}</footer>
</main>

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; font-family: system-ui, sans-serif; background: #111; color: #eee; }
  .wrap { max-width: 480px; margin: 0 auto; padding: 24px 20px; }
  header { display: flex; align-items: center; gap: 12px; font-weight: 750; margin-bottom: 36px; }
  footer { color: #aaa; font-size: 13px; margin-top: 44px; }
  :global(h1) { font-size: 30px; line-height: 1.2; }
  :global(p) { line-height: 1.6; color: #bbb; }
  :global(form) { margin: 24px 0; }
  :global(label) { display: block; margin-top: 20px; font-size: 15px; }
  :global(input), :global(button) { font: inherit; font-size: 18px; padding: 14px; width: 100%; margin-top: 8px; border-radius: 10px; }
  :global(input) { border: 1px solid #666; background: #202020; color: #fff; }
  :global(button) { background: #ffb400; color: #111; border: 0; font-weight: 700; cursor: pointer; min-height: 48px; }
  :global(button:disabled) { opacity: .6; cursor: wait; }
  :global(button.secondary) { background: transparent; color: #ffce5c; border: 1px solid #555; }
  :global(:focus-visible) { outline: 3px solid #fff; outline-offset: 3px; }
  :global(.error) { color: #ff9a9a; margin-top: 16px; }
</style>
