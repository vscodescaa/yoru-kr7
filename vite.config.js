import { defineConfig } from 'vite';

export default defineConfig({
  // En GitHub Pages el sitio cuelga de /<repo>/, no de la raíz.
  base: process.env.GITHUB_PAGES ? '/yoru-kr7/' : '/',
  build: {
    // three.js por sí solo ronda los 600 kB; es un único chunk a propósito.
    chunkSizeWarningLimit: 1100,
  },
});
