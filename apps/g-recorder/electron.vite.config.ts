import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

/**
 * The @garam/* packages are consumed as uncompiled TypeScript source, so they
 * must NOT be externalized — otherwise the packaged app cannot resolve them at
 * runtime. They are bundled in, which is also what keeps each app standalone.
 */
const GARAM_PACKAGES = ['@garam/core', '@garam/theme', '@garam/ui']
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import path from 'path'

const root = process.cwd()

/**
 * The renderer's Content-Security-Policy has to live in a meta tag: the packaged
 * app loads index.html over file://, which webRequest header injection cannot
 * reach. Vite's dev server needs inline scripts and eval for HMR, so the policy
 * is relaxed for `dev` only and stays strict in every build.
 */
function cspPlugin(): Plugin {
  const shared =
    "default-src 'self'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: clip:; " + // data: for timeline thumbnails
    "media-src 'self' clip:; " + // clip: streams local video into the editor
    "font-src 'self'"

  const production = `script-src 'self'; connect-src 'self' clip:; ${shared}`
  const development =
    `script-src 'self' 'unsafe-inline' 'unsafe-eval'; ` +
    `connect-src 'self' clip: ws://localhost:* http://localhost:*; ${shared}`

  return {
    name: 'g-recorder-csp',
    transformIndexHtml(html, context) {
      const policy = context.server ? development : production
      return html.replaceAll('%CSP%', policy)
    },
  }
}

export default defineConfig({
  // electron-vite auto-discovers src/main/index.ts and src/preload/index.ts.
  // Those shims re-import the real implementations from app/main/ and app/preload/.
  main: {
    plugins: [externalizeDepsPlugin({ exclude: GARAM_PACKAGES })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: GARAM_PACKAGES })],
  },
  renderer: {
    // electron-vite auto-discovers src/renderer/index.html, which loads
    // ./main.tsx — a shim that imports the real entry from app/renderer/src/.
    // fs.allow lets the dev server resolve modules outside its own root.
    server: {
      fs: { allow: [root] },
    },
    resolve: {
      alias: {
        '@shared': path.join(root, 'app/shared'),
      },
    },
    plugins: [react(), cspPlugin()],
  },
})
