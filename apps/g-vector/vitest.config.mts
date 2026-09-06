import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The modules under test are pure geometry: no DOM, no Electron, no React.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
