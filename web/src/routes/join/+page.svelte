<script lang="ts">
  // Join link spec §4.2: /join#token → name, email, password → emailed code → signed in.
  import { goto } from '$app/navigation';
  import { ClientResponseError } from 'pocketbase';
  import { auth, checkJoinLink, resendSignup, startSignup, verifySignup } from '$lib/pb';
  import { authCopy, copy } from '$lib/labels';
  import AuthCard from '$lib/components/AuthCard.svelte';
  import PasswordInput from '$lib/components/PasswordInput.svelte';
  import { passwordProblem } from '$lib/password';
  import { typedEmail } from '$lib/signInEmail';
  import { clearSignup, loadSignup, saveSignup, tokenFromHash, type StoredSignup } from '$lib/signup';
  import { onMount } from 'svelte';

  let step = $state<'checking' | 'no-link' | 'dead' | 'form' | 'code' | 'maybe-ready'>('checking');
  let name = $state(''), email = $state(''), password = $state(''), code = $state('');
  let error = $state(''), notice = $state(''), busy = $state(false);
  // Plain (non-reactive) copy of what is stored: $state proxies are not what we want in storage.
  let current: StoredSignup | null = null;
  const title = $derived({ checking: copy.boardTitle, 'no-link': copy.boardTitle, dead: copy.boardTitle, form: copy.boardTitle, code: authCopy.codeTitle, 'maybe-ready': authCopy.maybeReadyTitle }[step]);
  $effect(() => { if ($auth.user) void goto('/', { replaceState: true }); });
  const status = (e: unknown) => (e instanceof ClientResponseError ? e.status : 0);
  const message = (e: unknown) => e instanceof ClientResponseError ? e.response?.message || copy.genericError : copy.genericError;
  const cleanName = () => name.trim().replace(/\s+/g, ' ');
  const isLinkDead = (e: unknown) => status(e) === 410 && message(e) === authCopy.linkDead;
  const keep = (s: StoredSignup) => { current = s; saveSignup(sessionStorage, s); };
  const dead = () => { clearSignup(sessionStorage); current = null; step = 'dead'; };
  // No token at all (not a dead one): a chat app's "Open in browser" can drop the fragment.
  const noLink = () => { clearSignup(sessionStorage); current = null; step = 'no-link'; };

  onMount(() => {
    // A link pasted into this tab changes only the fragment: no reload, so no new mount.
    const pasted = () => {
      const token = tokenFromHash(location.hash);
      if (!token) return;
      history.replaceState(history.state, '', '/join');
      if (busy || (step === 'code' && token === current?.token)) return;
      error = ''; notice = ''; stuck = false; code = ''; password = '';
      step = 'checking'; checkLink(token);
    };
    addEventListener('hashchange', pasted);
    const stored = loadSignup(sessionStorage);
    const fromHash = tokenFromHash(location.hash);
    if (location.hash) history.replaceState(history.state, '', '/join');
    // A mailed code outranks the link check: on the last seat the link may already read as full.
    if (stored?.codeSent && stored.signupId && stored.secret && !(fromHash && fromHash !== stored.token)) {
      current = stored; name = stored.name ?? ''; email = stored.email ?? ''; step = 'code';
    } else {
      const token = fromHash ?? stored?.token ?? null;
      if (token) checkLink(token); else noLink();
    }
    return () => removeEventListener('hashchange', pasted);
  });
  function checkLink(token: string) {
    keep({ token, savedAt: Date.now() });
    // Only the newest check counts. A 429 only means this IP checked too often; the form works
    // anyway, since the server checks the link again on submit.
    const mine = () => step === 'checking' && current?.token === token;
    void checkJoinLink(token).then(() => { if (mine()) step = 'form'; }, (e) => {
      if (!mine()) return;
      if (status(e) === 410) dead(); else { if (status(e) !== 429) error = message(e); step = 'form'; }
    });
  }
  // The code step cannot go on (code expired, name or seat taken): say why, offer a fresh start.
  let stuck = $state(false);
  const refused = (e: unknown) => status(e) === 410 || status(e) === 409;
  const startAgain = () => {
    const token = current?.token; error = ''; notice = ''; stuck = false; code = ''; password = '';
    if (!token) { noLink(); return; }
    step = 'checking'; checkLink(token);
  };

  async function run(action: () => Promise<void>) {
    if (busy) return; error = ''; notice = ''; busy = true;
    try { await action(); } catch (e) { error = message(e); } finally { busy = false; }
  }
  const start = (ev: SubmitEvent) => { ev.preventDefault();
    if (cleanName().length < 2 || cleanName().length > 32) { error = copy.nameError; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { error = copy.emailError; return; }
    const problem = passwordProblem(password); if (problem) { error = problem; return; }
    const token = current?.token;
    if (!token) { noLink(); return; }
    void run(async () => {
      try {
        const r = await startSignup(token, cleanName(), email.trim(), password);
        keep({ token, signupId: r.signup_id, secret: r.secret, name: cleanName(), email: email.trim().toLowerCase(), codeSent: true, savedAt: Date.now() });
        email = email.trim().toLowerCase(); password = ''; step = 'code';
      } catch (e) { if (isLinkDead(e)) dead(); else throw e; }
    }); };
  // One automatic retry when the answer is lost (the server may have committed, and a retry of the
  // same code returns the session again without a second seat).
  async function verifyOnce(s: StoredSignup, c: string) {
    try { await verifySignup(s.signupId!, s.secret!, c); }
    catch (e) { if (status(e) !== 0 || (e as ClientResponseError).isAbort) throw e; await verifySignup(s.signupId!, s.secret!, c); }
  }
  const verify = (ev: SubmitEvent) => { ev.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) { error = copy.codeError; return; }
    const s = current; if (!s) return;
    void run(async () => {
      try { await verifyOnce(s, code.trim()); }
      catch (e) {
        if (isLinkDead(e)) { dead(); return; }
        if (status(e) === 404) { clearSignup(sessionStorage); current = null; typedEmail.set(email); step = 'maybe-ready'; return; }
        if (refused(e)) stuck = true;
        throw e;
      }
      clearSignup(sessionStorage); current = null;
    }); };
  const again = () => void run(async () => {
    const s = current; if (!s) return;
    try { await resendSignup(s.signupId!, s.secret!); code = ''; stuck = false; notice = authCopy.resent; }
    catch (e) { if (isLinkDead(e)) dead(); else { if (refused(e)) stuck = true; throw e; } }
  });
</script>

<AuthCard {title} {busy} focusTarget={step === 'code' ? 'code' : step === 'form' ? 'name' : undefined} icon={step === 'code' ? 'mail' : undefined}>
  {#if step === 'checking'}
    <p class="intro" role="status" data-testid="join-checking">{authCopy.linkChecking}</p>
  {:else if step === 'dead'}
    <p class="intro" data-testid="join-dead">{authCopy.linkDead}</p>
  {:else if step === 'no-link'}
    <p class="intro" data-testid="join-no-link">{authCopy.noLink}</p>
  {:else if step === 'form'}
    <p class="intro">{copy.boardIntro}</p>
    <form onsubmit={start} aria-busy={busy}>
      <div class="field">
        <label for="name">{copy.name}</label>
        <input id="name" type="text" autocomplete="nickname" bind:value={name} data-testid="name-input" maxlength="32" disabled={busy} aria-describedby="name-hint" />
        <p class="field-hint" id="name-hint">{authCopy.nameHint}</p>
      </div>
      <div class="field"><label for="email">{copy.emailLabel}</label><input id="email" type="email" autocomplete="username" placeholder={copy.emailPlaceholder} bind:value={email} data-testid="email-input" disabled={busy} /></div>
      <div class="field"><label for="join-password">{copy.passwordField}</label><PasswordInput id="join-password" autocomplete="new-password" bind:value={password} disabled={busy} testid="password-input" /><small class="field-hint">{copy.passwordHint}</small></div>
      <button class="primary" type="submit" disabled={busy} data-testid="send-code">{busy ? copy.working : authCopy.continue}</button>
      <p class="next-hint">{authCopy.nextVerify}</p>
    </form>
  {:else if step === 'code'}
    <p class="intro">{authCopy.codeIntro}<br /><strong class="destination">{email}</strong></p>
    <form onsubmit={verify} aria-busy={busy}>
      <div class="field"><label for="code">{copy.codeLabel}</label><input id="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" maxlength="6" bind:value={code} data-testid="code-input" disabled={busy} /></div>
      <button type="submit" class="primary" disabled={busy} data-testid="verify">{busy ? copy.working : copy.confirmCode}</button>
    </form>
    <p class="resend">{copy.noCodeHint}<br /><button type="button" class="text-button" onclick={again} disabled={busy} data-testid="resend-code">{copy.sendAgain}</button></p>
    {#if notice}<p class="notice" role="status">{notice}</p>{/if}
    {#if stuck}<button type="button" class="primary" onclick={startAgain} data-testid="start-again">{authCopy.startAgain}</button>{/if}
  {:else}
    <div data-testid="join-maybe-ready">
      <p class="intro">{authCopy.maybeReadyIntro}</p>
      <a class="primary" href="/login" onclick={() => typedEmail.set(email)}>{copy.signIn}</a>
    </div>
  {/if}
  {#if error}<p class="error" role="alert" data-testid="error">{error}</p>{/if}
  {#if step === 'form'}<div class="switch">{authCopy.alreadyAccount} <a class="text-button" href="/login" onclick={() => typedEmail.set(email)}>{copy.signIn}</a></div>
  {:else if step !== 'maybe-ready'}<a class="text-button back" href="/login" onclick={() => typedEmail.set(email)}><span aria-hidden="true">←</span>{copy.backToSignIn}</a>{/if}
</AuthCard>
