import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [svelte()],
  build: { target: 'es2022', sourcemap: false },
  server: {
    proxy: { '/api': 'http://localhost:3000', '/img': 'http://localhost:3000' },
  },
});
