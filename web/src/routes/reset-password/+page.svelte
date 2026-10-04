<script lang="ts">
  // Password spec §2.3. The token rides in the fragment: read once, then wiped from the address bar.
  import { afterNavigate, goto, replaceState } from '$app/navigation';
  import { ClientResponseError } from 'pocketbase';
  import { confirmPasswordReset, signInWithPassword } from '$lib/pb';
  import { passwordProblem, resetTokenEmail } from '$lib/password';
  import { copy } from '$lib/labels';
  import PasswordInput from '$lib/components/PasswordInput.svelte';
  // The fragment is read at component start (this app is client-only), where it cannot be missed:
  // SvelteKit's own first navigation throws on a fragment that will not decode, and then
  // afterNavigate never fires. A fragment that will not decode is a dead link; reload without it.
  let token = '', malformed = false;
  try { token = decodeURIComponent(location.hash.slice(1)); } catch { malformed = true; }
  const accountEmail = resetTokenEmail(token) ?? ''; // for the hidden username field; token is final here
  if (malformed) location.replace(location.pathname + location.search);
  let password = $state(''), error = $state(''), busy = $state(false);
  let phase = $state<'form' | 'dead' | 'set'>(token ? 'form' : 'dead');
  const message = (e: unknown) => e instanceof ClientResponseError ? e.response?.message || copy.genericError : copy.genericError;
  // afterNavigate, not onMount: it runs once the router is ready (also on the first load), and
  // replaceState throws or misbehaves before that.
  afterNavigate(() => { if (location.hash) replaceState(location.pathname, {}); });
  const submit = (ev: SubmitEvent) => { ev.preventDefault();
    const problem = passwordProblem(password);
    if (problem) { error = problem; return; }
    if (busy) return; busy = true; error = '';
    void (async () => {
      try { await confirmPasswordReset(token, password); }
      catch (e) {
        busy = false;
        // A field error (data.password) is about the password; anything else at 400 is the link.
        if (e instanceof ClientResponseError && e.status === 400 && !e.response?.data?.password) phase = 'dead';
        else error = message(e);
        return;
      }
      phase = 'set';
      const email = resetTokenEmail(token);
      if (!email) { busy = false; return; }
      try { await signInWithPassword(email, password); await goto('/', { replaceState: true }); }
      catch (e) { error = message(e); }
      finally { busy = false; }
    })();
  };
</script>

<h1>{copy.resetTitle}</h1>
{#if phase === 'dead'}
  <p data-testid="reset-dead">{copy.resetLinkDead}</p>
  <p><a href="/login/forgot">{copy.askNewLink}</a></p>
{:else if phase === 'set'}
  <p data-testid="password-set">{copy.passwordSetSignIn}</p>
  <p><a href="/login">{copy.signIn}</a></p>
{:else}
  <form onsubmit={submit} aria-busy={busy}>
    <input class="sr-only" type="email" autocomplete="username" readonly tabindex="-1" aria-hidden="true" value={accountEmail} />
    <label for="new-password">{copy.newPasswordField}</label>
    <PasswordInput id="new-password" autocomplete="new-password" bind:value={password} disabled={busy} testid="password-input" />
    <small class="hint">{copy.passwordHint}</small>
    <button type="submit" disabled={busy} data-testid="set-password">{busy ? copy.working : copy.setPassword}</button>
  </form>
{/if}
{#if error}<p class="error" role="alert" data-testid="error">{error}</p>{/if}

<style>
  /* Carries the account's email for the password manager only; never seen or focused. */
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
</style>
