import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The production build is a single self-contained HTML file (JS, CSS and the
// manifold WASM all inlined) so it can be opened straight from disk, offline.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  optimizeDeps: {
    exclude: ['manifold-3d'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 8000,
    assetsInlineLimit: 100_000_000,
  },
  server: {
    port: 5180,
    strictPort: false,
  },
});
