import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/**
 * The @garam/* packages are consumed as uncompiled TypeScript source, so they
 * must NOT be externalized — otherwise the packaged app cannot resolve them at
 * runtime. Bundling them in is also what keeps each app standalone.
 */
const GARAM_PACKAGES = ['@garam/core', '@garam/theme', '@garam/ui']

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: GARAM_PACKAGES })],
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: GARAM_PACKAGES })],
    resolve: { alias: { '@shared': resolve(__dirname, 'src/shared') } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@': resolve(__dirname, 'src/renderer/src'),
      },
    },
    plugins: [react()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
  },
})
