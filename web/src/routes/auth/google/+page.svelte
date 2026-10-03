<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { ClientResponseError } from 'pocketbase';
  import { pb } from '$lib/pb';
  import { GOOGLE_KEY, readReturn, type GoogleState } from '$lib/google';
  import { saveBoarding } from '$lib/boarding';
  import { copy } from '$lib/labels';
  let error = $state('');
  $effect(() => {
    let stored: GoogleState | null = null;
    try { stored = JSON.parse(sessionStorage.getItem(GOOGLE_KEY) ?? 'null'); } catch { stored = null; }
    sessionStorage.removeItem(GOOGLE_KEY);
    const back = readReturn(page.url, stored);
    if (!back.ok || !stored) { error = copy.genericError; return; }
    const s = stored;
    void (async () => {
      try {
        const res = await pb.send<{ token?: string; record?: Record<string, unknown>; pending?: boolean; request_id?: string; secret?: string }>(
          '/api/collections/users/auth-with-oauth2', { method: 'POST', headers: { Authorization: '' },
            body: { provider: 'google', code: back.code, codeVerifier: s.codeVerifier, redirectURL: s.redirectUrl, ...(s.mode === 'join' ? { createData: { name: s.name } } : {}) } });
        if (res.pending && res.request_id && res.secret) {
          saveBoarding(localStorage, { requestId: res.request_id, secret: res.secret, name: s.name, email: '', savedAt: Date.now() });
          await goto('/join', { replaceState: true });
        } else if (res.token && res.record) {
          pb.authStore.save(res.token, res.record as never);
          await goto('/', { replaceState: true });
        }
      } catch (e) { error = e instanceof ClientResponseError ? e.response?.message || copy.genericError : copy.genericError; }
    })();
  });
</script>
{#if error}<p class="error" role="alert">{error}</p><p><a href="/login">{copy.signIn}</a> · <a href="/join">{copy.boardTitle}</a></p>{:else}<p>{copy.working}</p>{/if}
