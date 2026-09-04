/**
 * Generates the G-Note icons: resources/icons/{tray.png, icon.png, icon.ico}
 * Not hand-edited — regenerate with `npm run icons`.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildIcons } from '../../../tools/icons/generate.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const result = await buildIcons({
  outDir: join(here, '..', 'resources', 'icons'),
  accent: '#e94560',
  glyph: 'note',
})

console.log(`Icons written -> ${result.outDir}`)
console.log(`  ${result.files.join(', ')}`)
