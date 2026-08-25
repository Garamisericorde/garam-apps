/** Setup simgelerini uretir: npm run icons */
import { buildIcons } from '../../../tools/icons/generate.mjs'

const r = await buildIcons({
  outDir: new URL('./src-tauri/icons/', import.meta.url).pathname.replace(/^\//, ''),
  accent: '#e94560',
  glyph: 'crop',
  tray: false, // setup'in tepsi simgesi yok
})
console.log('setup simgeleri uretildi:', r.files.join(', '))
