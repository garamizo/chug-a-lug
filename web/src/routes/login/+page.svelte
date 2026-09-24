<script lang="ts">
  import { goto } from '$app/navigation';
  import { ClientResponseError } from 'pocketbase';
  import { login, auth } from '$lib/pb';
  import { copy } from '$lib/labels';

  let name = $state('');
  let password = $state('');
  let error = $state('');
  let busy = $state(false);

  $effect(() => { if ($auth.user) void goto('/', { replaceState: true }); });

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    error = '';
    const trimmed = name.trim().replace(/\s+/g, ' ');
    if (trimmed.length < 2 || trimmed.length > 32) { error = copy.nameError; return; }
    if (!password) { error = copy.passwordError; return; }
    busy = true;
    try { await login(trimmed, password); }
    catch (e: unknown) {
      error = e instanceof ClientResponseError ? e.response?.message || copy.genericError : copy.genericError;
    } finally { busy = false; }
  }
</script>

<h1>{copy.loginTitle}</h1>
<p>{copy.loginIntro}</p>

<form onsubmit={submit} aria-busy={busy}>
  <label for="name">{copy.name}</label>
  <input id="name" type="text" autocomplete="nickname" placeholder={copy.namePlaceholder} bind:value={name} data-testid="name-input" required minlength="2" maxlength="32" disabled={busy} />
  <label for="password">{copy.password}</label>
  <input id="password" type="password" autocomplete="current-password" bind:value={password} data-testid="password" required disabled={busy} />
  <button type="submit" disabled={busy} data-testid="login">{busy ? copy.working : copy.login}</button>
</form>

{#if error}<p class="error" role="alert" data-testid="error">{error}</p>{/if}
