import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

const alias = { '@shared': resolve(__dirname, 'src/shared') }

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'db-host': resolve(__dirname, 'src/db-host/index.ts')
        },
        // pg lazily/optionally requires pg-native behind a try/catch guard
        // (only touched via `pg.native` or NODE_PG_FORCE_NATIVE). Rollup's
        // commonjs interop otherwise hoists that require out of the guard
        // and turns the missing optional native binding into a hard crash
        // at process start. Keeping it external preserves pg's real runtime
        // require + try/catch.
        // ssh2 and related modules (tunnel-ssh, cpu-features) have optional
        // native bindings; mark them as external to preserve their guard clauses.
        external: ['pg-native', 'cpu-features']
      }
    }
  },
  preload: {
    resolve: { alias },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') }
        // Root package.json has "type": "module", so electron-vite emits the
        // preload build as ESM (out/preload/index.mjs). Electron (28+) loads
        // ESM preload scripts fine as long as sandbox is disabled (see
        // BrowserWindow webPreferences.sandbox: false in src/main/index.ts),
        // so we let it default to .mjs instead of forcing CJS output, which
        // would otherwise be misinterpreted as ESM under the root "type"
        // field and throw at load time once the preload does real work.
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } }
    },
    plugins: [react(), tailwindcss()]
  }
})
