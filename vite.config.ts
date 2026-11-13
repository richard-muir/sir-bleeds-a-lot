import { defineConfig } from 'vite';

// Relative base so the static build works from any sub-path (GitHub Pages, Netlify, a USB stick).
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
