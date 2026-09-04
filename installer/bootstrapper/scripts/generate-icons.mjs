/** Generates the setup icons: npm run icons */
import { buildIcons } from '../../../tools/icons/generate.mjs'

const r = await buildIcons({
  outDir: new URL('./src-tauri/icons/', import.meta.url).pathname.replace(/^\//, ''),
  accent: '#e94560',
  glyph: 'crop',
  tray: false, // the setup has no tray icon
})
console.log('setup icons written:', r.files.join(', '))
