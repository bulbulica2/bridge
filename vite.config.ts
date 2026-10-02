/// <reference types="vitest" />

import legacy from '@vitejs/plugin-legacy'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { defineConfig } from 'vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    legacy()
  ],
  // bridge_backend's CORS allows FRONTEND_URL (default http://localhost:3000),
  // and localhost:3000 is a Sanctum stateful domain, so serve the app there.
  server: {
    port: 3000,
    strictPort: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // npm run test:coverage (docs/RUNNING.md, Code coverage). `all` counts
    // the files no test imports too, so a page without tests shows as 0 %.
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.{ts,vue}'],
      // main.ts only mounts the app; the .d.ts files hold no code.
      exclude: ['src/main.ts', 'src/**/*.d.ts'],
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      // The whole app's floor: a run under any of these fails. Every file
      // also keeps 95 % of its lines (scripts/coverage-check.mjs). Branches
      // count each v-if/?. a template compiles to, hence the lower bar.
      lines: 95,
      statements: 95,
      functions: 95,
      branches: 90,
    },
  }
})
