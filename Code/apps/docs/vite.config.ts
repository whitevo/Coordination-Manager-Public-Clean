import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { discoveryPlugin } from '../web/scripts/discovery-plugin.ts'

export default defineConfig({
  plugins: [react(), discoveryPlugin('docs')],
  base: '/docs/',
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    fs: {
      allow: [path.resolve(import.meta.dirname, '../../..')],
    },
    watch: {
      usePolling: true,
      interval: 500,
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom)[\\/]/.test(id)) {
            return 'vendor'
          }
          if (id.includes('lucide-react')) {
            return 'icons'
          }
        },
      },
    },
  },
})
