import { defineConfig } from 'vite'

export default defineConfig({
  // Tauri expects a fixed port and should fail loudly if it is taken.
  server: { port: 1420, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'esnext' },
  clearScreen: false,
})
