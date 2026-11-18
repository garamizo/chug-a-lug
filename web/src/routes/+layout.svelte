<script lang="ts">
  import { clientClock } from '$lib/sim/clock.svelte';
  import { onMount, untrack } from 'svelte';
  import { page } from '$app/state';
  import { afterNavigate, beforeNavigate } from '$app/navigation';
  import { landing, safeSession } from '$lib/landing';
  import { sending } from '$lib/sends';
  import { shouldSwitch, watchUpdates, type UpdateWatcher } from '$lib/update';
  import { copy } from '$lib/labels';
  import { auth } from '$lib/pb';
  import AppMenu from '$lib/components/AppMenu.svelte';
  import SimulationStatus from '$lib/components/SimulationStatus.svelte';
  import { fetchAlerts, fetchStatus } from '$lib/live/feed';
  import { watchCreditDate } from '$lib/metraCredit';
  import { readSeen, unseenCount } from '$lib/live/seen';
  import { liveDay } from '$lib/live/day.svelte';
  import { ui } from '$lib/ui.svelte';
  let { children } = $props();
  // Empty in every real build; the update harness sets it to tell two builds apart.
  const BUILD_MARK = import.meta.env.VITE_BUILD_MARK ?? '';

  // Kept apart from the Bulletin count so a failed alerts read only zeroes its own half of the
  // dot: `unread` below stays live off `liveDay`'s own state either way.
  let alertsUnread = $state(0);
  // On a practice day a Bulletin interrupts only Live, so the dot leaves it out everywhere else.
  const bulletinUnread = $derived(liveDay.practice && page.url.pathname !== '/live' ? 0
    : liveDay.bulletins.filter((b) => !liveDay.isAcked(b.id)).length);
  const unread = $derived(alertsUnread + bulletinUnread);

  // The dot is best-effort: a failed alerts read simply leaves that half off.
  $effect(() => {
    if (!$auth.user || liveDay.practice) { alertsUnread = 0; return; }
    if (clientClock.enabled) { alertsUnread = unseenCount(liveDay.alerts, readSeen()); return; }
    const check = () => void fetchAlerts()
      .then((r) => { alertsUnread = unseenCount(r.alerts, readSeen()); })
      .catch(() => { alertsUnread = 0; });
    check();
    const timer = setInterval(check, 60_000);
    return () => clearInterval(timer);
  });
  // The Metra credit's date, one watcher per signed-in user. Keyed on the id, and started untracked
  // because `fetchStatus` reads the simulation clock's revision synchronously: token renewals, renames
  // and clock revisions must not restart it. Dispose clears the date at logout.
  let creditDate = $state('');
  const creditUser = $derived($auth.user?.id ?? '');
  $effect(() => {
    if (!creditUser) return;
    return untrack(() => watchCreditDate(fetchStatus, (d) => { creditDate = d; }));
  });
  // A waiting new version is taken up at the next in-app link tap (see $lib/update). Production only,
  // like the registration: dev and the e2e run never register a worker, so `watcher` stays null.
  let watcher: UpdateWatcher | null = null;
  let unmounted = false;
  onMount(() => {
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then((r) => {
        if (!unmounted) watcher = watchUpdates(navigator.serviceWorker, r, document);
      }).catch(() => {
        // Online use remains available when the browser declines offline storage.
      });
    }
    return () => { unmounted = true; watcher?.dispose(); watcher = null; };
  });
  // Any move inside the app means Home was asked for, not landed on (see (app)/+page.svelte).
  beforeNavigate(({ from }) => landing.noteNavigation(from?.url.pathname ?? null));
  // Registered after Landing's, so the state saved before the full load includes this move.
  const busy = () => sending() || ui.tabBusy;
  beforeNavigate(({ type, to, willUnload, cancel }) => {
    if (!watcher || type !== 'link') return;
    // A switch is already under way and will full-load the screen first tapped; later taps wait for it.
    if (watcher.switching) { cancel(); return; }
    if (!to || !shouldSwitch({ pending: watcher.pending, switching: false, type, sameOrigin: to.url.origin === location.origin,
      willUnload, busy: busy() })) return;
    // Cancel first: with nothing to wait for, `switchTo` loads before it returns.
    cancel();
    void watcher.switchTo(to.url.href, {
      isBusy: busy,
      load: (href, replace) => {
        landing.persist(safeSession());
        if (replace) location.replace(href); else location.assign(href);
      }
    });
  });
  // Only non-link moves complete during a switch (Back/Forward, a `goto`): load where they landed.
  afterNavigate(() => { if (watcher?.switching) watcher.supersede(location.href); });
</script>

<svelte:head>
  <title>{copy.appTitle}</title>
  <meta name="description" content={copy.appSubtitle} />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="apple-touch-icon" href="/icon-192.png" />
  {#if BUILD_MARK}<meta name="app-build" content={BUILD_MARK} />{/if}
</svelte:head>

<header class="top">
  <div class="col bar">
    <a href="/" class="brand"><img src="/logo.svg" alt="" width="40" height="40" /><span>{copy.appTitle}<SimulationStatus /></span></a>
    {#if $auth.user}
      <button type="button" class="secondary menu" aria-label={copy.menu} onclick={() => (ui.menuOpen = true)} data-testid="menu">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M4 7h16M4 12h16M4 17h16"></path>
        </svg>
        {#if unread}<span class="dot" data-testid="menu-dot"></span>{/if}
      </button>
    {/if}
  </div>
</header>
<AppMenu open={ui.menuOpen} {unread} onclose={() => (ui.menuOpen = false)} oncompose={() => (liveDay.composing = true)} />
<main class="col">{@render children()}</main>
<footer class="col credit" data-testid="metra-credit">{copy.notAffiliated}{#if creditDate}{' '}{copy.timetablePublished} {creditDate}.{/if}</footer>

<style>
  :global(:root) {
    color-scheme: dark;
    --gold: #ffb400; --gold-soft: #ffce5c; --gold-deep: #6b4c10; --metra: #29C233; --board-bg: #0b0b0b; --danger: #ff8a80;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  @keyframes -global-flip { from { transform: rotateX(90deg); opacity: 0; } to { transform: none; opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { :global(.flip) { animation: none !important; } }
  :global(*) { box-sizing: border-box; }
  :global(a) { color: #ffce5c; }
  :global(a:focus-visible), :global(button:focus-visible), :global(label:focus-within) { outline: 3px solid #fff; outline-offset: 3px; }
  :global(body) { margin: 0; font-family: system-ui, sans-serif; background: #111; color: #eee; }
  /* One readable column on every screen: fluid on phones, capped on desktop. */
  .col { width: 100%; max-width: 760px; margin: 0 auto; padding-inline: 10px; }
  @media (min-width: 720px) { .col { padding-inline: 24px; } }
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
  .credit { font-size: 12px; line-height: 1.5; color: #888; padding-block: 32px 16px; }
  :global(h1) { font-size: 30px; line-height: 1.2; }
  :global(p) { line-height: 1.6; color: #bbb; }
  :global(form) { margin: 24px 0; }
  :global(label) { display: block; margin-top: 20px; font-size: 15px; }
  :global(input), :global(button) { font: inherit; font-size: 18px; padding: 14px; width: 100%; margin-top: 8px; border-radius: 10px; }
  :global(input) { border: 1px solid #666; background: #202020; color: #fff; }
  :global(button) { background: #ffb400; color: #111; border: 0; font-weight: 700; cursor: pointer; min-height: 48px; }
  :global(button:disabled), :global(button[aria-disabled='true']) { opacity: .6; cursor: wait; }
  :global(button.secondary) { background: transparent; color: #ffce5c; border: 1px solid #555; }
  :global(button.link) { background: none; color: #ffce5c; border: 0; padding: 0; width: auto; min-height: 0; margin: 0;
    font-size: inherit; font-weight: inherit; text-decoration: underline; }
  :global(:focus-visible) { outline: 3px solid #fff; outline-offset: 3px; }
  :global(.error) { color: #ff9a9a; margin-top: 16px; }
</style>
