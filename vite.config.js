import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // three.js por sí solo ronda los 600 kB; es un único chunk a propósito.
    chunkSizeWarningLimit: 1100,
  },
});
