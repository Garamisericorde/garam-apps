import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      // Main-process modules touch Electron at import time; the stub keeps the
      // pure logic testable without an Electron runtime.
      electron: path.join(root, 'tests/mocks/electron.ts'),
      '@shared': path.join(root, 'app/shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
