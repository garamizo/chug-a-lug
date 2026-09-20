<script lang="ts">
  import { onMount } from 'svelte';
  import { copy } from '$lib/labels';
  import { auth } from '$lib/pb';
  import AppMenu from '$lib/components/AppMenu.svelte';
  import { fetchAlerts } from '$lib/live/feed';
  import { readSeen, unseenCount } from '$lib/live/seen';
  let { children } = $props();

  let menuOpen = $state(false);
  let unread = $state(0);

  // The dot is best-effort: a failed alerts read simply leaves it off.
  $effect(() => {
    if (!$auth.user) { unread = 0; return; }
    const check = () => void fetchAlerts()
      .then((r) => { unread = unseenCount(r.alerts, readSeen()); })
      .catch(() => { unread = 0; });
    check();
    const timer = setInterval(check, 60_000);
    return () => clearInterval(timer);
  });
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

<header class="top">
  <div class="col bar">
    <a href="/" class="brand"><img src="/icon.svg" alt="" width="40" height="40" /><span>{copy.appTitle}</span></a>
    {#if $auth.user}
      <button type="button" class="secondary menu" aria-label={copy.menu} onclick={() => (menuOpen = true)} data-testid="menu">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16"></path>
        </svg>
        {#if unread}<span class="dot"></span>{/if}
      </button>
    {/if}
  </div>
</header>
<AppMenu open={menuOpen} {unread} onclose={() => (menuOpen = false)} />
<main class="col">{@render children()}</main>
<footer class="col">{copy.footer}</footer>

<style>
  :global(*) { box-sizing: border-box; }
  :global(body) { margin: 0; font-family: system-ui, sans-serif; background: #111; color: #eee; }
  /* One readable column on every screen: fluid on phones, capped on desktop. */
  .col { width: 100%; max-width: 760px; margin: 0 auto; padding-inline: 20px; }
  @media (min-width: 720px) { .col { padding-inline: 32px; } }
  .top { position: sticky; top: 0; z-index: 10; background: rgba(17, 17, 17, .94); backdrop-filter: blur(8px); border-bottom: 1px solid #2a2a2a; }
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 64px; padding-block: 8px; }
  .brand { display: flex; align-items: center; gap: 12px; font-weight: 750; color: inherit; text-decoration: none; min-width: 0; }
  .brand img { flex: none; }
  .brand span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .menu { flex: none; width: 44px; height: 44px; padding: 0; margin: 0; position: relative;
    display: flex; align-items: center; justify-content: center; }
  .dot { position: absolute; top: 5px; right: 5px; width: 9px; height: 9px; border-radius: 50%;
    background: #ffb400; border: 2px solid #111; }
  main { padding-block: 24px 0; }
  footer { color: #aaa; font-size: 13px; padding-block: 44px 24px; }
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
