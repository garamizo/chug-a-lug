<script lang="ts">
  // The role window: the Conductor sets someone's role (Crew, Trainspotter, Put off). Shared by the
  // Crew Board and the Manifest; each reloads its own list in `onsaved`.
  import { ClientResponseError } from 'pocketbase';
  import { copy, labels } from '$lib/labels';
  import { pb } from '$lib/pb';
  import type { Role } from '$lib/roles';
  let { person, onclose, onsaved }: {
    person: { id: string; name: string; role: Role }; onclose: () => void; onsaved: (role: Role) => void;
  } = $props();
  const options: { role: Role; name: string; hint: string }[] = [
    { role: 'crew', name: copy.roleCrew, hint: copy.roleCrewHint },
    { role: 'trainspotter', name: copy.roleTrainspotter, hint: copy.roleTrainspotterHint },
    { role: 'put_off', name: copy.rolePutOff, hint: copy.rolePutOffHint }
  ];
  // The caller mounts one window per person, so the starting choice is read once.
  // svelte-ignore state_referenced_locally
  let chosen = $state<Role>(person.role);
  let busy = $state(false), error = $state('');

  async function save() {
    // Putting someone off signs them out everywhere: ask once.
    if (chosen === 'put_off' && person.role !== 'put_off' && !confirm(copy.rolePutOffConfirm)) return;
    busy = true;
    error = '';
    try {
      await pb.send(`/api/crawl/users/${person.id}/role`, { method: 'POST', body: { role: chosen } });
    } catch (e) {
      error = e instanceof ClientResponseError && e.status && e.response?.message ? e.response.message : copy.noSignal;
      busy = false;
      return;
    }
    busy = false;
    onsaved(chosen);
    onclose();
  }
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') onclose(); }} />
<button type="button" class="scrim" aria-label={copy.close} onclick={onclose}></button>
<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="role-window-title" data-testid="role-window">
  <h2 id="role-window-title">{person.name}</h2>
  <fieldset>
    <legend>{labels.roleWindow}</legend>
    {#each options as o (o.role)}
      <label class="option">
        <input type="radio" name="role" value={o.role} bind:group={chosen} data-testid="role-option-{o.role}" />
        <span><strong>{o.name}</strong><small>{o.hint}</small></span>
      </label>
    {/each}
  </fieldset>
  {#if error}<p class="error" role="alert" data-testid="role-error">{error}</p>{/if}
  <button type="button" onclick={() => void save()} disabled={busy} data-testid="role-save">{copy.roleSave}</button>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 20; border: 0; border-radius: 0; margin: 0; padding: 0; width: auto; min-height: 0;
    background: rgba(0, 0, 0, .55); }
  .sheet { position: fixed; inset: auto 0 0; z-index: 20; background: #1b1b1b; border-top: 1px solid #444;
    border-radius: 16px 16px 0 0; padding: 18px 20px 24px; max-width: 760px; margin: 0 auto; }
  h2 { margin: 0 0 8px; font-size: 19px; overflow-wrap: anywhere; }
  fieldset { border: 0; margin: 0 0 8px; padding: 0; }
  legend { padding: 0; font-size: 13px; color: #9a9a9a; }
  .option { display: flex; align-items: flex-start; gap: 12px; padding: 12px 0; border-bottom: 1px solid #2a2a2a; min-height: 44px; }
  .option input { width: 24px; height: 24px; margin: 1px 0 0; flex: none; }
  .option span { display: grid; gap: 2px; }
  .option small { color: #9a9a9a; font-size: 13px; }
</style>
