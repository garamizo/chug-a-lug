<script lang="ts">
  import { afterNavigate, goto, replaceState } from '$app/navigation';
  import { onMount } from 'svelte';
  import { ClientResponseError } from 'pocketbase';
  import { pb } from '$lib/pb';
  import { GOOGLE_KEY, readReturn, type GoogleState } from '$lib/google';
  import { startGoogle } from '$lib/googleStart';
  import { saveBoarding } from '$lib/boarding';
  import { authCopy, copy } from '$lib/labels';
  import AuthCard from '$lib/components/AuthCard.svelte';

  let error = $state(''), busy = $state(false), name = $state('');
  let phase = $state<'loading' | 'profile' | 'error'>('loading');
  // Capture once, before URL scrubbing. Codes remain in memory only and are never retried.
  const stored: GoogleState | null = (() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(GOOGLE_KEY) ?? 'null');
      sessionStorage.removeItem(GOOGLE_KEY); return value;
    } catch { return null; }
  })();
  const back = readReturn(new URL(location.href), stored);
  let authCode = back.ok ? back.code : '';
  let active = true;
  const cleanName = () => name.trim().replace(/\s+/g, ' ');
  const message = (e: unknown) => e instanceof ClientResponseError ? e.response?.message || copy.genericError : copy.genericError;
  const title = $derived(phase === 'profile' ? authCopy.profileTitle : phase === 'error' ? authCopy.googleFailedTitle : authCopy.googleTitle);
  afterNavigate(() => { if (location.search) replaceState(location.pathname, {}); });
  onMount(() => {
    if (!back.ok || !stored) { phase = 'error'; error = authCopy.googleReturnError; }
    else if (stored.mode === 'join') { name = stored.name; phase = 'profile'; }
    else void exchange();
    return () => { active = false; authCode = ''; };
  });
  async function exchange() {
    if (busy || !stored || !authCode) return;
    busy = true; error = '';
    const s = stored, code = authCode;
    authCode = '';
    try {
      const res = await pb.send<{ token?: string; record?: Record<string, unknown>; pending?: boolean; request_id?: string; secret?: string }>(
        '/api/collections/users/auth-with-oauth2', { method: 'POST', headers: { Authorization: '' },
          body: { provider: 'google', code, codeVerifier: s.codeVerifier, redirectURL: s.redirectUrl,
            ...(s.mode === 'join' ? { createData: { name: cleanName() } } : {}) } });
      if (!active) return;
      if (res.pending && res.request_id && res.secret) {
        saveBoarding(localStorage, { requestId: res.request_id, secret: res.secret, name: cleanName(), email: '', savedAt: Date.now() });
        await goto('/join', { replaceState: true });
      } else if (res.token && res.record) {
        pb.authStore.save(res.token, res.record as never);
        await goto('/', { replaceState: true });
      } else throw new Error('Missing OAuth outcome');
    } catch (e) { if (active) { error = message(e); phase = 'error'; } }
    finally { if (active) busy = false; }
  }
  function submit(ev: SubmitEvent) {
    ev.preventDefault();
    const n = cleanName();
    if (n.length < 2 || n.length > 32 || !/^[A-Za-z0-9][A-Za-z0-9 .'-]*$/.test(n)) { error = copy.nameError; return; }
    void exchange();
  }
  async function retry() {
    if (busy) return;
    busy = true;
    try { await startGoogle(stored?.mode ?? 'login', cleanName()); }
    catch (e) { error = message(e); }
    finally { busy = false; }
  }
</script>

<AuthCard {title}>
  {#if phase === 'profile'}
    <p class="intro">{authCopy.profileIntro}</p>
    <form onsubmit={submit} aria-busy={busy}>
      <div class="field"><label for="name">{copy.name}</label><input id="name" autocomplete="nickname" bind:value={name} maxlength="32" disabled={busy} aria-describedby="name-hint" data-testid="name-input" /><p id="name-hint" class="field-hint">{authCopy.nameHint}</p></div>
      <button type="submit" class="primary" disabled={busy} data-testid="request-join">{busy ? copy.working : authCopy.requestJoin}</button>
    </form>
  {:else if phase === 'loading'}<p class="intro" role="status">{copy.working}</p>{/if}
  {#if error}<p class="error" role="alert" data-testid="error">{error}</p>{/if}
  {#if phase === 'error'}
    <p class="info">{authCopy.googleRetryHint}</p>
    <button type="button" class="primary" disabled={busy} onclick={retry} data-testid="google-retry">{busy ? copy.working : authCopy.googleRetry}</button>
  {/if}
  <a class="text-button back" href="/login"><span aria-hidden="true">←</span>{copy.backToSignIn}</a>
  {#if stored?.mode === 'join' && phase !== 'error'}<a class="text-button back" href="/join">{authCopy.backToSignUp}</a>
  {:else if phase === 'error'}<div class="switch">{authCopy.newHere} <a class="text-button" href="/join">{authCopy.signUp}</a></div>{/if}
</AuthCard>
