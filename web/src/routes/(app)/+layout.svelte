<script lang="ts">
  import { goto } from '$app/navigation';
  import { auth } from '$lib/pb';
  let { children } = $props();
  $effect(() => { if (!$auth.user) goto('/login'); });
</script>

{#if $auth.user}{@render children()}{/if}
