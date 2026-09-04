/** Renders every app's icon into one strip so the family can be judged at a glance. */
import { buildIcons } from './generate.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'icon-preview')
for (const [glyph, name] of [['crop', 'g-snap'], ['record', 'g-recorder'], ['note', 'g-note']]) {
  const r = await buildIcons({ outDir: join(out, name), accent: '#e94560', glyph, tray: true })
  console.log(`${name}: ${r.files.join(', ')}`)
}
