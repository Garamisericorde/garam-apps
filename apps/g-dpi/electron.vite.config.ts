import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'node:path'
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin({ exclude: ['@garam/theme'] })] },
  preload: { plugins: [externalizeDepsPlugin({ exclude: ['@garam/theme'] })] },
  renderer: { root: resolve(__dirname, 'src/renderer'), resolve: { alias: { '@garam/theme/all.css': resolve(__dirname, '../../packages/theme/src/all.css') } }, build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } } },
})
