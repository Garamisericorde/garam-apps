import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/**
 * @garam/* paketleri derlenmemis TypeScript kaynagi olarak tuketiliyor.
 * Bu yuzden externalize edilmemeleri gerekiyor — aksi halde paketlenmis
 * uygulamada `require('@garam/core')` calisma zamaninda bulunamaz.
 */
const GARAM_PACKAGES = ['@garam/core', '@garam/theme', '@garam/ui']

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: GARAM_PACKAGES })],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: GARAM_PACKAGES })],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
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
      rollupOptions: {
        // Iki ayri pencere: saydam tam ekran overlay ve normal ayarlar penceresi.
        input: {
          overlay: resolve(__dirname, 'src/renderer/overlay.html'),
          settings: resolve(__dirname, 'src/renderer/settings.html'),
        },
      },
    },
  },
})
