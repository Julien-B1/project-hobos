/**
 * Vite + Vitest configuration.
 *
 * The dev server runs inside the `app` Docker container (see compose.yaml), so
 * it must listen on all interfaces and keep a fixed port that Compose
 * publishes to the host.
 */
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'
import { compression } from './tooling/compression.ts'

/** Polling fallback for file watching, enabled with VITE_USE_POLLING=true. */
const usePolling = process.env.VITE_USE_POLLING === 'true'

export default defineConfig({
  plugins: [vue(), compression()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    watch: usePolling ? { usePolling: true, interval: 200 } : {},
  },
  optimizeDeps: {
    // Pre-bundled dependencies (Three.js, Vue) are served minified: the dev
    // server sends them with inline source maps, unminified they weigh
    // about 11 MB.
    rolldownOptions: { output: { minify: true } },
  },
  build: {
    // Three.js alone is ~800 kB minified; the default 500 kB warning is noise
    // for a game bundle. Revisit when code-splitting matters.
    chunkSizeWarningLimit: 1500,
  },
  preview: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  test: {
    // Unit tests target src/core (pure TypeScript), so a Node environment is
    // enough and fast. Use a per-file `@vitest-environment` comment if a DOM
    // is ever needed.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
