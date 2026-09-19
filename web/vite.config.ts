import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    sveltekit(),
    SvelteKitPWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      workbox: { globPatterns: ['client/**/*.{js,css,ico,png,svg,webp,woff,woff2}'] },
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
