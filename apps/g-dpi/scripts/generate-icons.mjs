import { buildIcons } from '../../../tools/icons/generate.mjs'
import { fileURLToPath } from 'node:url'
await buildIcons({ outDir: fileURLToPath(new URL('../resources/icons/', import.meta.url)), accent: '#e94560', glyph: 'download' })
