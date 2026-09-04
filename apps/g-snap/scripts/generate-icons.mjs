/**
 * Generates the G-Snap icons: resources/icons/{tray.png, icon.png, icon.ico}
 * Not hand-edited — regenerate with `npm run icons`.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildIcons } from '../../../tools/icons/generate.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const result = await buildIcons({
  outDir: join(here, '..', 'resources', 'icons'),
  // Blue -> purple, so g-snap reads as its own app next to the crimson siblings.
  accent: { from: '#2563eb', to: '#9333ea' },
  glyph: 'crop',
})

console.log(`Icons written -> ${result.outDir}`)
console.log(`  ${result.files.join(', ')}`)
console.log(`  ICO sizes: ${result.icoSizes.join(', ')}`)
