import { defineConfig } from 'vite'

export default defineConfig({
  // Tauri sabit bir port bekler ve hata durumunda basarisiz olmali.
  server: { port: 1420, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'esnext' },
  clearScreen: false,
})
