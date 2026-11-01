/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { discoveryPlugin } from './scripts/discovery-plugin.ts'

export default defineConfig({
  plugins: [react(), discoveryPlugin('web')],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // Rich-text editor suites become CPU-bound when many JSDOM workers run together.
    maxWorkers: 1,
    // Node 25+ exposes an experimental global localStorage that is undefined without
    // --localstorage-file and shadows the JSDOM Storage implementation.
    execArgv: ['--no-experimental-webstorage'],
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // Use polling for reliable HMR on OneDrive-synced paths
      usePolling: true,
      interval: 500,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Use esbuild for CSS minification. lightningcss (vite 8 default) rejects
    // `@media (min-width: 100%)` which Tailwind emits from our container.screens
    // hack (sm/md/lg/xl=100%). Switching minifiers avoids a churn-y refactor of
    // the breakpoint config.
    cssMinify: 'esbuild',
    rollupOptions: {
      output: {
        // rolldown (vite 8) requires manualChunks to be a function,
        // not an object map. Mirror the previous vendor split.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom)[\\/]/.test(id)) {
            return 'vendor-react'
          }
          if (id.includes('@supabase/supabase-js')) {
            return 'vendor-supabase'
          }
          if (/[\\/]node_modules[\\/](date-fns|axios|lucide-react)[\\/]/.test(id)) {
            return 'vendor-utils'
          }
          // Rich-text editor stack (loaded when Time Management opens its note composer).
          if (/[\\/]node_modules[\\/](@tiptap[\\/][^\\/]+|prosemirror-[^\\/]+|linkifyjs|rope-sequence|orderedmap|w3c-keyname)[\\/]/.test(id)) {
            return 'vendor-editor'
          }
        },
      },
    },
  },
})
