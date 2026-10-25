import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

const shared = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias: shared },
    // Personal installers (npm run dist:personal) may use the Claude Code plan engine; public ones never.
    define: { __SOLAMAR_PERSONAL__: JSON.stringify(process.env.SOLAMAR_PERSONAL_BUILD === '1') }
  },
  preload: {
    resolve: { alias: shared },
    // index: Solamar's own UI pages; page: every web page (runs before page scripts).
    // Sandboxed preloads cannot require packages, so the extensions toolbar code is bundled in.
    build: { externalizeDeps: { exclude: ['electron-chrome-extensions'] }, rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts'), page: resolve(__dirname, 'src/preload/page.ts') } } }
  },
  renderer: { resolve: { alias: shared }, plugins: [react()] }
})
