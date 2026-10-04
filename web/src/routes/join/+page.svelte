<script lang="ts">
  import { goto } from '$app/navigation';
  import { env } from '$env/dynamic/public';
  import { ClientResponseError } from 'pocketbase';
  import { auth, joinCrew, joinStatus, pb, resendJoin, verifyJoin } from '$lib/pb';
  import { clearBoarding, loadBoarding, saveBoarding, stepFor, type StoredBoarding } from '$lib/boarding';
  import { GOOGLE_KEY, buildAuthUrl } from '$lib/google';
  import { copy } from '$lib/labels';
  import Turnstile from '$lib/components/Turnstile.svelte';
  import PasswordInput from '$lib/components/PasswordInput.svelte';
  import { passwordProblem } from '$lib/password';
  import SignInButton from '$lib/components/SignInButton.svelte';
  import { onMount } from 'svelte';

  const google = env.PUBLIC_GOOGLE_ENABLED === '1';
  let turnstile = $state<Turnstile>();
  let offline = $state(false);
  let step = $state<'start' | 'code' | 'waiting' | 'aboard' | 'turned_away' | 'expired'>('start');
  let name = $state(''), email = $state(''), password = $state(''), code = $state(''), token = $state('');
  let error = $state(''), busy = $state(false);
  let current = $state<StoredBoarding | null>(null);
  $effect(() => { if ($auth.user) void goto('/', { replaceState: true }); });
  const message = (e: unknown) => e instanceof ClientResponseError ? e.response?.message || copy.genericError : copy.genericError;
  const cleanName = () => name.trim().replace(/\s+/g, ' ');

  // Resume a stored request once (spec §5). onMount, not $effect: check() reads `current`, and an
  // effect that both writes and reads it would re-run itself.
  onMount(() => {
    const stored = loadBoarding(localStorage, Date.now());
    if (stored) { current = stored; step = 'waiting'; void check(); }
  });
  // Poll while a request is open. Only `step` is tracked; check() runs inside the timer callback.
  $effect(() => {
    if (step !== 'waiting' && step !== 'code') return;
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void check(); }, 5000);
    return () => clearInterval(timer);
  });
  // Bumped whenever this page itself moves the request on (start, verify, restart): a status poll
  // asked before that answers for an older state, so a late 'unverified' cannot put a request that
  // was just verified back on the code step.
  let epoch = 0;
  // A 404 is definitive (unknown request or wrong secret); anything else is "try again later", and
  // the stored request is kept so a dead zone never costs someone their place in line.
  async function check() {
    const mine = current, asked = epoch;
    if (!mine) return;
    const stale = () => current !== mine || asked !== epoch;
    try {
      const next = stepFor((await joinStatus(mine.requestId, mine.secret)).status);
      if (stale()) return;
      offline = false;
      step = next;
      if (next !== 'code' && next !== 'waiting') clearBoarding(localStorage);
    } catch (e) {
      if (stale()) return;
      if ((e as { status?: number }).status === 404) { step = 'expired'; clearBoarding(localStorage); }
      else offline = true;
    }
  }
  async function run(action: () => Promise<void>) {
    if (busy) return; error = ''; busy = true;
    try { await action(); } catch (e) { error = message(e); } finally { busy = false; }
  }
  const start = (ev: SubmitEvent) => { ev.preventDefault();
    if (cleanName().length < 2 || cleanName().length > 32) { error = copy.nameError; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { error = copy.emailError; return; }
    const problem = passwordProblem(password); if (problem) { error = problem; return; }
    void run(async () => {
      try {
        const r = await joinCrew(cleanName(), email.trim(), password, token);
        epoch++;
        current = { requestId: r.request_id, secret: r.secret, name: cleanName(), email: email.trim().toLowerCase(), savedAt: Date.now() };
        saveBoarding(localStorage, current); step = 'code';
      } finally { turnstile?.reset(); } // the token is spent either way
    }); };
  const verify = (ev: SubmitEvent) => { ev.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) { error = copy.codeError; return; }
    void run(async () => { await verifyJoin(current!.requestId, current!.secret, code.trim()); epoch++; step = 'waiting'; }); };
  const again = () => void run(() => resendJoin(current!.requestId, current!.secret).then(() => {}));
  const withGoogle = () => {
    if (cleanName().length < 2 || cleanName().length > 32) { error = copy.nameError; return; }
    void run(async () => {
      pb.authStore.clear();
      const p = (await pb.collection('users').listAuthMethods()).oauth2.providers.find((x) => x.name === 'google');
      if (!p) throw new Error('google');
      const redirectUrl = `${location.origin}/auth/google`;
      sessionStorage.setItem(GOOGLE_KEY, JSON.stringify({ mode: 'join', name: cleanName(), state: p.state, codeVerifier: p.codeVerifier, redirectUrl }));
      location.href = buildAuthUrl(p.authURL, redirectUrl);
    });
  };
  const restart = () => { epoch++; clearBoarding(localStorage); current = null; step = 'start'; code = ''; };
</script>

<h1>{copy.boardTitle}</h1>
{#if step === 'start'}
  <p>{copy.boardIntro}</p>
  <form onsubmit={start} aria-busy={busy}>
    <label for="name">{copy.name}</label>
    <input id="name" type="text" autocomplete="nickname" placeholder={copy.namePlaceholder} bind:value={name} data-testid="name-input" maxlength="32" disabled={busy} />
    {#if google}<SignInButton provider="google" label={copy.continueGoogle} onclick={withGoogle} disabled={busy} testid="google" /><p>{copy.orEmail}</p>{/if}
    <label for="email">{copy.emailLabel}</label>
    <input id="email" type="email" autocomplete="email" placeholder={copy.emailPlaceholder} bind:value={email} data-testid="email-input" disabled={busy} />
    <label for="join-password">{copy.passwordField}</label>
    <PasswordInput id="join-password" autocomplete="new-password" bind:value={password} disabled={busy} testid="password-input" />
    <small class="hint">{copy.passwordHint}</small>
    <Turnstile bind:this={turnstile} ontoken={(t) => (token = t)} />
    <SignInButton provider="email" type="submit" label={busy ? copy.working : token ? copy.sendCode : copy.humanCheck} disabled={busy || !token} testid="send-code" />
  </form>
  <p><a href="/login">{copy.haveSeatSignIn}</a></p>
{:else if step === 'code'}
  <form onsubmit={verify} aria-busy={busy}>
    <p>{copy.codeSentTo} {current?.email}</p>
    <label for="code">{copy.codeLabel}</label>
    <input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" bind:value={code} data-testid="code-input" disabled={busy} />
    <button type="submit" disabled={busy} data-testid="verify">{busy ? copy.working : copy.confirmCode}</button>
    <p class="hint">{google ? copy.noCodeHint : copy.noCodeHintNoGoogle} <button type="button" class="link" onclick={again}>{copy.sendAgain}</button></p>
  </form>
{:else if step === 'waiting'}
  <p data-testid="waiting">{copy.requestSent}</p><p class="hint">{copy.requestSentHint}</p>
  {#if offline}<p class="hint" data-testid="join-offline">{copy.noSignal}</p>{/if}
{:else if step === 'aboard'}
  <p data-testid="aboard">{copy.youreAboard}</p><a class="button" href="/login" data-testid="go-sign-in">{copy.signIn}</a>
{:else if step === 'turned_away'}
  <p data-testid="turned-away">{copy.turnedAway}</p>
{:else}
  <p data-testid="expired">{copy.requestExpired}</p><button type="button" onclick={restart}>{copy.boardAgain}</button>
{/if}
{#if error}<p class="error" role="alert" data-testid="error">{error}</p>{/if}
