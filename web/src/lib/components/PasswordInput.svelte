<script lang="ts">
  // A password field with a Show/Hide toggle (password spec §3.3). No maxlength: it counts UTF-16
  // units, and passwordProblem counts code points.
  import { copy } from '$lib/labels';
  let { value = $bindable(''), id, autocomplete, testid, disabled = false }: {
    value?: string; id: string; autocomplete: 'current-password' | 'new-password'; testid?: string; disabled?: boolean;
  } = $props();
  let shown = $state(false);
</script>

<div class="password">
  <input {id} type={shown ? 'text' : 'password'} {autocomplete} bind:value {disabled} data-testid={testid} />
  <button type="button" class="link" aria-pressed={shown} aria-controls={id} onclick={() => (shown = !shown)}
    data-testid={testid ? `${testid}-show` : undefined}>{shown ? copy.hidePassword : copy.showPassword}</button>
</div>

<style>
  .password { display: flex; gap: 8px; align-items: center; }
  .password input { flex: 1; min-width: 0; }
  .password button { flex: none; min-height: 48px; margin-top: 8px; padding: 0 8px; }
</style>
