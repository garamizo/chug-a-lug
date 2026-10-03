<script lang="ts">
  // Cloudflare Turnstile, explicit render. No site key → no widget, and the server refuses the join.
  // A token is single-use: the page calls reset() after every submit, whatever the answer.
  import { env } from '$env/dynamic/public';
  let { ontoken }: { ontoken: (token: string) => void } = $props();
  let box: HTMLDivElement;
  let widget = '';
  type TurnstileApi = { render: (el: HTMLElement, o: Record<string, unknown>) => string; remove: (id: string) => void; reset: (id: string) => void };
  export function reset() {
    ontoken('');
    if (widget) (window as unknown as { turnstile?: TurnstileApi }).turnstile?.reset(widget);
  }
  $effect(() => {
    const sitekey = env.PUBLIC_TURNSTILE_SITE_KEY;
    if (!sitekey) return;
    let id = '', gone = false;
    const render = () => {
      const t = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (t && !gone) widget = id = t.render(box, { sitekey, callback: ontoken, 'expired-callback': () => ontoken('') });
    };
    if ((window as unknown as { turnstile?: TurnstileApi }).turnstile) render();
    else {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true; s.onload = render;
      document.head.appendChild(s);
    }
    return () => { gone = true; if (id) (window as unknown as { turnstile?: TurnstileApi }).turnstile?.remove(id); };
  });
</script>
<div bind:this={box} data-testid="turnstile"></div>
