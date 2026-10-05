<script lang="ts">
  import { tick } from 'svelte';
  import { ClientResponseError } from 'pocketbase';
  import { requestPasswordReset } from '$lib/pb';
  import { typedEmail } from '$lib/signInEmail';
  import { authCopy, copy } from '$lib/labels';
  import AuthCard from '$lib/components/AuthCard.svelte';
  let email = $state($typedEmail), sent = $state(false), error = $state(''), busy = $state(false);
  const send = (ev: SubmitEvent) => { ev.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { error = copy.emailError; return; }
    if (busy) return; busy = true; error = '';
    requestPasswordReset(email).then(() => { sent = true; },
      (e) => { error = e instanceof ClientResponseError ? e.response?.message || copy.genericError : copy.genericError; })
      .finally(() => { busy = false; });
  };
  async function changeEmail() { sent = false; error = ''; await tick(); document.getElementById('email')?.focus(); }
</script>

<AuthCard title={sent ? authCopy.inboxTitle : copy.forgotTitle} icon={sent ? 'mail' : undefined}>
  {#if sent}
    <p class="intro" data-testid="link-sent">{copy.linkMaybeSent}</p>
    <p class="intro"><strong class="destination">{email.trim().toLowerCase()}</strong></p>
    <button type="button" class="text-button change" onclick={changeEmail} data-testid="change-email">{authCopy.changeEmail}</button>
    <p class="info">{authCopy.resetHint}</p>
  {:else}
    <p class="intro">{copy.forgotIntro}</p>
    <form onsubmit={send} aria-busy={busy}>
      <div class="field"><label for="email">{copy.emailLabel}</label><input id="email" type="email" autocomplete="email" placeholder={copy.emailPlaceholder} bind:value={email} data-testid="email-input" disabled={busy} /></div>
      <button type="submit" class="primary" disabled={busy} data-testid="send-link">{busy ? copy.working : copy.emailMeLink}</button>
    </form>
  {/if}
  {#if error}<p class="error" role="alert" data-testid="error">{error}</p>{/if}
  <a class="text-button back" href="/login" onclick={() => typedEmail.set(email.trim())}><span aria-hidden="true">←</span>{copy.backToSignIn}</a>
</AuthCard>
