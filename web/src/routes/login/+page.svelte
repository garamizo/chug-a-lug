<script lang="ts">
  import { goto } from '$app/navigation';
  import { ClientResponseError } from 'pocketbase';
  import { normalizePhone } from '$lib/phone';
  import { startOtp, checkOtp, loginWithPin, auth } from '$lib/pb';
  import { copy } from '$lib/labels';

  let mode = $state<'login' | 'signup'>('login');
  let step = $state<'phone' | 'code'>('phone');
  let phoneInput = $state('');
  let pin = $state('');
  let code = $state('');
  let error = $state('');
  let busy = $state(false);

  $effect(() => { if ($auth.user) void goto('/', { replaceState: true }); });

  function phone(): string | null {
    const result = normalizePhone(phoneInput);
    if (!result) error = copy.phoneError;
    return result;
  }

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    error = ''; busy = true;
    try { await fn(); }
    catch (e: unknown) {
      error = e instanceof ClientResponseError ? e.response?.message || copy.genericError : copy.genericError;
    } finally { busy = false; }
  }

  function switchMode(next: 'login' | 'signup') {
    mode = next; step = 'phone'; error = ''; code = ''; pin = '';
  }

  const login = () => run(async () => {
    const p = phone(); if (!p) return;
    if (!/^[0-9]{4,8}$/.test(pin)) { error = copy.pinError; return; }
    await loginWithPin(p, pin);
  });
  const sendCode = () => run(async () => {
    const p = phone(); if (!p) return;
    await startOtp(p); step = 'code';
  });
  const verify = () => run(async () => {
    const p = phone(); if (!p) return;
    if (!/^[0-9]{4,8}$/.test(pin)) { error = copy.pinError; return; }
    await checkOtp(p, code, pin);
  });
</script>

<h1>{copy.loginTitle}</h1>
<p>{mode === 'signup' && step === 'code' ? copy.codeSent : copy.loginIntro}</p>

{#if mode === 'login'}
  <form onsubmit={(e) => { e.preventDefault(); void login(); }} aria-busy={busy}>
    <label for="phone">{copy.phone}</label>
    <input id="phone" type="tel" autocomplete="tel" placeholder={copy.phonePlaceholder} bind:value={phoneInput} data-testid="phone" required disabled={busy} />
    <label for="pin">{copy.pin}</label>
    <input id="pin" type="password" inputmode="numeric" autocomplete="current-password" bind:value={pin} data-testid="pin" required minlength="4" maxlength="8" pattern={'[0-9]{4,8}'} disabled={busy} />
    <button type="submit" disabled={busy} data-testid="login">{busy ? copy.working : copy.login}</button>
  </form>
  <button class="secondary" disabled={busy} onclick={() => switchMode('signup')} data-testid="to-signup">{copy.signup}</button>
{:else}
  {#if step === 'phone'}
    <form onsubmit={(e) => { e.preventDefault(); void sendCode(); }} aria-busy={busy}>
      <label for="phone">{copy.phone}</label>
      <input id="phone" type="tel" autocomplete="tel" placeholder={copy.phonePlaceholder} bind:value={phoneInput} data-testid="phone" required disabled={busy} />
      <button type="submit" disabled={busy} data-testid="send-code">{busy ? copy.working : copy.sendCode}</button>
    </form>
  {:else}
    <form onsubmit={(e) => { e.preventDefault(); void verify(); }} aria-busy={busy}>
      <label for="code">{copy.code}</label>
      <input id="code" inputmode="numeric" autocomplete="one-time-code" bind:value={code} data-testid="code" required pattern={'[0-9]{4,8}'} maxlength="8" disabled={busy} />
      <label for="new-pin">{copy.newPin}</label>
      <input id="new-pin" type="password" inputmode="numeric" autocomplete="new-password" bind:value={pin} data-testid="pin" required minlength="4" maxlength="8" pattern={'[0-9]{4,8}'} disabled={busy} />
      <button type="submit" disabled={busy} data-testid="verify">{busy ? copy.working : copy.verify}</button>
    </form>
    <button class="secondary" disabled={busy} onclick={() => { step = 'phone'; error = ''; code = ''; }}>{copy.changePhone}</button>
  {/if}
  <button class="secondary" disabled={busy} onclick={() => switchMode('login')} data-testid="to-login">{copy.backToLogin}</button>
{/if}

{#if error}<p class="error" role="alert" data-testid="error">{error}</p>{/if}
