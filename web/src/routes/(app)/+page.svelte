<script lang="ts">
  import { auth, logout } from '$lib/pb';
  import { label, copy } from '$lib/labels';
</script>

<h1>{copy.welcome} <span data-testid="name">{$auth.user?.name}</span></h1>
<p data-testid="role">{$auth.user?.is_admin ? label('admin') : label('users')}</p>
<p>{copy.homeIntro}</p>
<ul>
  {#each ['planningPhase', 'livePhase', 'wrapUpPhase'] as phase}
    <li><strong>{label(phase as 'planningPhase' | 'livePhase' | 'wrapUpPhase')}</strong><span>{copy.comingSoon}</span></li>
  {/each}
</ul>
<button class="secondary" onclick={logout} data-testid="logout">{copy.logout}</button>

<style>
  ul { list-style: none; padding: 0; margin: 28px 0; }
  li { padding: 18px 0; border-top: 1px solid #444; display: flex; justify-content: space-between; gap: 16px; }
  li span { font-size: 14px; color: #aaa; }
</style>
