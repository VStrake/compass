/**
 * Single-file demo build (Claude artifact / offline demo).
 * Proprietary and confidential. © Partners Real Estate.
 *
 *   npx vite build --config artifact/vite.config.mts
 *
 * Emits dist-artifact/index.html — one self-contained file with every script
 * and style inlined, suitable for hosts that forbid external requests.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

const editorRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root: editorRoot,
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../src', import.meta.url)),
      'pdfjs-dist': fileURLToPath(new URL('./pdfjs-stub.ts', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist-artifact',
    emptyOutDir: true,
    chunkSizeWarningLimit: 6000,
    rollupOptions: {
      input: fileURLToPath(new URL('./index.html', import.meta.url)),
      output: { inlineDynamicImports: true },
    },
  },
});
