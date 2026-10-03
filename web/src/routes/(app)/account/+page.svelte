<script lang="ts">
  import { ClientResponseError } from 'pocketbase';
  import { auth, logout, pb } from '$lib/pb';
  import { copy, labels } from '$lib/labels';
  let name = $state($auth.user?.name ?? '');
  let note = $state(''), busy = $state(false);
  async function save(ev: SubmitEvent) {
    ev.preventDefault(); if (busy || !$auth.user) return; busy = true; note = '';
    try { const r = await pb.collection('users').update($auth.user.id, { name: name.trim().replace(/\s+/g, ' ') }); pb.authStore.save(pb.authStore.token, r); note = copy.saved; }
    catch (e) { note = e instanceof ClientResponseError ? e.response?.message || copy.genericError : copy.genericError; }
    finally { busy = false; }
  }
</script>
<svelte:head><title>{labels.yourTicket}</title></svelte:head>
<h1>{labels.yourTicket}</h1>
<form onsubmit={save}>
  <label for="name">{copy.yourName}</label>
  <input id="name" bind:value={name} maxlength="32" data-testid="account-name" />
  <button type="submit" disabled={busy} data-testid="account-save">{copy.save}</button>
</form>
<p>{copy.emailLabel}: <span data-testid="account-email">{$auth.user?.email}</span></p>
{#if note}<p role="status" data-testid="account-note">{note}</p>{/if}
<button type="button" class="secondary" onclick={logout}>{copy.logout}</button>
