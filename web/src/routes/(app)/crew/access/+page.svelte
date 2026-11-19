<script lang="ts">
  import { auth, pb } from '$lib/pb';
  import { accessEventLabels, copy, labels, signInMethodLabels } from '$lib/labels';
  import { fmtDateTime } from '$lib/time';
  import { roleOf, type Role } from '$lib/roles';
  import RoleWindow from '$lib/components/RoleWindow.svelte';
  type Person = { id: string; name: string; email: string; is_admin: boolean; role: Role; last_seen: string; created: string };
  type Row = { id: string; created: string; event: string; method: string; name: string; email: string; user: string; actor: string; ip: string; country: string; city: string; user_agent: string; detail: string };
  let data = $state<{ people: Person[]; log: Row[] } | null>(null);
  // A failed load hides nothing; a failed role save shows in the role window.
  let filter = $state(''), error = $state('');
  let editing = $state<{ id: string; name: string; role: Role } | null>(null);
  const load = async () => { try { data = await pb.send('/api/crawl/manifest', {}); error = ''; } catch { error = copy.loadError; } };
  $effect(() => { if ($auth.user?.is_admin) void load(); });
  const roleNames: Record<Role, string> = { crew: copy.roleCrew, trainspotter: copy.roleTrainspotter, put_off: copy.rolePutOff };
  const rows = $derived((data?.log ?? []).filter((r) => !filter || r.event === filter));
  const when = (s: string) => (s ? fmtDateTime(s.replace(' ', 'T')) : copy.never);
  const shown = (map: Record<string, string>, v: string) => map[v] ?? v;
</script>
<svelte:head><title>{labels.manifest}</title></svelte:head>
<h1>{labels.manifest}</h1>
{#if !$auth.user?.is_admin}<p>{copy.conductorOnly}</p>
{:else}
  {#if error}<p class="error" role="alert" data-testid="manifest-error">{error}</p>{/if}
  {#if data}
    {#each data.people as p (p.id)}
      <div class="row" data-testid="manifest-person">
        <strong>{p.name}{#if p.is_admin}<small> · {labels.admin}</small>{/if}</strong>
        <span class="email">{p.email}</span>
        <small data-testid="person-status">{copy.personStatus}: {p.is_admin ? labels.admin : roleNames[roleOf(p)]} · {copy.personSince}: {when(p.created)}</small>
        <small>{copy.lastSeen}: {when(p.last_seen)}</small>
        {#if !p.is_admin}<button type="button" class="secondary" onclick={() => (editing = { id: p.id, name: p.name, role: roleOf(p) })} data-testid="open-role-window">{copy.changeRole}</button>{/if}
      </div>
    {/each}
    <h2>{copy.accessLog}</h2>
    <select bind:value={filter} data-testid="log-filter"><option value="">{copy.allEvents}</option>{#each [...new Set(data.log.map((r) => r.event))] as ev (ev)}<option value={ev}>{shown(accessEventLabels, ev)}</option>{/each}</select>
    {#each rows as r (r.id)}<div class="row log" data-testid="log-row"><small>{when(r.created)} · {shown(accessEventLabels, r.event)}{#if r.method} ({shown(signInMethodLabels, r.method)}){/if} · {r.name || r.user || r.email} · {r.ip} {r.country} {r.city}{#if r.actor} · {copy.byWhom} {r.actor}{/if}{#if r.detail} · {r.detail}{/if}</small></div>{/each}
  {/if}
  <!-- Keyed by person: a window retargeted to someone else starts from their role, not the last choice. -->
  {#if editing}{#key editing.id}<RoleWindow person={editing} onclose={() => (editing = null)} onsaved={() => void load()} />{/key}{/if}
{/if}
<style>
  .row { padding: 10px 0; border-bottom: 1px solid #2a2a2a; display: grid; gap: 4px; }
  .email { color: #bbb; word-break: break-all; }
  small { color: #9a9a9a; }
  select { font: inherit; font-size: 15px; padding: 10px; min-height: 44px; border-radius: 10px; border: 1px solid #555; background: #202020; color: #fff; }
</style>
