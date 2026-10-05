<script lang="ts">
  import { env } from '$env/dynamic/public';
  import { onMount } from 'svelte';
  import { authCopy, copy } from '$lib/labels';
  let { ontoken, google = false }: { ontoken: (token: string) => void; google?: boolean } = $props();
  let box: HTMLDivElement;
  let checkState = $state<'checking' | 'ready' | 'error'>('checking');
  let expired = $state(false);
  type Api = { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void };
  const api = () => (window as unknown as { turnstile?: Api }).turnstile;
  let widget: string | null = null, script: HTMLScriptElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0, mounted = false;
  function dispose() {
    clearTimeout(timer);
    if (script) { script.onload = null; script.onerror = null; script.remove(); script = null; }
    if (widget !== null) { try { api()?.remove(widget); } catch { /* Already removed by the provider. */ } widget = null; }
  }
  // Remount instead of reusing an errored widget; also retries a failed script load.
  export function reset() {
    if (!mounted) return;
    const mine = ++generation;
    dispose(); ontoken(''); checkState = 'checking'; expired = false;
    const active = () => mounted && mine === generation;
    const fail = (wasExpired = false) => {
      if (!active()) return;
      clearTimeout(timer); ontoken(''); expired = wasExpired; checkState = 'error';
    };
    if (!env.PUBLIC_TURNSTILE_SITE_KEY) { fail(); return; }
    timer = setTimeout(() => fail(), 15_000);
    const render = () => {
      if (!active()) return;
      const provider = api();
      if (!provider) { fail(); return; }
      try {
        widget = provider.render(box, {
          sitekey: env.PUBLIC_TURNSTILE_SITE_KEY,
          size: window.matchMedia('(max-width: 379px)').matches ? 'compact' : 'normal',
          retry: 'never',
          callback: (token: string) => { if (active()) { clearTimeout(timer); checkState = 'ready'; ontoken(token); } },
          'error-callback': () => { fail(); return true; },
          'expired-callback': () => fail(true),
          'timeout-callback': () => fail(),
          // An interactive puzzle has its own timeout; don't cut it off after 15 seconds.
          'before-interactive-callback': () => { if (active()) clearTimeout(timer); }
        });
      } catch { fail(); }
    };
    if (api()) render();
    else {
      script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true; script.onload = render; script.onerror = () => fail();
      document.head.appendChild(script);
    }
  }
  onMount(() => {
    mounted = true; reset();
    return () => { mounted = false; generation++; dispose(); ontoken(''); };
  });
</script>

<div class="human-check">
  <div bind:this={box} data-testid="turnstile"></div>
  {#if checkState === 'checking'}<p class="field-hint" role="status">{copy.humanCheck}</p>
  {:else if checkState === 'error'}
    <div class="failure" role="alert" data-testid="human-check-error">
      <strong>{expired ? authCopy.checkExpired : authCopy.checkFailed}</strong>
      <p>{google ? authCopy.checkHelp : authCopy.checkHelpNoGoogle}</p>
      <button type="button" class="text-button" onclick={reset} data-testid="human-check-retry">{authCopy.retry}</button>
    </div>
  {/if}
</div>

<style>
  .human-check { margin-top: 18px; }
  .failure { border: 1px solid #855039; border-radius: 8px; padding: 14px; background: #30221d; font-size: 13px; color: #ffd0ba; }
  .failure p { font-size: 13px; margin: 6px 0; color: #e2beb0; }
</style>
