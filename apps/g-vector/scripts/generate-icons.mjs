/**
 * Generates the G-Vector icons: resources/icons/{icon.png, icon.ico}
 * Not hand-edited — regenerate with `npm run icons`.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildIcons } from '../../../tools/icons/generate.mjs'

const here = dirname(fileURLToPath(import.meta.url))

/** The app accent — the same blue-to-purple ramp @garam/theme paints with. */
const ACCENT = { from: '#2563eb', to: '#9333ea' }

const result = await buildIcons({
  outDir: join(here, '..', 'resources', 'icons'),
  accent: ACCENT,
  glyph: 'node',
})

console.log(`Icons written -> ${result.outDir}`)
console.log(`  ${result.files.join(', ')}`)
