/**
 * G-Snap simgelerini uretir: resources/icons/{tray.png, icon.png, icon.ico}
 * Elle duzenlenmez — `npm run icons` ile yeniden uretilir.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildIcons } from '../../../tools/icons/generate.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const result = await buildIcons({
  outDir: join(here, '..', 'resources', 'icons'),
  accent: '#e94560',
  glyph: 'crop',
})

console.log(`Simgeler uretildi -> ${result.outDir}`)
console.log(`  ${result.files.join(', ')}`)
console.log(`  ICO boyutlari: ${result.icoSizes.join(', ')}`)
