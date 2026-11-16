<script lang="ts">
  // A Golden Spike driven into a tie: the celebration card's art, and the reel's. It fills its box.
  const uid = $props.id();
  const gold = `spike-gold-${uid}`;
</script>

<svg class="art" viewBox="0 0 64 64" aria-hidden="true">
  <defs>
    <linearGradient id={gold} x1="0" x2="1" y1="0" y2="1">
      <stop offset="0" stop-color="#fff2b0" /><stop offset=".45" stop-color="#f2c94c" /><stop offset="1" stop-color="#a87a12" />
    </linearGradient>
  </defs>
  <rect x="6" y="44" width="52" height="8" rx="2" fill="#5a4a2a" />
  <path d="M22 8h20l-4 6v26l-6 14-6-14V14z" fill="url(#{gold})" stroke="#7a5a0c" stroke-width="1.5" stroke-linejoin="round" />
</svg>

<style>
  .art { display: block; width: 100%; height: 100%; }
</style>
