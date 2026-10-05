<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  let { title, icon, children }: { title: string; icon?: 'mail' | 'clock' | 'check'; children: Snippet } = $props();
  let heading: HTMLHeadingElement;
  let initialized = false;
  $effect(() => {
    const current = title;
    if (initialized) void tick().then(() => { if (title === current) heading?.focus(); });
    initialized = true;
  });
</script>

<section class="auth-card" aria-labelledby="auth-title" data-testid="auth-card">
  {#if icon}
    <div class="state-icon" aria-hidden="true"><svg viewBox="0 0 24 24">
      {#if icon === 'mail'}<rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" />
      {:else if icon === 'clock'}<circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
      {:else}<path d="m5 12 4 4L19 6" />{/if}
    </svg></div>
  {/if}
  <h1 id="auth-title" tabindex="-1" bind:this={heading}>{title}</h1>
  {@render children()}
</section>

<style>
  .auth-card { max-width: 480px; margin: 24px auto 48px; background: #191919; border: 1px solid #343434; border-radius: 18px; padding: 32px; box-shadow: 0 20px 64px #0003; }
  h1 { margin: 0 0 12px; text-align: center; font-size: 28px; letter-spacing: -.7px; font-weight: 700; line-height: 1.2; scroll-margin-top: 90px; }
  h1:focus { outline: none; }
  .auth-card :global(.intro) { text-align: center; margin: 0 0 26px; color: #b5b5b5; font-size: 14px; line-height: 1.6; }
  .auth-card :global(.provider button) { min-height: 48px; height: 48px; margin: 0; border-radius: 8px; font-size: 15px; }
  .auth-card :global(.provider .mark) { width: 20px; height: 20px; }
  .auth-card :global(.divider) { display: flex; align-items: center; gap: 14px; margin: 22px 0; font-size: 12px; color: #aaa; }
  .auth-card :global(.divider)::before, .auth-card :global(.divider)::after { content: ''; height: 1px; flex: 1; background: #383838; }
  .auth-card :global(form) { margin: 0; }
  .auth-card :global(.field + .field) { margin-top: 18px; }
  .auth-card :global(label) { margin: 0; font-size: 13px; font-weight: 550; color: #e2e2e2; }
  .auth-card :global(input:not(.sr-only)) { display: block; width: 100%; min-height: 48px; margin: 8px 0 0; border: 1px solid #505050; border-radius: 8px; background: #121212; color: #f3f3f3; padding: 12px 14px; font-size: 16px; }
  .auth-card :global(input::placeholder) { color: #8e8e8e; }
  .auth-card :global(input:focus-visible) { outline: 2px solid var(--gold); outline-offset: 2px; }
  .auth-card :global(.label-row) { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .auth-card :global(button) { font-size: 14px; border-radius: 8px; }
  .auth-card :global(.text-button) { display: inline-flex; align-items: center; justify-content: center; width: auto; min-height: 36px; margin: 0; padding: 4px 0; background: transparent; color: var(--gold-soft); font-weight: 550; font-size: 13px; line-height: 1.4; text-decoration: none; }
  .auth-card :global(.text-button:hover) { text-decoration: underline; }
  .auth-card :global(.label-row .text-button) { margin-block: -9px; }
  .auth-card :global(.password) { position: relative; display: block; }
  .auth-card :global(.password input) { padding-right: 70px; }
  .auth-card :global(.password button) { position: absolute; inset: 1px 1px 1px auto; width: 62px; margin: 0; min-height: 0; padding: 0; background: transparent; color: #c7c7c7; font-size: 12px; font-weight: 550; text-decoration: none; }
  .auth-card :global(.field-hint) { display: block; margin: 6px 0 0; font-size: 12px; line-height: 1.5; color: #aaa; }
  .auth-card :global(.primary), .auth-card :global(.outline) { display: flex; align-items: center; justify-content: center; gap: 12px; width: 100%; min-height: 48px; margin: 22px 0 0; padding: 12px 16px; border-radius: 8px; font-size: 14px; font-weight: 650; line-height: 1.4; text-decoration: none; }
  .auth-card :global(.primary) { background: var(--gold); color: #161107; }
  .auth-card :global(.primary:hover:not(:disabled)) { background: #ffc333; }
  .auth-card :global(.primary span) { font-size: 18px; line-height: 1; }
  .auth-card :global(.outline) { border: 1px solid #565656; background: transparent; color: #ededed; margin-top: 12px; }
  .auth-card :global(.outline:hover:not(:disabled)) { background: #252525; }
  .auth-card :global(.next-hint) { font-size: 12px; text-align: center; line-height: 1.5; margin: 12px 0 0; color: #aaa; }
  .auth-card :global(.switch) { border-top: 1px solid #333; margin-top: 24px; padding-top: 16px; text-align: center; font-size: 13px; color: #b5b5b5; }
  .auth-card :global(.switch .text-button) { margin-left: 4px; }
  .state-icon { display: flex; align-items: center; justify-content: center; width: 52px; height: 52px; margin: 0 auto 22px; border-radius: 15px; background: #302719; border: 1px solid #685021; color: var(--gold-soft); }
  .state-icon svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .auth-card :global(.destination) { display: inline-block; margin-top: 4px; overflow-wrap: anywhere; color: #eee; font-weight: 550; }
  .auth-card :global(.change) { display: flex; margin: -18px auto 22px; }
  .auth-card :global(input.code-input) { text-align: center; letter-spacing: .4em; font-size: 24px; padding-left: calc(14px + .4em); font-variant-numeric: tabular-nums; }
  .auth-card :global(.resend) { font-size: 13px; text-align: center; margin: 22px 0 0; }
  .auth-card :global(.back) { display: flex; gap: 8px; margin: 18px auto 0; }
  .auth-card :global(.notice) { padding: 12px; margin: 16px 0 0; font-size: 13px; background: #162b21; border: 1px solid #31533e; border-radius: 8px; color: #bddfc4; }
  .auth-card :global(.info) { background: #232323; border: 1px solid #383838; padding: 16px; border-radius: 8px; font-size: 13px; line-height: 1.6; margin: 22px 0; }
  .auth-card :global(.error) { font-size: 14px; line-height: 1.6; }
  .auth-card :global(.steps) { list-style: none; padding: 0; margin: 24px 0; }
  .auth-card :global(.steps li) { display: flex; align-items: center; gap: 12px; position: relative; color: #aaa; font-size: 13px; min-height: 48px; }
  .auth-card :global(.steps li:not(:last-child))::after { content: ''; position: absolute; top: 37px; left: 13px; height: 22px; width: 1px; background: #4b4b4b; }
  .auth-card :global(.steps span) { display: flex; align-items: center; justify-content: center; flex: none; width: 28px; height: 28px; border-radius: 50%; border: 1px solid #555; font-size: 12px; background: #191919; }
  .auth-card :global(.steps .complete) { color: #bddfc4; }
  .auth-card :global(.steps .complete span) { background: #24372b; border-color: #416249; }
  .auth-card :global(.steps .current) { color: var(--gold-soft); font-weight: 550; }
  .auth-card :global(.steps .current span) { border-color: #947229; background: #302719; }
  @media (max-width: 479px) { .auth-card { margin-top: 0; padding: 26px 22px; border-radius: 14px; } h1 { font-size: 26px; } }
</style>
