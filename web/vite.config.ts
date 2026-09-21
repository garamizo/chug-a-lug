import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    sveltekit(),
    SvelteKitPWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      // SSR is off and adapter-node serves the shell at /. Include that HTML with the build's
      // revision as well as the bundles, so a navigation in a tunnel can boot the application.
      kit: { spa: true, adapterFallback: '/' },
      workbox: {
        globPatterns: ['client/**/*.{js,css,ico,png,svg,webp,woff,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/metra/'),
            handler: 'NetworkFirst',
            options: { cacheName: 'metra', expiration: { maxEntries: 40, maxAgeSeconds: 86_400 }, networkTimeoutSeconds: 4 }
          },
          {
            // The live route uses its timestamped IDB mirror; other record reads can use this cache.
            urlPattern: ({ url, request }) => request.cache !== 'no-store' && url.pathname.startsWith('/api/collections/') && url.pathname.endsWith('/records'),
            handler: 'NetworkFirst',
            options: { cacheName: 'records', expiration: { maxEntries: 60, maxAgeSeconds: 86_400 }, networkTimeoutSeconds: 4 }
          }
        ]
      },
      manifest: {
        name: 'Chug-a-Lug Choo-Choo',
        short_name: 'Chugalug',
        start_url: '/',
        display: 'standalone',
        background_color: '#111111',
        theme_color: '#111111',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ],
  test: { include: ['tests/**/*.test.ts'], environment: 'node' }
});
