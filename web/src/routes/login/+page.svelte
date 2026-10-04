<script lang="ts">
  import { goto } from '$app/navigation';
  import { env } from '$env/dynamic/public';
  import { ClientResponseError } from 'pocketbase';
  import { auth, pb, rehearsalLogin, requestCode, signInWithCode, signInWithPassword } from '$lib/pb';
  import { GOOGLE_KEY, buildAuthUrl } from '$lib/google';
  import { copy } from '$lib/labels';
  import SignInButton from '$lib/components/SignInButton.svelte';
  import PasswordInput from '$lib/components/PasswordInput.svelte';
  import { typedEmail } from '$lib/signInEmail';

  const rehearsal = env.PUBLIC_SIM === '1';
  const google = env.PUBLIC_GOOGLE_ENABLED === '1';
  let email = $state($typedEmail), code = $state(''), otpId = $state(''), name = $state(''), password = $state('');
  let error = $state(''), busy = $state(false);
  let mode = $state<'password' | 'code'>('password');
  $effect(() => { if ($auth.user) void goto('/', { replaceState: true }); });
  const message = (e: unknown) => e instanceof ClientResponseError ? e.response?.message || copy.genericError : copy.genericError;

  async function run(action: () => Promise<void>) {
    if (busy) return; error = ''; busy = true;
    try { await action(); } catch (e) { error = message(e); } finally { busy = false; }
  }
  const sendCode = (ev: SubmitEvent) => { ev.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { error = copy.emailError; return; }
    void run(async () => { otpId = await requestCode(email); }); };
  const withPassword = (ev: SubmitEvent) => { ev.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { error = copy.emailError; return; }
    if (!password) { error = copy.passwordMissing; return; }
    void run(async () => {
      try { await signInWithPassword(email, password); }
      catch (e) { if (e instanceof ClientResponseError && e.status === 400) { error = copy.passwordMismatch; return; } throw e; }
    }); };
  const toCode = () => { mode = 'code'; error = ''; };
  const toPassword = () => { mode = 'password'; otpId = ''; code = ''; error = ''; };
  const checkCode = (ev: SubmitEvent) => { ev.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) { error = copy.codeError; return; }
    void run(() => signInWithCode(otpId, code)); };
  const withGoogle = () => void run(async () => {
    pb.authStore.clear();
    const methods = await pb.collection('users').listAuthMethods();
    const p = methods.oauth2.providers.find((x) => x.name === 'google');
    if (!p) throw new Error('google');
    const redirectUrl = `${location.origin}/auth/google`;
    sessionStorage.setItem(GOOGLE_KEY, JSON.stringify({ mode: 'login', name: '', state: p.state, codeVerifier: p.codeVerifier, redirectUrl }));
    location.href = buildAuthUrl(p.authURL, redirectUrl);
  });
  const rehearse = (ev: SubmitEvent) => { ev.preventDefault();
    const n = name.trim().replace(/\s+/g, ' ');
    if (n.length < 2 || n.length > 32) { error = copy.nameError; return; }
    if (!password) { error = copy.passwordError; return; }
    void run(() => rehearsalLogin(n, password)); };
</script>

<h1>{copy.loginTitle}</h1>
{#if rehearsal}
  <p>{copy.rehearsalIntro}</p>
  <form onsubmit={rehearse} aria-busy={busy}>
    <label for="name">{copy.name}</label>
    <input id="name" type="text" autocomplete="nickname" bind:value={name} data-testid="name-input" disabled={busy} />
    <label for="password">{copy.password}</label>
    <input id="password" type="password" autocomplete="current-password" bind:value={password} data-testid="password" disabled={busy} />
    <button type="submit" disabled={busy} data-testid="login">{busy ? copy.working : copy.login}</button>
  </form>
{:else}
  <p>{google ? copy.loginIntro : copy.loginIntroNoGoogle}</p>
  {#if google}<SignInButton provider="google" label={copy.continueGoogle} onclick={withGoogle} disabled={busy} testid="google" /><p>{copy.orEmail}</p>{/if}
  {#if mode === 'password'}
    <form onsubmit={withPassword} aria-busy={busy}>
      <label for="email">{copy.emailLabel}</label>
      <input id="email" type="email" autocomplete="username" placeholder={copy.emailPlaceholder} bind:value={email} data-testid="email-input" disabled={busy} />
      <label for="password">{copy.passwordField}</label>
      <PasswordInput id="password" autocomplete="current-password" bind:value={password} disabled={busy} testid="password-input" />
      <SignInButton provider="email" type="submit" label={busy ? copy.working : copy.signIn} disabled={busy} testid="password-sign-in" />
    </form>
    <p class="hint"><a href="/login/forgot" onclick={() => typedEmail.set(email.trim())} data-testid="forgot">{copy.forgotPassword}</a> · <button type="button" class="link" onclick={toCode} data-testid="use-code">{copy.useCodeInstead}</button></p>
  {:else if !otpId}
    <form onsubmit={sendCode} aria-busy={busy}>
      <label for="email">{copy.emailLabel}</label>
      <input id="email" type="email" autocomplete="email" placeholder={copy.emailPlaceholder} bind:value={email} data-testid="email-input" disabled={busy} />
      <SignInButton provider="email" type="submit" label={busy ? copy.working : copy.emailMeCode} disabled={busy} testid="send-code" />
    </form>
    <p class="hint"><button type="button" class="link" onclick={toPassword} data-testid="use-password">{copy.usePasswordInstead}</button></p>
  {:else}
    <form onsubmit={checkCode} aria-busy={busy}>
      <p>{copy.codeSentTo} {email.trim().toLowerCase()}</p>
      <label for="code">{copy.codeLabel}</label>
      <input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" bind:value={code} data-testid="code-input" disabled={busy} />
      <button type="submit" disabled={busy} data-testid="sign-in">{busy ? copy.working : copy.signIn}</button>
      <p class="hint">{google ? copy.noCodeHint : copy.noCodeHintNoGoogle} <button type="button" class="link" onclick={() => { otpId = ''; code = ''; }}>{copy.sendAgain}</button></p>
    </form>
  {/if}
  <p><a href="/join" data-testid="to-join">{copy.newHereBoard}</a></p>
{/if}
{#if error}<p class="error" role="alert" data-testid="error">{error}</p>{/if}
