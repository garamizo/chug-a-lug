<script lang="ts">
  import { goto } from '$app/navigation';
  import { env } from '$env/dynamic/public';
  import { tick } from 'svelte';
  import { ClientResponseError } from 'pocketbase';
  import { auth, rehearsalLogin, requestCode, signInWithCode, signInWithPassword } from '$lib/pb';
  import { startGoogle } from '$lib/googleStart';
  import { authCopy, copy } from '$lib/labels';
  import AuthCard from '$lib/components/AuthCard.svelte';
  import SignInButton from '$lib/components/SignInButton.svelte';
  import PasswordInput from '$lib/components/PasswordInput.svelte';
  import { typedEmail } from '$lib/signInEmail';

  const rehearsal = env.PUBLIC_SIM === '1';
  const google = env.PUBLIC_GOOGLE_ENABLED === '1';
  let email = $state($typedEmail), code = $state(''), otpId = $state(''), name = $state(''), password = $state('');
  let error = $state(''), notice = $state(''), busy = $state(false);
  let mode = $state<'password' | 'code'>('password');
  const title = $derived(rehearsal ? authCopy.approvedTitle : otpId ? authCopy.codeTitle : mode === 'code' ? authCopy.codeRequestTitle : copy.loginTitle);
  $effect(() => { if ($auth.user) void goto('/', { replaceState: true }); });
  const message = (e: unknown) => e instanceof ClientResponseError ? e.response?.message || copy.genericError : copy.genericError;
  async function focus(id: string) { await tick(); document.getElementById(id)?.focus(); }
  async function run(action: () => Promise<void>) {
    if (busy) return; error = ''; notice = ''; busy = true;
    try { await action(); } catch (e) { error = message(e); } finally { busy = false; }
  }
  function sendCode(resend = false) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { error = copy.emailError; void focus('email'); return; }
    return run(async () => {
      otpId = await requestCode(email); code = '';
      if (resend) notice = authCopy.resent;
    });
  }
  const withPassword = (ev: SubmitEvent) => { ev.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { error = copy.emailError; return; }
    if (!password) { error = copy.passwordMissing; return; }
    void run(async () => {
      try { await signInWithPassword(email, password); }
      catch (e) { if (e instanceof ClientResponseError && e.status === 400) { error = copy.passwordMismatch; return; } throw e; }
    }); };
  function toCode() {
    if (busy) return;
    mode = 'code'; error = ''; notice = '';
    if (email.trim()) void sendCode();
  }
  function toPassword() {
    if (busy) return;
    mode = 'password'; otpId = ''; code = ''; error = ''; notice = '';
  }
  function changeEmail() {
    if (busy) return;
    otpId = ''; code = ''; error = ''; notice = '';
  }
  const checkCode = (ev: SubmitEvent) => { ev.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) { error = copy.codeError; return; }
    void run(() => signInWithCode(otpId, code)); };
  const withGoogle = () => void run(() => startGoogle('login'));
  const rehearse = (ev: SubmitEvent) => { ev.preventDefault();
    const n = name.trim().replace(/\s+/g, ' ');
    if (n.length < 2 || n.length > 32) { error = copy.nameError; return; }
    if (!password) { error = copy.passwordError; return; }
    void run(() => rehearsalLogin(n, password)); };
</script>

<AuthCard {title} {busy} focusTarget={otpId ? 'code' : mode === 'code' ? 'email' : 'password'} icon={otpId ? 'mail' : undefined}>
  {#if rehearsal}
    <p class="intro">{copy.rehearsalIntro}</p>
    <form onsubmit={rehearse} aria-busy={busy}>
      <div class="field"><label for="name">{copy.name}</label><input id="name" type="text" autocomplete="nickname" bind:value={name} data-testid="name-input" disabled={busy} /></div>
      <div class="field"><label for="password">{copy.password}</label><input id="password" type="password" autocomplete="current-password" bind:value={password} data-testid="password" disabled={busy} /></div>
      <button class="primary" type="submit" disabled={busy} data-testid="login">{busy ? copy.working : copy.login}</button>
    </form>
  {:else if otpId}
    <p class="intro">{authCopy.codeIntro}<br /><strong class="destination">{email.trim().toLowerCase()}</strong></p>
    <button type="button" class="text-button change" onclick={changeEmail} disabled={busy} data-testid="change-email">{authCopy.changeEmail}</button>
    <form onsubmit={checkCode} aria-busy={busy}>
      <div class="field"><label for="code">{copy.codeLabel}</label><input id="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" bind:value={code} data-testid="code-input" disabled={busy} /></div>
      <button class="primary" type="submit" disabled={busy} data-testid="sign-in">{busy ? copy.working : copy.signIn}<span aria-hidden="true">→</span></button>
    </form>
    <p class="resend">{google ? copy.noCodeHint : copy.noCodeHintNoGoogle}<br /><button type="button" class="text-button" onclick={() => void sendCode(true)} disabled={busy} data-testid="resend-code">{copy.sendAgain}</button></p>
    {#if notice}<p class="notice" role="status">{notice}</p>{/if}
    {#if google}<div class="provider"><SignInButton provider="google" label={copy.continueGoogle} onclick={withGoogle} disabled={busy} testid="google" /></div>{/if}
    <button type="button" class="text-button back" onclick={toPassword} disabled={busy} data-testid="use-password"><span aria-hidden="true">←</span>{copy.usePasswordInstead}</button>
  {:else}
    <p class="intro">{mode === 'code' ? authCopy.codeRequestIntro : copy.loginIntro}</p>
    {#if google}<div class="provider"><SignInButton provider="google" label={copy.continueGoogle} onclick={withGoogle} disabled={busy} testid="google" /></div><div class="divider"><span>{copy.orEmail}</span></div>{/if}
    {#if mode === 'password'}
      <form onsubmit={withPassword} aria-busy={busy}>
        <div class="field"><label for="email">{copy.emailLabel}</label><input id="email" type="email" autocomplete="username" placeholder={copy.emailPlaceholder} bind:value={email} data-testid="email-input" disabled={busy} /></div>
        <div class="field">
          <div class="label-row"><label for="password">{copy.passwordField}</label><a class="text-button" href="/login/forgot" onclick={() => typedEmail.set(email.trim())} data-testid="forgot">{copy.forgotPassword}</a></div>
          <PasswordInput id="password" autocomplete="current-password" bind:value={password} disabled={busy} testid="password-input" />
        </div>
        <button class="primary" type="submit" disabled={busy} data-testid="password-sign-in">{busy ? copy.working : copy.signIn}<span aria-hidden="true">→</span></button>
        <button type="button" class="outline" onclick={toCode} disabled={busy} data-testid="use-code">{copy.useCodeInstead}</button>
      </form>
    {:else}
      <form onsubmit={(ev) => { ev.preventDefault(); void sendCode(); }} aria-busy={busy}>
        <div class="field"><label for="email">{copy.emailLabel}</label><input id="email" type="email" autocomplete="email" placeholder={copy.emailPlaceholder} bind:value={email} data-testid="email-input" disabled={busy} /></div>
        <button class="primary" type="submit" disabled={busy} data-testid="send-code">{busy ? copy.working : copy.emailMeCode}<span aria-hidden="true">→</span></button>
      </form>
      <button type="button" class="text-button back" onclick={toPassword} disabled={busy} data-testid="use-password"><span aria-hidden="true">←</span>{copy.usePasswordInstead}</button>
    {/if}
  {/if}
  {#if error}<p class="error" role="alert" data-testid="error">{error}</p>{/if}
  {#if !rehearsal}<div class="switch">{authCopy.newHere} <a class="text-button" href="/join" data-testid="to-join">{authCopy.signUp}</a></div>{/if}
</AuthCard>
