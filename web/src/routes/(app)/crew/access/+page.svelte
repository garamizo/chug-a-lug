<script lang="ts">
  import { auth, pb } from '$lib/pb';
  import { ClientResponseError } from 'pocketbase';
  import { accessEventLabels, copy, labels, requestStatusLabels, signInMethodLabels } from '$lib/labels';
  import { fmtDateTime } from '$lib/time';
  type Person = { id: string; name: string; email: string; is_admin: boolean; blocked: boolean; approved_by: string; last_seen: string; created: string };
  type Req = { id: string; name: string; email: string; method: string; status: string; country: string; city: string; user_agent: string; created: string; decided_by: string };
  type Row = { id: string; created: string; event: string; method: string; name: string; email: string; user: string; actor: string; ip: string; country: string; city: string; user_agent: string; detail: string };
  let data = $state<{ people: Person[]; requests: Req[]; log: Row[] } | null>(null);
  // A failed load and a failed Put off / Let back on are reported apart: neither hides the list.
  let filter = $state(''), error = $state(''), actionError = $state('');
  const load = async () => { try { data = await pb.send('/api/crawl/manifest', {}); error = ''; } catch { error = copy.loadError; } };
  $effect(() => { if ($auth.user?.is_admin) void load(); });
  async function block(id: string, off: boolean) {
    actionError = '';
    try { await pb.send(`/api/crawl/users/${id}/${off ? 'put-off' : 'let-back-on'}`, { method: 'POST' }); }
    catch (e) { actionError = e instanceof ClientResponseError && e.status && e.response?.message ? e.response.message : copy.noSignal; }
    await load();
  }
  const rows = $derived((data?.log ?? []).filter((r) => !filter || r.event === filter));
  const when = (s: string) => (s ? fmtDateTime(s.replace(' ', 'T')) : copy.never);
  const shown = (map: Record<string, string>, v: string) => map[v] ?? v;
</script>
<svelte:head><title>{labels.manifest}</title></svelte:head>
<h1>{labels.manifest}</h1>
{#if !$auth.user?.is_admin}<p>{copy.conductorOnly}</p>
{:else}
  {#if error}<p class="error" role="alert" data-testid="manifest-error">{error}</p>{/if}
  {#if actionError}<p class="error" role="alert" data-testid="manifest-action-error">{actionError}</p>{/if}
  {#if data}
    {#each data.people as p (p.id)}
      <div class="row" data-testid="manifest-person">
        <strong>{p.name}{#if p.is_admin}<small> · {labels.admin}</small>{/if}</strong>
        <span class="email">{p.email}</span>
        <small data-testid="person-status">{copy.personStatus}: {p.blocked ? copy.personPutOff : copy.personAboard} · {copy.personSince}: {when(p.created)}</small>
        <small>{copy.approvedBy}: {p.approved_by || copy.none} · {copy.lastSeen}: {when(p.last_seen)}</small>
        {#if !p.is_admin}<button type="button" class="secondary" onclick={() => void block(p.id, !p.blocked)} data-testid="toggle-block">{p.blocked ? copy.letBackOn : copy.putOff}</button>{/if}
      </div>
    {/each}
    <h2>{copy.recentRequests}</h2>
    {#each data.requests as r (r.id)}<div class="row"><strong>{r.name}</strong> <span class="email">{r.email}</span> <small>{shown(requestStatusLabels, r.status)} · {shown(signInMethodLabels, r.method)} · {r.country || copy.none} {r.city} · {when(r.created)}{#if r.decided_by} · {copy.byWhom} {r.decided_by}{/if}</small></div>{/each}
    <h2>{copy.accessLog}</h2>
    <select bind:value={filter} data-testid="log-filter"><option value="">{copy.allEvents}</option>{#each [...new Set(data.log.map((r) => r.event))] as ev (ev)}<option value={ev}>{shown(accessEventLabels, ev)}</option>{/each}</select>
    {#each rows as r (r.id)}<div class="row log"><small>{when(r.created)} · {shown(accessEventLabels, r.event)}{#if r.method} ({shown(signInMethodLabels, r.method)}){/if} · {r.name || r.user || r.email} · {r.ip} {r.country} {r.city}{#if r.actor} · {copy.byWhom} {r.actor}{/if}{#if r.detail} · {r.detail}{/if}</small></div>{/each}
  {/if}
{/if}
<style>
  .row { padding: 10px 0; border-bottom: 1px solid #2a2a2a; display: grid; gap: 4px; }
  .email { color: #bbb; word-break: break-all; }
  small { color: #9a9a9a; }
</style>
