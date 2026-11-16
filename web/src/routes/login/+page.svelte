<script lang="ts">
  import { goto } from '$app/navigation';
  import { env } from '$env/dynamic/public';
  import { ClientResponseError } from 'pocketbase';
  import { auth, rehearsalLogin, signInWithPassword } from '$lib/pb';
  import { authCopy, copy } from '$lib/labels';
  import AuthCard from '$lib/components/AuthCard.svelte';
  import PasswordInput from '$lib/components/PasswordInput.svelte';
  import { typedEmail } from '$lib/signInEmail';

  const rehearsal = env.PUBLIC_SIM === '1';
  let email = $state($typedEmail), name = $state(''), password = $state('');
  let error = $state(''), busy = $state(false);
  const title = $derived(rehearsal ? authCopy.approvedTitle : copy.loginTitle);
  $effect(() => { if ($auth.user) void goto('/', { replaceState: true }); });
  const message = (e: unknown) => e instanceof ClientResponseError ? e.response?.message || copy.genericError : copy.genericError;
  async function run(action: () => Promise<void>) {
    if (busy) return; error = ''; busy = true;
    try { await action(); } catch (e) { error = message(e); } finally { busy = false; }
  }
  const withPassword = (ev: SubmitEvent) => { ev.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { error = copy.emailError; return; }
    if (!password) { error = copy.passwordMissing; return; }
    void run(async () => {
      try { await signInWithPassword(email, password); }
      catch (e) { if (e instanceof ClientResponseError && e.status === 400) { error = copy.passwordMismatch; return; } throw e; }
    }); };
  const rehearse = (ev: SubmitEvent) => { ev.preventDefault();
    const n = name.trim().replace(/\s+/g, ' ');
    if (n.length < 2 || n.length > 32) { error = copy.nameError; return; }
    if (!password) { error = copy.passwordError; return; }
    void run(() => rehearsalLogin(n, password)); };
</script>

<AuthCard {title} {busy} focusTarget="password">
  {#if rehearsal}
    <p class="intro">{copy.rehearsalIntro}</p>
    <form onsubmit={rehearse} aria-busy={busy}>
      <div class="field"><label for="name">{copy.name}</label><input id="name" type="text" autocomplete="nickname" bind:value={name} data-testid="name-input" disabled={busy} /></div>
      <div class="field"><label for="password">{copy.password}</label><input id="password" type="password" autocomplete="current-password" bind:value={password} data-testid="password" disabled={busy} /></div>
      <button class="primary" type="submit" disabled={busy} data-testid="login">{busy ? copy.working : copy.login}</button>
    </form>
  {:else}
    <p class="intro">{copy.loginIntro}</p>
    <form onsubmit={withPassword} aria-busy={busy}>
      <div class="field"><label for="email">{copy.emailLabel}</label><input id="email" type="email" autocomplete="username" placeholder={copy.emailPlaceholder} bind:value={email} data-testid="email-input" disabled={busy} /></div>
      <div class="field">
        <div class="label-row"><label for="password">{copy.passwordField}</label><a class="text-button" href="/login/forgot" onclick={() => typedEmail.set(email.trim())} data-testid="forgot">{copy.forgotPassword}</a></div>
        <PasswordInput id="password" autocomplete="current-password" bind:value={password} disabled={busy} testid="password-input" />
      </div>
      <button class="primary" type="submit" disabled={busy} data-testid="password-sign-in">{busy ? copy.working : copy.signIn}<span aria-hidden="true">→</span></button>
    </form>
  {/if}
  {#if error}<p class="error" role="alert" data-testid="error">{error}</p>{/if}
  {#if !rehearsal}<div class="switch">{authCopy.needSeat}</div>{/if}
</AuthCard>
