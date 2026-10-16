
/// <reference types="vitest/config" />

import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { playwright } from '@vitest/browser-playwright'

// ============================================================
// Q-GUARD — Vite Configuration
// React Frontend + FastAPI Backend
// ============================================================

export default defineConfig({
  // ----------------------------------------------------------
  // Plugins
  // ----------------------------------------------------------
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],

  // ----------------------------------------------------------
  // Development Server
  // ----------------------------------------------------------
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,

    // Forward API requests to the Python FastAPI backend.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },

  // ----------------------------------------------------------
  // Module Resolution
  // ----------------------------------------------------------
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  // ----------------------------------------------------------
  // Vitest
  // ----------------------------------------------------------
  test: {
    silent: 'passed-only',
    unstubEnvs: true,

    browser: {
      enabled: true,
      provider: playwright(),

      instances: [
        {
          browser: 'chromium',
        },
      ],
    },

    coverage: {
      exclude: [
        'src/components/ui/**',
        'src/assets/**',
        'src/tanstack-table.d.ts',
        'src/routeTree.gen.ts',
        'src/test-utils/**',
        'src/routes/**',
      ],
    },
  },
})
