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
  // Each caller keys the window by person id, so the starting choice is read once per person.
  // svelte-ignore state_referenced_locally
  let chosen = $state<Role>(person.role);
  let busy = $state(false), error = $state('');
  // A native modal: focus moves in, the page behind is inert, and Escape (the cancel event) closes it.
  let dialog = $state<HTMLDialogElement>();
  $effect(() => { if (dialog && !dialog.open) dialog.showModal(); });

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

<!-- The dialog has no padding of its own, so a click whose target is the dialog fell on the backdrop. -->
<dialog bind:this={dialog} class="role-window" aria-labelledby="role-window-title" data-testid="role-window"
  oncancel={(e) => { e.preventDefault(); onclose(); }}
  onclick={(e) => { if (e.target === dialog) onclose(); }}>
  <div class="body">
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
    <div class="actions">
      <button type="button" class="secondary" onclick={onclose} data-testid="role-cancel">{copy.roleCancel}</button>
      <button type="button" onclick={() => void save()} disabled={busy} data-testid="role-save">{copy.roleSave}</button>
    </div>
  </div>
</dialog>

<style>
  .role-window { margin: auto auto 0; width: 100%; max-width: 760px; max-height: 88dvh; padding: 0; border: 0; border-top: 1px solid #444;
    border-radius: 16px 16px 0 0; background: #1b1b1b; color: inherit; overflow-y: auto; overscroll-behavior: contain; }
  .role-window::backdrop { background: rgba(0, 0, 0, .55); }
  :global(html:has(dialog.role-window[open])) { overflow: hidden; }
  .body { padding: 18px 20px calc(24px + env(safe-area-inset-bottom)); }
  h2 { margin: 0 0 8px; font-size: 19px; overflow-wrap: anywhere; }
  fieldset { border: 0; margin: 0 0 8px; padding: 0; }
  legend { padding: 0; font-size: 13px; color: #9a9a9a; }
  .option { display: flex; align-items: flex-start; gap: 12px; padding: 12px 0; border-bottom: 1px solid #2a2a2a; min-height: 44px; }
  .option input { width: 24px; height: 24px; margin: 1px 0 0; flex: none; }
  .option span { display: grid; gap: 2px; }
  .option small { color: #9a9a9a; font-size: 13px; }
  .actions { display: flex; gap: 10px; }
  .actions button { flex: 1; }
</style>
