<script lang="ts">
  import { goto } from '$app/navigation';
  import { env } from '$env/dynamic/public';
  import { ClientResponseError } from 'pocketbase';
  import { auth, cancelJoin, joinCrew, joinStatus, resendJoin, verifyJoin } from '$lib/pb';
  import { clearBoarding, loadBoarding, saveBoarding, stepFor, type StoredBoarding } from '$lib/boarding';
  import { startGoogle } from '$lib/googleStart';
  import { authCopy, copy } from '$lib/labels';
  import AuthCard from '$lib/components/AuthCard.svelte';
  import Turnstile from '$lib/components/Turnstile.svelte';
  import PasswordInput from '$lib/components/PasswordInput.svelte';
  import { passwordProblem } from '$lib/password';
  import SignInButton from '$lib/components/SignInButton.svelte';
  import { typedEmail } from '$lib/signInEmail';
  import { onMount, tick } from 'svelte';

  const google = env.PUBLIC_GOOGLE_ENABLED === '1';
  let turnstile = $state<Turnstile>();
  let offline = $state(false);
  let step = $state<'start' | 'code' | 'waiting' | 'aboard' | 'turned_away' | 'expired'>('start');
  let name = $state(''), email = $state(''), password = $state(''), code = $state(''), token = $state('');
  let error = $state(''), notice = $state(''), busy = $state(false);
  let current = $state<StoredBoarding | null>(null);
  const title = $derived({ start: copy.boardTitle, code: authCopy.codeTitle, waiting: authCopy.waitingTitle,
    aboard: authCopy.approvedTitle, turned_away: authCopy.declinedTitle, expired: authCopy.expiredTitle }[step]);
  $effect(() => { if ($auth.user) void goto('/', { replaceState: true }); });
  const message = (e: unknown) => e instanceof ClientResponseError ? e.response?.message || copy.genericError : copy.genericError;
  const cleanName = () => name.trim().replace(/\s+/g, ' ');
  let epoch = 0;
  async function focus(id: string) { await tick(); document.getElementById(id)?.focus(); }
  onMount(() => {
    const stored = loadBoarding(localStorage, Date.now());
    if (stored) { current = stored; name = stored.name; email = stored.email; step = 'waiting'; void check(); }
    return () => { epoch++; };
  });
  $effect(() => {
    if (step !== 'waiting' && step !== 'code') return;
    const timer = setInterval(() => { if (!busy && document.visibilityState === 'visible') void check(); }, 5000);
    return () => clearInterval(timer);
  });
  // Newer actions own the screen: an old poll cannot undo verification or email correction.
  async function check() {
    const mine = current, asked = epoch;
    if (!mine) return;
    const stale = () => current !== mine || asked !== epoch;
    try {
      const next = stepFor((await joinStatus(mine.requestId, mine.secret)).status);
      if (stale()) return;
      offline = false; step = next;
      if (next !== 'code' && next !== 'waiting') clearBoarding(localStorage);
    } catch (e) {
      if (stale()) return;
      if ((e as { status?: number }).status === 404) { step = 'expired'; clearBoarding(localStorage); }
      else offline = true;
    }
  }
  async function run(action: () => Promise<void>) {
    if (busy) return; error = ''; notice = ''; busy = true;
    try { await action(); } catch (e) { error = message(e); } finally { busy = false; }
  }
  const start = (ev: SubmitEvent) => { ev.preventDefault();
    if (cleanName().length < 2 || cleanName().length > 32) { error = copy.nameError; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { error = copy.emailError; return; }
    const problem = passwordProblem(password); if (problem) { error = problem; return; }
    if (!token) return;
    void run(async () => {
      try {
        const r = await joinCrew(cleanName(), email.trim(), password, token);
        epoch++;
        const stored = { requestId: r.request_id, secret: r.secret, name: cleanName(), email: email.trim().toLowerCase(), savedAt: Date.now() };
        saveBoarding(localStorage, stored); current = stored; step = 'code';
        void focus('code');
      } finally { turnstile?.reset(); }
    }); };
  const verify = (ev: SubmitEvent) => { ev.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) { error = copy.codeError; return; }
    void run(async () => { await verifyJoin(current!.requestId, current!.secret, code.trim()); epoch++; step = 'waiting'; password = ''; }); };
  const again = () => void run(async () => { await resendJoin(current!.requestId, current!.secret); code = ''; notice = authCopy.resent; });
  const withGoogle = () => void run(() => startGoogle('join', cleanName()));
  const restart = () => {
    epoch++; clearBoarding(localStorage); current = null; step = 'start'; code = ''; error = ''; notice = ''; offline = false;
  };
  const changeEmail = () => void run(async () => {
    const mine = current;
    if (!mine) return;
    epoch++;
    try { await cancelJoin(mine.requestId, mine.secret); }
    catch (e) {
      if (e instanceof ClientResponseError && e.status === 409) { await check(); error = authCopy.requestChanged; return; }
      if (!(e instanceof ClientResponseError) || e.status !== 404) throw e;
    }
    name = mine.name; email = mine.email;
    restart(); void focus('email');
  });
</script>

<AuthCard {title} icon={step === 'code' ? 'mail' : step === 'waiting' ? 'clock' : step === 'aboard' ? 'check' : undefined}>
  {#if step === 'start'}
    <p class="intro">{copy.boardIntro}</p>
    {#if google}<div class="provider"><SignInButton provider="google" label={copy.continueGoogle} onclick={withGoogle} disabled={busy} testid="google" /></div><div class="divider"><span>{copy.orEmail}</span></div>{/if}
    <form onsubmit={start} aria-busy={busy}>
      <div class="field">
        <label for="name">{copy.name}</label>
        <input id="name" type="text" autocomplete="nickname" bind:value={name} data-testid="name-input" maxlength="32" disabled={busy} aria-describedby="name-hint" />
        <p class="field-hint" id="name-hint">{authCopy.nameHint}</p>
      </div>
      <div class="field"><label for="email">{copy.emailLabel}</label><input id="email" type="email" autocomplete="username" placeholder={copy.emailPlaceholder} bind:value={email} data-testid="email-input" disabled={busy} /></div>
      <div class="field"><label for="join-password">{copy.passwordField}</label><PasswordInput id="join-password" autocomplete="new-password" bind:value={password} disabled={busy} testid="password-input" /><small class="field-hint">{copy.passwordHint}</small></div>
      <Turnstile bind:this={turnstile} {google} ontoken={(t) => (token = t)} />
      <button class="primary" type="submit" disabled={busy || !token} data-testid="send-code">{busy ? copy.working : authCopy.continue}</button>
      <p class="next-hint">{authCopy.nextVerify}</p>
    </form>
  {:else if step === 'code'}
    <p class="intro">{current?.email ? authCopy.codeIntro : authCopy.codeNoEmail}{#if current?.email}<br /><strong class="destination">{current.email}</strong>{/if}</p>
    <button type="button" class="text-button change" onclick={changeEmail} disabled={busy} data-testid="change-email">{authCopy.changeEmail}</button>
    <form onsubmit={verify} aria-busy={busy}>
      <div class="field"><label for="code">{copy.codeLabel}</label><input id="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" bind:value={code} data-testid="code-input" disabled={busy} /></div>
      <button type="submit" class="primary" disabled={busy} data-testid="verify">{busy ? copy.working : copy.confirmCode}</button>
    </form>
    <p class="resend">{google ? copy.noCodeHint : copy.noCodeHintNoGoogle}<br /><button type="button" class="text-button" onclick={again} disabled={busy} data-testid="resend-code">{copy.sendAgain}</button></p>
    {#if google}<div class="provider"><SignInButton provider="google" label={copy.continueGoogle} onclick={withGoogle} disabled={busy} testid="google" /></div>{/if}
    {#if notice}<p class="notice" role="status">{notice}</p>{/if}
  {:else if step === 'waiting'}
    <p class="intro" data-testid="waiting">{copy.requestSent}</p>
    <ol class="steps">
      <li class="complete"><span aria-hidden="true">✓</span>{authCopy.verified}</li>
      <li class="current"><span aria-hidden="true">2</span>{authCopy.pending}</li>
      <li><span aria-hidden="true">3</span>{authCopy.nextSignIn}</li>
    </ol>
    <p class="info">{copy.requestSentHint}</p>
  {:else if step === 'aboard'}
    <p class="intro" data-testid="aboard">{authCopy.approvedIntro}</p>
    <a class="primary" href="/login" onclick={() => typedEmail.set(email)} data-testid="go-sign-in">{copy.signIn}</a>
  {:else if step === 'turned_away'}
    <p class="intro" data-testid="turned-away">{copy.turnedAway}</p>
  {:else}
    <p class="intro" data-testid="expired">{copy.requestExpired}</p>
    <button type="button" class="primary" onclick={restart}>{copy.boardAgain}</button>
  {/if}
  {#if offline && (step === 'code' || step === 'waiting')}<p class="info" data-testid="join-offline">{copy.noSignal}</p>{/if}
  {#if error}<p class="error" role="alert" data-testid="error">{error}</p>{/if}
  {#if step === 'start'}<div class="switch">{authCopy.alreadyAccount} <a class="text-button" href="/login" onclick={() => typedEmail.set(email)}>{copy.signIn}</a></div>
  {:else if step !== 'aboard'}<a class="text-button back" href="/login" onclick={() => typedEmail.set(email)}><span aria-hidden="true">←</span>{copy.backToSignIn}</a>{/if}
</AuthCard>
