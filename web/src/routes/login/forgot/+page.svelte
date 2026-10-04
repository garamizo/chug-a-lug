<script lang="ts">
  // Password spec §2.2: the same answer whatever the address.
  import { ClientResponseError } from 'pocketbase';
  import { requestPasswordReset } from '$lib/pb';
  import { typedEmail } from '$lib/signInEmail';
  import { copy } from '$lib/labels';
  let email = $state($typedEmail), sent = $state(false), error = $state(''), busy = $state(false);
  const send = (ev: SubmitEvent) => { ev.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { error = copy.emailError; return; }
    if (busy) return; busy = true; error = '';
    requestPasswordReset(email).then(() => { sent = true; },
      (e) => { error = e instanceof ClientResponseError ? e.response?.message || copy.genericError : copy.genericError; })
      .finally(() => { busy = false; });
  };
</script>

<h1>{copy.forgotTitle}</h1>
{#if sent}
  <p data-testid="link-sent">{copy.linkMaybeSent}</p>
{:else}
  <p>{copy.forgotIntro}</p>
  <form onsubmit={send} aria-busy={busy}>
    <label for="email">{copy.emailLabel}</label>
    <input id="email" type="email" autocomplete="email" placeholder={copy.emailPlaceholder} bind:value={email} data-testid="email-input" disabled={busy} />
    <button type="submit" disabled={busy} data-testid="send-link">{busy ? copy.working : copy.emailMeLink}</button>
  </form>
{/if}
{#if error}<p class="error" role="alert" data-testid="error">{error}</p>{/if}
<p><a href="/login">{copy.backToSignIn}</a></p>
