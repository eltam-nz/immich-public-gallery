import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'web',
  plugins: [svelte({ configFile: '../svelte.config.js' })],
  build: { outDir: '../dist/web', emptyOutDir: true, target: 'es2022', sourcemap: false },
  server: { proxy: { '/api': 'http://localhost:3001', '/img': 'http://localhost:3001' } },
});
