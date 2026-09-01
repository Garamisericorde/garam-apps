/**
 * Generates the G-Recorder icons:
 * resources/icons/{icon.png, icon.ico, tray-idle-*.png, tray-recording-*.png}
 *
 * Not hand-edited — regenerate with `npm run icons`. This used to be a private
 * 198-line copy of the drawing code with its own hardcoded accent, which is why
 * the icon kept showing an accent the app had stopped using. It now comes from
 * the shared generator, so all three apps stay one visual language.
 */
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { buildIcons } from '../../../tools/icons/generate.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'resources', 'icons')

/** The app accent — the same blue-to-purple ramp @garam/theme paints with. */
const ACCENT = { from: '#2563eb', to: '#9333ea' }

/** Recording tray: red, because it has to read as "live" at 16px, not as brand. */
const RECORDING = { from: '#e5484d', to: '#b02a2f' }

const app = await buildIcons({
  outDir,
  accent: ACCENT,
  glyph: 'record',
  trayFiles: [
    { name: 'tray-idle-16.png', size: 16 },
    { name: 'tray-idle-32.png', size: 32 },
  ],
})

const recording = await buildIcons({
  outDir,
  accent: RECORDING,
  glyph: 'record',
  appIcon: false,
  trayFiles: [
    { name: 'tray-recording-16.png', size: 16 },
    { name: 'tray-recording-32.png', size: 32 },
  ],
})

console.log(`Icons written -> ${outDir}`)
console.log(`  ${[...app.files, ...recording.files].join(', ')}`)
console.log(`  ICO sizes: ${app.icoSizes.join(', ')}`)
