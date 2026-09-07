/**
 * Generates the Garam Setup icons: src-tauri/icons/{icon.png, icon.ico}
 * Not hand-edited — regenerate with `npm run icons`.
 *
 * The output path used to be './src-tauri/icons/', which resolves against THIS
 * file and so wrote to scripts/src-tauri/icons/ — a directory the build never
 * reads. The generator reported success every time while the icon Tauri
 * compiled in stayed the crimson one from the first run.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildIcons } from '../../../tools/icons/generate.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const result = await buildIcons({
  outDir: join(here, '..', 'src-tauri', 'icons'),
  // The same ramp as the apps: the setup is their front door, not a fourth app.
  accent: { from: '#2563eb', to: '#9333ea' },
  glyph: 'download',
  tray: false, // the setup has no tray icon
})

console.log(`Icons written -> ${result.outDir}`)
console.log(`  ${result.files.join(', ')}`)
console.log(`  ICO sizes: ${result.icoSizes.join(', ')}`)
