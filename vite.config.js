import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2019',
    chunkSizeWarningLimit: 1200,
  },
  server: {
    host: true,
  },
});
