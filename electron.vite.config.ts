import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'db-host': resolve(__dirname, 'src/db-host/index.ts')
        }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        // Force CJS output: package.json has "type": "module", which makes
        // electron-vite default the preload build to ESM (out/preload/index.mjs).
        // Preload scripts are loaded via webPreferences.preload, and main/index.ts
        // references the path as index.js, so pin the format explicitly.
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } }
    },
    plugins: [react()]
  }
})
